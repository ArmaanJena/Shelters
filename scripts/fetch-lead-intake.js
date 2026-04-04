#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumber,
  sanitizeAirtableFields
} = require('./input-sanitizer');

const LEAD_INTAKE_PULL_URL = process.env.LEAD_INTAKE_PULL_URL || '';
const LEAD_INTAKE_PULL_TOKEN = process.env.LEAD_INTAKE_PULL_TOKEN || '';
const LEAD_INTAKE_PULL_TIMEOUT_MS = Number(process.env.LEAD_INTAKE_PULL_TIMEOUT_MS || 20000);
const LEAD_INTAKE_PULL_MAX_RETRIES = Number(process.env.LEAD_INTAKE_PULL_MAX_RETRIES || 3);
const LEAD_INTAKE_PULL_BASE_BACKOFF_MS = Number(process.env.LEAD_INTAKE_PULL_BASE_BACKOFF_MS || 1200);
const LEAD_INTAKE_MAX_STATE_IDS = Number(process.env.LEAD_INTAKE_MAX_STATE_IDS || 5000);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'lead-intake-state.json');
const WHATSAPP_QUEUE_FILE = path.join(DATA_DIR, 'whatsapp-leads.json');
const LOAN_QUEUE_FILE = path.join(DATA_DIR, 'loan-leads.json');
const INSURANCE_QUEUE_FILE = path.join(DATA_DIR, 'insurance-leads.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const processedIntakeIds = Array.isArray(parsed?.processedIntakeIds)
      ? parsed.processedIntakeIds.filter((id) => typeof id === 'string' && id.trim())
      : [];
    return {
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
      processedIntakeIds
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { updatedAt: null, processedIntakeIds: [] };
    }
    throw error;
  }
}

function parseIntakePayload(payload) {
  if (payload && typeof payload === 'object' && payload.ok === false) {
    const reason = typeof payload.error === 'string' && payload.error.trim() ? payload.error : 'Unknown intake error.';
    throw new Error(`Lead intake endpoint returned error: ${reason}`);
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.leads)) return payload.leads;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

function normalizeLeadCategory(raw) {
  const value = sanitizeText(raw, { maxLength: 40 }).toLowerCase();
  if (value === 'whatsapp') return 'whatsapp';
  if (value === 'loan') return 'loan';
  if (value === 'insurance') return 'insurance';
  return '';
}

function buildReferralId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function normalizeWhatsAppLead(raw) {
  const name = sanitizeText(raw.name, { maxLength: 120 });
  const phone = sanitizePhone(raw.phone);
  if (!name || !phone) return null;
  return {
    referralId: sanitizeText(raw.referralId, { maxLength: 80 }) || buildReferralId('SW'),
    name,
    phone,
    message: sanitizeText(raw.message, { preserveNewlines: true, maxLength: 2000 }),
    leadType: sanitizeText(raw.leadType, { maxLength: 120 }) || 'General Enquiry',
    submittedAt: toIso(raw.submittedAt),
    synced: false
  };
}

function normalizeLoanLead(raw) {
  const fields = sanitizeAirtableFields({
    Name: sanitizeText(raw.applicantName || raw?.fields?.Name, { maxLength: 120 }),
    Phone: sanitizePhone(raw.applicantPhone || raw?.fields?.Phone),
    Email: sanitizeEmail(raw.applicantEmail || raw?.fields?.Email),
    'Loan Amount': sanitizeNumber(raw.loanAmount || raw?.fields?.['Loan Amount']),
    'Tenure (Years)': sanitizeNumber(raw.loanTenure || raw?.fields?.['Tenure (Years)']),
    Application: sanitizeText(raw.loanType || raw?.fields?.Application, { maxLength: 120 }),
    'Applicant Age': sanitizeNumber(raw.applicantAge || raw?.fields?.['Applicant Age']),
    'Credit Score': sanitizeNumber(raw.creditScore || raw?.fields?.['Credit Score']),
    'Monthly Income': sanitizeNumber(raw.monthlyIncome || raw?.fields?.['Monthly Income']),
    'Existing EMIs': sanitizeNumber(raw.existingEMIs || raw?.fields?.['Existing EMIs']),
    'Co-Applicant Name':
      sanitizeText(raw.coApplicantName || raw?.fields?.['Co-Applicant Name'], { maxLength: 120 }) || null,
    'Co-Applicant Income': sanitizeNumber(raw.coApplicantIncome || raw?.fields?.['Co-Applicant Income']),
    Status: 'New Lead',
    'Submission Date': toIso(raw.submittedAt || raw?.fields?.['Submission Date'])
  });

  if (!fields.Name || !fields.Phone) return null;
  const referralId = sanitizeText(raw.referralId || raw?.fields?.['Referral ID'], { maxLength: 80 }) || buildReferralId('SR');
  fields['Referral ID'] = referralId;

  return {
    referralId,
    leadCategory: 'loan',
    submittedAt: toIso(raw.submittedAt),
    synced: false,
    fields
  };
}

function normalizeInsuranceLead(raw) {
  const safeName = sanitizeText(raw.applicantName || raw.name || raw?.fields?.Name, { maxLength: 120 });
  const safePhone = sanitizePhone(raw.applicantPhone || raw.phone || raw?.fields?.Phone);
  if (!safeName || !safePhone) return null;

  const referralId =
    sanitizeText(raw.referralId || raw?.fields?.['Referral ID'], { maxLength: 80 }) || buildReferralId('SI');
  const fields = sanitizeAirtableFields({
    Name: safeName,
    Phone: safePhone,
    Email: sanitizeEmail(raw.applicantEmail || raw.email || raw?.fields?.Email),
    Message: sanitizeText(raw.message || raw?.fields?.Message, { preserveNewlines: true, maxLength: 2000 }),
    Type: 'Insurance',
    Status: 'New Lead',
    'Referral ID': referralId,
    'Submission Date': toIso(raw.submittedAt || raw?.fields?.['Submission Date'])
  });

  return {
    referralId,
    leadCategory: 'insurance',
    submittedAt: toIso(raw.submittedAt),
    synced: false,
    fields
  };
}

function normalizeIncomingLead(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const category = normalizeLeadCategory(raw.leadCategory || raw.category || raw.type);
  if (!category) return null;

  const intakeId = sanitizeText(raw.intakeId || raw.id || raw.externalId || '', { maxLength: 160 });

  if (category === 'whatsapp') {
    const lead = normalizeWhatsAppLead(raw);
    return lead ? { category, intakeId, lead } : null;
  }
  if (category === 'loan') {
    const lead = normalizeLoanLead(raw);
    return lead ? { category, intakeId, lead } : null;
  }
  if (category === 'insurance') {
    const lead = normalizeInsuranceLead(raw);
    return lead ? { category, intakeId, lead } : null;
  }
  return null;
}

function createHeaders() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'shelters-realty-lead-intake-sync'
  };
  if (LEAD_INTAKE_PULL_TOKEN) {
    headers.Authorization = `Bearer ${LEAD_INTAKE_PULL_TOKEN}`;
  }
  return headers;
}

async function fetchIntakePayload() {
  if (!LEAD_INTAKE_PULL_URL.trim()) {
    console.log('LEAD_INTAKE_PULL_URL is not configured. Skipping intake sync.');
    return [];
  }

  let lastError;
  for (let attempt = 1; attempt <= LEAD_INTAKE_PULL_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LEAD_INTAKE_PULL_TIMEOUT_MS);
    try {
      const response = await fetch(LEAD_INTAKE_PULL_URL, {
        method: 'GET',
        headers: createHeaders(),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Intake endpoint failed (${response.status}).`);
      }
      const payload = await response.json();
      return parseIntakePayload(payload);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < LEAD_INTAKE_PULL_MAX_RETRIES;
      if (!canRetry) break;
      const backoff = LEAD_INTAKE_PULL_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      console.warn(`Lead intake fetch attempt ${attempt} failed: ${error.message || error}. Retrying...`);
      await sleep(backoff);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError || new Error('Lead intake fetch failed.');
}

function dedupeByReferralId(queue) {
  return new Set(queue.map((lead) => lead?.referralId).filter((id) => typeof id === 'string' && id.trim()));
}

async function run() {
  const [state, whatsappQueue, loanQueue, insuranceQueue] = await Promise.all([
    readState(),
    readJsonArray(WHATSAPP_QUEUE_FILE),
    readJsonArray(LOAN_QUEUE_FILE),
    readJsonArray(INSURANCE_QUEUE_FILE)
  ]);

  const processedIds = new Set(state.processedIntakeIds);
  const whatsappIds = dedupeByReferralId(whatsappQueue);
  const loanIds = dedupeByReferralId(loanQueue);
  const insuranceIds = dedupeByReferralId(insuranceQueue);

  const incoming = await fetchIntakePayload();
  if (!Array.isArray(incoming) || incoming.length === 0) {
    console.log('No incoming leads found from intake endpoint.');
    return;
  }

  const nextWhatsapp = [...whatsappQueue];
  const nextLoan = [...loanQueue];
  const nextInsurance = [...insuranceQueue];
  let imported = 0;
  const newlyProcessedIds = [];

  for (const raw of incoming) {
    const normalized = normalizeIncomingLead(raw);
    if (!normalized) continue;

    if (normalized.intakeId && processedIds.has(normalized.intakeId)) {
      continue;
    }

    if (normalized.category === 'whatsapp') {
      if (whatsappIds.has(normalized.lead.referralId)) continue;
      nextWhatsapp.push(normalized.lead);
      whatsappIds.add(normalized.lead.referralId);
      imported += 1;
    } else if (normalized.category === 'loan') {
      if (loanIds.has(normalized.lead.referralId)) continue;
      nextLoan.push(normalized.lead);
      loanIds.add(normalized.lead.referralId);
      imported += 1;
    } else if (normalized.category === 'insurance') {
      if (insuranceIds.has(normalized.lead.referralId)) continue;
      nextInsurance.push(normalized.lead);
      insuranceIds.add(normalized.lead.referralId);
      imported += 1;
    }

    if (normalized.intakeId) {
      processedIds.add(normalized.intakeId);
      newlyProcessedIds.push(normalized.intakeId);
    }
  }

  if (imported === 0) {
    console.log('No new leads imported from intake endpoint.');
    return;
  }

  const processedList = [...state.processedIntakeIds, ...newlyProcessedIds].slice(
    -Math.max(1, LEAD_INTAKE_MAX_STATE_IDS)
  );
  const nextState = {
    updatedAt: new Date().toISOString(),
    processedIntakeIds: processedList
  };

  await Promise.all([
    writeJson(WHATSAPP_QUEUE_FILE, nextWhatsapp),
    writeJson(LOAN_QUEUE_FILE, nextLoan),
    writeJson(INSURANCE_QUEUE_FILE, nextInsurance),
    writeJson(STATE_FILE, nextState)
  ]);

  console.log(`Imported ${imported} lead(s) into queue JSON files.`);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
