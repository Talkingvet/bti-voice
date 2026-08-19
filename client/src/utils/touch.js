// True on touch-first devices (iOS/Android). Used to stop desktop-style
// keyboard focus-grabbing from summoning the on-screen keyboard.
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(pointer: coarse)').matches
