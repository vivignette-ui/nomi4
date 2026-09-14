# Nomi Analytics — how every metric is measured

Data lives in Airtable base `appWV3X18RgXaqxcL`, two new tables (legacy
`waitlist` / `contacts` / `responses` untouched):

## Tables

**Nomi Users** — one row per unique user.
- `uid` — anonymous browser id (localStorage), NEVER changes for a returning
  visitor. This is the retention key.
- `email` + `registered` — set the moment the user completes email-code or
  Google sign-in (email-code users ARE registered users). Registered and
  unregistered users are both in this table, separated by the `registered`
  checkbox; the uid links their pre- and post-registration activity.
- `auth_method` (email/google), `rednote_experience` (new/experienced, from the
  welcome choice), `source` (first referrer), `rednote_id` (reserved; not yet
  collected in-product).
- Milestone flags: `profile_completed` (saved a social-self),
  `generated_once`, `exported_once` (copied/downloaded a note = task
  completion / publish proxy), `joined_waitlist`.
- `last_seen`; use the record's built-in **Created time** as first-seen.

**Nomi Events** — one row per action: `event`, `uid`, `email`, `registered`,
`meta` (JSON), `day` (YYYY-MM-DD, for pivots), `ts`.

Event vocabulary: `visit`, `welcome_choice`, `register`, `sign_in`,
`self_saved`, `generate`, `refine`, `export` (meta.type copy/download),
`project_open`, `sim_upload`, `block_upload`, `attach`, `waitlist_join`.

## Metric → formula

**Acquisition**
- Creators recruited / unique users → row count of Nomi Users.
- Visit→registration conversion → users with `registered` ✓ ÷ users with a
  `visit` event.
- Registration volume by channel → group `register` events by Users.`source`.
- Cost per registered user → (ad spend, external) ÷ registered count.
- % providing RedNote ID → `rednote_id` non-empty ÷ registered (field
  reserved; add a profile input when ready).

**Activation**
- % completing creator profile → `profile_completed` ÷ users (70% target).
- % generating first content → `generated_once` ÷ users (60% target).
- % publishing first post → `exported_once` ÷ users (export = copy/download,
  the in-product publish proxy; actual RedNote publishes need self-report).
- Time registration→first generation/export → per uid, first `generate`/
  `export` ts − `register` ts (Events).

**Engagement**
- Sessions per creator → count `visit` events per uid.
- Posts generated per creator → count `generate` events per uid.
- % who edit/regenerate/refine → users with a `refine` event ÷ active users.
- Weekly active / DAU → unique `uid` per `day` (group Events by day).
- 7/30-day return → users with events on ≥2 days that far apart.

**Retention**
- Week 2/4/8 retention → users with any event in [14,21) / [28,35) / [56,63)
  days after their Users record Created time ÷ cohort size (30% wk-4 target).

**Pilot headline metrics**
1. Registration→first-post conversion = `exported_once`∧`registered` ÷ registered.
2. % publishing ≥3 posts = uids with ≥3 `export` events ÷ registered (25% target).
3. Four-week retention (above).
4. Cost per activated creator = spend ÷ users with `profile_completed` ∧
   `generated_once` ∧ `exported_once` (the "activated" definition).

**Manual / survey metrics** (not measurable in-product): baseline posting
frequency change, creator satisfaction (70% "easier" target), intent to
continue, insights delivered to RedNote, partnership outcomes.

## Suggested Airtable views
- Users: filter `registered` ✓ → "Registered"; filter ✗ → "Guests".
- Users: group by `rednote_experience`; sort by Created time for cohorts.
- Events: group by `day` → DAU; group by `event` → feature adoption; filter
  `event=export` grouped by uid → publishing counts.

## Experiment: nomi_personalization_onboarding_v2 (live A/B, Sept 2026)

**Question:** how should a personalized AI learn a new user — explicitly before
creating (A `explicit_shape`) or behaviorally through creating (B
`learned_create`)?

**Assignment.** One canonical URL (`/nomi`). Deterministic fold-hash of the
stable anonymous `uid` → 50/50, persisted in `localStorage.nomiVariant`; no
per-load or per-session randomization; sign-in keeps the original assignment
because email attaches to the same uid row. Eligibility: not signed in AND no
existing social-self. Ineligible users get the unchanged flow.

**QA overrides:** `?nomi_variant=explicit_shape` / `?nomi_variant=learned_create`
(persists until `?nomi_variant=off`). Override traffic carries
`exp_override=true` on every row — ALWAYS filter it out of outcome metrics,
along with `internal` and `bot`.

**Storage.** Supabase is the primary store once `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` are set (tables `nomi_users` / `nomi_events` /
`nomi_prompts`, columns mirror Airtable 1:1; see `supabase/schema.sql`).
Airtable keeps all pre-migration data and acts as fallback if Supabase env is
absent. Every event/user/prompt row now also carries `experiment`, `variant`,
`exp_override`; users additionally get `exposed_at`, `first_output_at`,
`mins_to_first_output` (exposure → first output, the time-to-value metric).

**Event vocabulary added** (existing names unchanged):
- common: `exposed` (entering a variant experience), `gen_request`,
  `first_output`, `second_generation`, `signup_started`, `shelf_view`,
  `draft_edit` (existing: visit, engaged, welcome_choice, generate,
  generate_failed, refine, export, register, sign_in, project_open,
  heartbeat, exit)
- A diagnostics: `a_shape_entry`, `a_seed_started`, `a_seed_completed`,
  `a_tune_interacted`, `a_voice_viewed`, `a_voice_confirmed`,
  `a_shape_completed`
- B diagnostics: `b_compose_entry`, `b_first_gen_done`, `b_verify_viewed`,
  `b_draft_selected`, `b_inference_shown`, `b_inference_kept`,
  `b_inference_changed`, `b_add_started`, `b_add_saved`, `b_add_skipped`,
  `b_loop_completed`

**Primary metrics** (per variant, exposed eligible users only, excluding
internal/bot/exp_override):
- activation: users with `first_output_at` ÷ users with `exposed_at`
- conversion: `registered` ÷ exposed; also registered ÷ first-output viewers
- time-to-value: median `mins_to_first_output`
- A diagnostic: `a_shape_completed` ÷ A exposures
- B diagnostic: `b_loop_completed` ÷ B first-output viewers

**Turning it off / shipping a winner:** set the same short-circuit for everyone —
in `nomi.html`, `expEligible()` returning `false` disables all experiment
behavior (control experience for all); shipping a winner = replace
`expVariant()`'s hash with a constant. Assignment data stays in the tables.
