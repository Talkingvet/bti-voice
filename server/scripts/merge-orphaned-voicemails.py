"""
One-off repair (run 2026-08-13): recordings misfiled as voicemails.

Background
----------
Twilio's recordingStatusCallback payload never includes From/To. The old
/webhooks/voice/recording-complete handler read `req.body.From`, got undefined,
and fell back to the literal string 'unknown' -- so every recording was filed
against a single junk contact whose phone_number is 'unknown'.

Worse, its lookup used:

    WHERE ca.twilio_call_sid = $1 OR ca.status = 'voicemail'

The OR clause matched ANY historical voicemail, so the handler almost never
found the correct row and instead inserted a brand-new 'voicemail' row. The
result: recordings of ordinary agent-placed calls became phantom voicemails.
Those phantom rows carried the recording, transcript and true duration, while
the genuine call row had no recording and duration = 0.

Both bugs are fixed in server/webhooks/voice.js as of this commit:
  * the voicemail TwiML path now passes ?vm=1&from=<caller> on the callback URL
  * the lookup matches on twilio_call_sid only
  * non-voicemail recordings retry once and never fabricate a voicemail row
  * created voicemail rows now store twilio_call_sid

What this script does
---------------------
For each call attached to the junk contact, find real call rows started within
-4min/+90s. If exactly one candidate exists and it has no recording, merge the
recording / recording_sid / transcript / summary / duration onto that row and
delete the duplicate. Rows with zero or 2+ candidates are left untouched for
manual review. Call 9 was confirmed via the Twilio API to be a genuine inbound
voicemail from +12395959310 and is re-filed to that contact.

Outcome on 2026-08-13: 16 merged, 1 re-filed, 18 left for review (exported to
BTI-Voice-voicemail-review.csv). The junk contact still holds those 18 and was
renamed 'Unknown caller' rather than deleted.

Usage
-----
    export DATABASE_URL='postgresql://...'
    python3 merge-orphaned-voicemails.py           # dry run, writes nothing
    python3 merge-orphaned-voicemails.py --apply   # commit changes

Safe to re-run: it only ever looks at calls attached to the 'unknown' contact.
"""

import os
import sys

import psycopg2

APPLY = "--apply" in sys.argv

U = os.environ.get("DATABASE_URL")
if not U:
    sys.exit("Set DATABASE_URL in the environment.")

# Confirmed via the Twilio REST API: this row is a real inbound voicemail.
GENUINE_VM = {9: "+12395959310"}

c = psycopg2.connect(U)
cur = c.cursor()

cur.execute("select id from contacts where phone_number='unknown'")
r = cur.fetchone()
if not r:
    sys.exit("No junk contact (phone_number='unknown') -- nothing to do.")
junk = r[0]

cur.execute(
    """select ca.id, ca.started_at, ca.duration, ca.recording_url, ca.recording_sid,
              ca.transcription, ca.ai_summary
         from calls ca
         join conversations cv on cv.id = ca.conversation_id
        where cv.contact_id = %s
        order by ca.started_at""",
    (junk,),
)
rows = cur.fetchall()

merged, review, vmfixed = [], [], []

for cid, st, dur, rec, rsid, tr, ai in rows:
    if cid in GENUINE_VM:
        vmfixed.append((cid, st, dur, GENUINE_VM[cid]))
        continue
    cur.execute(
        """select ca.id, ca.started_at, ca.direction, ca.duration, co.phone_number,
                  ca.recording_url is not null
             from calls ca
             join conversations cv on cv.id = ca.conversation_id
             join contacts co      on co.id = cv.contact_id
            where ca.id <> %s
              and co.phone_number <> 'unknown'
              and ca.started_at between %s - interval '4 minutes'
                                    and %s + interval '90 seconds'
            order by abs(extract(epoch from (ca.started_at - %s)))""",
        (cid, st, st, st),
    )
    m = cur.fetchall()
    if len(m) == 1 and not m[0][5]:
        merged.append((cid, st, dur, rec, rsid, tr, ai, m[0]))
    else:
        review.append((cid, st, dur, len(m), m))

print(f"MERGE (clean): {len(merged)}   REVIEW: {len(review)}   VOICEMAIL re-file: {len(vmfixed)}")

print("\n--- will merge ---")
for cid, st, dur, rec, rsid, tr, ai, tgt in merged:
    print(f"  junk {cid} ({str(st)[:16]}, {dur}s) -> call {tgt[0]} {tgt[4]} {tgt[2]}"
          f"  [transcript={'Y' if tr else 'n'}]")

print("\n--- needs review ---")
for cid, st, dur, n, m in review:
    cands = ", ".join(f"{x[0]}:{x[4]}" for x in m) or "none"
    print(f"  junk {cid} ({str(st)[:16]}, {dur}s) candidates={n} [{cands}]")

print("\n--- genuine voicemail ---")
for cid, st, dur, num in vmfixed:
    print(f"  junk {cid} ({str(st)[:16]}, {dur}s) -> re-file to {num}")

if not APPLY:
    print("\nDRY RUN -- nothing written. Pass --apply to commit.")
    sys.exit(0)

for cid, st, dur, rec, rsid, tr, ai, tgt in merged:
    cur.execute(
        """update calls set
             recording_url = coalesce(recording_url, %s),
             recording_sid = coalesce(recording_sid, %s),
             transcription = coalesce(transcription, %s),
             ai_summary    = coalesce(ai_summary, %s),
             duration      = case when coalesce(duration, 0) = 0 then %s else duration end
           where id = %s""",
        (rec, rsid, tr, ai, dur, tgt[0]),
    )
    cur.execute("delete from calls where id = %s", (cid,))

for cid, st, dur, num in vmfixed:
    cur.execute("select id from contacts where phone_number = %s", (num,))
    ct = cur.fetchone()
    if not ct:
        cur.execute(
            "insert into contacts (phone_number, name) values (%s, %s) returning id",
            (num, num),
        )
        ct = cur.fetchone()
    contact_id = ct[0]
    cur.execute(
        "select id from conversations where contact_id = %s order by created_at desc limit 1",
        (contact_id,),
    )
    cv = cur.fetchone()
    if not cv:
        cur.execute(
            "insert into conversations (contact_id, last_message_at) values (%s, NOW()) returning id",
            (contact_id,),
        )
        cv = cur.fetchone()
    cur.execute("update calls set conversation_id = %s where id = %s", (cv[0], cid))

cur.execute(
    """select count(*) from calls ca
         join conversations cv on cv.id = ca.conversation_id
        where cv.contact_id = %s""",
    (junk,),
)
left = cur.fetchone()[0]
if left == 0:
    cur.execute("delete from conversations where contact_id = %s", (junk,))
    cur.execute("delete from contacts where id = %s", (junk,))
    print("\nJunk contact deleted.")
else:
    cur.execute("update contacts set name = 'Unknown caller' where id = %s", (junk,))
    print(f"\nJunk contact kept ({left} calls remain), renamed 'Unknown caller'.")

c.commit()
print("APPLIED.")
