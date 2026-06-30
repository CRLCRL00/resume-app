const express = require('express');
const router = express.Router();

const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: '简历推荐小程序 API',
    version: '1.0.0',
    description: 'Phase 8 完整 + 微信小程序后端。Auth: JWT Bearer。',
  },
  servers: [
    { url: 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com', description: 'tunnel (真机)' },
    { url: 'https://43.139.176.199', description: 'IP+自签证书 (开发/审核员)' },
    { url: 'http://127.0.0.1:3003', description: '本地开发' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      StandardResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '0 = success' },
          data: { type: 'object', nullable: true },
          message: { type: 'string', nullable: true },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Basic health check',
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardResponse' } } } } },
      },
    },
    '/api/health/deep': {
      get: {
        summary: 'DB + Redis ping',
        responses: {
          200: { description: 'all OK' },
          503: { description: 'one or more down' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        summary: '微信 code2session + 返回 JWT',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'OK' }, 429: { description: 'too many' } },
      },
    },
    '/api/resume/save': {
      post: {
        summary: '保存用户填的简历 source_form',
        responses: { 200: { description: 'data.resume_id' } },
      },
    },
    '/api/resume/current': {
      get: { summary: '获取当前激活简历', responses: { 200: { description: 'data: {resume_id, content_md, source_form}' } } },
    },
    '/api/resume/generate': {
      post: {
        summary: '调 DeepSeek 生成内容',
        responses: {
          200: { description: 'data.content_md (markdown)' },
          502: { description: 'LLM failure' },
        },
      },
    },
    '/api/match': {
      post: {
        summary: '匹配 + LLM rerank',
        responses: { 200: { description: 'data: {results: [...], batch_id}' } },
      },
    },
    '/api/jobs/{id}': {
      get: {
        summary: '岗位详情',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'not found' } },
      },
    },
    '/api/legal/privacy': { get: { summary: '隐私协议 markdown', responses: { 200: { description: 'data.content' } } } },
    '/api/legal/terms': { get: { summary: '服务条款 markdown', responses: { 200: { description: 'data.content' } } } },
    '/api/user/me/export': {
      get: {
        summary: 'GDPR 风格导出本人全部数据',
        responses: { 200: { description: 'data: {user, resumes, matches}' } },
      },
    },
    '/api/user/me': {
      delete: {
        summary: '硬删除本人全部数据',
        responses: { 200: { description: 'data.deleted: true' } },
      },
    },
    '/api/admin/check': { get: { summary: 'admin 探测' } },
    '/api/admin/jobs': { get: { summary: '岗位列表 (admin)', responses: { 200: { description: 'data.items + data.total' } } } },
    '/api/admin/jobs/{id}': { put: { summary: '编辑岗位 (admin)' } },
    '/api/admin/prompts': { get: { summary: '提示词列表' } },
    '/api/admin/logs': { get: { summary: '操作日志' } },
  },
};

router.get('/openapi.json', (req, res) => res.json(openapiSpec));

// 简化版 Swagger UI（CDN，无依赖）— 单文件 HTML
const SWAGGER_HTML = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>API Docs</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css">
</head><body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
<script>
SwaggerUIBundle({ url: '/api/docs/openapi.json', dom_id: '#ui' });
</script></body></html>`;

router.get('/', (req, res) => {
  res.set('Content-Type', 'text/html').send(SWAGGER_HTML);
});

module.exports = { openapiRouter: router };
