# Cookie Auth for Admin Web (Round 39)

## Why cookie for admin panel

JWT-in-`Authorization`-header is fine for API clients and the WeChat mini-program
(`wx.request` does not support cookies). For browser-based admin (planned R39+),
plain JWT-in-header has two drawbacks:

1. **XSS token theft** — any inline `<script>` or compromised dependency can
   `fetch(...).then(r => r.headers.get('Authorization'))` and exfiltrate the
   token. httpOnly cookies are unreachable to JS.
2. **No automatic attachment** — browser does not auto-attach `Authorization`
   to cross-origin requests, so every `fetch` needs `credentials: 'include'`
   plus a manual header. Cookies are attached automatically (subject to
   `SameSite` / `Secure` policy).

So: keep `Authorization: Bearer` for WeChat, also set `httpOnly` cookie for
browsers. Both are issued from the same `/login` endpoint with the same JWT —
just two transport channels.

## Cookie config (Round 39)

Defined in `backend/src/config/cookie.js`:

| field       | test / dev            | production                                |
| ----------- | --------------------- | ----------------------------------------- |
| `httpOnly`  | `true`                | `true`                                    |
| `secure`    | `false` (no HTTPS)    | `true` (`NODE_ENV=production`)            |
| `sameSite`  | `'lax'`               | `'lax'`                                   |
| `path`      | `'/'`                 | `'/'`                                     |
| `maxAge`    | `30d` (access) / `90d` (refresh) | same                     |
| `domain`    | `undefined`           | `process.env.COOKIE_DOMAIN` (e.g. `.example.com`) |

`sameSite: 'lax'` (not `'strict'`) — admin may navigate from external links
back into the panel; `strict` would block those cookie reattachments.

`secure: false` in dev/test is intentional: local `http://localhost:3000`
servers can't set `Secure` cookies (browser would drop them).

## Wire-up

`backend/src/app.js` mounts `cookie-parser()` after `express.json` and before
all routes. `backend/src/middleware/auth.js#userAuth` reads token from
**either** `Authorization: Bearer` **or** `req.cookies.auth_token`, header
first (WeChat always wins).

## CSRF interaction

`requireCsrf` middleware already requires `X-CSRF-Token` header on mutating
methods. **Cookie-mode additionally requires `Origin` to be in
`CORS_ALLOWED_ORIGINS`** (Round 39 addition). Defense-in-depth:

- `SameSite=lax` already blocks most cross-site POSTs initiated via top-level
  navigation (link clicks).
- Origin whitelist blocks sub-resource POSTs (e.g. XHR from a third-party
  page) that `SameSite=lax` allows.

Header-mode (WeChat) is unaffected — no `Origin` header on most
`wx.request` calls, and the rule only fires when `req.authVia === 'cookie'`.

## Routes

| route             | effect                                                |
| ----------------- | ----------------------------------------------------- |
| `POST /api/auth/login`    | `Set-Cookie: auth_token=…; HttpOnly; SameSite=Lax` (30d) + `Set-Cookie: refresh_token=…` (90d). Body still returns `token`/`refreshToken` for WeChat. |
| `POST /api/auth/refresh`  | Re-issues `auth_token` cookie with rotated access. Body returns new `access_token` / `refresh_token`. |
| `POST /api/auth/logout`   | `Set-Cookie: auth_token=…; Max-Age=0` + same for `refresh_token` (browsers drop them). |

## WeChat backward compat

Unchanged. `Authorization: Bearer <token>` in body response + headers is
still the canonical path for the mini-program. wx.request transparently
ignores any `Set-Cookie` the server emits.

## Migration path

Existing admin web prototype (R39) gets cookie support for free — no client
changes required beyond `credentials: 'include'` on `fetch` and reading
`data.token` from body for the first render. Pre-existing token-in-header
flow keeps working (userAuth checks both).

## Admin panel (Round 40)

The browser-based admin UI is at `/admin/*` (see [admin-panel.md](./admin-panel.md)).
It uses the same cookie flow above. Dev login short-circuits the WeChat call:

- `POST /api/auth/login` with `code: 'dev-bypass'` and a pre-registered admin
  `openid` → 200 + cookies, skipping `wechatService.code2session()`.
- Gated on `NODE_ENV !== 'production'`. Production forces the normal WeChat
  path (returns 400 if the dev-bypass code is seen in prod).
- Every dev-bypass success writes `security.admin.dev_bypass` to
  `admin_operation_logs` with the openid in `detail.openid`.

## Tests

`backend/tests/auth-cookie.test.js` — 8 cases covering cookie attributes,
backward compat, header/cookie priority, clear-on-logout, refresh
re-issuance, and CSRF Origin enforcement.

`backend/tests/auth-cookie-rotation.test.js` — 6 cases (R40) covering
cookie theft detection: rotation → use old cookie → 401, multi-rotation
→ use any old cookie → 401, logout → use old cookie → 401, header-mode
(WeChat) unaffected.

## Cookie theft detection (R40)

`/refresh` rotates the refresh token: the old `jti` lands in the Redis
blacklist (`jwt:bl:<oldJti>`) and a new `jti` is issued. If an attacker
replays the old `refresh_token` cookie (e.g. via XSS exfiltration, or
stolen from a leaked device backup) **after** the legitimate user has
already refreshed, that old jti is now blacklisted — `userAuth` detects
this and treats it as theft.

### Detection flow (`backend/src/middleware/auth.js`)

On every cookie-mode request, after the access token verifies, `userAuth`
also checks `req.cookies.refresh_token`:

1. Decode the refresh cookie → extract `jti`
2. If `jti` is in `jwt:bl:<jti>` (Redis blacklist) → **theft suspected**
3. `burnFamily(family)` — revoke every token in the rotation chain
4. `res.clearCookie('auth_token')` + `res.clearCookie('refresh_token')`
5. Log `security.cookie_theft` via `securityLog.recordSync`
6. Return `401 { code: 1002, message: "cookie revoked; please re-login" }`

The clearCookie emits `Set-Cookie` headers with past expiry, so the
browser drops both cookies immediately. The user must re-login (the
refresh chain is burned — there is no way to "un-burn" a family).

### `/logout` chain (R40)

`POST /api/auth/logout` was previously header-only aware. R40 adds
cookie-mode handling:

- If `Authorization: Bearer <access>` → revoke access jti (TTL 900s)
- Else if `req.cookies.auth_token` → revoke access jti from cookie
- If `req.cookies.refresh_token` (or body.refresh_token) → `burnFamily`

This makes the logout chain symmetric: whether the user logged in via
WeChat (`Authorization` header) or via the browser admin panel
(cookies), the jti blacklist is updated, and any subsequent request
with the old refresh cookie hits the theft detection path in step 1.

### Failure mode: fail-open

The Redis lookup in step 2 is wrapped in `safeCheckJti` semantics:
if Redis is down, the check returns `false` and the request proceeds.
This matches the existing R33 chaos-followup fail-open behavior. A
warn-level log is emitted so operators can correlate a flood of
"theft checks failing open" with a Redis outage.

### Header-mode (WeChat) unaffected

The detection only fires when:

- `req.authVia === 'cookie'` (set when the access token came from cookie)
- `req.cookies.refresh_token` is present

WeChat mini-program requests go through `Authorization: Bearer` and
never carry cookies (`wx.request` does not set Cookie), so `via` is
`'header'` and the cookie theft branch is skipped entirely. Header-mode
theft detection continues to use the existing `token revoked` path
(jti blacklist on access token).

### Recovery

A user who hits a 401 "cookie revoked; please re-login" must re-auth
via `/api/auth/login` (WeChat) or the admin panel login page. The
burned family cannot be revived — that's the point: even if the
attacker later presents the rotated jti, the `jwt:fam:burned:<id>`
key returns truthy and `detectReuse` will 401 it.