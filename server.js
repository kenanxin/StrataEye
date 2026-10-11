'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  RoofRiskRepositoryError,
  createRoofRiskRepository,
} = require('./server/roof-risk-repository.js');
const {
  AuthError,
  SESSION_COOKIE,
  createAuthService,
  parseCookies,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} = require('./server/auth-service.js');
const { createSupabaseAuthService } = require('./server/supabase-auth-service.js');
const { createExpertAdviceService } = require('./server/expert-advice-service.js');
const { createMultiAgentWorkflowService } = require('./server/multi-agent-workflow-service.js');

const ROOT = __dirname;
const DEFAULT_ARTIFACT_PATH = path.join(ROOT, 'data', 'roof-risk-dataset.json');
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
};

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendApiError(res, statusCode, code, message, details = {}) {
  sendJson(res, { error: { code, message, ...details } }, statusCode);
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  res.end();
}

function portalUrl(role) {
  if (role === 'super_admin') return '/admin';
  const portal = role === 'viewer' ? 'expert' : role;
  return `/?scene=v2&view=underground&field=risk&portal=${portal}`;
}

function assertAdminUserUpdateAllowed(operator, targetId, changes = {}) {
  if (!operator?.subject || String(targetId) !== String(operator.subject)) return;
  const changesRole = changes.role !== undefined && changes.role !== 'super_admin';
  const changesStatus = changes.status !== undefined && changes.status !== 'active';
  if (changesRole || changesStatus) {
    throw new AuthError(
      'ADMIN_SELF_PROTECTED',
      '不能修改当前超级管理员的角色或状态',
      409,
    );
  }
}

function requestIsSecure(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwardedProto === 'https' || Boolean(req.socket.encrypted);
}

function requestClientId(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwardedFor || req.socket.remoteAddress || 'unknown';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BODY_BYTES) {
        reject(new RoofRiskRepositoryError('BODY_TOO_LARGE', 'JSON body exceeds 1 MB', 413));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new RoofRiskRepositoryError('INVALID_JSON', 'Request body is not valid JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

function assertMethod(req, allowed) {
  if (allowed.includes(req.method)) return;
  throw new RoofRiskRepositoryError(
    'METHOD_NOT_ALLOWED',
    `Method ${req.method} is not allowed`,
    405,
    { allowed },
  );
}

function loadArtifact(artifactPath) {
  let text;
  try {
    text = fs.readFileSync(artifactPath, 'utf8');
  } catch (error) {
    throw new Error(`RoofRisk dataset is unavailable at ${artifactPath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`RoofRisk dataset is not valid JSON at ${artifactPath}: ${error.message}`);
  }
}

function serveStatic(root, pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }
  const relativePath = decodedPath.replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(root, relativePath);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (filePath !== root && !filePath.startsWith(rootPrefix)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Not Found: ${pathname}`);
      return;
    }
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function createAppServer(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const artifactPath = path.resolve(options.artifactPath || DEFAULT_ARTIFACT_PATH);
  const repository = createRoofRiskRepository(loadArtifact(artifactPath));
  const authService = options.authService || (process.env.AUTH_PROVIDER === 'supabase'
    ? createSupabaseAuthService({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    })
    : createAuthService());
  const expertAdviceService = options.expertAdviceService || createExpertAdviceService();
  const multiAgentWorkflowService = options.multiAgentWorkflowService || createMultiAgentWorkflowService(repository);

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    const pathname = requestUrl.pathname;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = await authService.getSession(token);

    try {
      if (pathname === '/api/auth/login') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        const result = await authService.login({
          username: body.username,
          password: body.password,
          clientId: requestClientId(req),
        });
        res.setHeader('Set-Cookie', serializeSessionCookie(result.token, { secure: requestIsSecure(req) }));
        sendJson(res, {
          authenticated: true,
          user: result.user,
          expiresAt: new Date(result.expiresAt).toISOString(),
          portalUrl: portalUrl(result.user.role),
        });
        return;
      }

      if (pathname === '/healthz') {
        assertMethod(req, ['GET', 'HEAD']);
        sendJson(res, {
          status: 'ok', service: 'smart-mine-v2-balanced', data_source: 'teacher_real_csv_xgboost',
          release: 'competition-audit-v1', commit: process.env.RENDER_GIT_COMMIT || null,
          auth_provider: authService.provider || (process.env.AUTH_PROVIDER === 'supabase' ? 'supabase' : 'local'),
        });
        return;
      }

      if (pathname === '/api/auth/session') {
        assertMethod(req, ['GET']);
        if (!session) {
          sendApiError(res, 401, 'AUTH_REQUIRED', '请先登录');
          return;
        }
        sendJson(res, {
          authenticated: true,
          user: session.user,
          expiresAt: new Date(session.expiresAt).toISOString(),
          portalUrl: portalUrl(session.user.role),
        });
        return;
      }

      if (pathname === '/api/auth/logout') {
        assertMethod(req, ['POST']);
        authService.logout(token);
        res.setHeader('Set-Cookie', serializeExpiredSessionCookie({ secure: requestIsSecure(req) }));
        sendJson(res, { authenticated: false });
        return;
      }

      const isAdminApi = pathname.startsWith('/api/admin/');
      if (isAdminApi) {
        if (!session) {
          sendApiError(res, 401, 'AUTH_REQUIRED', '请先登录');
          return;
        }
        if (!authService.can(session.user.role, 'users.manage') && !authService.can(session.user.role, 'audit.read')) {
          sendApiError(res, 403, 'FORBIDDEN', '仅超级管理员可访问管理中心', { role: session.user.role });
          return;
        }
        if (pathname === '/api/admin/users' && req.method === 'GET') {
          if (!authService.listUsers) throw new AuthError('ADMIN_NOT_CONFIGURED', '当前认证服务不支持用户管理', 503);
          const users = await authService.listUsers();
          sendJson(res, {
            users: users.map(user => ({
              ...user,
              isSelf: Boolean(session.user.subject) && String(user.id) === String(session.user.subject),
            })),
          });
          return;
        }
        if (pathname === '/api/admin/users' && req.method === 'POST') {
          if (!authService.createUser) throw new AuthError('ADMIN_NOT_CONFIGURED', '当前认证服务不支持用户管理', 503);
          const body = await readJsonBody(req);
          const user = await authService.createUser(body);
          if (authService.recordAudit) await authService.recordAudit(session.user.subject, 'user.create', 'profile', user.id, { role: user.role });
          sendJson(res, { user }, 201);
          return;
        }
        const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
        if (userMatch && req.method === 'PATCH') {
          if (!authService.updateUser) throw new AuthError('ADMIN_NOT_CONFIGURED', '当前认证服务不支持用户管理', 503);
          const targetId = decodeURIComponent(userMatch[1]);
          const changes = await readJsonBody(req);
          assertAdminUserUpdateAllowed(session.user, targetId, changes);
          const user = await authService.updateUser(targetId, changes);
          if (authService.recordAudit) await authService.recordAudit(session.user.subject, 'user.update', 'profile', user.id, { changes: user });
          sendJson(res, { user });
          return;
        }
        const resetMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
        if (resetMatch && req.method === 'POST') {
          if (!authService.resetPassword) throw new AuthError('ADMIN_NOT_CONFIGURED', '当前认证服务不支持用户管理', 503);
          const body = await readJsonBody(req);
          const targetId = decodeURIComponent(resetMatch[1]);
          const result = await authService.resetPassword(targetId, body.password);
          if (authService.recordAudit) await authService.recordAudit(session.user.subject, 'user.password_reset', 'profile', targetId);
          sendJson(res, result);
          return;
        }
        if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
          if (!authService.listAuditLogs) throw new AuthError('ADMIN_NOT_CONFIGURED', '当前认证服务不支持审计查询', 503);
          sendJson(res, { logs: await authService.listAuditLogs() });
          return;
        }
        sendApiError(res, 404, 'API_NOT_FOUND', `API route not found: ${pathname}`, { path: pathname });
        return;
      }

      if (pathname === '/login' || pathname === '/login.html') {
        assertMethod(req, ['GET', 'HEAD']);
        if (session) {
          redirect(res, portalUrl(session.user.role));
          return;
        }
        serveStatic(root, '/login.html', res);
        return;
      }

      if (pathname === '/admin' || pathname === '/admin.html') {
        assertMethod(req, ['GET', 'HEAD']);
        if (!session) { redirect(res, '/login'); return; }
        if (!authService.can(session.user.role, 'users.manage')) { redirect(res, portalUrl(session.user.role)); return; }
        serveStatic(root, '/admin.html', res);
        return;
      }

      const isApplicationShell = pathname === '/' || pathname === '/index.html';
      const isRoofRiskApi = pathname.startsWith('/api/roof-risk/');
      const isMultiAgentApi = pathname.startsWith('/api/multi-agent/');
      if ((isApplicationShell || isRoofRiskApi || isMultiAgentApi) && !session) {
        if (isRoofRiskApi || isMultiAgentApi) sendApiError(res, 401, 'AUTH_REQUIRED', '请先登录');
        else redirect(res, '/login');
        return;
      }

      if (pathname === '/' && req.method === 'GET' && requestUrl.search === '') {
        redirect(res, portalUrl(session.user.role));
        return;
      }

      if (pathname === '/api/roof-risk/current') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.getCurrent());
        return;
      }

      if (pathname === '/api/multi-agent/status') {
        assertMethod(req, ['GET']);
        sendJson(res, multiAgentWorkflowService.status());
        return;
      }

      if (pathname === '/api/multi-agent/run') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        if (typeof body.record_id !== 'string' || !body.record_id) {
          throw new RoofRiskRepositoryError('RECORD_ID_REQUIRED', 'record_id is required', 400);
        }
        let result;
        try {
          result = multiAgentWorkflowService.run({ recordId: body.record_id, resourceSnapshot: body.resource_snapshot });
        } catch (error) {
          if (error instanceof TypeError) throw new RoofRiskRepositoryError('INVALID_WORKFLOW_INPUT', error.message, 400);
          throw error;
        }
        sendJson(res, result);
        return;
      }

      if (pathname === '/api/multi-agent/reflect') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        if (!body.run || typeof body.run !== 'object') {
          throw new RoofRiskRepositoryError('WORKFLOW_RUN_REQUIRED', 'run is required', 400);
        }
        sendJson(res, multiAgentWorkflowService.reflect({ run: body.run, feedback: body.feedback || {} }));
        return;
      }

      if (pathname === '/api/roof-risk/history') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.getHistory());
        return;
      }

      if (pathname === '/api/roof-risk/research-analytics') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.getResearchAnalytics());
        return;
      }

      if (pathname === '/api/roof-risk/replay/meta') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.getReplayMeta());
        return;
      }

      if (pathname === '/api/roof-risk/replay/frame') {
        assertMethod(req, ['GET']);
        const index = Number(requestUrl.searchParams.get('index'));
        const windowSize = Number(requestUrl.searchParams.get('window') || 48);
        if (!Number.isInteger(index)) {
          throw new RoofRiskRepositoryError('INVALID_REPLAY_INDEX', 'index must be an integer', 400);
        }
        sendJson(res, repository.getReplayFrame(index, windowSize));
        return;
      }

      if (pathname === '/api/roof-risk/explain') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.getExplain());
        return;
      }

      if (pathname === '/api/roof-risk/similar-cases') {
        assertMethod(req, ['GET']);
        const recordId = requestUrl.searchParams.get('record_id');
        if (!recordId) {
          throw new RoofRiskRepositoryError('RECORD_ID_REQUIRED', 'record_id is required', 400);
        }
        const limit = Number(requestUrl.searchParams.get('limit') || 3);
        sendJson(res, repository.findSimilarCases(recordId, limit));
        return;
      }

      if (pathname === '/api/roof-risk/expert-advice') {
        assertMethod(req, ['POST']);
        if (!['expert', 'super_admin'].includes(session.user.role)) {
          sendApiError(res, 403, 'FORBIDDEN', '仅智库端专家可生成专家建议', { role: session.user.role });
          return;
        }
        if (!expertAdviceService.configured) {
          sendApiError(res, 503, 'DEEPSEEK_NOT_CONFIGURED', 'DeepSeek API 尚未配置，请在服务端设置 DEEPSEEK_API_KEY');
          return;
        }
        const body = await readJsonBody(req);
        const result = await expertAdviceService.generate(body);
        sendJson(res, result);
        return;
      }

      if (pathname === '/api/roof-risk/expert-advice/status') {
        assertMethod(req, ['GET']);
        sendJson(res, { configured: Boolean(expertAdviceService.configured), source: expertAdviceService.configured ? 'deepseek' : 'unconfigured' });
        return;
      }

      if (pathname === '/api/roof-risk/events') {
        assertMethod(req, ['GET']);
        sendJson(res, repository.listEvents());
        return;
      }

      if (pathname === '/api/roof-risk/select') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        if (typeof body.event_id !== 'string' || !body.event_id) {
          throw new RoofRiskRepositoryError('EVENT_ID_REQUIRED', 'event_id is required', 400);
        }
        sendJson(res, {
          api_version: 'RoofRisk API v1',
          ...repository.selectEvent(body.event_id),
        });
        return;
      }

      if (pathname === '/api/roof-risk/evaluate') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        if (typeof body.record_id !== 'string' || !body.record_id) {
          throw new RoofRiskRepositoryError('RECORD_ID_REQUIRED', 'record_id is required', 400);
        }
        sendJson(res, repository.evaluateRecord(body.record_id));
        return;
      }

      if (pathname === '/api/roof-risk/closed-loop/advance') {
        assertMethod(req, ['POST']);
        const body = await readJsonBody(req);
        const action = body.action || 'advance';
        if (!['advance', 'archive', 'reset'].includes(action)) {
          throw new RoofRiskRepositoryError('INVALID_ACTION', `Unsupported closed-loop action: ${action}`, 400, { action });
        }
        if (!authService.can(session.user.role, action)) {
          sendApiError(res, 403, 'FORBIDDEN', '当前账号无权执行此闭环操作', {
            action,
            role: session.user.role,
          });
          return;
        }
        if (body.event_id) repository.selectEvent(body.event_id);
        sendJson(res, repository.advanceClosedLoop(action));
        return;
      }

      if (pathname.startsWith('/api/')) {
        sendApiError(res, 404, 'API_NOT_FOUND', `API route not found: ${pathname}`, { path: pathname });
        return;
      }

      assertMethod(req, ['GET', 'HEAD']);
      serveStatic(root, pathname, res);
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
        sendApiError(res, error.statusCode, error.code, error.message);
        return;
      }
      if (error instanceof RoofRiskRepositoryError) {
        sendApiError(res, error.statusCode, error.code, error.message, error.details);
        return;
      }
      console.error('Unhandled request error:', error);
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The request could not be completed');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8092;
  const server = createAppServer();
  server.listen(port, () => {
    console.log('========================================');
    console.log('  智慧矿山平台已启动');
    console.log(`  真实数据接口: http://localhost:${port}/api/roof-risk/current`);
    console.log(`  页面入口: http://localhost:${port}`);
    console.log('  按 Ctrl+C 停止服务器');
    console.log('========================================');
  });
}

module.exports = {
  assertAdminUserUpdateAllowed,
  createAppServer,
  portalUrl,
};
