// Deploy feature flags — which optional add-ons THIS customer's server has.
//
// BTI Voice is deployed single-tenant, so a customer without Zoho CRM must
// never see CRM panels, sync buttons or "post to Zoho" wording. The server
// derives the flags from its env vars (GET /api/features, booleans only) and
// the client reads them once per login via useFeatures().
//
// Defaults are all OFF so a slow/failed fetch errs on the side of hiding.
import { useEffect, useState } from 'react'
import { api } from './api'

// `account` is the subscription state from the server (admin portal Phase 1):
// { state: 'active'|'renews_soon'|'grace'|'restricted'|'blocked', message,
//   enabled_through, grace_ends, outbound_allowed }. Drives the banner in App.
const DEFAULTS = {
  zoho: false, zoho_widget: false, recording: true,
  sms: true, ai_summaries: true, voicemail_transcription: true, mobile_apps: true,
  sms_configured: true, // batch 7 (F1): false when the server has no Twilio credentials

  call_lists: false, // dialer lists — BTI only, ENABLE_CALL_LISTS=true on the deploy
  brand: null, account: null, loaded: false,
}

let current   = { ...DEFAULTS }
let inflight  = null
const listeners = new Set()

function emit() { listeners.forEach(fn => fn(current)) }

export function loadFeatures(force = false) {
  if (inflight && !force) return inflight
  inflight = api.features()
    .then(f => { current = { ...DEFAULTS, ...f, loaded: true }; emit(); return current })
    .catch(e => { console.warn('[features] fetch failed:', e.message); current = { ...DEFAULTS, loaded: true }; emit(); return current })
  return inflight
}

export function resetFeatures() { current = { ...DEFAULTS }; inflight = null; emit() }
export function getFeatures()   { return current }

export function useFeatures() {
  const [f, setF] = useState(current)
  useEffect(() => {
    listeners.add(setF)
    if (!inflight) loadFeatures()
    return () => listeners.delete(setF)
  }, [])
  return f
}
