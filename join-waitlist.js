import { createRecord, getAirtableConfig } from '../lib/airtable.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, sessionId, source } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const { waitlistTable } = getAirtableConfig();

    await createRecord(waitlistTable, {
      email,
      session_id: sessionId || '',
      source: source || 'unknown',
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('JOIN WAITLIST ERROR', error);
    return res.status(500).json({ error: error.message || 'Failed to join waitlist' });
  }
}
