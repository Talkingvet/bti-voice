# Draft email to accountant — telecom tax questions

*Send before the first BTI Voice invoice. From BTI-Voice-Productization-Plan.md §8. Edit greeting/sign-off to taste.*

---

**Subject: Tax treatment question — reselling VoIP phone service to clients**

Hi [name],

We're about to start selling a phone/texting service to a handful of our MSP clients and I want to structure the billing correctly before the first invoice. The short version: we built our own VoIP + SMS app (calls/texts run over Twilio, a wholesale carrier), and we'll charge clients about $35/user/month plus a one-time setup fee. Expecting 1–5 small clients (roughly 10 users each) in year one, all in Florida.

The question is what my billing model makes us:

1. **If we bill clients one bundled monthly fee that includes the underlying calling/texting**, my research says we likely become an "interconnected VoIP provider" — FCC Form 499-A registration (even if de minimis for USF), Florida Communications Services Tax (~12–15%) collection and monthly filings, and Florida E911 fees ($0.40/line/month). I'd like your read on whether that's right and what the real compliance burden looks like at this tiny scale.

2. **Alternative — "agent" model:** each client opens their own account with the carrier (a subaccount billed directly to their card), and we bill only for software licensing and managed services, never for telecom. My understanding is that keeps the telecom-tax obligations off us entirely. Is that clean, and is there anything about it that creates other problems (sales tax on SaaS, agency issues, etc.)?

3. Either way — does our existing [entity type / S-corp status] matter here, and should the phone product run through a separate entity?

4. Anything registration-wise we need BEFORE invoice #1, vs. things that can wait until we're past a revenue threshold?

Happy to send the fuller research doc I have. Can we grab 30 minutes this week or next?

Thanks,
Danny
