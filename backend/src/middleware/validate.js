const Joi = require('joi');

const yearMonth = Joi.string().pattern(/^(\d{4}-(0[1-9]|1[0-2])|至今)$/);
const phoneOrEmpty = Joi.string().allow('').pattern(/^1[3-9]\d{9}$/).messages({
  'string.pattern.base': '手机号格式错误',
});

// Schemas carry .label() so routeScanner → OpenAPI can infer requestBody refs
// from validateBody middleware (see __joiSchemaLabel). Keep labels in sync with
// components.schemas names in src/routes/openapi.js — drift = broken $ref.
const resumeSchema = Joi.object({
  name: Joi.string().max(64).required(),
  gender: Joi.string().valid('male', 'female', 'other').required(),
  degree: Joi.string().max(16).required(),
  phone: phoneOrEmpty.required(),
  educations: Joi.array().items(
    Joi.object({
      school: Joi.string().max(128).required(),
      major: Joi.string().max(64).required(),
      degree: Joi.string().max(16).required(),
      start: yearMonth.required(),
      end: yearMonth.required(),
    })
  ).min(1).required(),
  experiences: Joi.array().items(
    Joi.object({
      company: Joi.string().max(128).required(),
      title: Joi.string().max(64).required(),
      start: yearMonth.required(),
      end: yearMonth.required(),
      desc: Joi.string().max(2000).required(),
    })
  ).min(1).required(),
  expected: Joi.object({
    city: Joi.string().max(64).required(),
    position: Joi.string().max(128).required(),
    salary_min: Joi.number().integer().min(0).required(),
    salary_max: Joi.number().integer().min(Joi.ref('salary_min')).required(),
  }).required(),
  skills: Joi.array().items(Joi.string()).min(1).max(20).required(),
}).label('ResumeSaveRequest');

const jobSchema = Joi.object({
  title: Joi.string().max(128).required(),
  company: Joi.string().max(128).required(),
  city: Joi.string().max(64).required(),
  salary_min: Joi.number().integer().min(0).required(),
  salary_max: Joi.number().integer().min(Joi.ref('salary_min')).required(),
  degree_required: Joi.string().max(16).default('不限'),
  experience_required: Joi.string().max(16).default('不限'),
  skills_required: Joi.array().items(Joi.string()).default([]),
  description_md: Joi.string().max(20000).required(),
}).label('JobCreateRequest');

const promptUpdateSchema = Joi.object({
  content: Joi.string().max(50000).required(),
}).label('PromptUpdateRequest');

// R114 T1: AI assist-field 入参校验（含长度上限，防止超长输入打爆 LLM / 注入）
const assistFieldSchema = Joi.object({
  fieldId: Joi.string().max(64).required(),
  fieldLabel: Joi.string().max(64).required(),
  currentValue: Joi.string().allow('').max(2000).required(),
  history: Joi.array().items(Joi.object({
    role: Joi.string().valid('user', 'assistant').required(),
    content: Joi.string().max(2000).required(),
  })).max(20).default([]),
}).label('AssistFieldRequest');

/**
 * validateBody(schema, { source = 'body', stripUnknown = false } = {})
 * Express middleware: validate req[source] against joi schema.
 * On success: req[source] is replaced with the cleaned value (Joi strips unknown keys if configured).
 * On failure: 400 with { code: 400, message, details }.
 *
 * The returned middleware also carries `__joiSchema` (ref) and `__joiSchemaLabel`
 * (string from schema._flags.label) so routeScanner → OpenAPI can infer
 * requestBody $refs. Backward-compat: existing callers continue to work — the
 * extra props are read only by the scanner, not by Express.
 */
function validateBody(schema, { source = 'body', stripUnknown = false } = {}) {
  if (!schema || typeof schema.validate !== 'function') {
    throw new Error('validateBody requires a Joi schema');
  }
  const mw = (req, res, next) => {
    const data = req[source];
    const opts = {
      abortEarly: false,
      stripUnknown,
      convert: true,
      errors: { wrap: { label: false } },
    };
    const { error, value } = schema.validate(data, opts);
    if (error) {
      const details = error.details.map(d => ({ path: d.path.join('.'), message: d.message }));
      return res.status(400).json({ code: 400, message: '请求参数错误', details });
    }
    req[source] = value;
    next();
  };
  // Attach joi ref + label so routeScanner can resolve $ref without parsing source.
  // Both are best-effort — missing label gracefully skips requestBody emission.
  mw.__joiSchema = schema;
  mw.__joiSchemaLabel = (schema && schema._flags && schema._flags.label) || null;
  return mw;
}

module.exports = { resumeSchema, jobSchema, promptUpdateSchema, assistFieldSchema, validateBody };
