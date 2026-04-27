import { createRecord, getAirtableConfig } from '../lib/airtable.js';

function serialize(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function addTextIfValue(fields, key, value) {
  if (hasValue(value)) {
    fields[key] = String(value);
  }
}

function addNumberIfValue(fields, key, value) {
  if (!hasValue(value)) return;
  const n = Number(value);
  if (Number.isFinite(n)) {
    fields[key] = n;
  }
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
      submitCompletedAt,
    } = payload;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const { responsesTable } = getAirtableConfig();
    const selectedDraft = generation?.selectedDraft || {};

    const fields = {
      session_id: sessionId,
      platform: platform || '',
      task: task || '',
      notes: notes || '',
      generation_id: generation?.generationId || '',
      generated_drafts: serialize(generation?.drafts || []),
      selected_draft: serialize(selectedDraft),
      selected_draft_title: selectedDraft?.title || '',
      selected_draft_body: selectedDraft?.body || '',
      selected_draft_tone: selectedDraft?.tone || '',
      self_mode: generation?.mode || '',
      self_feel: generation?.selfFeel || '',
      self_vibes: (generation?.vibes || []).join(', '),
      action_selections: (persistence?.actionSelections || []).join(', '),
      save_character_intent: persistence?.saveCharacterIntent || '',
      variation_intent: persistence?.variationIntent || '',
      open_feedback: persistence?.openFeedback || '',
      nyla_waitlist_joined: String(Boolean(nyla?.waitlistJoined)),
      submit_completed_at: submitCompletedAt || '',
      created_at: new Date().toISOString(),
    };

    addNumberIfValue(fields, 'selected_draft_index', generation?.selectedDraftIndex);
    addNumberIfValue(fields, 'edit_score', generation?.editScore);
    addNumberIfValue(fields, 'match_score', generation?.matchScore);
    addNumberIfValue(fields, 'self_tone', generation?.tone);
    addNumberIfValue(fields, 'self_polish', generation?.polish);
    addNumberIfValue(fields, 'self_energy', generation?.energy);
    addNumberIfValue(fields, 'nyla_interest_score', nyla?.interestScore);
    addTextIfValue(fields, 'nyla_waitlist_intent', nyla?.waitlistIntent);

    await createRecord(responsesTable, fields);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('SAVE RESPONSE ERROR', error);
    return res.status(500).json({ error: error.message || 'Failed to save response' });
  }
}
