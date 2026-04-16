export const FONT_STACKS = {
  system:              `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
  'Plus Jakarta Sans': `'Plus Jakarta Sans', sans-serif`,
  'DM Sans':           `'DM Sans', sans-serif`,
  'Figtree':           `'Figtree', sans-serif`,
  'Outfit':            `'Outfit', sans-serif`,
}

export function applyFont(key) {
  document.body.style.fontFamily = FONT_STACKS[key] || FONT_STACKS.system
}
