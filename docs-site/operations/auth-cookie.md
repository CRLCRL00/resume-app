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

## Tests

`backend/tests/auth-cookie.test.js` — 8 cases covering cookie attributes,
backward compat, header/cookie priority, clear-on-logout, refresh
re-issuance, and CSRF Origin enforcement.