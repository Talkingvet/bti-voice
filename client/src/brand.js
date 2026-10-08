// Product brand, per customer deploy (batch 8 — brand sweep, 2026-10-08).
//
// Where the name comes from, in order:
//   1. the deploy's portal setting (deploy_settings.brand_name), via /api/features
//   2. the server's BRAND_NAME env var, via the same call
//   3. the build-time VITE_BRAND_NAME (only matters before /api/features answers)
//   4. "BTI Voice"
// So a white-label name can be set in the BTI portal without a redeploy.
//
// First paint happens before /api/features answers, so the last known name is
// cached in localStorage and the splash/login hold off on the wordmark until
// the brand is known (BRAND_PENDING) — a CBIA-branded deploy must never flash
// "BTI Voice".
import { useFeatures } from './features'

const CACHE_KEY = 'bti_brand'
const BUILD_BRAND = import.meta.env.VITE_BRAND_NAME || ''

function readCache() { try { return localStorage.getItem(CACHE_KEY) || '' } catch { return '' } }

// Static fallback (non-hook contexts: document.title at boot, error strings).
export const BRAND = readCache() || BUILD_BRAND || 'BTI Voice'

export function rememberBrand(name) {
  if (!name) return
  try { localStorage.setItem(CACHE_KEY, name) } catch {}
  if (document.title !== name) document.title = name
}

// Hook: the live brand. `pending` is true only when nothing is known yet
// (fresh install, before /api/features answers) — callers that must not guess
// render the mark without a wordmark while it's pending.
export function useBrand() {
  const f = useFeatures()
  const known = f.brand || readCache() || BUILD_BRAND
  const name = known || 'BTI Voice'
  const pending = !known && !f.loaded
  return { name, pending, company: f.company || null, support: f.support || null }
}

export function brandInitial(name) { return (name || 'B').trim()[0].toUpperCase() }
