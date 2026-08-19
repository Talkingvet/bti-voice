# BTI Voice — Productization Plan (Selling Track)

**Date:** 2026-08-18 · **Decisions made with Danny** · Companion to `BTI-Voice-Session-Handoff 3.md` and `BTI-Voice-TODO.md`

**Target market (decided):** BTI's own MSP clients — SMBs already buying managed services from Business Technology Insight. Veterinarians possibly later via Talkingvet's channel. **Scale (decided):** 1–5 pilot customers in the first 6–12 months.

---

## 1. The core architectural decision: single-tenant per customer. Do NOT build multi-tenancy.

A full codebase audit (2026-08-18) confirmed:

- **Zero tenant awareness anywhere.** 16 tables, no org/tenant column on any. `ivr_settings` is physically constrained to one row (`CHECK (id = 1)`). `contacts.phone_number` and `agents.username` are globally unique. JWT carries `{id, username, name}` — no org claim. ~40 unscoped queries.
- **But it is cleanly single-tenant-per-process.** Everything company-specific is an env var (23 of them) or DB data. No shared state between deployments.
- **True multi-tenancy = multi-week rewrite touching every route.** Not justified below ~5–10 customers.

**Decision: one Railway project + one Postgres + one Twilio subaccount per customer.** The code already supports this once the blockers below are fixed. Revisit multi-tenancy only if customer count passes ~5 and ops burden (N deploys, N backups, N build pipelines) actually hurts.

### Hard blockers before ANY customer deploy (all trivial, ~1–2 days total)

| # | Blocker | Fix |
|---|---------|-----|
| 1 | **`seed.js` runs on every boot and creates 5 named BTI employees** with passwords like `danny123`, plus fake vet demo conversations | Gate behind env flag (e.g. `SEED_DEMO=true` only on BTI's instance); add a first-admin bootstrap (env `ADMIN_USERNAME`/`ADMIN_PASSWORD` or setup wizard) |
| 2 | **"Talkingvet" baked into customer-facing strings**: after-hours SMS default (`db.js:139` + `sms.js:68`) and the GPT call-summary prompt (`voice.js:734-737` — names Talkingvet, vets, and three employees) | Move both to config: `ivr_settings` column / env `COMPANY_NAME` + `AI_SUMMARY_CONTEXT` |
| 3 | **`ADMIN_KEY` fallback `'bti-admin-2026'` hardcoded in repo**, `/admin/activity` route has no `requireAuth` | Remove fallback; require env or 404 |
| 4 | **`JWT_SECRET` random-per-boot if unset** — forget it on a new deploy → everyone logged out every redeploy | Add boot-time check that refuses to start in production without it |
| 5 | **Twilio webhook validation soft by default** | Flip default to strict for customer deploys (`TWILIO_STRICT_WEBHOOKS=true` in the deploy template) |

### Branding / white-label (moderate, mostly one-time)

- Env-driven branding: `COMPANY_NAME`, logo URL, window title. ~10 client files hardcode "BTI Voice" (Login.jsx, TitleBar.jsx, App.jsx splash, SettingsTab, index.html title).
- **Decision needed: product name.** "BTI Voice" works fine if selling under the BTI brand to BTI's own MSP clients (recommended — it's the MSP's brand promise anyway). White-labeling per customer is possible later but each name change means new Electron appId/installer.
- **Desktop app is the expensive part of white-label**: `electron/main.js` hardcodes the Railway URL; `VITE_API_URL` baked at build time; updater pulls from `Talkingvet/bti-voice` GitHub. Every customer instance needs its own built installer, signing run, and release channel. **Recommendation: pilot customers use the browser app** (works fully in any browser today). Only build per-customer installers if a pilot demands desktop. This removes the single largest recurring cost.

### Zoho CRM integration = optional add-on, not core product (per Danny 2026-08-18)

The Zoho integration talks to **BTI's** Zoho org. External customers won't have it unless they also run Zoho CRM. The audit confirms Zoho degrades gracefully — every integration point guards on `ZOHO_REFRESH_TOKEN`; the app is fully functional without it.

- **Default customer deploy: no Zoho env vars.** Standalone VOIP/SMS app.
- **If a customer uses Zoho CRM:** connect *their* org — requires their own OAuth client + refresh token, creating the `BTI_Voice` custom module (+ unique `BTI_Ref` field — remember the upsert lesson) in their org, and registering the SMS widget in their Developer Hub. Budget ~half a day per Zoho customer; price it as a setup fee.
- Future: same integration pattern could target other CRMs, but not for pilots.

---

## 2. Twilio & A2P 10DLC per customer (researched 2026-08-18, Twilio docs cited in session)

**Structure: Twilio subaccount per customer under BTI's account** (Twilio's recommended "ISV architecture #1"). Subaccounts are free, bill to the parent, have their own numbers/Messaging Service/credentials, 1,000 allowed by default. BTI is unambiguously an **ISV** under Twilio's test (customers compose their own messages).

**One-time BTI setup (do once, before first customer):**
1. Re-register BTI's Primary Customer Profile in Trust Hub as **"ISV Reseller or Partner"** (Console only, ~24h approval). ⚠️ Check whether the existing approved profile can be edited or must be redone — current brand/campaign hang off it.
2. SHAKEN/STIR Trust Product on the parent (72h) → all calls get B attestation.
3. Request access to Twilio's **Compliance Embeddable** (private beta since June 2026) — white-label widget that lets customers self-complete brand/campaign registration.

**Per customer (each needs its OWN brand + campaign — no sharing, registered under the CUSTOMER's EIN and legal identity):**

| Step | Time | Cost |
|------|------|------|
| Collect customer data: EIN (exact CP 575 legal name), address, authorized rep w/ company-domain email, live website | 3–10 biz days (the real bottleneck) | — |
| Fix their website: public privacy policy ("mobile numbers not shared with third parties", frequency, rates), T&C on same domain, compliant opt-in form. **Build to the Sept 15, 2026 unified-policy standard** | 2–10 biz days | BTI labor |
| Create subaccount, buy number(s) | minutes | $1.15/mo per number |
| Secondary Customer Profile + TrustProduct + Brand (**Low-Volume Standard**, `skip_automatic_sec_vet` — right for nearly every SMB; note US LLCs are NEVER eligible for Sole Prop) | ~1 day | $4.50 |
| Campaign (Low-Volume Mixed; PrivacyPolicyUrl + TermsUrl now REQUIRED since 6/30/26) | **10–15 days manual vetting** | $15 one-time (non-refundable) + $1.50/mo |
| E911 address per number (MSAG-validated; test with 933) | 30 min | $0.75/mo/number |
| SHAKEN/STIR secondary profile → A attestation (parallel with campaign vetting) | 24h + 72h | — |

**Realistic onboarding calendar: ~2.5 weeks best case, 4–6 weeks typical.** Voice can go live in ~3 days while SMS vetting runs — **sell voice-first activation.**

**Limits that matter:** Low-Volume Standard = 2,000 segments/day to T-Mobile (~6,000/day total), 3.75 MPS on Low-Volume Mixed — plenty for an SMB. T-Mobile caps are per-EIN across ALL providers. Max 5 brands per EIN; an email/street address may appear in max 10 TCR registrations ecosystem-wide.

**Compliance obligations BTI carries as reseller:**
- Twilio's STOP handling is **per-number** — the app's own `contacts.opted_out` (already built ✓) is the real suppression list; keep it authoritative across all of a customer's numbers.
- Store consent records (timestamp, method, disclosure text) per contact — **not built yet; needed before external SMS**.
- HELP reply must contain the customer's brand name (Advanced Opt-Out config per Messaging Service).
- FCC revocation rules (2025–26): honor any reasonable opt-out means within 10 business days; cross-subject revocation in force since 4/11/26.
- Delete campaigns when a customer churns or the $1.50/mo runs forever.
- **Telecom taxes/USF**: if BTI bills for voice service it may inherit remittance obligations — **ask BTI's accountant before first invoice**; this is the cited margin-killer in white-label VoIP.

---

## 3. Pricing (researched 2026-08-18; competitor prices from 2026 sources, verify before publishing)

**Competitive band for the same feature set** (shared SMS inbox + calling + IVR + AI transcription/summaries + CRM logging): **$23–$50/user/mo** — Quo Business $23 (annual), Dialpad Pro $25 (3-seat min), RingCentral Advanced $35 monthly (+$60/user for Conversation Intelligence!), JustCall Pro $49, Aircall Pro $50 (3-seat min). RingCentral meters SMS (25–200/user/mo — useless for a team inbox); several meter or gate AI.

**BTI's COGS for a typical 10-user client** (3,000 SMS segments, 4,000 call min/mo): ≈ $111/mo (~$11/user) in Twilio + share of one Railway project (~$5–20/mo) + OpenAI (cents) + ~$3/mo compliance fees.

**Recommendation: $35/user/month, monthly, no seat minimum, AI included, unlimited-with-fair-use SMS/voice.**
- ~65–70% gross margin — top of the white-label VoIP band (agent/reseller programs pay 30–50%).
- 13–27% of a typical $150–200/user/mo managed-services bill — a normal MSP add-on ratio.
- Cheaper than the equivalent name-brand config, with AI that RingCentral charges +$60/user for.
- **One-time onboarding fee: $250–$500** to cover A2P registration labor, website compliance fixes, E911 setup. (Pure pass-through fees are only ~$20; the labor is the cost.)
- **Zoho CRM integration add-on: one-time setup fee** (~half day labor) for customers on Zoho.
- **Fair-use policy + per-account usage monitoring from day one** — one heavy-dialer client can invert the margin. Add a usage report/alert before first customer.
- Billing for 1–5 pilots: invoice through whatever BTI already bills MSP clients with (likely Zoho Books — connected here). No billing automation needed yet.

**Honest gaps vs incumbents** (know before pitching): no desk-phone/SIP support, no 99.999% SLA (single Railway region), no SOC 2/HIPAA posture (avoid healthcare/legal clients initially), no call queues/barge/whisper/power dialer. And BTI becomes the telecom support desk: porting, carrier filtering, spam-label remediation.

---

## 4. Security hardening — re-scoped for single-tenant

The deferred audit items, reassessed now that each customer is an isolated deploy:

| Item | Verdict for single-tenant |
|------|--------------------------|
| "Send as another agent" + call-control-by-SID | Stays intra-company per deploy — acceptable for pilot SMBs; document it. Lock down before any multi-tenant future. |
| Media/recording JWT-in-URL | **Still fix before external customers** — recordings of THEIR customers' calls. Short-lived per-resource tokens. |
| Updater endpoint auth / installer integrity | Moot if pilots are browser-only (recommended). Revisit only if shipping installers. |
| `ZOHO_WIDGET_KEY` shared-secret model | Per-deploy key = per-customer key. Acceptable; rotate per customer. |
| Per-tenant data isolation | Solved by architecture (separate DB per customer). |
| NEW: seed/ADMIN_KEY/JWT_SECRET/strict-webhooks | The §1 blocker list. |

Also required before external customers: **default passwords eliminated** (bootstrap flow, no `username123` pattern), and the per-number inbound call routing item below.

---

## 5. Product work required (beyond hardening)

1. **Per-number inbound call routing** — all numbers currently hit one global IVR (`ivr_settings CHECK (id=1)`, webhook never reads `req.body.To`). Within one customer's deploy this still matters (multiple numbers → different greetings/routing). Promote from backlog; design: key `ivr_settings`/`ivr_menus` by number or add a number→config mapping.
2. **First-run bootstrap** — create admin account, company name, timezone, business hours on first boot instead of seeded users.
3. **Consent-record storage** — per-contact opt-in evidence (timestamp, method, text shown). Small schema addition; required for A2P audits.
4. **Usage monitoring/report** — per-deploy monthly minutes/segments summary for fair-use enforcement and margin tracking.
5. **Deploy runbook + env template** — checklist of all 23 env vars with per-customer values; JWT_SECRET generation; strict webhooks on; Railway project naming convention.
6. *(Optional, per Zoho customer)* Scripted creation of the `BTI_Voice` module + unique `BTI_Ref` field in a customer's Zoho org.

---

## 6. Sequenced roadmap

**Phase 0 — Foundation (~1–2 weeks, BTI-internal, start now)**
1. Fix the 5 hard blockers (§1) — 1–2 days
2. Brandable strings via config — 1 day
3. Bootstrap flow replacing seed — 1–2 days
4. Consent-record storage — 1 day
5. Twilio: ISV Primary Profile + parent SHAKEN/STIR + Compliance Embeddable beta request — mostly wait time, run in parallel
6. Deploy runbook + env template — half day
7. Record demo video from `BTI-Voice-Demo-Video-Script.md` — parallel, any time

**Phase 1 — First pilot (~4–6 weeks calendar, ~2–3 days BTI labor)**
1. Pick the friendliest existing MSP client; send intake form + website checklist the day they say yes
2. Spin up Railway project + subaccount; voice live in ~days; SMS after campaign vetting
3. Browser app only; $35/user/mo + onboarding fee; watch usage weekly

**Phase 2 — Pilots 2–5 (repeat Phase 1; refine runbook each time)**
- Per-number IVR routing when a customer needs a second number
- Media-token hardening before or during first pilot
- Ask accountant about telecom tax treatment before first invoice

**Phase 3 — Decide at ~5 customers:** multi-tenancy vs continue cloning; desktop installers; SOC 2; other-CRM integrations; Talkingvet vet-market channel.

---

## 7. Open decisions for Danny

1. **Product name/brand** for external sale — keep "BTI Voice"? (Recommended for MSP-channel sales.)
2. **First pilot candidate** — which MSP client?
3. **Pricing sign-off** — $35/user/mo + $250–500 onboarding, monthly billing, fair-use policy.
4. **Browser-only for pilots** — confirm desktop installer is NOT offered initially.
5. **Telecom tax question** to the accountant — research done, see §8; the specific asks for the accountant are listed there.
6. Whether BTI's existing Twilio account converts to ISV profile cleanly or needs Twilio Support (existing A2P campaign must not break — BTI's own traffic keeps running on the parent account either way).

---

## 8. Telecom tax & regulatory exposure (researched 2026-08-18 — for the accountant; not legal/tax advice)

**Bottom line: billing $35/user/mo in BTI's name for bundled calling+SMS makes BTI a retail "interconnected VoIP provider"** under FCC rules (47 CFR §9.3) and Florida law (Fla. Stat. §365.172) — riding on Twilio does NOT exempt a reseller, and Twilio's docs say so explicitly. Obligations are not transferable by contract.

**What attaches if BTI bills bundled telecom in its own name:**

| Obligation | Reality at BTI's scale (≤50 users, ≤$21k/yr) |
|---|---|
| FCC: FRN registration + annual Form 499-A | Mandatory. But BTI is **de minimis** (USF liability ≈ $5.3k safe-harbor calc < $10k threshold) → files 499-A annually, pays $0 USF, no quarterly 499-Q. Keeps paying Twilio's USF pass-through (de minimis filers can't give valid reseller certs). |
| FCC regulatory fee / TRS / NANPA / LNP | Exempt (<$1,000) or trivial (tens of dollars). |
| FCC non-tax: CPNI cert (Mar 1), Robocall Mitigation DB, 911 rules | Apply regardless of size. |
| **Florida CST** | The big one: ~7.44% state + local = **~12–15% all-in**, applies to business VoIP. Register (DR-1), file **monthly** DR-700016. **Bundling trap: one $35 price → whole $35 taxable** unless telecom is separately stated/allocated in books kept in the ordinary course. |
| **Florida E911 fee** | $0.40/line/mo, BTI (the biller) collects & remits monthly to the FL E911 Board — Twilio's $0.75 e911 charge is a routing service fee, NOT this surcharge. |

**Compliance burden if registering:** ~4 one-time registrations + ~27–30 filings/yr (mostly monthly FL returns). Outsourced ≈ $3k–10k/yr (single 499-A prep ~$799; small-provider shops: Commpliance Group, Inteserra, Thomas Lynch) — potentially 15–50% of gross revenue at 5-customer scale. The admin, not the tax, is the problem.

**Structuring alternatives small resellers use:**
- **A. Agent model (leading candidate — fits the per-customer-subaccount architecture):** customer contracts/pays Twilio directly for the telecom (their own subaccount billed to them); BTI bills only software/management. Arguably no provider status → no 499, no CST on BTI's invoice, no 911 remittance. Substance must match the label.
- **B. Partial unbundling:** separately state "software/management $X" vs "voice/text $Y" on the invoice — shrinks the CST base to $Y and clarifies the 499 revenue; provider obligations still attach to the $Y.
- **C. Register + outsource** (costs above).

**Enforcement reality:** nobody hunts $20k/yr operators, but exposure is a 5-yr (or open-ended for never-filed returns) lookback that surfaces in audits or M&A due diligence; a pending FCC "Know-Your-Upstream-Provider" rule may force Twilio to demand resellers' FCC registrations — the likely discovery vector. Precedent: $153k proposed forfeiture vs a small iVoIP provider (PayG/SkySwitch).

**Ask the accountant specifically:** (1) what software-vs-telecom allocation Florida DOR will accept for the bundle — get the method in writing in the books BEFORE the first invoice; (2) does the agent model keep BTI out of provider status entirely; (3) whether to register for FL CST regardless. **Unverified:** whether Twilio honors an FL CST resale certificate (their docs suggest no for state telecom taxes — ask taxforms@twilio.com); FL limitations period on never-filed CST returns.
