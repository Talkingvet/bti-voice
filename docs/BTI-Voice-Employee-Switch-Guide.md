# Switching from Zoho Voice to BTI Voice — Employee Guide

*First run: Rick. Then the same steps for everyone else, one person at a time.*
*Written 2026-09-23. Items marked **CONFIRM** are things we have not verified yet — check them before you rely on them.*

---

## The short version

1. Your existing phone number moves from Zoho Voice into BTI Voice. It stays the same number — customers notice nothing.
2. Until the move day, you keep using Zoho Voice exactly as before.
3. On the move day, calls and texts to your number start arriving in BTI Voice instead of Zoho Voice. Zoho Voice stops ringing for that number.
4. Zoho Voice history (call logs, recordings, voicemails) does **not** move over. We export it before the switch.

---

## Will there be downtime?

- **Before move day:** none. Nothing changes until the number actually transfers.
- **On move day:** the number cuts over in a matter of minutes, during business hours (usually morning ET — the exact date is given to us in advance by Twilio, our carrier behind BTI Voice). A call placed in that exact window could fail. Plan not to be on an important call that morning.
- **Text messages:** calls work immediately after cutover. Texting to/from a freshly moved number can lag by up to 1–2 days while the messaging routes update. If a text doesn't arrive on move day, that's expected — test again the next day.
- **If the transfer is rejected** (wrong account details), nothing breaks — the number simply stays on Zoho Voice and we fix the details and resubmit. Each rejection costs roughly 1–2 weeks.

---

## Downsides / differences to know about (be honest with the team)

| Topic | Zoho Voice | BTI Voice |
|---|---|---|
| Ringing on your iPhone when the app is closed | Yes | **No.** The iPhone app only rings while it is open on screen. Use the desktop app or browser as your main phone. Background ringing (CallKit) is a future project. |
| Desk phone / SIP handset | Supported | **Not supported.** Softphone only (desktop app, browser, iPhone app while open). |
| Call history, recordings, voicemails from before the switch | In Zoho Voice | **Not migrated.** Export what you need before we cancel Zoho Voice (see Step 3). |
| Contacts | Zoho Voice contacts | Pulled from Zoho CRM — nothing to move. |
| Call recording | Per Zoho Voice settings | On or off company-wide. If on, callers hear a short disclosure (required in Florida). |
| Call transfer, hold, conference | Per Zoho Voice | **CONFIRM** — verify which of these BTI Voice supports before moving anyone who depends on them. |
| Click-to-call from Zoho CRM | Via Zoho Voice's CRM integration | Via the BTI Voice widget inside Zoho CRM (📞 / 💬 buttons). **CONFIRM** the Zoho Voice telephony integration in CRM is disabled after the switch so CRM doesn't try to dial through Zoho Voice. |
| Call/SMS logging in CRM | Zoho Voice logs to CRM | BTI Voice logs to the **BTI Voice** custom module in CRM (calls, SMS digests, transcripts and AI summaries). |

---

## Step-by-step

### Step 1 — Before anything else (admin: Danny)

- [ ] Confirm the employee already has a BTI Voice login and can sign in on the desktop app or in the browser. (Rick: account `rick`, agent 4 — done.)
- [ ] Have them change their password (Settings → Profile → Change Password) if the app still shows the default-password banner.
- [ ] Write down what they use in Zoho Voice today: transfer? mobile app? desk phone? voicemail greeting? Anything in the **CONFIRM** rows above that they depend on must be checked in BTI Voice first.
- [ ] Write down their Zoho Voice number exactly (with area code).

### Step 2 — Get the port-out details from Zoho Voice (admin)

- [ ] Log in to Zoho Voice as admin → Billing/Settings. Look for an account number and a porting PIN. **CONFIRM** whether Zoho exposes these — if not:
- [ ] Email **support@zohovoice.com** from the admin address asking for: the account number and PIN for the carrier of record, the exact account holder name and service address on file for the number, and confirmation that no port-out lock is set.
- [ ] Save a PDF or screenshot of the Zoho Voice invoice/billing page showing the number and account name (Twilio asks for a bill dated within the last 30 days).

### Step 3 — Export Zoho Voice history (employee, with admin help)

- [ ] Download any call recordings or voicemails you want to keep.
- [ ] Export your call log if you need it (Zoho Voice → Reports/Logs → export). **CONFIRM** the exact export option in Zoho Voice.
- [ ] Note your voicemail greeting text so it can be re-recorded if BTI Voice supports per-user greetings (**CONFIRM**).

### Step 4 — Submit the port request to Twilio (admin, ~15 min)

- [ ] Twilio Console → **Phone Numbers → Manage → Port & Host → Port a number**.
- [ ] Run the number through the portability checker. If it says "not portable," stop and ask Zoho support why.
- [ ] Start a port-in request. Enter the account holder name, address, account number and PIN **exactly as Zoho gave them** — character for character. Mismatches are the #1 reason ports get rejected.
- [ ] Upload the invoice/screenshot from Step 2.
- [ ] Name the authorized signer (the Zoho Voice account owner at BTI). Twilio emails them a Letter of Authorization to e-sign. **It must be signed within 30 days** or the request cancels itself.
- [ ] Submit. There is no Twilio porting fee; the number becomes a normal Twilio number ($1.15/mo).

### Step 5 — Wait (typically 1–3 weeks)

- [ ] Employee: keep using Zoho Voice normally. **Do not** cancel, downgrade, or remove the number from Zoho Voice — that would release the number and it could be lost.
- [ ] Admin: watch the Twilio port request status + email. Twilio will send a **FOC date** — the scheduled move day. Tell the employee that date as soon as you have it.
- [ ] If rejected: read the reason on the request, fix that one detail, resubmit.

### Step 6 — Move day setup (admin, right after cutover — same as the 8/14 setup for Rick's temporary number)

- [ ] Twilio Console → Phone Numbers → Active numbers → the moved number. Set the **Voice** and **Messaging** webhooks to match the existing BTI numbers exactly (open +12394755114 in another tab and copy its settings). For SMS you can instead run `railway run node server/scripts/fix-sms-urls.js` — it is safe to run repeatedly.
- [ ] Add the number to the **A2P Messaging Service sender pool** (Messaging → Services → sender pool → add).
- [ ] Trust Hub: assign the number to the **Business Profile** first (Customer profiles → Assigned phone numbers), **then** to the Trust Product **"Talkingvet Dialer"**. Order matters — that's what gives calls A-level caller-ID attestation and keeps them from showing as spam.
- [ ] Add an **emergency (911) address** to the number.
- [ ] BTI Voice → **Settings → Calls → Number Routing** → add a rule: moved number → that employee.
- [ ] Change the employee's agent phone number to the moved number (wherever their current Twilio number is set) so their outbound caller ID shows it.

### Step 7 — Test together (admin + employee, 10 min)

- [ ] Call the moved number from a cell phone → it should ring the employee directly in BTI Voice.
- [ ] Text the moved number → it should appear in the BTI Voice inbox (if not, wait a day — see downtime note).
- [ ] Employee places an outbound call → caller ID on the receiving phone should show their number.
- [ ] Employee sends an outbound text → confirm it arrives.
- [ ] Check the BTI Voice module in Zoho CRM shows the test call.

### Step 8 — Clean up (admin, after a few days of normal use)

- [ ] Remove the employee's seat/number from Zoho Voice (the number is already gone from their account; this stops the billing).
- [ ] If the Zoho Voice–CRM telephony integration is still enabled in Zoho CRM, disable it so CRM uses the BTI Voice widget only (**CONFIRM**).
- [ ] Release the employee's old temporary Twilio number in the Console if they had one (Rick: +12394755114) — or keep it as a spare.
- [ ] Once the last employee is moved, cancel the Zoho Voice subscription entirely.

---

## Notes for the first run (Rick)

- Record how long Zoho support takes to reply and how long the port takes end-to-end. That becomes the estimate for everyone else.
- Note anything Rick misses from Zoho Voice — that's the feature list to address before moving the next person.
