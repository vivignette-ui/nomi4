# Nomi A/B `nomi_personalization_onboarding_v3` — results as of 2026-09-15 20:00 UTC

**Question.** What should Nomi ask a new user to provide explicitly, and what should it infer for
itself? A = `explicit_shape` (three self-report sliders — closeness, energy, composure — then create).
B = `learned_create` (create first; Nomi infers a provisional read of the same three dimensions
from the idea text and shows it as pre-positioned sliders to correct).

**Design.** One canonical URL. Assignment = deterministic hash of an anonymous browser id, 50/50
(verified 49.6% on 50k ids; live split 151/137). Two populations on the same build, labeled and
never pooled: Instagram ad traffic (mobile in-app browser) and a Maze-recruited panel (desktop).
Identical instrumentation in both arms; identity-fit rating after output as the guardrail.

## The numbers

**Ads** (real visitors after the visibility gate went in at 07:05 UTC): A 151 / B 137. Median
on-screen dwell **1 second in both arms**. 24 vs 24 touched anything. **0 outputs, 0 registrations.**
(Before the gate, 129 rows had been written of which 112 had no interaction — Instagram's hidden
prefetch of the ad page plus instant bounces — and are excluded from exposure counts.)

**Maze panel:** 7 people (A 2 / B 5), all desktop.

| | A (n=2) | B (n=5) |
|---|---|---|
| used the first control | 2/2 moved all three sliders | 2/5 typed their own idea; 2/5 used a starter chip; 1/5 did nothing |
| pressed generate | 2/2 | 4/5 |
| saw first output | 2/2 | 3/5 (1 left after pressing generate, before output) |
| exposure → generate (s) | 77, 37 | 45, 9, 92, 22 |
| generation itself (s) | 16, 21 | 17, 14, 13 |
| exposure → first output (s) | 93, 58 (mean 75) | 62, 23, 105 (mean 63) |
| picked a note | 2/2 | 2/3 |
| identity fit (Feels like me / Close / Not me) | Close, Close | Feels like me, Feels like me (third never rated) |
| copied a note | 2/2 | 2/3 |
| edited a note | 0 | 0 |
| started sign-in (Google popup opened) | 1 | 1 |
| registered | 0 | 0 |

**A's answers** (all three sliders moved, 12–34 moves each): closeness/energy/structure =
(0, 0, 100) and (14, 31, 96).
**B's inferences:** closeness 55 / 46 / 64; energy 48 / 48 / 48; structure 44 / 44 / 44.
**B's corrections:** P1 structure 44→60, accepted. P2 closeness 64→43, energy 48→38, structure
44→55, accepted at those values; 29s later, after copying, nudged closeness 43→54. P3 saw the
panel, touched nothing, never rated — passive (which the design does not read as "accurate").

## Findings (mechanism-level, no winner)

### 1. Composure ("think it through vs let it flow") is asked well and inferred badly.
- **Insight.** Everyone who expressed this dimension put it above where the inference did, and every
  correction on it went up.
- **Evidence.** A self-reports 100 and 96. B inferences 44, 44, 44. Both B corrections moved it up
  (+16, +11); none down. The one B participant who never corrected is unresolved by design.
- **Mechanism.** A single first idea carries little signal about how deliberately someone composes;
  a heuristic keyed on the text of one prompt (list structure, length) has nothing to read. B's
  corrections landed at 55–60 — up, but near the midpoint — consistent with anchoring on the
  pre-positioned value, while A's blind answers went to the pole.
- **Why it matters.** The misread is systematic, not random: it makes early drafts feel more offhand
  than the person is.
- **Decision.** Ask composure with one explicit slider in whichever flow ships; do not infer it.
- **Confidence: medium** — four independent expressions, all in one direction; n is tiny.

### 2. Closeness and energy are inferable enough to start from; the correction is where the value is.
- **Insight.** On these two, the inference was a usable starting point and corrections were small.
- **Evidence.** Energy: inferred 48; one correction to 38, one untouched. Closeness: inferred 55
  (untouched) and 64 (corrected to 43 at acceptance — gap 21 — then nudged to 54 after copying,
  gap 10). Both net corrections went down.
- **Mechanism.** A pre-positioned slider turns "define yourself" into "nudge this": the person
  supplies a delta, not a value. Cost per correction looked like one drag but was not timed.
- **Why it matters.** These dimensions don't need a questionnaire; provisional value + correction
  reaches a usable representation with less asked of the user.
- **Decision.** Infer closeness and energy; ask composure → a hybrid, not A or B.
- **Confidence: exploratory** — three inferences, two correctors.

### 3. Fit was rated higher when the representation was corrected after seeing output than when it
was declared before.
- **Insight.** Both B raters said "Feels like me"; both A raters said "Close".
- **Evidence.** B 3, 3 vs A 2, 2 on the three-label scale. A's values were set blind, at the poles,
  before any output; B's were shown next to the notes they produced and corrected in place.
- **Mechanism.** Only B's representation was shaped with the output in view. A's extreme
  self-reports may have over-steered generation away from what the person recognized as theirs.
  Confound: B's participants wrote more ordinary ideas.
- **Why it matters.** More information collected up front did not translate into better perceived
  fit; the lift came from the correction loop, not the questionnaire.
- **Decision.** Keep a correction step adjacent to the first output in whichever flow ships.
- **Confidence: exploratory** — 2 vs 2.

### 4. The cost moved from "define yourself" to the blank box.
- **Insight.** B's setup is not zero effort: writing an idea from nothing is the product's most
  expensive input.
- **Evidence.** Two of five B participants avoided typing and used a starter chip; one typed *"create
  an image of a house for me"* (thought Nomi makes images). One left after pressing generate, before
  the 13–21s generation finished. Even so B reached first output slightly sooner on average (63s vs
  75s) because A still has to write an idea after its sliders.
- **Mechanism.** Sliders are pre-structured; the box is not. The starter chips are the actual
  friction reducer, and they sit below the composer on a phone.
- **Why it matters.** The time-to-value argument for "create first" rests on the box being easy; it
  isn't, and generation latency compounds it.
- **Decision.** Pre-fill the composer (or make a starter the default) and show progress during
  generation.
- **Confidence: exploratory** — per-person timings above; n=2 vs 4.

## Two things that are not mechanism findings but bound everything above

- **The account gate ends both arms identically.** 4 of the 5 people who reached output copied a
  note (A 2/2, B 2/3); one per arm opened the Google sign-in; **0 registered.** Copy and the account
  prompt sit on the same screen. Signup cannot separate the arms; treat the gate as its own
  experiment. (medium — 0/5, consistent, small)
- **Ad traffic never reached the variable.** 288 real visitors, median dwell 1s in both arms, 0
  outputs. The arms did not differ at the bounce; the ad→page match failed in the first second. The
  next lever for the public funnel is creative and targeting, not onboarding. (high)

## What this does not say
A did not win; B did not win. n = 2 vs 5 on a desktop panel. Finding 1 is consistent across every
person who expressed it; everything else tells you what to measure at n≈50 per arm. Nothing has
shipped from this yet: the v3 split is still live; the hybrid is a hypothesis, not a build.
