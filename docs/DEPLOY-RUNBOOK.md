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
   Since 2026-10-06 the build installs with `npm ci` (exact versions from the
   committed `package-lock.json` files). If a deploy fails with *"npm ci can only
   install packages when your package.json and package-lock.json are in sync"*,
   someone changed a `package.json` without its lockfile: run `npm install` in
   that folder (`server/`, `client/`, `huddle/` or `admin/`), commit the
   lockfile, push again.
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
2. Self Client in their org, scopes `ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.settings.custom_views.READ` (the last one is only needed for Call Lists' view import) →
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
- **Tenant admin (Phase 1, 2026-09-30):** set `TENANT_ADMIN_KEY` on the service and
  record it in the BTI portal. Until the portal exists, drive it with curl:
  `curl -H "X-Tenant-Key: $KEY" $SERVER_URL/api/tenant/settings` (also `/usage`,
  `/agents`, `/health-extended`; `PATCH /settings` with JSON, `POST /settings/extend
  {"days":30}`). Full contract in `docs/BTI-Voice-Admin-Portal-Plan.md` §6.
- **Security middleware (2026-10-05, review batch 3):** every deploy now has a
  login throttle (10 failed tries per username / 15 min), per-IP rate limits
  (`/api` 300/min; login 30 / 15 min; a 429 shows as "Too many…" in the app),
  `helmet()` headers and a CORS allow-list built from `SERVER_URL` + the phone
  apps' origins. **Nothing to configure** — but `SERVER_URL` must be the real
  https URL (it always had to be, for Twilio). If a browser on ANOTHER domain
  ever needs to call this deploy's API (e.g. `app.btivoice.com` while the
  Railway URL is still live), add it to the optional `CORS_ORIGINS` variable
  (comma-separated) and redeploy. The Zoho CRM widget, the desktop app and the
  phone apps need no entry.
- Billing: software fee via BTI invoice; Twilio usage lands on the subaccount —
  decide per the agent-model tax strategy (plan §8) before first invoice.

## 8. The BTI admin portal (`bti-voice-admin`) — one-time setup, then per-customer registration

The portal is BTI's control plane (plan §3/§7). Code: `admin/` in this repo. It is a **second Railway service** in the same Railway project, with its **own** Postgres. Do §8a once; do §8b for every customer deploy (including BTI's own).

### 8a. One-time: create the service (~15 min)
1. Make sure the commit containing `admin/` is pushed (`git log origin/main --oneline -1` shows it).
2. Railway → the **bti-voice** project → **+ New** → **GitHub Repo** → pick `Talkingvet/bti-voice`. A new service appears. Click it → **Settings** → rename to **`bti-voice-admin`**.
3. Same Settings page → **Source** → **Root Directory**: type `/admin` and save. (This makes Railway use `admin/package.json`; no build step, it just runs `npm start`.)
4. Back in the project canvas → **+ New** → **Database** → **Add PostgreSQL**. Rename it **`admin-postgres`** so it's never confused with the customer DB. ⚠ Do NOT reuse the main service's Postgres.
5. Click **bti-voice-admin** → **Variables** → **+ New Variable**, add these five:
   - `DATABASE_URL` → click **Add Reference** and pick `admin-postgres` → `DATABASE_URL` (it fills in `${{admin-postgres.DATABASE_URL}}`).
   - `NODE_ENV` = `production`
   - `PORTAL_SECRET` = a long random string. Generate one in Git Bash: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the output. **Save this somewhere safe (password manager).** If it is ever lost, every registered tenant key has to be re-entered.
   - `PORTAL_ADMIN_USERNAME` = `danny`
   - `PORTAL_ADMIN_PASSWORD` = any temporary password, at least 8 characters (you change it on first login).
   - (optional) `PORTAL_ADMIN_NAME` = `Danny`
6. **Settings → Networking → Generate Domain**. You get something like `bti-voice-admin-production.up.railway.app`. That's the portal URL — bookmark it.
7. Railway deploys automatically once variables are saved. Open **Deployments → latest → View logs** and wait for these three lines, in order:
   `[db] Migrations complete.` → `[bootstrap] First portal user created: danny. …` → `[admin] bti-voice-admin listening on :XXXX`.
   If instead you see `[secret] FATAL: PORTAL_SECRET is not set`, step 5 didn't save — add it and redeploy.
8. Open the portal URL → sign in `danny` / the temporary password → you are forced to **Change password** (10+ chars). Do it. You land on an empty Dashboard.
9. **Register BTI's own deploy first** (§8b) using `https://bti-voice-production.up.railway.app` and the `TENANT_ADMIN_KEY` value from the **main** service's Variables. The dashboard should show it as **OK** with this month's real numbers. If it shows "Tenant rejected the admin key", copy the key again — it must match character for character.
10. **Portal users → + Add user** for Paul, Rick, Shawn. Each gets a one-time temp password shown once (copy button) — send it to them; they're forced to change it.
11. Go back to **bti-voice-admin → Variables** and **delete `PORTAL_ADMIN_PASSWORD`** (and the username/name vars if you like). They were only for the very first boot.
12. Quick round-trip test: BTI tenant → **Features** → flip **Voicemail transcription** off → in a browser open `https://bti-voice-production.up.railway.app/api/features` → within 30 s it shows `"voicemail_transcription": false` → flip it back on. That proves the portal actually controls the deploy.

### 8b. Per customer: register the deploy (~2 min, after §2 of this runbook)
1. On the customer's Railway service add a variable **`TENANT_ADMIN_KEY`** = a long random string (generate the same way as `PORTAL_SECRET`). Redeploy if it doesn't auto-redeploy. Without this the portal gets a 404 ("no admin API").
2. Portal → **+ Add tenant** → name, the customer's Railway domain, paste that key, plan (e.g. `Pilot · $35/user`), notes → **Verify & add**. It checks the key live before saving.
3. You land on the **Features** tab — untick anything they aren't paying for, set the **seat limit**.
4. **Billing** tab → set **Enabled through** to their first renewal date. (Rules for what happens after that date are printed on the tab.)
5. **Users** tab → **+ Add user** for their first admin → give them the temp password. They log in already scoped.
6. Month end: **Usage** tab → **Last month** → **⬇ Export CSV** → attach to / enter in Zoho Billing.

### 8c. Everyday operations
- Customer late paying → Billing → nothing to do, the deploy enforces the dates itself. To give them time: **+30 days**. To cut them off now: **Suspend account**. Both take effect within 30 s, nothing is ever deleted.
- Customer forgot a password → Users → **Reset password** → send temp password.
- Customer wants more seats → Features → raise **Seat limit**.
- Dashboard shows **Unreachable** → their Railway service is down or the URL changed → click the tenant → **Health → Test connection** for the exact error.
- Rotated a customer's `TENANT_ADMIN_KEY` → tenant → **Setup** → paste the new key → Save.

## 9. Fast path: a demo / trial deploy for a prospect (~45 min, voice same day)

For a prospect who wants to "play with it" before buying. Same code, their own isolated
database and number, but **inside BTI's own Twilio account** (no subaccount, no A2P
registration — texting rides on BTI's already-approved campaign). If they sign, redo
Twilio properly per §3 under their identity; the Railway service and portal record stay.

### 9a. Railway (~10 min)
1. Railway → the **bti-voice** project → **+ New** → **Database → PostgreSQL** → rename it `<prospect>-postgres`.
2. **+ New** → **GitHub Repo** → `Talkingvet/bti-voice` → rename the service `<prospect>-voice`. Leave Root Directory blank (repo root).
3. Variables (generate each secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`):
   - `DATABASE_URL` → reference `<prospect>-postgres` → `DATABASE_URL`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = random
   - `TENANT_ADMIN_KEY` = random (**different** from JWT_SECRET; you'll paste it into the portal)
   - `ADMIN_USERNAME` = `admin` · `ADMIN_PASSWORD` = temporary 8+ chars · `ADMIN_NAME` = the prospect's main contact
   - `COMPANY_NAME` = the prospect's business name
   - `ENABLE_RECORDING` = `true` · `OPENAI_API_KEY` = same value as BTI's own service
   - **Do NOT set** `SEED_DEMO`, `ZOHO_*`, `LATEST_VERSION`, `GH_TOKEN`.
   - Twilio vars come in §9b; `SERVER_URL` in step 4.
4. Settings → Networking → **Generate Domain** → put it in `SERVER_URL` (https, no trailing slash).
5. Deploy log must show `[db] Migrations complete.` and `[seed] Bootstrap admin account created: admin`. (It also prints webhook URLs with `YOUR-DOMAIN` — hardcoded text, not a sign SERVER_URL is missing.)

### 9b. Twilio, in BTI's main account (~15 min)
1. **Buy a number** (new console: Communications → Numbers & senders; direct link `https://console.twilio.com/us1/develop/phone-numbers/manage/incoming` lists active numbers. The post-purchase "Manage compliance" wizard: pick **Voice**, skip Messaging (that path starts a new A2P registration); Voice Integrity registration is optional — use case **Customer Support**, BTI's details, skip CNAM/Branded Calling for a trial; local, voice + SMS + MMS capable, their area code). → `TWILIO_PHONE_NUMBER`. Add BTI's E911 address to it.
2. **TwiML App** (new console: Builder tools → TwiML host & config → TwiML apps; or paste `https://console.twilio.com/us1/develop/voice/manage/twiml-apps`): Create → name `<prospect>-voice`, Request URL `SERVER_URL/webhooks/voice/outbound` (POST) → SID → `TWILIO_TWIML_APP_SID`.
3. On the new number: Voice "A call comes in" = `SERVER_URL/webhooks/voice/inbound` (POST); Messaging "A message comes in" = `SERVER_URL/webhooks/sms` (POST).
4. `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_API_KEY` / `TWILIO_API_SECRET` = **same values as BTI's own service** (it's the same account).
5. **Texting** (direct link `https://console.twilio.com/us1/develop/sms/services`): add the new number to BTI's Messaging Service sender pool. Then check the service's **Integration → Incoming messages** setting: it must be **"Defer to sender's webhook"** so this number's own SMS URL (step 3) is used rather than BTI's deploy. If it's "Send a webhook" today, switch it — BTI's own numbers keep working because they carry the same URL at number level (verify with `server/scripts/fix-sms-urls.js` or by eye). Set `TWILIO_MESSAGING_SERVICE_SID` on the demo service to the same SID as BTI's.
6. **SHAKEN/STIR**: add the number to the "Talkingvet Dialer" Trust Product (Business Profile first, then Trust Product) so outbound isn't "Spam Likely".
7. Redeploy the demo service after the Twilio vars are in. (The boot log's "Twilio webhook URLs" lines always print `YOUR-DOMAIN` — that text is hardcoded, not read from SERVER_URL. Ignore it; just confirm `SERVER_URL` exists in Variables.)

### 9c. Portal (~5 min)
1. Portal → **Add customer** → name, the demo service's domain, its `TENANT_ADMIN_KEY` → Verify and add.
2. **Features**: leave on except Zoho (not available anyway). **Seat limit** 3.
3. **Billing** → Enabled through = **today + 30 days**. Plan `Trial`. Notes: who the contact is, what they're evaluating.
4. **Users** → Add user for the prospect's contact → send them the temp password + the URL. (The `admin` bootstrap login is BTI's; keep it.)

### 9d. Hand-over
- They get: the URL, their username, temp password (forced change), the phone number.
- They test in a browser (Chrome/Edge). No installer for trials (§7).
- Tell them: recording disclosure plays on outbound calls; texts work from the new number.
- You watch usage on the dashboard. Day 16 they see the renewal banner; day 31 they enter grace; you extend or let it lapse from Billing.
- **This deploy is also the runtime test plan §6g asked for** — when the trial lapses, confirm outbound blocked / inbound rings / then the blocked-login screen.

## 10. Rotating the Postgres password (done 2026-10-05; repeat for any deploy if a credential leaks)

Railway's Postgres template here has **no "Credentials" tab** — the regenerate button is under **Database → Config**. Do NOT edit `POSTGRES_PASSWORD`/`PGPASSWORD` by hand on the Variables tab; Railway warns that this changes the variable without changing the real password.

1. Railway → the project → click the **Postgres** service that the app uses (`Postgres` for BTI, `cbia-postgres` for CBIA, `admin-postgres` for the portal).
2. **Database** tab → **Config** sub-tab → Connection → **Regenerate** (password) → confirm **Regenerate Password**. Railway sets the new password in the DB, updates `DATABASE_URL`/`DATABASE_PUBLIC_URL`, and restarts the service (~30 s).
3. Wait for the Postgres service to show **Online**.
4. Postgres → **Variables** → copy `DATABASE_PUBLIC_URL` into the password manager ("<deploy> Postgres (public URL)"). Never paste it into docs or chat.
5. App service (e.g. `bti-voice`) → **Variables** → `DATABASE_URL`. It must be the reference `${{Postgres.DATABASE_URL}}` (service name is case-sensitive). If it is a pasted `postgresql://…` string, replace it with the reference so future rotations need no edit.
6. App service → **Deployments** → ⋯ on the latest → **Redeploy** (a running container keeps the old password in memory until it restarts). Wait for green.
7. Open the app and load Messages. Conversations showing = done.

**No `DATABASE_PUBLIC_URL` on a Postgres service?** Public access is off (new databases start that way — `cbia-postgres` did until 2026-10-08). Postgres service → **Settings** → **Networking** → **Public Access** → **Add Public Access**. Railway then creates `DATABASE_PUBLIC_URL` on the Variables tab by itself. Needed for any script you run from a PC against that database (e.g. `server/scripts/purge-undelivered.js`); the internal `DATABASE_URL` only works inside Railway.
