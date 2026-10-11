import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSupabaseAuthService } = require('../server/supabase-auth-service.js');

function mockFetch(calls) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/auth/v1/token')) return { ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, user: { id: 'u1', email: 'operator@example.com' } }) };
    if (url.includes('/profiles?')) return { ok: true, json: async () => [{ username: 'operator@example.com', display_name: '操作员', organization: '示范矿', status: 'active' }] };
    if (url.includes('/user_roles?')) return { ok: true, json: async () => [{ roles: { key: 'enterprise' } }] };
    if (url.includes('/roles?')) return { ok: true, json: async () => [{ id: 'role-1' }] };
    if (url.includes('/admin/users')) return { ok: true, json: async () => ({ id: 'u2' }) };
    return { ok: true, json: async () => [] };
  };
}

test('Supabase login maps profile role and keeps token server-side', async () => {
  const calls = [];
  const auth = createSupabaseAuthService({ url: 'https://demo.supabase.co', anonKey: 'anon', fetchImpl: mockFetch(calls) });
  const result = await auth.login({ username: 'operator@example.com', password: 'secret' });
  assert.equal(result.user.role, 'enterprise');
  assert.equal(result.user.displayName, '操作员');
  assert.equal((await auth.getSession(result.token)).user.username, 'operator@example.com');
  assert.equal(calls[0].init.method, 'POST');
});

test('Supabase admin user creation uses service role and validates role', async () => {
  const calls = [];
  const auth = createSupabaseAuthService({ url: 'https://demo.supabase.co', anonKey: 'anon', serviceRoleKey: 'service', fetchImpl: mockFetch(calls) });
  const user = await auth.createUser({ username: 'new@example.com', password: 'password1', displayName: '新用户', role: 'viewer' });
  assert.equal(user.role, 'viewer');
  assert.ok(calls.some(call => call.url.includes('/auth/v1/admin/users')));
  await assert.rejects(() => auth.createUser({ username: 'bad', password: 'password1', role: 'viewer' }), /有效邮箱/);
});

test('Supabase invalid password is reported as invalid credentials', async () => {
  const auth = createSupabaseAuthService({
    url: 'https://demo.supabase.co',
    anonKey: 'anon',
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error_code: 'invalid_credentials' }),
    }),
  });

  await assert.rejects(
    () => auth.login({ username: 'operator@example.com', password: 'wrong-password' }),
    error => error.code === 'INVALID_CREDENTIALS' && error.statusCode === 401,
  );
});

test('Supabase transport errors are unavailable, never invalid credentials or provider detail', async () => {
  for (const name of ['Error', 'TypeError', 'AbortError']) {
    const auth = createSupabaseAuthService({ url: 'https://demo.supabase.co', anonKey: 'anon', fetchImpl: async () => { throw Object.assign(new Error('private provider credentials'), { name }); } });
    await assert.rejects(auth.login({ username: 'operator@example.com', password: 'secret' }), error => error.statusCode === 503 && error.code === 'AUTH_SERVICE_UNAVAILABLE' && !error.message.includes('private'));
  }
});
