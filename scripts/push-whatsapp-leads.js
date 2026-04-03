#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { sanitizeAirtableFields } = require('./input-sanitizer');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_LEADS_TABLE_NAME = process.env.AIRTABLE_LEADS_TABLE_NAME || 'Leads';

const QUEUE_FILES = [
  {
    label: 'WhatsApp',
    path: path.resolve(process.cwd(), 'data', 'whatsapp-leads.json'),
    mapToFields: (lead) => {
      const formattedMessage = [lead.message || '', `Timestamp: ${lead.submittedAt || ''}`]
        .filter(Boolean)
        .join('\n');
      return sanitizeAirtableFields({
        Name: lead.name || '',
        Phone: lead.phone || '',
        Message: formattedMessage,
        'Lead Property': lead.leadType || 'General Enquiry',
        'Referral ID': lead.referralId || '',
        'Submission Date': lead.submittedAt || new Date().toISOString(),
        Status: 'New Lead'
      });
    }
  },
  {
    label: 'Loan',
    path: path.resolve(process.cwd(), 'data', 'loan-leads.json'),
    mapToFields: (lead) => sanitizeAirtableFields(lead.fields || {})
  },
  {
    label: 'Insurance',
    path: path.resolve(process.cwd(), 'data', 'insurance-leads.json'),
    mapToFields: (lead) => sanitizeAirtableFields(lead.fields || {})
  }
];

function assertRequired(value, name) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

async function readQueue(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeQueue(filePath, queue) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
}

function chunk(input, size) {
  const output = [];
  for (let index = 0; index < input.length; index += size) {
    output.push(input.slice(index, index + size));
  }
  return output;
}

async function pushBatch(airtableUrl, records) {
  const response = await fetch(airtableUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ records })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airtable push failed (${response.status}): ${body}`);
  }
}

async function syncQueue(airtableUrl, config) {
  const queue = await readQueue(config.path);
  const unsyncedLeads = queue.filter((lead) => !lead.synced);

  if (unsyncedLeads.length === 0) {
    console.log(`No unsynced ${config.label} leads found.`);
    return 0;
  }

  const batchSize = 10;
  const chunks = chunk(unsyncedLeads, batchSize);
  for (const leadsChunk of chunks) {
    const records = leadsChunk.map((lead) => ({ fields: config.mapToFields(lead) }));
    await pushBatch(airtableUrl, records);
  }

  const nowIso = new Date().toISOString();
  const syncedLeadIds = new Set(
    unsyncedLeads.map((lead) => lead.referralId).filter((referralId) => Boolean(referralId))
  );
  const updatedQueue = queue.map((lead) => {
    if (!lead?.referralId || !syncedLeadIds.has(lead.referralId)) return lead;
    return {
      ...lead,
      synced: true,
      syncedAt: nowIso
    };
  });

  await writeQueue(config.path, updatedQueue);
  console.log(`Synced ${unsyncedLeads.length} ${config.label} lead(s) to Airtable.`);
  return unsyncedLeads.length;
}

async function run() {
  assertRequired(AIRTABLE_API_KEY, 'AIRTABLE_API_KEY');
  assertRequired(AIRTABLE_BASE_ID, 'AIRTABLE_BASE_ID');

  const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
    AIRTABLE_LEADS_TABLE_NAME
  )}`;

  let totalSynced = 0;
  for (const config of QUEUE_FILES) {
    totalSynced += await syncQueue(airtableUrl, config);
  }

  if (totalSynced === 0) {
    console.log('No queued leads to sync.');
  } else {
    console.log(`Total synced leads: ${totalSynced}`);
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
