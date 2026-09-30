# BTI Voice — Mobile UI Plan (Android/iOS)

**Written 2026-09-30** after the first Android install on a Pixel. Goal set by Paul:
look like a professional Android VOIP app (references: Pixel Phone, Google Messages,
Google Voice). Hard rule: **no screen may need scrolling or swiping to be fully usable.**

## What the reference apps do (and we didn't)

1. **One header per screen, or none.** Pixel Phone's keypad has no header at all;
   Google Messages has a single header row (app name + search + avatar). We stacked
   the desktop TitleBar (brand + presence + bell) AND a per-tab header on every screen.
2. **Bottom-anchored dialer.** Number display sits above the keypad, keypad + Call
   pill anchor to the bottom, free space floats to the top. Ours was top-stacked, so
   the call button fell behind the bottom nav and the screen scrolled (Quick Dial
   list pushed everything down).
3. **Oval/pill keys and a labeled Call pill**, not 72px desktop circles.
4. **FABs only on list screens** (Messages' "Start chat"). Ours floated over the dialer.
5. **Full-width tappable rows in Settings**, text labels, no emoji-as-icons.
6. **Dialogs are bottom sheets** (rounded top corners, full width), not floating
   desktop popovers.

## Phase 1 — DONE 2026-09-30 (all gated on IS_TOUCH; desktop pixel-identical)

- `DialpadTab.jsx`: phone layout — "Dialpad" title dropped (slim "Calling from" line
  kept), flex spacer bottom-anchors number display + keypad + call button, keypad is
  a fluid 3×4 grid of oval keys (max-width 340), Call/End are labeled green/red pills,
  Quick Dial + keyboard hint hidden on touch (Contacts tab covers it), no scrolling.
- `App.jsx`: compose FAB hidden on the dialpad tab on touch devices.
- `PostCallScreen.jsx` + `NewMessageModal.jsx`: render as Material bottom sheets on
  touch (full-width, rounded top corners, height-capped) instead of 360px popovers.
  (Also 2026-09-30, commit earlier: viewport-width/height caps that fixed the
  off-screen clipping — the panels were 360px wide on a ~349px effective viewport.)
- `SettingsTab.jsx`: tab strip is text-only on touch (emoji icons stay desktop-only);
  FieldRow hint text ("Contact admin to change") now wraps under the value instead of
  clipping off the right edge — this one also improves desktop.

**The zoom context:** `client/src/index.css` applies `zoom: 1.18` to `#root` under
`@media (pointer: coarse)`. Effective phone viewport ≈ real ÷ 1.18 (Pixel ≈ 349px wide).
Any `position: fixed` element or raw `100vw/100vh` must divide by `var(--ui-scale, 1)`
or it overflows. Fixed-size elements must fit 349px width.

## Phase 1b — DONE 2026-09-30 (same day, after Paul's web test)

- `SettingsTab.jsx`: full two-level phone navigation — top level is a Pixel
  Messages-style list (Profile / Audio / Appearance / Calls / About, each with a
  one-line description, plus a red Sign out row); tapping opens the section
  full-screen with a back-arrow header. Desktop keeps the tab strip, unchanged.
- `ChatPanel.jsx`: compose placeholder is just "Text message" on phones — the
  desktop placeholder ("Message… ( / = templates)") wrapped to a second line that
  the one-row box clipped, which looked broken.

## Phase 1c — DONE 2026-09-30 (density pass on the remaining screens)

All via touch-conditional values in each file's central `S` style object
(`const T = IS_TOUCH`); desktop values untouched.

- `SettingsTab.jsx` section content: rows 13px/16px padding, 14.5px labels, 12px
  descriptions, 46×26 toggles, 14px inputs, bigger buttons.
- `CallsTab.jsx`: taller rows (13/16), 14.5px names, pill-shaped filter chips,
  38px round play button, larger date headers.
- `ContactsTab.jsx`: 42px avatars, taller rows, rounded search field, larger
  detail-view rows/labels.
- `ConvList.jsx` (SMS list): 44px avatars, 14.5px names, 12.5px previews,
  rounded search, Google Messages-like row height.
- `ChatPanel.jsx`: "Messages" tab shortened to "Chat" on phones so the contact
  name stops truncating to one letter; bigger header name/sub + tab buttons.

## Phase 2 — backlog, in rough priority

1. [ ] **Per-component typography pass** to replace the zoom hack: real type scale
   (17px body like WhatsApp/Pixel), 44pt+ touch targets, then delete `--ui-scale`.
   This is the documented "eventual right answer" from the TODO.
2. [ ] **TitleBar on mobile**: fold brand out, keep one slim row (presence + bell)
   or move both into per-tab headers — reclaims ~40px on every screen.
3. [x] ~~Settings as stacked full-width rows~~ — done in Phase 1b. Remaining
   polish: the section CONTENT (cards, inputs) is still desktop-dense.
4. [x] ~~Calls/Contacts/SMS list rows~~ — done in Phase 1c (sizes/spacing).
   Remaining: swipe actions, full-bleed dividers if wanted.
5. [ ] **Wrap-up sheet content**: chips are compact; check tap targets ≥44pt.
6. [ ] **ActiveCallPanel** on phone: full-screen in-call UI (Pixel Phone style)
   rather than the desktop panel.
7. [ ] Verify all of this on iOS too (same IS_TOUCH gate applies) before the next
   TestFlight build.

## Testing loop

Railway rebuilds the client on every push → test at
`bti-voice-production.up.railway.app` in the phone's Chrome immediately; only cut a
new APK (bump `versionCode` in `client/android/app/build.gradle`) / TestFlight build
once a batch is approved on the web.
