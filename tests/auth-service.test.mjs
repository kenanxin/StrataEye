import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('seeded users authenticate and expose only public identity fields', async () => {
  const { createAuthService } = require('../server/auth-service.js');
  const auth = createAuthService({ randomToken: () => 'a'.repeat(64) });
  const result = await auth.login({
    username: ' enterprise_operator ',
    password: 'Mine@2026',
    clientId: '127.0.0.1',
  });

  assert.deepEqual(result.user, {
    username: 'enterprise_operator',
    displayName: '企业端操作员',
    role: 'enterprise',
  });
  assert.equal(result.token, 'a'.repeat(64));
  assert.equal('passwordHash' in result.user, false);
});

test('sessions expire absolutely after eight hours and logout invalidates immediately', async () => {
  const { createAuthService } = require('../server/auth-service.js');
  let now = 1_000_000;
  let tokenNumber = 0;
  const auth = createAuthService({
    now: () => now,
    randomToken: () => String(++tokenNumber).padStart(64, '0'),
  });
  const loggedIn = await auth.login({
    username: 'regulator_officer',
    password: 'Safe@2026',
    clientId: 'test',
  });

  assert.equal(auth.getSession(loggedIn.token).user.role, 'regulator');
  now += (8 * 60 * 60 * 1000) - 1;
  assert.ok(auth.getSession(loggedIn.token));
  now += 1;
  assert.equal(auth.getSession(loggedIn.token), null);

  const second = await auth.login({
    username: 'expert_analyst',
    password: 'Model@2026',
    clientId: 'test',
  });
  auth.logout(second.token);
  assert.equal(auth.getSession(second.token), null);
});

test('five failed attempts throttle the username and client pair for 15 minutes', async () => {
  const { AuthError, createAuthService } = require('../server/auth-service.js');
  let now = 2_000_000;
  const auth = createAuthService({ now: () => now });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      auth.login({ username: 'enterprise_operator', password: 'wrong', clientId: 'client-a' }),
      (error) => error instanceof AuthError && error.code === 'INVALID_CREDENTIALS' && error.statusCode === 401,
    );
  }
  await assert.rejects(
    auth.login({ username: 'enterprise_operator', password: 'wrong', clientId: 'client-a' }),
    (error) => error.code === 'RATE_LIMITED' && error.statusCode === 429 && error.retryAfter > 0,
  );
  await assert.rejects(
    auth.login({ username: 'enterprise_operator', password: 'Mine@2026', clientId: 'client-a' }),
    (error) => error.code === 'RATE_LIMITED',
  );

  now += (15 * 60 * 1000) + 1;
  const recovered = await auth.login({
    username: 'enterprise_operator',
    password: 'Mine@2026',
    clientId: 'client-a',
  });
  assert.equal(recovered.user.role, 'enterprise');
});

test('successful login clears failures and buckets are isolated by client', async () => {
  const { createAuthService } = require('../server/auth-service.js');
  const auth = createAuthService();
  await assert.rejects(auth.login({ username: 'expert_analyst', password: 'bad', clientId: 'client-a' }));
  await auth.login({ username: 'expert_analyst', password: 'Model@2026', clientId: 'client-a' });
  await assert.rejects(auth.login({ username: 'expert_analyst', password: 'bad', clientId: 'client-b' }));
  const result = await auth.login({ username: 'expert_analyst', password: 'Model@2026', clientId: 'client-a' });
  assert.equal(result.user.role, 'expert');
});

test('deployment environment can override a seeded password hash', async () => {
  const { createAuthService } = require('../server/auth-service.js');
  const auth = createAuthService({
    env: {
      ROOFRISK_ENTERPRISE_PASSWORD_HASH: 'scrypt$16384$8$1$161841f2fd39b76e5e92473ae875135f$a2dfdb411bcc27ce03736aa8bad4fe9d33704fe70b373093b0f181ddbff7fad01300be6a0b26cfde9ce1dd13fc4d8e45e67de669eb46550a4e109cd2b17e603a',
    },
  });

  const result = await auth.login({
    username: 'enterprise_operator',
    password: 'Safe@2026',
    clientId: 'override-test',
  });
  assert.equal(result.user.role, 'enterprise');
  await assert.rejects(
    auth.login({ username: 'enterprise_operator', password: 'Mine@2026', clientId: 'override-test' }),
    (error) => error.code === 'INVALID_CREDENTIALS',
  );
});


test('cookies include the required security attributes', () => {
  const {
    parseCookies,
    serializeExpiredSessionCookie,
    serializeSessionCookie,
  } = require('../server/auth-service.js');

  assert.deepEqual(parseCookies('theme=dark; roofrisk_session=token%20123'), {
    theme: 'dark',
    roofrisk_session: 'token 123',
  });
  const cookie = serializeSessionCookie('abc', { secure: true });
  assert.match(cookie, /^roofrisk_session=abc;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=28800/);
  assert.match(cookie, /Secure/);
  assert.match(serializeExpiredSessionCookie(), /Max-Age=0/);
});

test('role policy matches the approved closed-loop matrix', () => {
  const { createAuthService } = require('../server/auth-service.js');
  const auth = createAuthService();
  assert.equal(auth.can('enterprise', 'advance'), true);
  assert.equal(auth.can('enterprise', 'reset'), true);
  assert.equal(auth.can('enterprise', 'archive'), false);
  assert.equal(auth.can('regulator', 'advance'), true);
  assert.equal(auth.can('regulator', 'archive'), false);
  assert.equal(auth.can('regulator', 'reset'), false);
  assert.equal(auth.can('expert', 'advance'), false);
  assert.equal(auth.can('expert', 'archive'), true);
  assert.equal(auth.can('expert', 'reset'), false);
});

test('malformed deployment hash fails service initialization', () => {
  const { createAuthService } = require('../server/auth-service.js');
  assert.throws(
    () => createAuthService({ env: { ROOFRISK_ENTERPRISE_PASSWORD_HASH: 'not-a-scrypt-hash' } }),
    /Invalid RoofRisk password hash configuration/,
  );
});
