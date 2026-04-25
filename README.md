# Nomi Instagram MVP starter with Airtable

This starter runs a simplified Instagram-only Nomi MVP:
1. collect one Instagram post idea
2. generate character-shaped drafts
3. capture the chosen draft and rating feedback
4. optionally capture future-use feedback
5. optionally capture Nyla concept feedback and waitlist email

## Stack
- Vercel for hosting and serverless API routes
- OpenAI for content generation
- Airtable for storage

## Files
- `index.html` - MVP UI, wired to real APIs
- `api/generate.js` - calls OpenAI for Instagram draft generation
- `api/save-response.js` - stores draft selection, ratings, and feedback in Airtable
- `api/join-waitlist.js` - stores the Nyla waitlist email in Airtable
- `lib/prompts.js` - prompt logic and fallback drafts
- `lib/airtable.js` - Airtable helper
- `.env.example` - environment variables you need in Vercel

## Deploy steps
1. Create an Airtable base named `Nomi MVP`.
2. Add a table named `responses` and a table named `waitlist`.
3. Add the columns listed below.
4. Create an Airtable personal access token with access to that base.
5. Create a Vercel project from this folder.
6. Add the environment variables from `.env.example` in Vercel.
7. Deploy.

## Environment variables
```bash
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.4-mini
AIRTABLE_TOKEN=your_airtable_personal_access_token
AIRTABLE_BASE_ID=your_airtable_base_id
AIRTABLE_RESPONSES_TABLE=responses
AIRTABLE_WAITLIST_TABLE=waitlist
```

## Airtable columns

### responses
- `session_id` (single line text)
- `platform` (single line text)
- `task` (long text)
- `notes` (long text)
- `generation_id` (single line text)
- `generated_drafts` (long text)
- `selected_draft_index` (single line text)
- `selected_draft` (long text)
- `selected_draft_title` (single line text)
- `selected_draft_body` (long text)
- `selected_draft_tone` (single line text)
- `edit_score` (number)
- `match_score` (number)
- `self_mode` (single line text)
- `self_tone` (single line text)
- `self_polish` (single line text)
- `self_energy` (single line text)
- `self_feel` (long text)
- `self_vibes` (single line text)
- `action_selections` (long text)
- `save_character_intent` (single line text)
- `variation_intent` (single line text)
- `open_feedback` (long text)
- `nyla_interest_score` (number)
- `nyla_waitlist_intent` (single line text)
- `nyla_waitlist_joined` (single line text)
- `submit_completed_at` (single line text)
- `created_at` (single line text)

### waitlist
- `email` (email)
- `session_id` (single line text)
- `source` (single line text)
- `created_at` (single line text)

## Airtable CSV headers

### responses
```csv
session_id,platform,task,notes,generation_id,generated_drafts,selected_draft_index,selected_draft,selected_draft_title,selected_draft_body,selected_draft_tone,edit_score,match_score,self_mode,self_tone,self_polish,self_energy,self_feel,self_vibes,action_selections,save_character_intent,variation_intent,open_feedback,nyla_interest_score,nyla_waitlist_intent,nyla_waitlist_joined,submit_completed_at,created_at
```

### waitlist
```csv
email,session_id,source,created_at
```

## Local development
```bash
npm install
npm run dev
```

## Notes
- Delete `api/generate-a.js` and `api/generate-b.js` if they still exist in your project.
- The MVP is Instagram-only, so there is no platform selector.
- All future-use and Nyla concept questions are optional.
- The prompt now defaults generated drafts to English unless the user explicitly asks for another output language.
