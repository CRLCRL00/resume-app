/**
 * joiToOpenApi: convert a Joi 17 schema (or its describe()) into OpenAPI 3.0 schema JSON.
 *
 * Self-contained — no deps. Drives off schema.describe() so we don't peek at internals.
 * On any unhandled construct, falls back to {} (with logger.warn).
 */

const logger = require('../utils/logger');
const FLAG_CHARS = new Set(['u', 'i', 'm', 's']);

function extractRegex(rule) {
  const raw = rule && rule.args && (rule.args.regex || rule.args.pattern);
  if (!raw) return null;
  let src;
  let flagsStr = '';
  if (typeof raw === 'string') {
    // Joi sometimes returns the regex as a stringified "/pat/flags"
    const m = raw.match(/^\/(.*)\/([a-z]*)$/);
    if (m) { src = m[1]; flagsStr = m[2] || ''; }
    else { src = raw; }
  } else {
    src = raw.source;
    flagsStr = raw.flags || '';
  }
  const flags = [];
  for (const c of flagsStr) if (FLAG_CHARS.has(c)) flags.push(c);
  return { pattern: src, flags };
}

function convertDescribed(node) {
  if (!node || typeof node !== 'object') return {};
  const t = node.type;
  try {
    switch (t) {
      case 'string': return convertString(node);
      case 'number': return convertNumber(node);
      case 'boolean': return { type: 'boolean' };
      case 'array': return convertArray(node);
      case 'object': return convertObject(node);
      case 'alternatives': return convertAlternatives(node);
      case 'any': return convertAny(node);
      case 'date': return { type: 'string', format: 'date-time' };
      case 'binary': return { type: 'string', format: 'binary' };
      default:
        logger.warn({ joiType: t }, 'joiToOpenApi: unhandled type, falling back to {}');
        return {};
    }
  } catch (err) {
    logger.warn({ joiType: t, err: err.message }, 'joiToOpenApi: error converting type');
    return {};
  }
}

function convertString(node) {
  const out = { type: 'string' };
  if (Array.isArray(node.allow) && node.flags && node.flags.only) {
    out.enum = node.allow.slice();
  }
  if (node.flags && Object.prototype.hasOwnProperty.call(node.flags, 'default')) {
    out.default = node.flags.default;
  }
  for (const rule of node.rules || []) {
    if (rule.name === 'max') out.maxLength = rule.args.limit;
    else if (rule.name === 'min') out.minLength = rule.args.limit;
    else if (rule.name === 'pattern') {
      const re = extractRegex(rule);
      if (re) {
        out.pattern = re.pattern;
        if (re.flags.length) out.format = re.flags.join('');
      }
    } else if (rule.name === 'length') {
      out.minLength = rule.args.limit;
      out.maxLength = rule.args.limit;
    }
  }
  return out;
}

function convertNumber(node) {
  // Joi signals .integer() via a rule with name='integer' (not via flags)
  let isInteger = false;
  for (const rule of node.rules || []) {
    if (rule.name === 'integer') isInteger = true;
  }
  const out = { type: isInteger ? 'integer' : 'number' };
  if (node.flags && Object.prototype.hasOwnProperty.call(node.flags, 'default')) {
    out.default = node.flags.default;
  }
  if (Array.isArray(node.allow) && node.flags && node.flags.only) {
    out.enum = node.allow.slice();
  }
  for (const rule of node.rules || []) {
    if (rule.name === 'min') {
      // Joi.ref() can't be expressed in OpenAPI numeric constraint → drop lower bound silently
      const lim = rule.args.limit;
      if (typeof lim === 'number') out.minimum = lim;
    } else if (rule.name === 'max') {
      const lim = rule.args.limit;
      if (typeof lim === 'number') out.maximum = lim;
    }
  }
  return out;
}

function convertArray(node) {
  const items = Array.isArray(node.items) ? node.items : [];
  const out = {
    type: 'array',
    items: items.length ? convertDescribed(items[0]) : {},
  };
  if (node.flags && Object.prototype.hasOwnProperty.call(node.flags, 'default')) {
    out.default = node.flags.default;
  }
  for (const rule of node.rules || []) {
    if (rule.name === 'min') out.minItems = rule.args.limit;
    else if (rule.name === 'max') out.maxItems = rule.args.limit;
    else if (rule.name === 'length') {
      out.minItems = rule.args.limit;
      out.maxItems = rule.args.limit;
    }
    else if (rule.name === 'unique') out.uniqueItems = true;
  }
  return out;
}

function convertObject(node) {
  const props = {};
  const required = [];
  const keys = (node.keys) || {};
  for (const k of Object.keys(keys)) {
    const child = keys[k];
    props[k] = convertDescribed(child);
    if (child && child.flags && child.flags.presence === 'required') {
      required.push(k);
    }
  }
  const out = { type: 'object', properties: props };
  if (required.length) out.required = required;
  if (node.flags && Object.prototype.hasOwnProperty.call(node.flags, 'default')) {
    out.default = node.flags.default;
  }
  return out;
}

function convertAlternatives(node) {
  const matches = (node.matches || []).map(m => convertDescribed(m.schema || m));
  // also flatten any nested .try() items via Joi internals: described top-level alternatives
  // has one match per branch with .schema = described branch.
  if (!matches.length) return {};
  return { oneOf: matches };
}

function convertAny(_node) {
  // Joi.any() and Joi.unknown() are too permissive to map safely — return empty schema
  return {};
}

function wrap(joiOrDescribed, opts) {
  const name = opts && opts.name ? opts.name : 'Schema';
  let described;
  if (joiOrDescribed && typeof joiOrDescribed.describe === 'function' && joiOrDescribed._flags !== undefined) {
    try { described = joiOrDescribed.describe(); } catch (e) {
      described = joiOrDescribed;
    }
  } else {
    described = joiOrDescribed;
  }
  return {
    schema: convertDescribed(described),
    sourceJoiName: name,
    generatedAt: new Date().toISOString(),
  };
}

function convertJoi(joiSchema, opts) {
  return wrap(joiSchema, opts);
}

function convertJoiAll(map) {
  const out = {};
  for (const k of Object.keys(map || {})) {
    out[k] = wrap(map[k], { name: k });
  }
  return out;
}

module.exports = { convertJoi, convertJoiAll };
