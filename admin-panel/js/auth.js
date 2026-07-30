// auth.js — 验 session；失败跳 login
//   GET /api/admin/check  (cookie 自动附)
//   200 → 通过；401/403 → 跳 /admin/login.html
async function requireAuth() {
  try {
    const data = await api('/admin/check');
    window.auth = { admin: true, ...data };
    return data;
  } catch (e) {
    // 401/403/网络：跳 login
    window.location.href = '/admin/login.html';
    throw e;
  }
}
async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (_e) {}
  window.location.href = '/admin/login.html';
}
