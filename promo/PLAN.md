# Jules Dispatch — Product Launch Video Plan

## Overview

A 25-second product launch video for Jules Dispatch, built with Remotion.
The video positions Jules Dispatch as an **AI orchestrator** — not a session manager,
not a dashboard, but an intelligent agent you give goals to and it figures out the rest.

## Philosophy

- **Show, don't explain.** Every beat earns its seconds with a visual.
- **Slow is confident.** The pacing is calm. No hype. The product speaks.
- **Grounded in real problems.** Every scene references something a developer
  actually encounters — blocked sessions, failing tests, Redis config, deployment.
- **The bot is a character, not a tool.** It thinks, asks, decides, acts, and
  tells you when it'll be back. That's an agent.
- **Mid-conversation > command-and-response.** We drop into a workflow that's
  already running. The viewer doesn't need to understand how it started —
  they need to feel that it *works*.
- **One word answers from the user.** The human collaborates, doesn't micromanage.
  Short inputs = the bot handles the complexity.
- **Power ≠ complexity.** The video ends with one terminal command. The contrast
  between "4 parallel sessions firing" and "npx jules-dispatch → deployed" is the pitch.
- **Free tier is a feature.** Show that this runs on Convex free tier.
  Lowering the barrier to try it is part of the message.

## Target

- **Duration:** 20–25 seconds
- **Aspect ratio:** 16:9 (1920x1080)
- **FPS:** 30
- **Voiceover:** Yes — generated via ElevenLabs TTS
- **Audio:** Subtle ambient background track (TBD)

## Timeline — Scene Breakdown

### Beat 1 — Opening (0–2s)

**Visual:** Black screen. Telegram notification sound. Phone screen lights up
with a notification preview.

**Voiceover:** *"Your coding agent just finished planning your sprint."*

**Mood:** Quiet, attention-grabbing. The sound + darkness earns a second of focus.

**Technical:** Simple fade from black. Notification UI component with spring entrance.

---

### Beat 2 — Mid-Conversation: The Blocker (2–7s)

**Visual:** Telegram chat loads mid-conversation. Scrollback shows the session
has been running. Status panel visible:

```
Session 1: payment routes — done
Session 2: auth patches — done
Session 3: integration tests — running
Session 4: rate limiter — blocked
```

Bot message appears: *"Rate limiter needs your Redis config. Port 6379 isn't
reachable from staging."*

**Voiceover:** *"Give it a goal. It breaks it down. It orchestrates."*

**Key design decisions:**
- We enter mid-convo, not at the start. This implies depth and history.
- Two sessions already done = the bot has been working while the user was away.
- One blocked = the bot isn't just executing blindly, it knows when it needs human input.
- The blocker is a real engineering problem (Redis port unreachable) — not abstract.

---

### Beat 3 — Resolution + Autonomy (7–10s)

**Visual:** User types: `staging-redis.internal:6380`
Bot: *"Got it. Session 4 resumed."*
Status updates scroll.
Bot: *"All sessions merged. PR ready. I'll text you when the next batch is done."*

**Voiceover:** *"It thinks. It asks. Then it ships."*

**Key design decisions:**
- User answer is one line with real info (hostname + port). Not "approve" — the bot is
  already in auto mode. This is genuine collaboration.
- "I'll text you when the next batch is done" = the bot schedules future work and
  reaches out on its own. That's an agent, not a tool.
- The resolution is fast. The bot doesn't dwell — it acts.

---

### Beat 4 — Task Graph (10–14s)

**Visual:** Transition out of chat. A task graph visualization appears:
one goal node at the top, branching into 4 session nodes. Two already merged
(solid lines), one finishing (animated progress), one re-joining the pipeline.
Slow zoom out.

**Voiceover:** *"Not a session manager. An orchestrator."*

**Key design decisions:**
- The graph is the *result* of the conversation we just watched. Viewer connects
  chat → visual instantly.
- "Not a session manager. An orchestrator." — the thesis line. Directly names
  the distinction.
- The branching/merging pattern shows coordination, not just parallelism.

---

### Beat 5 — Research Agent: Test Report (14–19s)

**Visual:** User drops a failing test log file into chat (file upload icon animation).
Bot responds instantly:
```
42 failures analyzed.
38 snapshot drift — ignored.
4 real regressions — fixing now.
Two sessions spawned.
```

**Voiceover:** *"Drop a log. It finds what matters. Then it acts."*

**Key design decisions:**
- File-in → analysis → action. Three steps compressed into 5 seconds.
- "38 snapshot drift, 4 real regressions" — the bot *sorted and prioritized*,
  not just dumped results.
- "Two sessions spawned" — it didn't just tell you the problem, it started fixing.
- This shows the research/analysis muscle separately from the conversation muscle
  of beats 2–3. Different capability, same agent.
- Failing test reports are universally relatable to developers.

---

### Beat 6 — Deploy (19–25s)

**Visual:** Graph fades. Screen goes dark. Cursor blinks. Then:

```
npx jules-dispatch
```

Wizard runs. Terminal output shows:

```
✓ Convex Hobby (free tier)
✓ Telegram bot connected
✓ Deployed.
```

End card with repo link.

**Voiceover:** *"From install to production in two minutes."*

**Key design decisions:**
- The contrast between "4 sessions firing" (beat 2) and "one command, done"
  is the whole pitch. Power ≠ complexity.
- "Convex Hobby (free tier)" shown in the output — lowers the barrier.
  It's free to try. That's a feature worth showing.
- The terminal is the final image. No fluff. Developers know what to do next.

---

## Visual Style

- **Chat UI:** Dark Telegram theme. Messages appear with subtle spring animations.
- **Task graph:** Clean nodes and lines. Dark background. Animated progress
  along edges (subtle glow or dot moving along connection lines).
- **Terminal:** Dark background, monospace font. Minimal. Cursor blink is the
  only motion before the command appears.
- **Transitions:** Fade through black between chat → graph → terminal.
  No flashy wipes. Confidence, not hype.
- **Typography:** Clean sans-serif for UI. Monospace for terminal.
  Voiceover text (if shown) is minimal or absent — let the VO do the work.

## Voiceover

Six lines total. One per beat. Generated via ElevenLabs.

| Beat | VO Line |
|------|---------|
| 1 | *"Your coding agent just finished planning your sprint."* |
| 2 | *"Give it a goal. It breaks it down. It orchestrates."* |
| 3 | *"It thinks. It asks. Then it ships."* |
| 4 | *"Not a session manager. An orchestrator."* |
| 5 | *"Drop a log. It finds what matters. Then it acts."* |
| 6 | *"From install to production in two minutes."* |

**Style:** Calm, confident, slightly lower register. Not salesy. The tone
matches a senior engineer explaining something they built to a peer.

## Technical Notes

- Remotion composition: `1920x1080`, 30fps, ~750 frames (25s)
- Voiceover audio files in `public/voiceover/`, one per beat
- Use `calculateMetadata` to dynamically set duration based on voiceover lengths
- Scenes use `<TransitionSeries>` with `fade()` transitions
- Spring animations for message entrances, task graph node appearances
- No CSS transitions/animations — all driven by `useCurrentFrame()` + `interpolate`

## Scene File Structure

```
promo/src/
├── Root.tsx                    # Composition definitions
├── Promo.tsx                   # Main video component (TransitionSeries)
├── scenes/
│   ├── Notification.tsx        # Beat 1: Phone notification
│   ├── TelegramChat.tsx        # Beats 2-3: Chat conversation
│   ├── TaskGraph.tsx           # Beat 4: Branching graph visualization
│   ├── TestReport.tsx          # Beat 5: File upload + analysis
│   └── Deploy.tsx              # Beat 6: Terminal deploy
├── components/
│   ├── ChatBubble.tsx          # Reusable chat message component
│   ├── StatusPanel.tsx         # Session status list
│   ├── GraphNode.tsx           # Single node in task graph
│   └── Terminal.tsx            # Terminal window component
└── styles/
    └── global.css
```

## Decisions Log

1. **Orchestrator, not session manager** — The video's thesis. Every beat reinforces this.
2. **Mid-conversation entry** — We don't show the start. We show the bot mid-work.
3. **User gives real input, not just approve** — "staging-redis.internal:6380"
   shows genuine collaboration.
4. **"I'll text you" moment** — Establishes the bot's autonomy and scheduling ability.
5. **Failing test report for research agent** — File upload → analysis → parallel fix sessions.
   Universal developer pain point.
6. **Both chat AND test report included** — Different muscles (conversation vs analysis).
   6 beats fit in 25s without bloat.
7. **Free tier Convex shown in deploy** — Lowers barrier. It's free to try.
8. **Task graph between chat and test report** — Visual proof that the conversation
   produced real work. Palette cleanser between two chat moments.
9. **One terminal command to end** — Power ≠ complexity. The contrast is the pitch.
10. **No subtitles/text overlays** — Voiceover carries the narrative. Visuals show, VO tells.

## Open Questions

- [ ] Background music track — ambient/upbeat? Need to pick before building scenes.
- [ ] Telegram UI accuracy — do we replicate Telegram exactly or use a stylized version?
- [ ] Task graph animation style — flowing dots along edges? Pulse glow? Simple fade-in?
- [ ] End card design — just repo URL? Add tagline? Telegram group link?
- [ ] ElevenLabs voice selection — which voice ID?
