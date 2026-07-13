// api.js — fetch wrapper（cookie-mode，credentials: 'include'）
// R40 / admin panel: 浏览器 httpOnly cookie 自动附；JS 不读 localStorage
async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data;
  try { data = await res.json(); } catch (_e) { throw new Error(`API ${res.status}`); }
  if (data.code !== 0) throw new Error(data.message || `API error ${data.code}`);
  return data.data;
}
