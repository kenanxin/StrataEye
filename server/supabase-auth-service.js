'use strict';

const { AuthError } = require('./auth-service.js');

const ROLE_ACTIONS = {
  enterprise: new Set(['advance', 'reset']),
  regulator: new Set(['advance']),
  expert: new Set(['archive']),
  viewer: new Set(),
  super_admin: new Set(['users.manage', 'audit.read']),
};

function createSupabaseAuthService(options = {}) {
  const baseUrl = String(options.url || '').replace(/\/$/, '');
  const anonKey = options.anonKey;
  const serviceRoleKey = options.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fetchImpl = options.fetchImpl || fetch;
  const sessions = new Map();
  if (!baseUrl || !anonKey) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');

  async function request(path, init = {}) {
    let response;
    try { response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    }); } catch (_) { throw new AuthError('AUTH_SERVICE_UNAVAILABLE', '身份认证服务连接失败或超时，请稍后重试', 503); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (path.startsWith('/auth/v1/token') && [400, 401].includes(response.status)) {
        throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不正确', 401);
      }
      throw new AuthError('SUPABASE_AUTH_ERROR', '身份认证服务暂不可用，请稍后重试', 502, {
        providerStatus: response.status,
      });
    }
    return payload;
  }

  async function adminRequest(path, init = {}) {
    if (!serviceRoleKey) throw new AuthError('ADMIN_NOT_CONFIGURED', '管理员服务尚未配置，请设置 SUPABASE_SERVICE_ROLE_KEY', 503);
    return request(path, {
      ...init,
      headers: { Authorization: `Bearer ${serviceRoleKey}`, ...(init.headers || {}) },
    });
  }

  async function roleForUser(accessToken, user) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const profile = await request(`/rest/v1/profiles?select=username,display_name,organization,status&id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers });
    const roleRows = await request(`/rest/v1/user_roles?select=roles(key)&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers });
    const record = profile[0];
    const role = roleRows[0]?.roles?.key;
    if (!record || !role || !ROLE_ACTIONS[role] || record.status !== 'active') {
      throw new AuthError('ACCOUNT_DISABLED', '当前账号不可用，请联系管理员', 403);
    }
    return {
      username: record.username || user.email || user.id,
      displayName: record.display_name || user.user_metadata?.display_name || user.email || user.id,
      role,
      organization: record.organization || '',
      subject: user.id,
    };
  }

  async function login({ username, password }) {
    if (!String(username || '').trim() || !String(password || '')) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不正确', 401);
    }
    let payload;
    try {
      payload = await request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email: String(username).trim(), password: String(password) }),
      });
      const identity = await roleForUser(payload.access_token, payload.user);
      const token = payload.access_token;
      const expiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
      sessions.set(token, { user: identity, expiresAt, refreshToken: payload.refresh_token });
      return { token, user: identity, expiresAt };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('AUTH_SERVICE_UNAVAILABLE', '身份认证服务暂不可用，请稍后重试', 503);
    }
  }

  async function getSession(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session || Date.now() >= session.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return { user: { ...session.user }, expiresAt: session.expiresAt };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  async function listUsers() {
    const rows = await adminRequest('/rest/v1/profiles?select=id,username,display_name,organization,status,created_at,last_login_at,user_roles(roles(key,name))&order=created_at.desc');
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      organization: row.organization,
      status: row.status,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      role: row.user_roles?.[0]?.roles?.key || 'viewer',
      roleName: row.user_roles?.[0]?.roles?.name || '只读用户',
    }));
  }

  async function createUser({ username, password, displayName, organization = '', role = 'viewer' }) {
    const email = String(username || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || String(password || '').length < 8) {
      throw new AuthError('ADMIN_INVALID_USER', '请输入有效邮箱和至少 8 位密码', 400);
    }
    if (!ROLE_ACTIONS[role]) throw new AuthError('ADMIN_INVALID_ROLE', '无效的角色', 400);
    const created = await adminRequest('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: displayName || email } }),
    });
    try {
      await adminRequest('/rest/v1/profiles', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ id: created.id, username: email, display_name: displayName || email, organization, status: 'active' }),
      });
      const roleRows = await adminRequest(`/rest/v1/roles?select=id&key=eq.${encodeURIComponent(role)}&limit=1`);
      if (!roleRows[0]) throw new Error('role not found');
      await adminRequest('/rest/v1/user_roles', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: created.id, role_id: roleRows[0].id }),
      });
    } catch (error) {
      try { await adminRequest(`/auth/v1/admin/users/${created.id}`, { method: 'DELETE' }); } catch (_) { /* best effort cleanup */ }
      throw error;
    }
    return { id: created.id, username: email, displayName: displayName || email, organization, status: 'active', role };
  }

  async function updateUser(id, { displayName, organization, role, status }) {
    if (role && !ROLE_ACTIONS[role]) throw new AuthError('ADMIN_INVALID_ROLE', '无效的角色', 400);
    const profile = {};
    if (displayName !== undefined) profile.display_name = String(displayName).trim();
    if (organization !== undefined) profile.organization = String(organization).trim();
    if (status !== undefined) profile.status = status;
    if (Object.keys(profile).length) await adminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(profile) });
    if (role) {
      const roleRows = await adminRequest(`/rest/v1/roles?select=id&key=eq.${encodeURIComponent(role)}&limit=1`);
      if (!roleRows[0]) throw new AuthError('ADMIN_INVALID_ROLE', '无效的角色', 400);
      await adminRequest(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      await adminRequest('/rest/v1/user_roles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: id, role_id: roleRows[0].id }) });
    }
    return { id, ...profile, role };
  }

  async function resetPassword(id, password) {
    if (String(password || '').length < 8) throw new AuthError('ADMIN_INVALID_PASSWORD', '密码至少 8 位', 400);
    await adminRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ password }) });
    return { id, reset: true };
  }

  async function listAuditLogs() {
    return adminRequest('/rest/v1/audit_logs?select=id,action,target_type,target_id,details,created_at,operator_id&order=created_at.desc&limit=200');
  }

  async function recordAudit(operatorId, action, targetType, targetId, details = {}) {
    await adminRequest('/rest/v1/audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ operator_id: operatorId, action, target_type: targetType, target_id: String(targetId || ''), details }),
    });
  }

  return {
    provider: 'supabase',
    login,
    getSession,
    logout,
    can(role, action) { return ROLE_ACTIONS[role]?.has(action) || false; },
    listUsers,
    createUser,
    updateUser,
    resetPassword,
    listAuditLogs,
    recordAudit,
  };
}

module.exports = { createSupabaseAuthService };
