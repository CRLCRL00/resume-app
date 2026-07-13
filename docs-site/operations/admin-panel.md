# Admin Web Panel (Round 40)

## What it is

A minimal browser-based admin UI at `https://<host>/admin/*`, served as static
files by the Express backend. Replaces the WeChat DevTools / curl workflow for
common admin operations.

- **Stack**: static HTML + Alpine.js 3 (CDN, unpkg) + plain CSS. No build step.
- **Auth**: cookie-based (R38 — `auth_token` httpOnly). `credentials: 'include'`
  on every `fetch`. JS never reads or stores tokens.
- **Pages**: login, dashboard, jobs, audit, slow queries, 2FA setup.

## File layout

```
admin-panel/
  index.html       # redirect → login.html
  login.html       # login form (openid + dev-bypass code)
  dashboard.html   # summary cards + nav
  jobs.html        # job list + search
  audit.html       # audit log filter
  queries.html     # slow query view
  two-factor.html  # 2FA setup / disable
  css/admin.css    # minimal styles (~120 lines, responsive)
  js/api.js        # fetch wrapper (cookie-mode)
  js/auth.js       # requireAuth() + logout()
```

Total: ≤ 600 lines (currently ~480).

## Dev login flow

The login form posts `{ code: 'dev-bypass', openid: '<admin-openid>' }` to
`POST /api/auth/login`. The route short-circuits before the WeChat call when:

1. `code === 'dev-bypass'`
2. `process.env.NODE_ENV !== 'production'`

It then verifies the openid exists in the `admins` table (otherwise `403`),
issues a normal session (cookie + JWT + CSRF), and logs
`security.admin.dev_bypass` to `admin_operation_logs`. The `openid` field on
the form defaults to `dev-admin` — pre-seed this row via the existing
`admins` table or `seed.sql`.

**Production is unaffected**: `NODE_ENV=production` disables the short-circuit
entirely; the route returns 400 (`code is required` / `wechat error`) and the
browser login page is dev-only.

> Note: this entry point is dev-only. For real admin use, log in via WeChat
> (`POST /api/auth/login` with the wx `code`) in a tool that can post JSON,
> or extend the panel with a WeChat QR-code flow (follow-up).

## Backend wiring

- `backend/src/app.js` mounts `express.static('admin-panel')` at `/admin` with
  a SPA fallback (`/admin/*` → `index.html`).
- `backend/src/routes/auth.js` adds the dev-bypass short-circuit before the
  WeChat `code2session` call. Extracted `issueSession({ openid, bypassDev })`
  helper so dev-bypass and the normal WeChat path share identical
  post-auth behavior (cookies, CSRF, security log).
- `backend/src/middleware/auth.js` (R38) accepts both `Authorization: Bearer`
  and `req.cookies.auth_token`; cookie takes priority for the browser.
- `backend/src/middleware/csrf.js` (R38) requires `X-CSRF-Token` on mutating
  methods **plus Origin whitelist check for cookie-mode requests**.

## Pages → API

| page          | endpoints used                                    |
| ------------- | ------------------------------------------------- |
| dashboard     | `GET /admin/users`, `/admin/jobs`, `/admin/logs`, `/admin/queries/stats`, `/admin/check` |
| jobs          | `GET /admin/jobs?q=&page=&pageSize=`              |
| audit         | `GET /admin/audit?action=&openid=&since=&until=`  |
| queries       | `GET /admin/queries/slow?limit=`, `/admin/queries/stats` |
| two-factor    | `GET /admin/2fa/status`, `POST /setup`, `POST /enable`, `DELETE /2fa` |

All require admin session — non-admin token returns `403 { code: 1003 }`.

## Security notes

- **httpOnly cookie** — JS cannot exfiltrate. CSRF still enforced (Origin +
  token). See [auth-cookie.md](./auth-cookie.md).
- **dev-bypass is gated** by `NODE_ENV !== 'production'`. There is **no env
  var** to enable it; flipping `NODE_ENV=production` is the kill switch.
- **Openid must be in `admins`** — random openids are rejected with 403.
- **Audit** — every dev-bypass success writes `security.admin.dev_bypass` to
  `admin_operation_logs` with `{ openid, ip }`. Visible under
  `GET /api/admin/audit?action=security.admin.dev_bypass`.

## Tests

`backend/tests/auth-dev-bypass.test.js` (5 cases) covers dev-bypass:
1. `code='dev-bypass' + admin openid` → 200 + cookies
2. `code='dev-bypass' + non-admin openid` → 403
3. `code='dev-bypass'` in `NODE_ENV=production` → 400
4. `security.admin.dev_bypass` event recorded with correct openid
5. `GET /admin/login.html` → 200 HTML

`backend/tests/admin-panel-static.test.js` (3 cases):
- `GET /admin/login.html` → 200 HTML
- `GET /admin/dashboard.html` → 200 HTML
- `GET /admin/css/admin.css` → 200 CSS

## Known follow-ups

- WeChat QR-code login flow (replace dev-bypass with `wx.login` → real code
  exchange via a server-side proxy that holds `WX_APPID` + `WX_SECRET`).
- Bulk job operations (currently single-row toggle/delete).
- 2FA backup codes management UI (currently one-time display only).
