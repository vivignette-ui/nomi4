# Nomi live A/B — `nomi_personalization_onboarding_v3`

Everything needed to run, QA, read, and end the experiment. Analytics
storage is described in [ANALYTICS.md](ANALYTICS.md); the SQL schema is in
[supabase/schema.sql](supabase/schema.sql).

## 1. The question

**What information should Nomi ask a new user to provide explicitly, and what
should Nomi infer for itself?** Two user-model acquisition mechanisms:

| Arm | Variant value | Mechanism |
|---|---|---|
| A | `explicit_shape` | self-report → structured representation → generation |
| B | `learned_create` | behavior → inference → provisional representation → user correction → updated representation |

Not "active vs passive". Not "which converts better". The output is 3–5
mechanism-level findings (§9), not a winner.

## 2. Final flows

Both arms share: one canonical URL `/nomi`, no welcome page, the same
generation pipeline (unchanged `/api/generate`, same model, same 3 outputs),
all three notes visible with nothing locked or blurred, the same account gate
position (after the first output), the same Shelf and Studio afterwards.

**A — define first, then create**

1. Lands on `#a-onboard`: "Who are you when you show up online? / Answer
   three questions. Meet your digital self." Three sliders, all default 50:
   openness (`aq-i` → closeness dial), energy (`aq-e` → energy dial),
   composure (`aq-p` → structure dial). No field is required; any can be
   left untouched.
2. "That's me →" writes the three dials, marks a self as existing, and goes
   straight to Compose with one transition line ("Got it. Let's make
   something that feels like you."). No profile summary.
3. Compose → generate → gate: three note cards (tap one to select), one-tap
   identity-fit rating, account box ("Save your social-self and keep
   creating") → Shelf / Studio.

**B — create first, then reflect**

1. Lands on Compose: "Create something. See what it reveals about you. /
   Nomi will learn your digital presence as you create." Back button and the
   reshape chip are hidden during onboarding so there is exactly one action.
2. At the first generation, `bInfer(idea)` computes a deterministic
   provisional read of the three dimensions from the idea text (recorded
   verbatim as `b_inference_shown`).
3. Gate: the same three cards + fit rating, then the calibration panel:
   "Here's what I'm picking up about you. / Adjust anything that feels off."
   — the three dimensions as **already-positioned sliders**, each with an
   interpretation line ("You let people in, but keep a little mystery.")
   that re-words live as the slider moves. Moving a slider = correction and
   writes the real dial. "That's me" = explicit acceptance. Doing neither =
   passive continuation, resolved when the user starts signup or copies a
   note. Then the same account box ("Save what Nomi learned and keep
   creating") → Shelf / Studio.

**Everyone else** (signed-in, or a stored token, or an existing social-self,
or a browser that cannot persist localStorage): the unchanged experience,
landing on the shelf. A returning signed-in user never sees onboarding, even
with a lapsed token (they get the shelf plus a "sign in again" toast).

## 3. Assignment and persistence

- Identity: `localStorage.nomiUid` (a UUID that never changes for that
  browser). Server rows are keyed on it; registering attaches the email to
  the same row, so the original anonymous assignment survives login by
  construction.
- Bucket: fold-hash (FNV-1a with the high half folded into the low) of the
  uid, mod 2. Verified 49.9–50.1% on 200k UUID-shaped ids. Deterministic:
  the same uid always lands in the same arm.
- Persisted: `localStorage.nomiVariant` (assignment) and
  `localStorage.nomiExposedV2` (the arm actually entered — sticky). Reloads,
  back/forward, sign-in and returns all keep the arm. Nothing is randomized
  per page load or per session.
- Eligibility (`expEligible()`): not signed in, no self, no stored token,
  uid ≠ `u-nolocal`. Ineligible users are never exposed.
- Flow version gate: `FLOW_VERSION` (`localStorage.nomiFlowVersion`). A guest
  whose stored version differs never went through this onboarding, so they
  are eligible once more on their next visit (projects and seed text are
  kept; only the "already onboarded" judgement and any older exposure are
  reset). Bump it whenever the onboarding flow changes so returning guests
  from an earlier campaign see the current flow exactly once.
- Exposure = landing in the arm's first screen (`enterFlow()` at boot).
  First landing emits `exposed`; later landings emit `exposure_reentered`.
- Client-side, not middleware: the whole app is one static file with no
  server render, so there is no "wrong variant flashes first" risk — the
  first painted screen is the assigned one.

## 4. QA overrides

| URL | Effect |
|---|---|
| `zeyaai.com/nomi?internal=1&nomi_variant=explicit_shape` | force A |
| `zeyaai.com/nomi?internal=1&nomi_variant=learned_create` | force B |
| `zeyaai.com/nomi?nomi_variant=off` | remove the override (assignment returns to the hash) |

The parameter is stripped from the address bar immediately so a copied link
never carries it. Override traffic is stamped `exp_override=true` on every
row it writes (users, events, prompts), and stays stamped after
`?nomi_variant=off`. Always use `internal=1` on your own phone as well.

Opening a link that carries `?nomi_variant=` on a **signed-out** browser
starts a fresh run: the saved guest session, the previous exposure and the
Shape screen are reset, so you see exactly what a new visitor sees — even on
a browser that already has a guest self (which would otherwise be treated
as already onboarded and land on the shelf). Reloading afterwards *without*
the parameter keeps normal rules, so refresh persistence stays testable. On
a signed-in browser, sign out first.

## 5. Turning it off / shipping an arm

In `nomi.html` (edit `mvp-nomi.html`, then build + push as usual):

- **Off (everyone gets the pre-experiment flow):** make `expEligible()`
  return `false`. Existing exposures stop mattering because `enterFlow()`
  only honors a stored exposure when the user is still eligible-or-exposed;
  to also stop honoring stored exposures, remove the `returning||` clause.
- **Ship A or B permanently:** make `expVariant()` return the constant
  (`"explicit_shape"` or `"learned_create"`). Keep `EXP_NAME` as is so
  historical rows stay attributable; bump it if the flow changes again.
- **Material product change mid-test:** bump `EXP_NAME` to `_v4`. Never
  edit copy or the gate in only one arm.

## 6. Events

Every row carries `experiment`, `variant`, `exp_override`, `internal`,
`bot`, `uid`, `email` (after login), `session_id`, `session_seconds`, `ts`,
`local_time`, `day`. Exceptions: Google `register`/`sign_in` rows have no
session (the OAuth redirect carries no session id) — join to the nearest
client event by uid. `exit` fires on every background/tab switch as well as
on close (`meta.via` = `hidden` | `pagehide`). **Dwell = `meta.s` = seconds
the page was actually on screen**; `meta.wall` is time since load. Instagram
keeps a dismissed page alive for exactly 30s before `pagehide`, so wall time
over-reports every bounce by 30s — never use it as dwell. For rows before
2026-09-15 14:40 UTC, use the `hidden` exit's `s` (the first one), not the
`pagehide` one. Client once-guards are per page
load, so count activation from the `nomi_users` stamps (or
`count(distinct uid)`), never from raw event counts. `nomi_users.internal`
means "ever internal" for that browser. Only new/renamed events are listed; the pre-experiment
vocabulary (`visit`, `engaged`, `generate`, `generate_failed`, `refine`,
`export`, `register`, `sign_in`, `project_open`, `heartbeat`, `exit`) is
unchanged.

**Common**
- `exposed` / `exposure_reentered` — landed in the arm's first screen
- `compose_entered` — reached Compose during onboarding (once)
- `gen_request` — generation requested; `generate` (server) = succeeded;
  `generate_failed` = failed
- `first_output` — first useful output viewed (server stamps
  `first_output_at` once and computes `mins_to_first_output` from
  `exposed_at`)
- `draft_selected` `{register, idx}` — tapped a note card at the gate
- `fit_rating` `{v: 3|2|1}` — "Feels like me / Close / Not me"
- `draft_edit` `{field}` — first inline edit of a generated note
- `signup_started` `{via}` — once; `register` from the server = completed
- `shelf_view`, `second_generation`, `exp_completed` `{arm}`

**First-screen interaction (both arms)**
- `ob_tap` `{scr, el}` — one per distinct element tapped per screen per load
  (`a-onboard`, `p-compose`, `r-gate`); fires on pointerdown so it lands
  even when the tap leads nowhere. `el` is the element id or class
  (`aq-e` = energy slider, `pdial` = slider label/ends, `aq-done`, `p-idea`,
  `p-gen`, `pstart`, `clseg`, `attachbtn`, `lang-zh`/`lang-en`, `aq-signin`,
  `gvcard`, `glchip`, `range` = calibration slider; the screen id itself means
  a tap on non-interactive space)
- `ob_scroll` `{scr}` — first scroll during onboarding
- `a_slider_touched` `{dim}` / `compose_typed` — first real input before the
  commit button
- `compose_abandoned` `{len, text}` / `a_abandoned` `{closeness, energy,
  structure}` — sent on exit when they typed or moved a slider on the first
  screen but never committed: the abandoned idea text (first 300 chars) or
  the slider values they left behind
- `engaged` is looser than all of these: any pointerdown, touch, key or
  scroll. Use `ob_tap` to answer "did they try the control or just look".

**A diagnostics**
- `a_entry` — landed on the three questions
- `a_tune_interacted` `{via}` — a real slider touch (programmatic writes excluded)
- `a_defined` `{closeness, energy, structure, touched:[bool×3], changes:[n×3]}`
  — final value per dimension, which were skipped, how many revisions
- `a_voice_viewed`, `a_voice_confirmed`, `a_seed_*`, `a_shape_completed` —
  only if the user opens the full Shape screen later

**B diagnostics**
- `b_compose_entry` — landed on Compose
- `b_inference_shown` `{closeness, energy, structure}` — Nomi's initial read
- `b_calibrated` `{dim, from, to}` — one correction (direction = sign of to−from)
- `b_accepted` `{closeness, energy, structure}` — explicit acceptance
- `b_calibration_done` `{initial:{…}, final:{…}, mode: accepted|corrected|passive}`
  — fired exactly once per user; `passive` means the user moved on without
  touching the panel and **must not be read as "the inference was accurate"**

## 7. Files changed

- `nomi.html` (built from `../mvp-nomi.html`): experiment utility
  (`expVariant`, `expEligible`, `enterFlow`, `expPayload`, override IIFE),
  `#a-onboard` screen + CSS, `bInfer` + calibration panel + fit rating in
  the gate, welcome page removed, routing guards, A/B copy overlay, i18n
  strings (both languages), token-restore fix.
- `api/index.js`: Supabase adapter (`storeGetUser` / `storeUpsertUser` /
  `storeInsertEvents` / `storeInsertPrompt`, Airtable fallback), experiment
  fields on every write, `exposed_at` / `first_output_at` /
  `mins_to_first_output`, experiment context carried through the Google
  OAuth state.
- `supabase/schema.sql`: three tables mirroring Airtable 1:1 + experiment
  columns, RLS on.
- `ANALYTICS.md`, this file.

## 8. What was NOT touched

OpenAI integration and prompts, model configuration, the research brief,
image upload / vision / page-sync functions, Google OAuth and email-code
auth mechanics, state persistence (`/api/state`, Redis), Studio, Shelf
internals, undo/redo, the visual system (tokens, cards, buttons, chrome,
responsive rules). Verified by diff: the only edits to those code paths are
the experiment field pass-through (`exp` in request bodies) and the
analytics store swap.

## 9. Where to look, and how

Supabase project **nomi-analytics** (`bfaujtkwwvfhkuqkpxld`, us-east-1) →
SQL editor. Airtable base `appWV3X18RgXaqxcL` keeps all pre-migration data
untouched; nothing new is written there while Supabase is configured.

Always filter: `experiment = 'nomi_personalization_onboarding_v3' AND
coalesce(exp_override,false) = false AND coalesce(internal,false) = false
AND coalesce(bot,false) = false`.

Also exclude **pre-existing accounts** that arrived on a fresh browser and
were enrolled before signing in (their first auth event is `sign_in`, not
`register`): `uid NOT IN (select uid from nomi_events where event='sign_in')
OR uid IN (select uid from nomi_events where event='register')`. Their
account data is safe (the auth-time merge keeps an existing self and
projects), but they are not new-user onboarding observations.

Tables were emptied on 2026-09-15 after verification; everything in them is
post-launch data. Airtable holds all history before that.

```sql
-- funnel per arm
select variant,
  count(*) filter (where exposed_at is not null)                  as exposed,
  count(*) filter (where first_output_at is not null)             as first_output,
  count(*) filter (where registered)                              as registered,
  round(100.0*count(*) filter (where first_output_at is not null)
        /nullif(count(*) filter (where exposed_at is not null),0),1) as activation_pct,
  percentile_cont(0.5) within group (order by mins_to_first_output) as median_mins_to_value
from nomi_users
where experiment='nomi_personalization_onboarding_v3'
  and not coalesce(exp_override,false) and not coalesce(internal,false) and not coalesce(bot,false)
group by variant;

-- exact drop-off step: last event per exposed user who never reached first_output
select variant, last_event, count(*) from (
  select e.uid, e.variant, (array_agg(e.event order by e.id desc))[1] as last_event
  from nomi_events e join nomi_users u using (uid)
  where u.experiment='nomi_personalization_onboarding_v3' and u.first_output_at is null
    and not coalesce(u.exp_override,false) and not coalesce(u.internal,false)
  group by e.uid, e.variant) t
group by 1,2 order by 1,3 desc;

-- B calibration gap per dimension (initial inference vs final), and mode mix
select (meta::jsonb->>'mode') as mode, count(*),
  avg(abs((meta::jsonb->'final'->>'closeness')::num - (meta::jsonb->'initial'->>'closeness')::num)) as gap_closeness,
  avg(abs((meta::jsonb->'final'->>'energy')::num    - (meta::jsonb->'initial'->>'energy')::num))    as gap_energy,
  avg(abs((meta::jsonb->'final'->>'structure')::num - (meta::jsonb->'initial'->>'structure')::num)) as gap_structure
from nomi_events where event='b_calibration_done' and not coalesce(exp_override,false)
group by 1;

-- A: which dimensions get answered vs skipped, and final value distribution
select
  avg(((meta::jsonb->'touched')->>0)::bool::int) as answered_openness,
  avg(((meta::jsonb->'touched')->>1)::bool::int) as answered_energy,
  avg(((meta::jsonb->'touched')->>2)::bool::int) as answered_composure,
  avg((meta::jsonb->>'closeness')::num) as mean_closeness,
  avg((meta::jsonb->>'energy')::num)    as mean_energy,
  avg((meta::jsonb->>'structure')::num) as mean_structure
from nomi_events where event='a_defined' and not coalesce(exp_override,false);

-- identity fit and willingness proxies per arm
select variant,
  avg((meta::jsonb->>'v')::num) filter (where event='fit_rating')  as mean_fit_1to3,
  count(*) filter (where event='export')                          as copies,
  count(*) filter (where event='draft_edit')                      as edited,
  count(*) filter (where event='second_generation')               as second_creations
from nomi_events
where experiment='nomi_personalization_onboarding_v3' and not coalesce(exp_override,false) and not coalesce(internal,false)
group by variant;
```

`(meta::jsonb->>'x')::num` — `meta` is stored as text (Airtable parity);
cast per query as above.

## 10. Reading results

Pick the 3–5 strongest **mechanism-level** findings. For each: Insight ·
Evidence · Mechanism · Why it matters · Design/system decision · Confidence
(high / medium / exploratory). Do not declare an arm the winner.

Guardrails baked into the schema: `passive` calibration is its own mode
(never counted as accuracy); `a_defined.touched` separates skipped from
"left at 50 on purpose"; `changes` counts are recorded but not a headline
metric (revision can be thought or confusion); time-to-value is reported as
a median, not a mean, and never as "engagement".

## 11. Unresolved / known limits

- `bInfer` is a deterministic text heuristic (punctuation, first-person
  density, list structure, length). It is the provisional representation
  the spec asks for and it is recorded verbatim, so its bias is measurable
  — but it is not a learned model. Expect systematic over/under-estimates on
  some dimensions; that *is* one of the findings this test can produce.
- With generation before any self-report, B's first notes are shaped by
  Nomi's default self; A's are shaped by the three answers. That asymmetry
  is the independent variable, by design.
- Passive B users resolve only when they start signup or copy; a B user who
  reads the panel and closes the tab is recorded as exposed + first_output
  with no `b_calibration_done` — count them as "did not calibrate", which is
  a real outcome, not missing data.
- Private-mode browsers (`u-nolocal`) are excluded from the experiment
  entirely, not bucketed.
- Traffic is small; treat anything under ~40 exposures per arm as
  exploratory.

## 12. Production QA checklist

- [ ] `?internal=1&nomi_variant=explicit_shape` → three questions → compose with transition line → generate → 3 cards, fit row, no calibration panel → signup → Studio
- [ ] `?internal=1&nomi_variant=learned_create` → compose (no back, no chip) → generate → 3 cards, fit row, calibration panel with three pre-set sliders → move one (interpretation line updates) → "That's me" → signup → Studio
- [ ] 简 / EN switch on every one of those screens
- [ ] Reload mid-flow keeps the arm and the screen
- [ ] Signed-in user (or lapsed token) lands on the shelf, never onboarding
- [ ] Sign out → lands back in the assigned arm
- [ ] Phone (Instagram in-app browser): sliders draggable, nothing below the fold on the three-question screen except the button
- [ ] Supabase: `nomi_users` row shows `variant`, `exposed_at`, `first_output_at`, `mins_to_first_output`; events carry `experiment`/`variant`/`exp_override`
