-- Nomi analytics on Supabase.
-- Mirrors the Airtable base appWV3X18RgXaqxcL tables 1:1 (Nomi Users / Nomi
-- Events / Nomi Prompts) so pre-migration Airtable data and post-migration
-- Supabase data line up column-for-column at analysis time. Airtable keeps
-- the pre-migration archive; everything new lands here.
-- Written by the server only (service_role key). RLS is on with no public
-- policies, so anon/authenticated clients cannot read or write anything.

create table if not exists nomi_users (
  uid                   text primary key,
  email                 text,
  registered            boolean,
  auth_method           text,
  rednote_experience    text,
  rednote_id            text,
  source                text,
  user_agent            text,
  in_app_browser        boolean,
  internal              boolean,
  bot                   boolean,
  engaged               boolean,
  profile_completed     boolean,
  generated_once        boolean,
  exported_once         boolean,
  joined_waitlist       boolean,
  first_seen            timestamptz,
  last_seen             timestamptz,
  registered_at         timestamptz,
  profile_completed_at  timestamptz,
  generated_first_at    timestamptz,
  exported_first_at     timestamptz,
  waitlist_at           timestamptz,
  mins_to_profile       numeric,
  mins_to_generate      numeric,
  mins_to_export        numeric,
  mins_to_register      numeric,
  days_active           numeric,
  sessions              numeric,
  total_minutes         numeric,
  avg_session_minutes   numeric,
  last_session_minutes  numeric,
  last_session_id       text,
  last_session_seconds  numeric,
  -- experiment: nomi_personalization_onboarding_v2
  experiment            text,
  variant               text,          -- explicit_shape | learned_create
  exp_override          boolean,       -- QA-forced variant: exclude from outcomes
  exposed_at            timestamptz,   -- first entry into a variant experience
  first_output_at       timestamptz,   -- first generated output viewed
  mins_to_first_output  numeric        -- exposure -> first output (time to value)
);

create table if not exists nomi_events (
  id              bigint generated always as identity primary key,
  event           text not null,
  uid             text,
  email           text,
  registered      boolean,
  meta            text,               -- JSON string, same shape as Airtable
  day             text,               -- YYYY-MM-DD in America/New_York
  ts              timestamptz,
  local_time      text,
  session_id      text,
  session_minutes numeric,
  session_seconds numeric,
  internal        boolean,
  bot             boolean,
  experiment      text,
  variant         text,
  exp_override    boolean
);

create table if not exists nomi_prompts (
  id           bigint generated always as identity primary key,
  uid          text,
  email        text,
  idea         text,
  kind         text,                  -- generate | refine
  content_lang text,                  -- en | zh | bilingual
  category     text,
  self_name    text,
  self_traits  text,
  seed_text    text,
  project_name text,
  titles       text,
  researched   boolean,
  internal     boolean,
  day          text,
  ts           timestamptz,
  local_time   text,
  experiment   text,
  variant      text,
  exp_override boolean
);

create index if not exists nomi_events_uid_idx     on nomi_events (uid);
create index if not exists nomi_events_day_idx     on nomi_events (day);
create index if not exists nomi_events_event_idx   on nomi_events (event);
create index if not exists nomi_events_variant_idx on nomi_events (variant);
create index if not exists nomi_users_variant_idx  on nomi_users (variant);

alter table nomi_users   enable row level security;
alter table nomi_events  enable row level security;
alter table nomi_prompts enable row level security;
