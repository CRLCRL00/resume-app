const express = require('express');
const router = express.Router();

/* eslint-disable max-len */
const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: '简历推荐小程序 API',
    version: '1.0.0',
    description: 'Phase 8+ 完整后端。Auth: JWT Bearer。Privacy: 隐私协议 / 服务条款 markdown。Audit: /admin/logs/security 过滤。',
  },
  servers: [
    { url: 'https://fa1b04c679fe9e41-43-139-176-199.serveousercontent.com', description: 'tunnel (真机可达)' },
    { url: 'https://43.139.176.199', description: 'IP+自签证书 (审核员)' },
    { url: 'http://127.0.0.1:3003', description: '本地开发' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      StandardResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', description: '0=success, !0=error', example: 0 },
          data: { type: 'object', nullable: true },
          message: { type: 'string', nullable: true, example: 'success' },
        },
      },
      ResumeSaveRequest: {
        type: 'object',
        required: ['source_form'],
        properties: {
          source_form: {
            type: 'object',
            required: ['name', 'gender', 'degree', 'phone', 'educations', 'experiences', 'expected', 'skills'],
            properties: {
              name: { type: 'string', example: '张三' },
              gender: { type: 'string', enum: ['male', 'female', 'other'] },
              degree: { type: 'string', enum: ['高中','大专','本科','硕士','博士'] },
              phone: { type: 'string', example: '' },
              educations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    school: { type: 'string' }, major: { type: 'string' },
                    degree: { type: 'string' },
                    start: { type: 'string', pattern: '^(\\d{4}-(0[1-9]|1[0-2])|至今)$' },
                    end: { type: 'string' },
                  },
                },
              },
              experiences: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    company: { type: 'string' }, title: { type: 'string' },
                    start: { type: 'string' }, end: { type: 'string' },
                    desc: { type: 'string' },
                  },
                },
              },
              expected: {
                type: 'object',
                properties: {
                  city: { type: 'string' }, position: { type: 'string' },
                  salary_min: { type: 'integer', minimum: 0 },
                  salary_max: { type: 'integer', minimum: 0 },
                },
              },
              skills: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', description: 'wx.login() 返回的 js_code' } },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer', example: 0 },
          data: {
            type: 'object',
            properties: {
              token: { type: 'string', description: 'JWT bearer' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  openid: { type: 'string' },
                  nickname: { type: 'string', nullable: true },
                  avatar_url: { type: 'string', nullable: true },
                },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      MatchRequest: {
        type: 'object',
        required: ['resume_id'],
        properties: { resume_id: { type: 'integer', example: 12 } },
      },
      MatchResult: {
        type: 'object',
        properties: {
          job_id: { type: 'integer' },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          reason: { type: 'string' },
        },
      },
      MatchResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer' },
          data: {
            type: 'object',
            properties: {
              results: { type: 'array', items: { $ref: '#/components/schemas/MatchResult' } },
              batch_id: { type: 'string', nullable: true },
              message: { type: 'string' },
            },
          },
        },
      },
      GenerateRequest: {
        type: 'object',
        required: ['resume_id'],
        properties: { resume_id: { type: 'integer' } },
      },
      GenerateResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer' },
          data: {
            type: 'object',
            properties: {
              resume_id: { type: 'integer' },
              content_md: { type: 'string', description: 'AI 生成的 markdown 简历' },
              cached: { type: 'boolean' },
            },
          },
        },
      },
      JobCreateRequest: {
        type: 'object',
        required: ['title', 'company', 'city', 'salary_min', 'salary_max', 'description_md'],
        properties: {
          title: { type: 'string' }, company: { type: 'string' }, city: { type: 'string' },
          salary_min: { type: 'integer', minimum: 0 }, salary_max: { type: 'integer', minimum: 0 },
          degree_required: { type: 'string', default: '不限' },
          experience_required: { type: 'string', default: '不限' },
          skills_required: { type: 'array', items: { type: 'string' } },
          description_md: { type: 'string' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          code: { type: 'integer' },
          message: { type: 'string' },
          data: { type: 'object', nullable: true },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        summary: 'Basic health',
        security: [],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/StandardResponse' } } } } },
      },
    },
    '/api/health/deep': {
      get: {
        summary: 'DB + Redis ping',
        security: [],
        responses: { 200: { description: 'all OK' }, 503: { description: 'degraded' } },
      },
    },
    '/api/auth/login': {
      post: {
        summary: '微信 code2session + 返回 JWT',
        security: [],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } },
        responses: {
          200: { description: 'OK + JWT', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } } },
          400: { description: 'invalid wechat code' },
          429: { description: 'IP rate-limited / locked' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        summary: '注销：把当前 JWT 加入 Redis 黑名单',
        responses: { 200: { description: 'OK' }, 401: { description: 'no/bad token' } },
      },
    },
    '/api/resume/save': {
      post: {
        summary: '保存/更新简历 source_form',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ResumeSaveRequest' } } } },
        responses: { 200: { description: 'OK + resume_id' } },
      },
    },
    '/api/resume/current': {
      get: {
        summary: '获取当前激活简历',
        responses: { 200: { description: 'OK' }, 404: { description: 'no resume' } },
      },
    },
    '/api/resume/generate': {
      post: {
        summary: '调 DeepSeek 生成简历内容',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateRequest' } } } },
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateResponse' } } } },
          502: { description: 'LLM failure' },
        },
      },
    },
    '/api/match': {
      post: {
        summary: '匹配 + LLM rerank',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/MatchRequest' } } } },
        responses: {
          200: { description: 'OK + results + batch_id', content: { 'application/json': { schema: { $ref: '#/components/schemas/MatchResponse' } } } },
        },
      },
    },
    '/api/jobs/{id}': {
      get: {
        summary: '岗位详情',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'not found' } },
      },
    },
    '/api/legal/privacy': { get: { summary: '隐私协议', security: [], responses: { 200: { description: 'OK' } } } },
    '/api/legal/terms': { get: { summary: '服务条款', security: [], responses: { 200: { description: 'OK' } } } },
    '/api/legal/versions': {
      get: {
        summary: '法务文档版本号',
        security: [],
        responses: { 200: { description: 'data: {privacy, terms}' } },
      },
    },
    '/api/user/me/export': {
      get: {
        summary: 'GDPR 风格导出本人全部数据',
        responses: { 200: { description: 'data.user / resumes / matches' } },
      },
    },
    '/api/user/me': {
      delete: {
        summary: '硬删除本人全部数据（+ audit log）',
        responses: { 200: { description: 'data.deleted: true' } },
      },
    },
    '/api/admin/check': {
      get: { summary: 'admin 探测', responses: { 200: { description: 'isAdmin true' }, 403: { description: 'admin only' } } },
    },
    '/api/admin/jobs': {
      get: {
        summary: '岗位列表 (admin)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: { 200: { description: 'data.items + total' } },
      },
      post: {
        summary: '新增岗位 (admin, 启用 2FA 后需 X-2FA-Token)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/JobCreateRequest' } } } },
        responses: { 200: { description: 'data.job_id' }, 403: { description: '2FA required' } },
      },
    },
    '/api/admin/jobs/{id}': {
      put: {
        summary: '编辑岗位 (admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'not found' } },
      },
      delete: { summary: '软删 (admin)', parameters: [{ name: 'id', in: 'path', required: true }] },
    },
    '/api/admin/jobs/{id}/online': {
      patch: { summary: '切换 is_online (admin)', parameters: [{ name: 'id', in: 'path', required: true }] },
    },
    '/api/admin/jobs/{id}/restore': {
      patch: { summary: '取消软删 (admin)', parameters: [{ name: 'id', in: 'path', required: true }] },
    },
    '/api/admin/prompts/{code}': {
      get: { summary: '提示词详情 (admin)', parameters: [{ name: 'code', in: 'path', required: true }] },
      put: { summary: '编辑提示词 (admin)', parameters: [{ name: 'code', in: 'path', required: true }] },
    },
    '/api/admin/logs': {
      get: {
        summary: '全部操作日志 (admin)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: { 200: { description: 'data.items + total' } },
      },
    },
    '/api/admin/logs/security': {
      get: {
        summary: '安全事件日志（filter security.* + days 范围）',
        parameters: [
          { name: 'days', in: 'query', schema: { type: 'integer', default: 7 } },
        ],
        responses: { 200: { description: 'data.items + total' } },
      },
    },
    '/api/admin/logs/prune': {
      delete: {
        summary: '清理 N 天前 logs (admin, days ≥ 7)',
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 90 } }],
        responses: { 200: { description: 'data.deleted' } },
      },
    },
    '/api/admin/legal-version': {
      post: {
        summary: 'bump 法务文档版本号 (admin)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['doc_type', 'version'],
            properties: {
              doc_type: { type: 'string', enum: ['privacy', 'terms'] },
              version: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              note: { type: 'string' },
            },
          } } },
        },
        responses: { 200: { description: 'OK' }, 400: { description: 'invalid' }, 403: { description: 'admin only' } },
      },
    },
    '/api/admin/2fa/status': {
      get: {
        summary: 'admin 2FA 状态 (enabled / hasSecret / verifiedAt)',
        responses: { 200: { description: 'data.enabled / data.hasSecret / data.verifiedAt' }, 403: { description: 'admin only' } },
      },
    },
    '/api/admin/2fa/setup': {
      post: {
        summary: '生成 TOTP secret 存 DB（不启用）',
        responses: { 200: { description: 'data.otpauthUrl + data.base32 + data.qrDataUrl' } },
      },
    },
    '/api/admin/2fa/enable': {
      post: {
        summary: '校验 code 后启用 2FA (admin)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^\\d{6}$' } } } } },
        },
        responses: { 200: { description: 'data.enabled=true' }, 400: { description: 'code 错或未 setup' } },
      },
    },
    '/api/admin/2fa/verify': {
      post: {
        summary: '校验 code 签发 challengeToken (5 min, 单次)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^\\d{6}$' } } } } },
        },
        responses: { 200: { description: 'data.challengeToken (32 hex)' }, 400: { description: 'code 错 / 未启用' } },
      },
    },
    '/api/admin/2fa': {
      delete: {
        summary: '校验 code 后关闭 2FA (admin, 清 secret)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^\\d{6}$' } } } } },
        },
        responses: { 200: { description: 'data.disabled=true' }, 400: { description: 'code 错' } },
      },
    },
    '/api/internal/alert': {
      post: {
        summary: '接收 monitor webhook (server-side)',
        security: [],
        responses: { 200: { description: 'received' }, 401: { description: 'bad token' } },
      },
    },
    '/api/internal/alerts/recent': {
      get: {
        summary: '近 50 条 alert',
        security: [],
        responses: { 200: { description: 'data.items' } },
      },
    },
  },
};

router.get('/openapi.json', (req, res) => res.json(openapiSpec));

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
