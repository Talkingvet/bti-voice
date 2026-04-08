# BTI Voice — Setup & Deployment Guide

## What's built
A full shared SMS & VOIP inbox for your team. Shawn, Danny, and Raven each send/receive
from their own number, but every conversation is visible to everyone in one shared app.
Double-text warnings appear automatically when two agents message the same customer.

---

## Step 1 — Deploy to Railway (takes ~10 minutes)

1. Go to **railway.app** and sign up / log in (free account is fine to start)
2. Click **New Project → Deploy from GitHub repo**
   - If you haven't connected GitHub: click **New Project → Empty Project** instead,
     then use the Railway CLI (see below)
3. Point it at the `bti-voice/` folder in this repo
4. Railway will auto-detect the `nixpacks.toml` and run the build

**Or deploy via CLI (easiest):**
```bash
npm install -g @railway/cli
railway login
cd bti-voice
railway init        # creates a new Railway project
railway up          # deploys the code
```

---

## Step 2 — Add PostgreSQL

1. In your Railway project dashboard, click **+ Add Service → Database → PostgreSQL**
2. Railway will automatically inject `DATABASE_URL` into your app — no manual config needed

---

## Step 3 — Set Environment Variables

In Railway → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | Any long random string (e.g. `my-super-secret-bti-voice-key-2024`) |
| `NODE_ENV` | `production` |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID (AC...) |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |

> **Twilio is optional for now.** The app runs fully in demo mode without it.
> Add the Twilio variables when you're ready for real SMS.

---

## Step 4 — Get Your App URL

After deploying, Railway gives you a URL like:
`https://bti-voice-production.up.railway.app`

That's your live app. Share it with the team.

---

## Step 5 — Log In

The app auto-creates three accounts on first boot:

| Name | Username | Password |
|------|----------|----------|
| Shawn | `shawn` | `shawn123` |
| Danny | `danny` | `danny123` |
| Raven | `raven` | `raven123` |

**Change passwords after first login** (Settings → Change Password).

---

## Step 6 — Connect Real Phone Numbers (when you're ready)

### Option A: Buy new Twilio numbers (~$1.15/month each)
1. Log into twilio.com → **Phone Numbers → Buy a Number**
2. Buy 3 numbers (one per person)
3. For each number, go to **Configure → Messaging** and set the webhook URL to:
   `https://YOUR-RAILWAY-URL/webhooks/sms`
4. For **Voice**, set to: `https://YOUR-RAILWAY-URL/webhooks/voice/inbound`

### Option B: Port existing numbers to Twilio
1. Go to twilio.com → **Phone Numbers → Port & Host**
2. Submit a port request — needs your current carrier account number & PIN
3. Porting takes 5–10 business days
4. Once ported, set the same webhooks as above

### Assign numbers to agents
After adding numbers in Twilio, update each agent's number in the app.
Either log in as that agent and go to Settings, or run directly in the Railway shell:
```sql
UPDATE agents SET phone_number = '+15125550101' WHERE username = 'shawn';
UPDATE agents SET phone_number = '+15125550187' WHERE username = 'danny';
UPDATE agents SET phone_number = '+15125550223' WHERE username = 'raven';
```

---

## Step 7 — Enable Browser Calling (optional, can skip for now)

Browser-to-phone calling requires a few extra Twilio steps:

1. Create a **Twilio API Key**: Console → Account → API Keys → Create new key
2. Create a **TwiML App**: Console → Voice → TwiML Apps → Create
   - Set Voice URL to: `https://YOUR-RAILWAY-URL/webhooks/voice/outbound`
3. Add these environment variables in Railway:
   - `TWILIO_API_KEY` = the API Key SID (SKxxxx...)
   - `TWILIO_API_SECRET` = the API Key Secret
   - `TWILIO_TWIML_APP_SID` = the TwiML App SID (APxxxx...)

---

## Running Locally (for testing before deploying)

You'll need PostgreSQL running locally. Easiest way is Docker:
```bash
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres
```

Then:
```bash
# In bti-voice/server/, create a .env file:
cp ../.env.example server/.env
# Edit server/.env and set:
# DATABASE_URL=postgresql://postgres:password@localhost:5432/btivoice
# JWT_SECRET=any-local-secret

# Start server
cd server && npm install && node index.js

# In another terminal, start frontend dev server
cd client && npm install && npm run dev
# Open http://localhost:5173
```

---

## Architecture Overview

```
Browser clients (React)
      │  WebSocket (Socket.io)
      │  REST API calls
      ▼
Express Server (Node.js) ─── PostgreSQL DB
      │
      ├── /api/auth          Login, token refresh
      ├── /api/conversations  Shared inbox data
      ├── /api/messages       Send SMS via Twilio
      ├── /api/calls          Call log, voice tokens
      │
      ├── /webhooks/sms       ← Twilio calls this when a text arrives
      └── /webhooks/voice     ← Twilio calls this for inbound/outbound calls
```

---

## Questions?
Ask Claude in the Talkingvet Help project — just describe what you need and it can
modify the code, fix issues, or add features directly.
