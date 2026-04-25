import OpenAI from 'openai';
import { buildInstagramPrompt, parseDraftsFromText, fallbackDrafts } from '../lib/prompts.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { task, notes, selfProfile } = req.body || {};

    if (!task) {
      return res.status(400).json({ error: 'task is required' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

    const prompt = buildInstagramPrompt({
      task,
      notes: notes || '',
      selfProfile: selfProfile || {}
    });

    const response = await client.responses.create({
      model,
      input: prompt
    });

    const text = response.output_text || '';
    const drafts = parseDraftsFromText(text, fallbackDrafts(task));

    return res.status(200).json({
      generationId: response.id || '',
      drafts
    });
  } catch (error) {
    console.error('GENERATE ERROR', error);
    return res.status(500).json({ error: error.message || 'Failed to generate drafts' });
  }
}
