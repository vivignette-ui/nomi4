import { createRecord } from '../lib/airtable.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      email,
      message,
      source,
      sessionId
    } = req.body || {};

    if (!email || !message) {
      return res.status(400).json({ error: 'email and message are required' });
    }

    const contactsTable = process.env.AIRTABLE_CONTACTS_TABLE || 'contacts';

    await createRecord(contactsTable, {
      name: name || '',
      email,
      message,
      source: source || 'zenya_contact',
      session_id: sessionId || '',
      created_at: new Date().toISOString()
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('SAVE CONTACT ERROR', error);
    return res.status(500).json({ error: error.message || 'Failed to save contact' });
  }
}
