#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || '';
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || '';
const AIRTABLE_AREAS_TABLE_NAME = process.env.AIRTABLE_AREAS_TABLE_NAME || 'Areas';
const AIRTABLE_AREA_QUESTIONS_TABLE_NAME =
  process.env.AIRTABLE_AREA_QUESTIONS_TABLE_NAME || 'Area Questions';

const AIRTABLE_FETCH_MAX_RETRIES = Number.parseInt(process.env.AIRTABLE_FETCH_MAX_RETRIES || '4', 10);
const AIRTABLE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.AIRTABLE_FETCH_TIMEOUT_MS || '20000', 10);
const AIRTABLE_FETCH_BASE_BACKOFF_MS = Number.parseInt(
  process.env.AIRTABLE_FETCH_BASE_BACKOFF_MS || '1000',
  10
);

const OUTPUTS = [
  {
    tableName: AIRTABLE_AREAS_TABLE_NAME,
    outputPath: path.resolve(process.cwd(), 'data', 'areas.json')
  },
  {
    tableName: AIRTABLE_AREA_QUESTIONS_TABLE_NAME,
    outputPath: path.resolve(process.cwd(), 'data', 'area-questions.json')
  }
];

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

async function fetchJsonWithRetry(url) {
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
            `Airtable support-data request failed with ${status}; retrying in ${backoffMs}ms (attempt ${
              attempt + 1
            }/${AIRTABLE_FETCH_MAX_RETRIES})`
          );
          await sleep(backoffMs);
          continue;
        }

        const error = new Error(`Airtable support-data request failed (${status}): ${body}`);
        error.nonRetryable = !isRetryableStatus(status);
        throw error;
      }

      return response.json();
    } catch (error) {
      lastError = error;
      if (error?.nonRetryable) break;
      if (attempt >= AIRTABLE_FETCH_MAX_RETRIES) break;

      const backoffMs = computeBackoffMs(attempt);
      console.warn(
        `Support-data request error (${error.message}); retrying in ${backoffMs}ms (attempt ${
          attempt + 1
        }/${AIRTABLE_FETCH_MAX_RETRIES})`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError || new Error('Airtable support-data request failed after retries.');
}

function normalizeRecord(record) {
  return {
    id: record.id,
    createdTime: record.createdTime || null,
    fields: record.fields || {}
  };
}

function buildRecordHash(records) {
  const normalized = JSON.stringify(records);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function fetchTableRecords(tableName) {
  const endpointBase = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
  const records = [];
  let offset = '';

  do {
    const endpoint = new URL(endpointBase);
    endpoint.searchParams.set('pageSize', '100');
    if (offset) endpoint.searchParams.set('offset', offset);

    const payload = await fetchJsonWithRetry(endpoint.toString());
    records.push(...(payload.records || []));
    offset = payload.offset || '';
  } while (offset);

  return records.map(normalizeRecord);
}

async function readExistingPayload(outputPath) {
  try {
    const raw = await fs.readFile(outputPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writePayloadIfChanged(outputPath, payload) {
  const existingPayload = await readExistingPayload(outputPath);
  const previousRecords = Array.isArray(existingPayload?.records) ? existingPayload.records : null;

  if (previousRecords) {
    const previousHash = buildRecordHash(previousRecords);
    const nextHash = buildRecordHash(payload.records);
    if (previousHash === nextHash) {
      console.log(`No change detected for ${path.basename(outputPath)}.`);
      return false;
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Updated ${path.relative(process.cwd(), outputPath)} with ${payload.records.length} record(s).`);
  return true;
}

async function main() {
  assertEnv(AIRTABLE_API_KEY, 'AIRTABLE_API_KEY');
  assertEnv(AIRTABLE_BASE_ID, 'AIRTABLE_BASE_ID');

  for (const output of OUTPUTS) {
    console.log(`Syncing table: ${output.tableName}`);
    const records = await fetchTableRecords(output.tableName);
    await writePayloadIfChanged(output.outputPath, {
      updatedAt: new Date().toISOString(),
      table: output.tableName,
      records
    });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
