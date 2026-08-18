// One-off (2026-08-17): Rick's and Paul's Twilio numbers were configured with the
// voice webhook + A2P sender pool on 8/14, but their number-level SMS URL was left
// on Twilio's default demo responder ("Configure your number's SMS URL...").
// Inbound texts to those numbers never reached BTI Voice.
//
// This copies the SMS webhook config from Danny's working number to both.
// Run with:  railway run node server/scripts/fix-sms-urls.js
// Safe to re-run (idempotent).

const twilio = require('twilio');

const REFERENCE = '+12396667033';                 // danny — known-good SMS config
const TARGETS = ['+12394755114', '+12394454227']; // rick, paul

(async () => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const nums = await client.incomingPhoneNumbers.list();

  const ref = nums.find(n => n.phoneNumber === REFERENCE);
  if (!ref) throw new Error(`Reference number ${REFERENCE} not found in account`);
  console.log(`reference (danny): smsUrl=${ref.smsUrl} method=${ref.smsMethod}`);

  for (const phone of TARGETS) {
    const n = nums.find(x => x.phoneNumber === phone);
    if (!n) { console.log(`MISSING ${phone} — not in account`); continue; }
    console.log(`before:  ${phone} smsUrl=${n.smsUrl || '(none/default)'}`);
    await client.incomingPhoneNumbers(n.sid).update({
      smsUrl: ref.smsUrl,
      smsMethod: ref.smsMethod,
      smsFallbackUrl: ref.smsFallbackUrl || '',
      smsFallbackMethod: ref.smsFallbackMethod,
    });
    console.log(`fixed:   ${phone} -> ${ref.smsUrl}`);
  }
  console.log('Done. Test by texting one of the fixed numbers from a cell.');
})().catch(e => { console.error(e.message); process.exit(1); });
