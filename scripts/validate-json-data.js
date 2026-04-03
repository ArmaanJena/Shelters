#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_DIR = path.resolve(process.cwd(), 'data');

const REQUIRED_TOP_LEVEL_BY_FILE = {
  'listings.json': ['updatedAt', 'records'],
  'areas.json': ['updatedAt', 'table', 'records'],
  'area-questions.json': ['updatedAt', 'table', 'records'],
  'blog.json': ['updatedAt', 'entries']
};

const REQUIRED_FIELDS_BY_FILE = {
  'listings.json': ['Title', 'Location'],
  'area-questions.json': [
    'Location',
    'Area Description',
    'Question 1',
    'Answer 1',
    'Question 2',
    'Answer 2',
    'Question 3',
    'Answer 3'
  ]
};

function emitError(file, message) {
  console.error(`::error file=${file},title=JSON validation failed::${message}`);
}

function stableKeys(input) {
  return Object.keys(input || {}).sort().join('|');
}

async function listJsonFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'listing-images') continue;
      const nested = await listJsonFiles(fullPath);
      results.push(...nested);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}

function validateTopLevelObject(relPath, payload, errors) {
  const requiredKeys = REQUIRED_TOP_LEVEL_BY_FILE[path.basename(relPath)] || [];
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      errors.push(`Missing required top-level key "${key}".`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'updatedAt')) {
    const updatedAt = payload.updatedAt;
    if (typeof updatedAt !== 'string' || !updatedAt.trim()) {
      errors.push('Top-level "updatedAt" must be a non-empty string.');
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'table')) {
    const table = payload.table;
    if (typeof table !== 'string' || !table.trim()) {
      errors.push('Top-level "table" must be a non-empty string.');
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'records')) {
    if (!Array.isArray(payload.records)) {
      errors.push('Top-level "records" must be an array.');
      return;
    }

    const records = payload.records;
    let baselineRecordShape = null;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const recordLabel = `records[${index}]`;

      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        errors.push(`${recordLabel} must be an object.`);
        continue;
      }

      if (typeof record.id !== 'string' || !record.id.trim()) {
        errors.push(`${recordLabel}.id must be a non-empty string.`);
      }
      if (!(typeof record.createdTime === 'string' || record.createdTime === null)) {
        errors.push(`${recordLabel}.createdTime must be a string or null.`);
      }
      if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) {
        errors.push(`${recordLabel}.fields must be an object.`);
      }

      const currentShape = stableKeys(record);
      if (baselineRecordShape === null) {
        baselineRecordShape = currentShape;
      } else if (currentShape !== baselineRecordShape) {
        errors.push(`${recordLabel} has inconsistent structure compared to previous records.`);
      }

      const requiredFields = REQUIRED_FIELDS_BY_FILE[path.basename(relPath)] || [];
      for (const field of requiredFields) {
        const value = record.fields?.[field];
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
          errors.push(`${recordLabel}.fields is missing required field "${field}".`);
        }
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'entries')) {
    if (!Array.isArray(payload.entries)) {
      errors.push('Top-level "entries" must be an array.');
    }
  }
}

function validateTopLevelArray(relPath, payload, errors) {
  let baselineItemShape = null;
  for (let index = 0; index < payload.length; index += 1) {
    const item = payload[index];
    const itemLabel = `[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${itemLabel} must be an object.`);
      continue;
    }

    const currentShape = stableKeys(item);
    if (baselineItemShape === null) {
      baselineItemShape = currentShape;
    } else if (currentShape !== baselineItemShape) {
      errors.push(`${itemLabel} has inconsistent structure compared to previous records.`);
    }

    if (Object.prototype.hasOwnProperty.call(item, 'synced')) {
      if (typeof item.synced !== 'boolean') {
        errors.push(`${itemLabel}.synced must be a boolean when present.`);
      }
      if (item.synced === true && (!item.syncedAt || typeof item.syncedAt !== 'string')) {
        errors.push(`${itemLabel}.syncedAt must be a non-empty string when synced is true.`);
      }
    }
  }
}

async function validateFile(filePath) {
  const relPath = path.relative(process.cwd(), filePath).split(path.sep).join('/');
  const errors = [];

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return { relPath, errors: [`Unable to read file: ${error.message || error}`] };
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    return { relPath, errors: [`Malformed JSON: ${error.message || error}`] };
  }

  if (Array.isArray(payload)) {
    validateTopLevelArray(relPath, payload, errors);
  } else if (payload && typeof payload === 'object') {
    validateTopLevelObject(relPath, payload, errors);
  } else {
    errors.push('Top-level JSON value must be either an object or an array.');
  }

  return { relPath, errors };
}

async function main() {
  let files;
  try {
    files = await listJsonFiles(DATA_DIR);
  } catch (error) {
    console.error(`::error title=JSON validation failed::Unable to scan data directory: ${error.message || error}`);
    process.exit(1);
    return;
  }

  if (files.length === 0) {
    console.error('::error title=JSON validation failed::No JSON files found under data/.');
    process.exit(1);
    return;
  }

  let failed = false;
  for (const filePath of files) {
    const result = await validateFile(filePath);
    if (result.errors.length === 0) {
      console.log(`Validated ${result.relPath}`);
      continue;
    }

    failed = true;
    for (const message of result.errors) {
      emitError(result.relPath, message);
    }
  }

  if (failed) {
    console.error('JSON validation failed. Deployment/sync is blocked until the above errors are fixed.');
    process.exit(1);
    return;
  }

  console.log(`JSON validation passed for ${files.length} file(s).`);
}

main().catch((error) => {
  console.error(`::error title=JSON validation failed::Unexpected error: ${error.message || error}`);
  process.exit(1);
});
