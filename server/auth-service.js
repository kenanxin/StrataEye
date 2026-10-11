'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);
const SESSION_COOKIE = 'roofrisk_session';
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

const DEFAULT_PASSWORD_HASHES = {
  enterprise: 'scrypt$16384$8$1$c5b02cfb174016eb17f82f397189063b$802bc84c18eed369174006f2656368b8ef6a8352df0d1bb19b072578a236f8cce622535897133dba949a56f9c9ead233bbd60b9932b882a999efd2f7055b2e8e',
  regulator: 'scrypt$16384$8$1$161841f2fd39b76e5e92473ae875135f$a2dfdb411bcc27ce03736aa8bad4fe9d33704fe70b373093b0f181ddbff7fad01300be6a0b26cfde9ce1dd13fc4d8e45e67de669eb46550a4e109cd2b17e603a',
  expert: 'scrypt$16384$8$1$fd6ffbede769ca7db0fc8c31d24324fe$a49d74fc8f033f6bb720578dc3b032409d8a8dac16eafb0e87a5fe44b6cbbbfe609deeceb7b7252007b815441d874fd5d00a5398728c772714156314569b3f06',
};

const ROLE_ACTIONS = {
  enterprise: new Set(['advance', 'reset']),
  regulator: new Set(['advance']),
  expert: new Set(['archive']),
};

class AuthError extends Error {
  constructor(code, message, statusCode, details = {}) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

function configuredUsers(env = process.env) {
  return [
    {
      username: 'enterprise_operator',
      displayName: '企业端操作员',
      role: 'enterprise',
      passwordHash: env.ROOFRISK_ENTERPRISE_PASSWORD_HASH || DEFAULT_PASSWORD_HASHES.enterprise,
    },
    {
      username: 'regulator_officer',
      displayName: '监管端监管员',
      role: 'regulator',
      passwordHash: env.ROOFRISK_REGULATOR_PASSWORD_HASH || DEFAULT_PASSWORD_HASHES.regulator,
    },
    {
      username: 'expert_analyst',
      displayName: '智库端专家',
      role: 'expert',
      passwordHash: env.ROOFRISK_EXPERT_PASSWORD_HASH || DEFAULT_PASSWORD_HASHES.expert,
    },
  ];
}

function parsePasswordHash(encoded) {
  const [algorithm, n, r, p, saltHex, derivedKeyHex] = String(encoded).split('$');
  if (algorithm !== 'scrypt'
    || !/^\d+$/.test(n)
    || !/^\d+$/.test(r)
    || !/^\d+$/.test(p)
    || !/^[a-f\d]+$/i.test(saltHex || '')
    || !/^[a-f\d]{128}$/i.test(derivedKeyHex || '')) {
    throw new Error('Invalid RoofRisk password hash configuration');
  }
  return {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(saltHex, 'hex'),
    expected: Buffer.from(derivedKeyHex, 'hex'),
  };
}

async function verifyPassword(password, encoded) {
  const parsed = parsePasswordHash(encoded);
  const actual = await scryptAsync(String(password), parsed.salt, parsed.expected.length, {
    N: parsed.n,
    r: parsed.r,
    p: parsed.p,
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, parsed.expected);
}

function publicUser(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch (error) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function cookieSecuritySuffix(secure) {
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function serializeSessionCookie(token, options = {}) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=28800; ${cookieSecuritySuffix(options.secure)}`;
}

function serializeExpiredSessionCookie(options = {}) {
  return `${SESSION_COOKIE}=; Max-Age=0; ${cookieSecuritySuffix(options.secure)}`;
}

function createAuthService(options = {}) {
  const now = options.now || Date.now;
  const randomToken = options.randomToken || (() => crypto.randomBytes(32).toString('hex'));
  const users = configuredUsers(options.env);
  // Validate deployment overrides before accepting requests so a typo cannot silently disable login.
  users.forEach((user) => parsePasswordHash(user.passwordHash));
  const usersByName = new Map(users.map((user) => [user.username, user]));
  const dummyHash = users[0].passwordHash;
  const sessions = new Map();
  const failures = new Map();

  function failureKey(username, clientId) {
    return `${username}\u0000${clientId || 'unknown'}`;
  }

  function activeFailures(key, currentTime) {
    const cutoff = currentTime - THROTTLE_WINDOW_MS;
    const recent = (failures.get(key) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
    return recent;
  }

  async function login({ username, password, clientId = 'unknown' }) {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const currentTime = now();
    const key = failureKey(normalizedUsername, clientId);
    const recent = activeFailures(key, currentTime);
    if (recent.length >= MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((recent[0] + THROTTLE_WINDOW_MS - currentTime) / 1000));
      throw new AuthError('RATE_LIMITED', '登录尝试过多，请稍后再试', 429, { retryAfter });
    }

    const user = usersByName.get(normalizedUsername);
    const valid = await verifyPassword(password || '', user?.passwordHash || dummyHash);
    if (!user || !valid) {
      const updated = [...recent, currentTime];
      failures.set(key, updated);
      if (updated.length >= MAX_FAILURES) {
        throw new AuthError('RATE_LIMITED', '登录尝试过多，请稍后再试', 429, {
          retryAfter: Math.ceil(THROTTLE_WINDOW_MS / 1000),
        });
      }
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不正确', 401);
    }

    failures.delete(key);
    const token = randomToken();
    const expiresAt = currentTime + SESSION_LIFETIME_MS;
    const identity = publicUser(user);
    sessions.set(token, { user: identity, expiresAt });
    return { token, user: identity, expiresAt };
  }

  function getSession(token) {
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (now() >= session.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return { user: { ...session.user }, expiresAt: session.expiresAt };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  return {
    users: users.map(publicUser),
    login,
    getSession,
    logout,
    can(role, action) {
      return ROLE_ACTIONS[role]?.has(action) || false;
    },
  };
}

module.exports = {
  AuthError,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  createAuthService,
  parseCookies,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  verifyPassword,
};
