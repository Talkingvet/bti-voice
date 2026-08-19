# BTI Voice — Customer-Facing Demo Video Script

**Length:** ~2:30 · **Format:** screen recording + voiceover · **Audience:** potential customers
**Setup before recording:** light mode ON (new theming shows well), sign in as Danny, have the Danny Test contact thread populated, quit/reopen from tray so the latest client is loaded. Mute the notification bell if a test text might land mid-take. Record at 1920×1080, app window centered.

**⚠️ Window size matters now (UI update 2026-08-18):** at ≥900px wide the SMS/Calls/Contacts tabs switch to desktop split views (list + detail side by side); below that it's the compact phone-style navigator the scenes below describe. **Record the main scenes at the default compact size (~470 wide)** so the shot directions match — then see the new Scene 2.5 for the resize moment. Also changed: the notifications tab is gone (bell-only now — one less thing to mute, but check the bell badge isn't showing before recording), the title bar shows just status + name (cleaner on camera), and your number now appears in the Dialpad header — Scene 2's "calls from their own number" line can point at it.

**⚠️ Talkingvet-string sweep (do BEFORE recording — added 2026-08-18):**
1. Settings → Calls: if the after-hours message still reads "Talkingvet: Thanks for your message!…", change it to "Thanks for your message! Our team is away right now…" (Scene 3 shows this screen).
2. For Scene 3, pre-pick a call whose AI summary does NOT mention Talkingvet, veterinarians, or staff names — existing summaries were generated with a Talkingvet-specific prompt. Read the summary before you point a camera at it.
3. Skim the Danny Test thread for any vet/Talkingvet references in message text; use a cleaner thread if needed.

---

## COLD OPEN (0:00–0:15)

**Shot:** App closed. Double-click BTI Voice icon → login screen → main inbox appears.

**VO:** "This is BTI Voice — calls, texts, and voicemail for your whole team, in one shared inbox. Built by Business Technology Insight. Let me show you around in about two minutes."

---

## SCENE 1 — The Shared Inbox (0:15–0:40)

**Shot:** SMS tab. Scroll the conversation list slowly, open the Danny Test thread. Point out agent-colored messages.

**VO:** "Every text your customers send lands in one place — no more 'who has that conversation?' Each reply is tagged with the teammate who sent it, so the whole team sees the full history. Anyone can pick up right where the last person left off."

**Shot:** Type `/` in the compose box → canned responses pop up. Pick one, send.

**VO:** "Common replies are one keystroke away with templates…"

**Shot:** Click the clock icon → schedule a message. Then the paperclip → attach an image.

**VO:** "…you can schedule texts to send later, and photos come through just like a regular message."

---

## SCENE 2 — Calls That Feel Personal (0:40–1:10)

**Shot:** Dialpad tab. Dial the Danny Test number, connect briefly, hang up. Then open Calls tab.

**VO:** "Calls work right from the desktop — no desk phone needed. Every agent calls from their own dedicated number, so when you call a customer back, they recognize you."

**Shot:** Expand a call-log row → show the 📞 Call / 💬 Message buttons.

**VO:** "Any call in the log is one click from a callback — or flip to a text without retyping the number."

---

## SCENE 2.5 — Made for Your Screen (NEW 2026-08-18, ~8 seconds, optional but recommended)

**Shot:** From the compact window, drag the corner to widen it across the screen. The SMS tab snaps into the split view — conversation list beside the open thread. Click a second conversation; it opens instantly beside the list.

**VO:** "And it works the way you do — keep it tucked in a corner, or stretch it out and it becomes a full workspace."

*(If the video runs long, this is the second thing to trim after Scene 2's live dial. But it's the single most visually impressive 8 seconds available, and no competitor's demo shows it.)*

---

## SCENE 3 — Never Miss Anything (1:10–1:45)

**Shot:** Open a call row that has a recording + transcript + AI summary. Scroll the summary.

**VO:** "Here's the part teams love. Voicemails and recorded calls are transcribed automatically, and AI writes a summary — the reason they called, what they need, next steps. You read fifteen seconds instead of listening to five minutes."

**Shot:** Settings → Calls. Show missed-call auto-text and after-hours auto-responder settings.

**VO:** "Miss a call? The caller instantly gets a text so they know they're not being ignored. After hours, an auto-responder covers you with your business hours built in."

---

## SCENE 4 — Plays Nice With Your CRM (1:45–2:10) *(reframed 2026-08-18: CRM is an optional add-on — most MSP customers won't run Zoho)*

**Shot:** Switch to Zoho CRM in the browser. Open the Danny Test contact → BTI Voice tab (call/SMS records), then the BTI Voice SMS tab. Send a text FROM the CRM widget, show it arriving in the app.

**VO:** "And if your business runs on a CRM, BTI Voice can plug right in — here it is inside Zoho: every call, every text thread, transcripts and summaries attached to the right contact automatically. Your team can even text straight from a customer's record. Not on a CRM? Everything you've seen works on its own, out of the box."

**Alternate cut (no-CRM version):** skip this scene entirely and stretch Scene 3; the 2:00 runtime is fine.

---

## CLOSE (2:10–2:30)

**Shot:** Back to the app inbox. Slow zoom or just hold. End card: BTI Voice logo + "Business Technology Insight" + contact info.

**VO:** "One inbox. Every call, text, and voicemail. Transcribed, summarized, and synced to your CRM. That's BTI Voice, from Business Technology Insight. Reach out and we'll show you what it can do for your team."

---

## Cutting-room notes

- Features intentionally left out of the 2:30 cut (mention only if asked): STOP/START compliance handling, dark mode, scheduled-send quiet hours, tray behavior, updater. Compliance is worth a slide in sales follow-ups — "carrier-registered A2P messaging, automatic opt-out handling" reassures buyers.
- If a take goes long, Scene 2's live dial is the first thing to trim — the call log expansion tells the same story.
- Don't show real customer names/numbers on screen — the Danny Test contact keeps it clean.
- Record the Zoho scene last; CRM pages load slower and it's easier to splice.

## Recording workflow (Windows — added 2026-08-18)

1. **Capture:** OBS Studio (free, obsproject.com) — Source: "Window Capture" on BTI Voice; Settings → Video: 1920×1080, 30fps; record each scene as its own take, silent (no mic). Redo any take freely — they're separate files. (Xbox Game Bar Win+Alt+R works in a pinch but can't capture the Zoho browser scene and app in one session as cleanly.)
2. **Voiceover:** record the VO separately, scene by scene, reading from this script — quiet room, phone earbuds mic is fine for v1. In Clipchamp (built into Windows 11): Record & Create → Audio.
3. **Assemble:** Clipchamp — drop scene clips on the timeline in order, trim dead frames, lay the VO under each scene, add the end card (title slide: BTI Voice / Business Technology Insight / phone + email). Export 1080p.
4. **End card:** ask Claude to generate one (Canva connector is available) if you don't have a slide handy.
5. Watch it once end-to-end checking for: stray notification pops, real customer data, Talkingvet strings, timing vs the 2:30 target.
