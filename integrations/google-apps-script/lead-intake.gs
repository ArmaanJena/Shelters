const SHEET_NAME = 'LeadIntake';
const PULL_TOKEN_PROPERTY_KEY = 'LEAD_INTAKE_PULL_TOKEN';

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSheet_() {
  const sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME) ||
    SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'intakeId',
      'leadCategory',
      'submittedAt',
      'name',
      'phone',
      'message',
      'leadType',
      'source',
      'pageUrl',
      'whatsappUrl',
      'payloadJson'
    ]);
  }
  return sheet;
}

function sanitizeText_(value, maxLength) {
  const text = String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function sanitizePhone_(value) {
  const text = sanitizeText_(value, 40).replace(/[^+\d]/g, '');
  if (!text) return '';
  if (text.startsWith('+')) return `+${text.slice(1).replace(/[+]/g, '')}`;
  return text.replace(/[+]/g, '');
}

function normalizeCategory_(value) {
  const category = sanitizeText_(value, 30).toLowerCase();
  if (category === 'whatsapp' || category === 'loan' || category === 'insurance') {
    return category;
  }
  return '';
}

function generateIntakeId_() {
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GAS-${Date.now()}-${randomPart}`;
}

function validateLeadPayload_(payload) {
  const category = normalizeCategory_(payload.leadCategory || payload.category || payload.type);
  if (!category) {
    return { ok: false, error: 'Invalid lead category.' };
  }

  if (category === 'whatsapp') {
    const name = sanitizeText_(payload.name, 120);
    const phone = sanitizePhone_(payload.phone);
    if (!name || !phone) {
      return { ok: false, error: 'Name and phone are required.' };
    }
  }

  return { ok: true, category };
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const validation = validateLeadPayload_(payload);
    if (!validation.ok) {
      return jsonResponse({ ok: false, error: validation.error });
    }

    const intakeId = sanitizeText_(payload.intakeId, 160) || generateIntakeId_();
    const submittedAt = sanitizeText_(payload.submittedAt, 80) || new Date().toISOString();
    const sheet = getSheet_();

    sheet.appendRow([
      intakeId,
      validation.category,
      submittedAt,
      sanitizeText_(payload.name, 120),
      sanitizePhone_(payload.phone),
      sanitizeText_(payload.message, 2000),
      sanitizeText_(payload.leadType, 120),
      sanitizeText_(payload.source, 120),
      sanitizeText_(payload.pageUrl, 500),
      sanitizeText_(payload.whatsappUrl, 500),
      JSON.stringify(payload)
    ]);

    return jsonResponse({ ok: true, intakeId, message: 'Lead accepted.' });
  } catch (error) {
    return jsonResponse({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}

function validatePullToken_(requestToken) {
  const scriptToken = PropertiesService.getScriptProperties().getProperty(PULL_TOKEN_PROPERTY_KEY);
  if (!scriptToken) return false;
  return requestToken === scriptToken;
}

function mapRowsToLeads_(rows) {
  const leads = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length === 0) continue;

    const intakeId = sanitizeText_(row[0], 160);
    const leadCategory = normalizeCategory_(row[1]);
    const submittedAt = sanitizeText_(row[2], 80) || new Date().toISOString();
    const payloadJson = sanitizeText_(row[10], 20000);

    if (!intakeId || !leadCategory) continue;

    let payload = {};
    try {
      payload = payloadJson ? JSON.parse(payloadJson) : {};
    } catch (error) {
      payload = {};
    }

    leads.push({
      intakeId,
      leadCategory,
      submittedAt,
      ...payload
    });
  }
  return leads;
}

function doGet(e) {
  try {
    const token = sanitizeText_((e && e.parameter && e.parameter.token) || '', 200);
    if (!validatePullToken_(token)) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    const sheet = getSheet_();
    const rows = sheet.getDataRange().getValues();
    const leads = mapRowsToLeads_(rows);
    return jsonResponse({ ok: true, updatedAt: new Date().toISOString(), leads });
  } catch (error) {
    return jsonResponse({ ok: false, error: error && error.message ? error.message : String(error) });
  }
}
