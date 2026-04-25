import { createRecord, getAirtableConfig } from '../lib/airtable.js';

function serialize(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function addNumber(fields, key, value) {
  const n = Number(value);
  if (Number.isFinite(n)) fields[key] = n;
}

function addText(fields, key, value) {
  if (value == null) return;
  const text = String(value);
  if (text !== '') fields[key] = text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const {
      sessionId,
      platform,
      task,
      notes,
      generation,
      persistence,
      nyla,
      submitCompletedAt
    } = payload;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const { responsesTable } = getAirtableConfig();

    const fields = {
      session_id: sessionId,
      platform: platform || 'Instagram',
      task: task || '',
      notes: notes || '',
      generation_id: generation?.generationId || '',
      generated_drafts: serialize(generation?.drafts || []),
      selected_draft_index: String(generation?.selectedDraftIndex ?? ''),
      selected_draft: serialize(generation?.selectedDraft),
      self_mode: generation?.mode || '',
      self_tone: String(generation?.tone ?? ''),
      self_polish: String(generation?.polish ?? ''),
      self_energy: String(generation?.energy ?? ''),
      self_feel: generation?.selfFeel || '',
      self_vibes: (generation?.vibes || []).join(', '),
      action_selections: (persistence?.actionSelections || []).join(', '),
      save_character_intent: persistence?.saveCharacterIntent || '',
      variation_intent: persistence?.variationIntent || '',
      open_feedback: persistence?.openFeedback || '',
      nyla_waitlist_intent: nyla?.waitlistIntent || '',
      nyla_waitlist_joined: nyla?.waitlistJoined ? 'yes' : 'no',
      submit_completed_at: submitCompletedAt || '',
      created_at: new Date().toISOString()
    };

    addNumber(fields, 'edit_score', generation?.editScore);
    addNumber(fields, 'match_score', generation?.matchScore);
    addNumber(fields, 'nyla_interest_score', nyla?.interestScore);
    addText(fields, 'selected_draft_title', generation?.selectedDraft?.title || '');
    addText(fields, 'selected_draft_body', generation?.selectedDraft?.body || '');
    addText(fields, 'selected_draft_tone', generation?.selectedDraft?.tone || '');

    await createRecord(responsesTable, fields);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('SAVE RESPONSE ERROR', error);
    return res.status(500).json({ error: error.message || 'Failed to save response' });
  }
}
