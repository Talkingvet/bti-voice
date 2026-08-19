# BTI Voice — Customer Onboarding Checklist

*Send this to the customer after they sign. It's their side of the deploy runbook (bti-voice/docs/DEPLOY-RUNBOOK.md §1). The carrier-registration items are the schedule bottleneck — start them day one.*

## What we need from you

### Business identity (for carrier text-messaging registration)
The US carriers require every business that texts customers to register. We handle the process; we need:

- [ ] **Legal company name** — exactly as it appears on your IRS letter CP 575 (the EIN assignment letter)
- [ ] **EIN**
- [ ] **Business address** (also used for 911 registration on your numbers)
- [ ] **Authorized contact**: name, title, and an email **on your company's domain** (no gmail/yahoo)

### Your website (carriers check it)
- [ ] Live website on your own domain
- [ ] **Privacy policy** page that states: mobile numbers are not shared with third parties, how often you text, and "message & data rates may apply"
- [ ] **Terms** page on the same domain
- [ ] A place customers opt in to texts (web form with consent checkbox, or tell us your process — we'll document it)

*Missing some of this? Common — we'll tell you exactly what to add; it's usually an afternoon of website edits. Carrier vetting (10–15 business days) can't start until it's done.*

### Phone numbers
- [ ] How many numbers, and which area code?
- [ ] Keeping existing numbers? List them + current carrier (porting adds ~1–2 weeks; we can go live on new numbers meanwhile)
- [ ] Which number is the "main line" (gets the phone-tree), and who gets direct lines?

### Your team
- [ ] User list: full name + email for each person
- [ ] Business hours, days, timezone
- [ ] After-hours auto-reply text (we'll suggest one)
- [ ] Phone-tree menu, if wanted ("Press 1 for…") — or calls just ring everyone
- [ ] Call recording on or off? (If on, callers hear a short disclosure — required in FL and other two-party-consent states)

## What happens next (our side)

1. Days 1–3: your private instance + numbers set up → **calling live**
2. Days 1–15: carrier registration under your business identity → **texting live on approval**
3. Training: one 30-minute session for the team; each person sets their password on first login
4. You get: admin access, this checklist completed, and our support line

## The standing rule

**Only text people who opted in or texted you first. No purchased lists, ever.** The app enforces opt-outs automatically and keeps a consent log, but the rule starts with your team.
