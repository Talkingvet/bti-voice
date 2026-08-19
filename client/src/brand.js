// Product brand name, configurable per customer deploy.
// Set VITE_BRAND_NAME in the deploy environment (Railway build) to white-label
// the UI; defaults to "BTI Voice" for BTI's own deployment.
export const BRAND = import.meta.env.VITE_BRAND_NAME || 'BTI Voice'
