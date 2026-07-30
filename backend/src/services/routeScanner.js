/**
 * routeScanner: walk Express app._router.stack, emit {method,path,middlewares}
 * descriptors and convert to OpenAPI 3.0 paths object.
 *
 * Self-contained — no deps. Walks Express's internal layer stack (the only
 * public-ish way to introspect mounted routes). Recurses into nested routers,
 * joining prefixes. Skips /api/internal/* by default (server-side only).
 *
 * R40: middleware entries may carry __joiSchema + __joiSchemaLabel (set by
 * validateBody). When present, we propagate them as `requestSchema` /
 * `requestSchemaName` so routesToOpenApi can emit `requestBody` $refs.
 */

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

function mwName(mw) {
  if (!mw) return 'anonymous';
  if (mw.name) return mw.name;
  if (typeof mw.handle === 'function' && mw.handle.name) return mw.handle.name;
  return 'anonymous';
}

/**
 * Describe a single middleware function. Returns:
 *   { name }                                          — generic mw
 *   { name, requestSchema, requestSchemaName }        — validateBody-style with label
 * `requestSchemaName` is resolved from __joiSchemaLabel (preferred) or
 * schema._flags.label (fallback). When neither is set, name-only is emitted
 * and routesToOpenApi will skip requestBody gracefully.
 */
function describeMw(fn) {
  const entry = { name: mwName(fn) };
  if (fn && fn.__joiSchema) {
    entry.requestSchema = fn.__joiSchema;
    const label = fn.__joiSchemaLabel
      || (fn.__joiSchema && fn.__joiSchema._flags && fn.__joiSchema._flags.label)
      || null;
    if (label) entry.requestSchemaName = label;
  }
  return entry;
}

function walkStack(stack, prefix, out) {
  for (const layer of stack || []) {
    if (!layer || !layer.regexp) continue;
    // Express route layer: layer.route is set
    if (layer.route) {
      const fullPath = joinPath(prefix, layer.route.path);
      for (const method of HTTP_METHODS) {
        if (layer.route.methods[method]) {
          const mws = (layer.route.stack || []).map(s => describeMw(s.handle));
          out.push({
            method,
            path: fullPath,
            middlewares: mws,
          });
        }
      }
      continue;
    }
    // Sub-router: layer.handle is a function with its own router stack
    if (typeof layer.handle === 'function' && Array.isArray(layer.handle.stack)) {
      // Extract mount prefix from regexp. Express builds paths like:
      //   ^\/api\/auth\/?(?=\/|$)
      //   ^\/api\/internal\/metrics\/?(?=\/|$)
      //   ^\/?(?=\/|$)   (root mount: app.use(sub))
      //   ^\/(?=\/|$)    (express.json etc. — not a router, but skip via stack check)
      const mountPath = extractPrefix(layer.regexp);
      walkStack(layer.handle.stack, joinPath(prefix, mountPath), out);
    }
  }
}

function extractPrefix(regexp) {
  if (!regexp || !regexp.source) return '';
  const src = regexp.source;
  if (regexp.fast_slash) return '';
  // Source shapes from Express's path-to-regexp:
  //   ^\/api\/health\/?(?=\/|$)         → /api/health
  //   ^\/api\/internal\/?(?=\/|$)        → /api/internal
  //   ^\/?(?=\/|$)                       → '' (root mount)
  // Parse: strip ^, optional \/; read segments separated by \/; stop on ? ( $ [.
  let s = src;
  if (s.startsWith('^')) s = s.slice(1);
  if (s.startsWith('\\/')) s = s.slice(2);
  else if (s.startsWith('/')) s = s.slice(1);
  else return '';
  const segs = [];
  while (s.length) {
    let seg = '';
    while (s.length) {
      if (s.startsWith('\\/')) break;
      if ('?($['.includes(s[0])) break;
      if (s[0] === '\\' && s[1] && s[1] !== '/') break;
      seg += s[0];
      s = s.slice(1);
    }
    if (seg) segs.push(seg);
    if (s.startsWith('\\/')) {
      s = s.slice(2);
      if (!s || '?($'.includes(s[0])) break;
    } else {
      break;
    }
  }
  if (!segs.length) return '';
  return '/' + segs.join('/');
}

function joinPath(prefix, sub) {
  if (!prefix) return sub || '/';
  if (!sub || sub === '/') return prefix;
  return prefix.replace(/\/$/, '') + sub;
}

/**
 * Scan an Express app and return route descriptors.
 * @param {object} app - Express app
 * @param {object} [opts]
 * @param {boolean} [opts.includeInternal=false] - include /api/internal/*
 * @param {string[]} [opts.skipPaths] - additional path prefixes to skip
 * @returns {Array<{method:string, path:string, middlewares:string[], xInternal?:boolean}>}
 */
function scanRoutes(app, opts = {}) {
  const { includeInternal = false, skipPaths = [] } = opts;
  const out = [];
  if (!app || !app._router || !Array.isArray(app._router.stack)) return out;
  walkStack(app._router.stack, '', out);

  // Apply skip filter
  const defaultSkip = ['/api/docs', '/api/health', '/api/internal'];
  const allSkips = [...defaultSkip, ...skipPaths];
  return out.filter(r => {
    // Only emit /api/* routes — exclude /admin/* (static panel), docs self-ref, etc.
    if (!r.path.startsWith('/api/')) return false;
    const isInternal = r.path.startsWith('/api/internal/');
    if (isInternal && !includeInternal) return false;
    for (const p of allSkips) {
      if (p === '/api/internal' && isInternal && !includeInternal) return false; // already filtered
      if (p !== '/api/internal' && r.path.startsWith(p)) return false;
    }
    // also explicitly skip /api/docs/* + /api/health/* even when includeInternal
    if (r.path.startsWith('/api/docs/')) return false;
    if (r.path.startsWith('/api/health')) return false;
    if (isInternal) r.xInternal = true;
    return true;
  });
}

/**
 * Convert Express path /users/:id → OpenAPI /users/{id}
 */
function expressToOpenApiPath(p) {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/**
 * Convert route descriptors → OpenAPI 3.0 paths object.
 * Each method gets a minimal stub with summary + 200 response + x-auto-generated:true.
 * If any middleware carries `requestSchemaName`, emit requestBody with a $ref
 * into components.schemas (the schema itself is generated from joi by
 * src/routes/openapi.js).
 * @param {Array} routes
 * @returns {object} OpenAPI paths
 */
function routesToOpenApi(routes) {
  const paths = {};
  for (const r of routes) {
    const oaPath = expressToOpenApiPath(r.path);
    if (!paths[oaPath]) paths[oaPath] = {};
    const op = {
      summary: `${r.method.toUpperCase()} ${oaPath}`,
      responses: { 200: { description: 'OK' } },
      'x-auto-generated': true,
    };
    // path parameters
    const params = [];
    const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    let m;
    while ((m = re.exec(oaPath)) !== null) {
      params.push({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }
    if (params.length) op.parameters = params;
    // requestBody from validateBody middleware — first mw with requestSchemaName wins.
    // Graceful: if no middleware has a label, skip silently (no error, no stub).
    const bodyMw = (r.middlewares || []).find(mw => mw && mw.requestSchemaName);
    if (bodyMw && bodyMw.requestSchemaName) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${bodyMw.requestSchemaName}` },
          },
        },
      };
    }
    if (r.xInternal) op['x-internal'] = true;
    paths[oaPath][r.method] = op;
  }
  return paths;
}

module.exports = {
  scanRoutes,
  routesToOpenApi,
  expressToOpenApiPath,
};
