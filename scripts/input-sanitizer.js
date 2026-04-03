const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SCRIPT_TAG_REGEX = /<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const HTML_TAG_REGEX = /<[^>]+>/g;
const JS_PROTOCOL_REGEX = /javascript\s*:/gi;

function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function sanitizeText(value, options = {}) {
  const { preserveNewlines = false, maxLength = 2000 } = options;
  let text = (value ?? '').toString();
  text = text.replace(CONTROL_CHAR_REGEX, '');
  text = text.replace(SCRIPT_TAG_REGEX, ' ');
  text = text.replace(HTML_TAG_REGEX, ' ');
  text = text.replace(JS_PROTOCOL_REGEX, '');
  text = text.replace(/[<>{}[\]`$\\]/g, '');

  if (preserveNewlines) {
    text = text
      .split(/\r?\n/)
      .map((line) => collapseWhitespace(line))
      .filter((line, index, lines) => !(line === '' && lines[index - 1] === ''))
      .join('\n')
      .trim();
  } else {
    text = collapseWhitespace(text);
  }

  if (typeof maxLength === 'number' && maxLength > 0 && text.length > maxLength) {
    return text.slice(0, maxLength);
  }

  return text;
}

function sanitizeEmail(value) {
  return sanitizeText(value, { maxLength: 254 }).toLowerCase();
}

function sanitizePhone(value) {
  const raw = sanitizeText(value, { maxLength: 40 });
  const keep = raw.replace(/[^+\d]/g, '');
  if (!keep) return '';

  if (keep.startsWith('+')) {
    return `+${keep.slice(1).replace(/[+]/g, '')}`;
  }

  return keep.replace(/[+]/g, '');
}

function sanitizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const sanitized = sanitizeText(value, { maxLength: 40 }).replace(/,/g, '');
  const numeric = Number(sanitized);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeAirtableValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeAirtableValue(item));
  if (typeof value === 'object') return sanitizeAirtableFields(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return sanitizeText(value, { preserveNewlines: true, maxLength: 4000 });
}

function sanitizeAirtableFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};

  const sanitized = {};
  for (const [key, value] of Object.entries(fields)) {
    const safeKey = sanitizeText(key, { maxLength: 120 });
    if (!safeKey) continue;
    sanitized[safeKey] = sanitizeAirtableValue(value);
  }
  return sanitized;
}

module.exports = {
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumber,
  sanitizeAirtableFields
};
