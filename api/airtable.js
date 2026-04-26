export function getAirtableConfig() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const responsesTable = process.env.AIRTABLE_RESPONSES_TABLE || 'responses';
  const waitlistTable = process.env.AIRTABLE_WAITLIST_TABLE || 'waitlist';

  if (!token) throw new Error('Missing AIRTABLE_TOKEN');
  if (!baseId) throw new Error('Missing AIRTABLE_BASE_ID');

  return { token, baseId, responsesTable, waitlistTable };
}

function airtableUrl(tableName) {
  const { baseId } = getAirtableConfig();
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
}

async function parseResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export async function createRecord(tableName, fields) {
  const { token } = getAirtableConfig();

  const response = await fetch(airtableUrl(tableName), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  const data = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error?.type ||
      data?.raw ||
      `Airtable request failed with ${response.status}`
    );
  }

  return data;
}
