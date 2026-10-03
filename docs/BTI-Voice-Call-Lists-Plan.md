# BTI Voice — Call Lists (dialer list) Plan (draft 2026-10-03)

Danny's ask: load a list of contacts to call, work through it from inside the app, and when a call completes log the outcome (same disposition + note as the existing wrap-up) and take that entry off the list so the list always shows who's left. Must work for non-Zoho customers; anything Zoho goes behind `useFeatures()` like the rest of the app.

Paul's wishlist (2026-10-02) is mapped in §2 — some of it is in v1, the rest is parked on purpose. Paul's own worry ("this turns into a telemarketing CRM — stop before it goes crazy") is the design rule here: **v1 is a list, a Next button, and the wrap-up screen we already have.** Nothing else until the team has used it for real.

## 1. Where it lives — Voice, not Huddle

Danny asked whether this should be a Huddle thing now that it's getting robust, with Huddle reaching Voice's call/text features "through a connection".

**Recommendation: build it inside BTI Voice as its own tab ("Call Lists"), feature-flagged.** Reasons:

- The whole feature is *placing phone calls and logging them*. The Twilio softphone, call rows, recording, wrap-up screen, Zoho call logging — all of that is Voice. Huddle is WebRTC video + team chat between agents; it has no phone line.
- "Huddle shows the list, Voice makes the call" is exactly the remote-dial pattern we built and Danny rejected on 2026-08-27 (click-to-dial v1): the dial happened in a different window the user wasn't looking at. The v2 fix was to put a softphone *inside* the Zoho widget. Putting the list inside Voice is the same lesson.
- Same server, same DB, same login either way — nothing is lost by putting it in Voice. Later, Huddle can show "Paul is working the CBIA list, 12 left" in its people list or chat, because both read the same tables. That's a one-screen addition when wanted, not a reason to move the feature.
- Robustness isn't the deciding factor: Huddle is a *different kind of app* (meetings/chat), not "the big one". A feature belongs with the tool that performs the action.

## 2. Scope fence — v1 vs parked

| Paul's idea | v1? | How |
|---|---|---|
| 6. Contact only comes off when the user sets a call status (Call / NA / LM / Closed) | **Yes** | Entry closes only on a *closing* disposition. No answer / left voicemail / busy keep it on the list with an attempt count. |
| 6.1 Note window per call; if objective not met, stays on list | **Yes** | It's the existing wrap-up note. Every attempt is logged against the entry (date, agent, outcome, note). |
| 6.2 Callback date | **Yes** | "Callback requested" prompts an optional date/time. Entry shows "Call back Tue 2:00pm" and sorts to the top when due. |
| 7. Show the contact's local time | **Yes** | Area code → time zone table (works with phone number alone, so non-Zoho too). Zoho State/Country overrides when present. |
| 5. Come off the list *or* change colour when reached | **Yes (both)** | Default view is **Remaining**. Closed entries aren't deleted — they move to a greyed **Done** view (toggle). Nothing ever silently disappears. |
| 2 / 4. Who has access; give or restrict lists to users | **Yes, simple form** | List has an owner + "shared with": *just me* / *everyone* / *pick agents*. The app has no roles, so the owner is the admin of their list. |
| 1. Multiple lists: Zoho view / CSV / pick in app | **Yes** | §3. Zoho import is gated behind `features.zoho`. |
| 3. Show if a contact is on another list | **v1.5** | Cheap (a count badge) — add once lists exist and we see whether overlap is real. |
| 1 (first list). Script window with a dropdown of scripts | **Parked** | Different feature (content management). A plain "list notes" box at the top of each list covers the pilot need. |
| 1 (second list). Build searches and save them as a target list (location, prospect, empty PIMS) | **Parked** | For Zoho users this *is* a Zoho custom view — build the view in Zoho, import it here. For non-Zoho customers the app has nothing to search on except name/phone/notes. Revisit if a customer asks. |
| Anything that looks like a pipeline, stages, lead scoring, auto-dialling, power/predictive dialling | **No** | That's the CRM Paul doesn't want to build. |

## 3. How it works (user view)

**Call Lists tab** (desktop sidebar + phone bottom nav; hidden if the `call_lists` feature is off).

1. **Lists screen** — your lists and lists shared with you: name, remaining / total, last worked, owner. **+ New list** → name → add people by:
   - **Upload CSV** (name, phone, optional company/notes/state) — numbers normalised with the existing `phoneVariants()`, duplicates and opted-out contacts flagged before import.
   - **From Contacts** — tick contacts in the Contacts tab → "Add to list…".
   - **From Zoho CRM view** *(Zoho deploys only)* — pick a module (Leads / Contacts) and one of its custom views; records with a phone become entries, keeping the Zoho record id so wrap-up logs to the right CRM record. "Re-import" adds new view members without touching existing entries.
2. **Working a list** — Remaining entries, sorted: due callbacks first, then untried, then fewest attempts. Each row: name, company, phone, **local time**, attempts, last outcome, "on N other lists" (v1.5). **Call** on a row dials from the Dialpad as today (click-to-call already exists). A **Next** button at the top dials the first remaining entry so the agent never hunts.
3. **After the call:**
   - Connected ≥ 15 s → the existing **wrap-up screen** opens as today (disposition pills, note, Zoho contact picker when Zoho is on). Saving it also updates the list entry.
   - Short / unanswered call → a small **outcome strip** (No answer · Left voicemail · Busy · Wrong number · Skip for now) because the wrap-up screen doesn't open for those today.
   - Closing dispositions (`demo_scheduled`, `not_interested`, `wrong_number`, `existing_customer_support`, `other`) → entry moves to **Done**. Retaining outcomes (`left_voicemail`, `callback_requested`, `no_answer`, `busy`) → stays, attempts +1, callback date if given. Optional per-list **max attempts** (default: none) auto-closes as "Max attempts".
4. **Done view** — greyed rows with final outcome, who, when; "Reopen" puts one back. **Export CSV** of the whole list with outcomes (this is the report; no reporting screens in v1).
5. Shared lists update live over the existing socket, so two agents working the same list never dial the same person twice (an entry is **held** by whoever's on the call).

## 4. Data model + API (server)

Tables (added in `db.js` with `CREATE TABLE IF NOT EXISTS`, same style as everything else):

- `call_lists` — id, name, notes, owner_agent_id, visibility (`owner` | `all` | `agents`), source (`csv` | `contacts` | `zoho_view`), zoho_module, zoho_view_id, max_attempts, created_at, archived_at.
- `call_list_agents` — list_id, agent_id (for `visibility = 'agents'`).
- `call_list_entries` — id, list_id, contact_id (FK contacts; created on import if new), display_name, company, zoho_record_id, zoho_module, status (`open` | `done`), attempts, last_outcome, last_attempt_at, callback_at, held_by_agent_id, held_at, closed_at, closed_by_agent_id, sort_key, UNIQUE (list_id, contact_id).
- `call_list_attempts` — id, entry_id, call_id (FK calls, nullable for "skip"), agent_id, outcome, note, created_at.

Routes `server/routes/callLists.js` mounted at `/api/call-lists` (all `requireAuth`, visibility enforced in every query):
- `GET /` · `POST /` · `PATCH /:id` · `DELETE /:id` (archive) · `GET /:id` (entries, `?view=open|done`)
- `POST /:id/entries` (body: rows from CSV or contact ids) · `POST /:id/import/zoho` (`{module, view_id}`) · `GET /zoho/views?module=` *(404 unless Zoho configured — mirrors other Zoho routes)*
- `POST /:id/entries/:eid/hold` · `POST /:id/entries/:eid/outcome` (`{outcome, note, callback_at, call_id}`) · `POST /:id/entries/:eid/reopen` · `GET /:id/export.csv`

Hook into the existing wrap-up: `POST /calls/:id/wrap-up` accepts an optional `list_entry_id`; when present it records the attempt and updates the entry in the same transaction (so one Save does both). The client passes it because `dialTo()` learns which entry it's dialling. Fallback: if no entry id but the call's contact has exactly one *held-by-this-agent* open entry, use that.

Sockets: `call_list_updated { list_id }` → clients re-fetch that list. Zoho: outcome logging to the CRM is unchanged — it's the same wrap-up call as today.

Feature flag: new key `call_lists` in `deploySettings.js` `FEATURE_KEYS` (default ON like recording/sms — it's useful to every customer), exposed in `GET /api/features`, toggleable from the portal. Zoho import UI additionally needs `features.zoho`.

Local time: `server/helpers/areaCodeTz.js` — static NANP area-code → IANA zone map (US + Canada), returned per entry as `tz`; client renders `Intl.DateTimeFormat` in that zone. Unknown/non-NANP → blank.

## 5. Non-Zoho customers

Everything in §3 works with CSV + Contacts. Hidden without Zoho: the "From Zoho CRM view" option, the Zoho contact picker inside the wrap-up (already gated), and the Zoho record id columns are simply null. Tested the same way as 2026-09-30: log in on the CBIA deploy and confirm no CRM wording anywhere in the tab.

## 6. Decisions for Danny (the bracketed ones from the ask, plus Paul's)

1. **List source v1** — proposed: **all three** (CSV, pick from Contacts, Zoho view behind the flag). Dropping Zoho view would save ~a third of the build but BTI's own use is Zoho views. Keep all three?
2. **Per agent or shared** — proposed: **owner + share setting** (just me / everyone / pick agents). Default for a new list: just me. OK?
3. **No answer / voicemail** — proposed: **keep with attempt count**, closes only on a closing disposition (Paul #6). Optional max-attempts per list, default off. OK?
4. **Remove vs recolour** — proposed: **Remaining / Done views**; nothing deleted; Done is grey. OK, or do you want closed rows gone entirely?
5. **Callback date** — in v1 via the existing "Callback requested" disposition. OK?
6. **Local time** — area-code based, in v1. OK?
7. **Parked items** (scripts, saved searches, cross-list badge in v1.5) — agree to park, and use this doc as the agenda for the call with Paul?

## 7. Build order

Two sessions, each ending in a commit Danny pushes (no Co-Authored-By lines):

- **Session A — server + lists.** Tables, routes, feature key, area-code map, unit tests for outcome rules (`server/test/callLists.test.js`), CSV + Contacts import, Zoho view import (gated). Lists screen + working view + Call/Next + outcome strip + wrap-up hook. Runtime-test on BTI's deploy.
- **Session B — polish.** Shared-list live updates + hold, Done view + reopen, CSV export, phone layout (IS_TOUCH), portal Features tab shows `call_lists`, DEPLOY-RUNBOOK note, handoff §8v, TODO. Test on the CBIA deploy as a non-Zoho customer.

No new Electron build needed — this is all server + web client, so it reaches the desktop apps on push (gotcha #1).
