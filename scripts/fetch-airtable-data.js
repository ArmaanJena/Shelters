#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_AIRTABLE_API_KEY =
  'patMgiMllqq4gqdW3.67ee2063e096e9e99e1c74a5a8ff3fdab29c8ef3eee7c197f6fc666bedc401d7';
const DEFAULT_AIRTABLE_BASE_ID = 'appXSnhjcUrnuvaS5';
const DEFAULT_AIRTABLE_TABLE_NAME = 'Properties';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || DEFAULT_AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || DEFAULT_AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || DEFAULT_AIRTABLE_TABLE_NAME;
const AIRTABLE_ENDPOINT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_NAME}`;
const AIRTABLE_VIEW_NAME = process.env.AIRTABLE_VIEW_NAME || '';
const AIRTABLE_MAX_RECORDS = Number.parseInt(process.env.AIRTABLE_MAX_RECORDS || '0', 10);
const AIRTABLE_FETCH_MAX_RETRIES = Number.parseInt(process.env.AIRTABLE_FETCH_MAX_RETRIES || '4', 10);
const AIRTABLE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.AIRTABLE_FETCH_TIMEOUT_MS || '20000', 10);
const AIRTABLE_FETCH_BASE_BACKOFF_MS = Number.parseInt(
  process.env.AIRTABLE_FETCH_BASE_BACKOFF_MS || '1000',
  10
);

const OUTPUT_PATH = path.resolve(process.cwd(), 'data', 'listings.json');

function assertEnv(value, name) {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function computeBackoffMs(attempt) {
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(AIRTABLE_FETCH_BASE_BACKOFF_MS * 2 ** attempt + jitter, 15000);
}

function parseRetryAfterMs(response) {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;

  const asSeconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(asSeconds)) return asSeconds * 1000;
  return null;
}

async function fetchPageWithRetry(url) {
  let lastError = null;

  for (let attempt = 0; attempt <= AIRTABLE_FETCH_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(AIRTABLE_FETCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        const body = await response.text();
        const status = response.status;
        const shouldRetry = isRetryableStatus(status) && attempt < AIRTABLE_FETCH_MAX_RETRIES;

        if (shouldRetry) {
          const retryAfterMs = parseRetryAfterMs(response);
          const backoffMs = retryAfterMs || computeBackoffMs(attempt);
          console.warn(
            `Airtable request failed with ${status}; retrying in ${backoffMs}ms (attempt ${
              attempt + 1
            }/${AIRTABLE_FETCH_MAX_RETRIES})`
          );
          await sleep(backoffMs);
          continue;
        }

        throw new Error(`Airtable API request failed (${status}): ${body}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= AIRTABLE_FETCH_MAX_RETRIES) break;

      const backoffMs = computeBackoffMs(attempt);
      console.warn(
        `Airtable request error (${error.message}); retrying in ${backoffMs}ms (attempt ${
          attempt + 1
        }/${AIRTABLE_FETCH_MAX_RETRIES})`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError || new Error('Airtable request failed after retries.');
}

function normalizeRecord(record) {
  return {
    id: record.id,
    createdTime: record.createdTime || null,
    fields: record.fields || {}
  };
}

function stableSortRecords(records) {
  return [...records].sort((a, b) => {
    const aTime = new Date(a.createdTime || 0).getTime();
    const bTime = new Date(b.createdTime || 0).getTime();
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });
}

async function fetchAirtableRecords() {
  const records = [];
  let offset = '';

  do {
    const endpoint = new URL(AIRTABLE_ENDPOINT);

    if (offset) endpoint.searchParams.set('offset', offset);
    if (AIRTABLE_VIEW_NAME) endpoint.searchParams.set('view', AIRTABLE_VIEW_NAME);
    endpoint.searchParams.set('pageSize', '100');
    if (AIRTABLE_MAX_RECORDS > 0) endpoint.searchParams.set('maxRecords', String(AIRTABLE_MAX_RECORDS));

    const payload = await fetchPageWithRetry(endpoint.toString());
    records.push(...(payload.records || []));
    offset = payload.offset || '';

    if (AIRTABLE_MAX_RECORDS > 0 && records.length >= AIRTABLE_MAX_RECORDS) {
      return records.slice(0, AIRTABLE_MAX_RECORDS);
    }
  } while (offset);

  return records;
}

function buildRecordHash(records) {
  const normalized = JSON.stringify(records);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function readExistingPayload() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePayloadIfChanged(payload) {
  const existingPayload = await readExistingPayload();
  const previousRecords = Array.isArray(existingPayload?.records) ? existingPayload.records : null;
  const nextRecords = payload.records;
  const existingHasLegacySourceField =
    existingPayload && Object.prototype.hasOwnProperty.call(existingPayload, 'source');

  if (previousRecords) {
    const previousHash = buildRecordHash(previousRecords);
    const nextHash = buildRecordHash(nextRecords);
    if (previousHash === nextHash && !existingHasLegacySourceField) {
      console.log('No Airtable data change detected. listings.json left unchanged.');
      return false;
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return true;
}

async function main() {
  assertEnv(AIRTABLE_API_KEY, 'AIRTABLE_API_KEY');
  assertEnv(AIRTABLE_BASE_ID, 'AIRTABLE_BASE_ID');

  console.log(
    `Sync config -> table: ${AIRTABLE_TABLE_NAME}, view: ${
      AIRTABLE_VIEW_NAME || '(all records)'
    }, maxRecords: ${AIRTABLE_MAX_RECORDS > 0 ? AIRTABLE_MAX_RECORDS : 'unlimited'}`
  );

  const rawRecords = await fetchAirtableRecords();
  const records = stableSortRecords(rawRecords.map(normalizeRecord));

  const payload = {
    updatedAt: new Date().toISOString(),
    records
  };

  const changed = await writePayloadIfChanged(payload);
  console.log(
    changed
      ? `Updated data/listings.json with ${records.length} record(s).`
      : `Data unchanged (${records.length} record(s)).`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
