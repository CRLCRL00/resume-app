const Joi = require('joi');

const yearMonth = Joi.string().pattern(/^(\d{4}-(0[1-9]|1[0-2])|至今)$/);
const phoneOrEmpty = Joi.string().allow('').pattern(/^1[3-9]\d{9}$/).messages({
  'string.pattern.base': '手机号格式错误',
});

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
});

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
});

const promptUpdateSchema = Joi.object({
  content: Joi.string().max(50000).required(),
});

module.exports = { resumeSchema, jobSchema, promptUpdateSchema };
