# BTI Voice — Per-Customer Deploy Runbook

Single-tenant model: **every customer gets their own Railway project, Postgres database,
Twilio subaccount, and env config.** Nothing is shared between customers.
Business/pricing context lives in `BTI-Voice-Productization-Plan.md`; this file is the
operational checklist.

**Timeline reality:** voice can be live in ~3 days. SMS waits on the customer's A2P
campaign (10–15 business days of vetting, after their website is compliant). Sell
voice-first; enable SMS when the campaign approves.

---

## 0. One-time BTI prerequisites (already done or in progress)

- [x] Code hardening (SEED_DEMO gate, admin bootstrap, brandable strings, consent log)
- [ ] Twilio Primary Customer Profile re-registered as **ISV Reseller or Partner**
- [ ] Parent SHAKEN/STIR Trust Product approved
- [ ] Compliance Embeddable beta access requested
- Railway account with GitHub repo access (Talkingvet/bti-voice, private)

## 1. Collect from the customer (start immediately — this is the bottleneck)

| Item | Why |
|------|-----|
| Legal entity name EXACTLY as on IRS CP 575 + EIN | A2P brand registration |
| Business address | A2P + E911 |
| Authorized rep: name, title, email **on the company domain** | A2P brand |
| Live website on their own domain | A2P campaign vetting |
| Privacy policy URL + Terms URL (same domain) | REQUIRED on campaigns since 6/30/26 |
| Privacy policy must state: mobile numbers not shared with third parties, message frequency, msg&data rates | Campaign approval (Sept 2026 unified standard) |
| Compliant SMS opt-in point (web form / verbal script) | Campaign approval + TCPA |
| User list: names, usernames, which users get dedicated numbers | App setup |
| Number preferences: area code, how many, port-in or new | Twilio |
| Business hours, timezone, after-hours message text, IVR menu (or "ring all") | App setup |
| Recording on/off decision (two-party-consent states need the disclosure — app plays one automatically) | ENABLE_RECORDING |

## 2. Railway deploy (~30 min)

1. Railway → New Project → name it `<customer>-voice`.
2. Add **PostgreSQL** to the project.
3. Add a **service from GitHub repo** `Talkingvet/bti-voice`, branch `main`.
4. Service → Variables: paste from `server/.env.example` and fill in. Minimum for
   first boot: `DATABASE_URL` (reference the Postgres plugin), `JWT_SECRET`
   (`openssl rand -hex 32`), `NODE_ENV=production`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `COMPANY_NAME`, `BRAND_NAME`/`VITE_BRAND_NAME` (if white-labeling), `SERVER_URL`
   (add after Railway assigns the domain in step 5).
   **Never set `SEED_DEMO` on a customer deploy.**
5. Service → Settings → Networking → Generate Domain (or attach a custom domain).
   Put that URL (https, no trailing slash) into `SERVER_URL` and redeploy.
6. Check Deploy Logs: migrations run, `[seed] Created admin ...` appears once,
   app starts. The log prints the webhook URLs to configure in Twilio (§3.5).
7. Log in at `SERVER_URL` with the admin credentials. Change anything obviously
   wrong before inviting the customer.

## 3. Twilio subaccount (~1 hr + A2P wait)

Do all of this INSIDE a new subaccount, from BTI's parent console:

1. **Create subaccount:** Console → Account → Subaccounts → Create. Name it after the
   customer. Copy its ACCOUNT SID + AUTH TOKEN → `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`.
2. **Buy number(s):** Phone Numbers → Buy (in the subaccount). $1.15/mo each.
   Set the primary one as `TWILIO_PHONE_NUMBER`.
   **E911:** add a validated emergency address and assign it to every voice number.
3. **API key:** Account → API keys & tokens → Create (Standard) in the subaccount →
   `TWILIO_API_KEY` / `TWILIO_API_SECRET`.
4. **TwiML App** (outbound calling): Voice → TwiML Apps → Create.
   Request URL: `SERVER_URL/webhooks/voice/outbound` (POST). SID → `TWILIO_TWIML_APP_SID`.
5. **Number webhooks** (every voice number):
   - Voice → A call comes in: `SERVER_URL/webhooks/voice/inbound` (POST)
   - Messaging → A message comes in: `SERVER_URL/webhooks/sms` (POST)
   (`server/scripts/fix-sms-urls.js` can copy SMS config across numbers later.)
6. **A2P 10DLC** (SMS — the long pole, all under the CUSTOMER's identity):
   - Trust Hub → Secondary Customer Profile with the customer's EIN/legal name/rep.
   - Brand: **Low-Volume Standard** ($4.50, ~1 day). US LLCs are NEVER Sole Prop.
   - Messaging Service: create, add the customer's numbers to its sender pool.
     SID → `TWILIO_MESSAGING_SERVICE_SID` (leave unset until campaign approves).
   - Campaign: **Low-Volume Mixed** ($15 one-time + $1.50/mo). PrivacyPolicyUrl +
     TermsUrl REQUIRED. Vetting 10–15 business days.
   - While pending: voice works; app SMS sends will fail — tell the customer.
7. **SHAKEN/STIR:** attach the subaccount's numbers to a Trust Product so outbound
   calls get attestation (less "Spam Likely").

## 4. App configuration (with the customer, ~30 min)

1. Admin login → Settings → Profile → **Team**: create each agent
   (until an invite UI exists: INSERT into `agents` with a bcryptjs hash, or have
   each person log in with a temp password and change it — the nag banner enforces).
2. Assign each user their Twilio number: Team → edit (E.164).
3. Settings → Calls:
   - **IVR / phone tree** (greeting, menu options, default agent) or leave disabled.
   - **Number Routing**: point each dedicated number at its agent; main number → IVR.
   - **Missed-call auto-text** + **After-hours SMS** (message, hours, days, timezone).
   - **Canned responses.**
4. Every user: log in, change password (banner nags until they do), test mic
   (Settings → Audio), make a test call.

## 5. Zoho CRM add-on (optional — only if the customer runs Zoho)

1. In the CUSTOMER's Zoho org: create custom module `BTI_Voice` (fields per
   `BTI-Voice-Session-Handoff 3.md` §"Zoho BTI Voice tab") — **BTI_Ref must be
   marked "Do not allow duplicate values"** or every sync duplicates.
2. Self Client in their org, scopes `ZohoCRM.modules.ALL,ZohoCRM.users.READ` →
   `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`.
3. Optional SMS widget: register in their Developer Hub (Type: Related List,
   External, Base URL `SERVER_URL/zoho-widget/sms.html?key=<ZOHO_WIDGET_KEY>`),
   set `ZOHO_WIDGET_KEY`, attach to Contacts/Leads (see handoff §8e for the
   Canvas gotchas).

## 6. Verification checklist (before handing over)

- [ ] Inbound call to main number → IVR/default routing works, call logged
- [ ] Inbound call to an agent's routed number → rings that agent directly
- [ ] Outbound call → correct caller ID (agent's own number), recording +
      transcript + AI summary appear (if enabled), wrap-up screen works
- [ ] Unanswered inbound → voicemail records, transcribes, files on the right contact
- [ ] Missed-call auto-text fires (if enabled)
- [ ] After A2P approval: outbound SMS delivers; inbound SMS threads; MMS image
      in+out; STOP blocks sends + shows the red banner + consent log records it;
      START unblocks
- [ ] Consent log export works (Settings → Calls → SMS Compliance)
- [ ] After-hours auto-reply (send a text outside business hours)
- [ ] `/api/updates/latest` 200s; `/api/agents` without token → 401
- [ ] All users changed default passwords (no amber banner)

## 7. Go-live notes

- **Browser-only for pilots:** users bookmark `SERVER_URL` — no installer.
  (Desktop/Electron builds are per-brand work; defer until a customer demands it.)
- Deploys: push to `main` → Railway auto-deploys all tenants pointed at that repo.
  For customer-specific pacing, pin services to a branch or fork per customer later.
- Support runbook: check Railway Deploy Logs first; `TWILIO_STRICT_WEBHOOKS=false`
  to debug inbound 403s; `ADMIN_KEY` + `/admin/activity?key=` for login/event history.
- Billing: software fee via BTI invoice; Twilio usage lands on the subaccount —
  decide per the agent-model tax strategy (plan §8) before first invoice.
