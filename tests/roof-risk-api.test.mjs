import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { EXPECTED_SOURCE_HASH } = require('../server/roof-risk-repository.js');

let createAppServer;

async function withServer(run, { authenticate = true } = {}) {
  ({ createAppServer } = require('../server.js'));
  const directory = await mkdtemp(path.join(tmpdir(), 'mine-roof-api-'));
  const { createFileWorkflowStore } = require('../server/workflow-store.js');
  const server = createAppServer({ workflowStore: createFileWorkflowStore({ directory }) });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const cookie = authenticate ? await loginAs(baseUrl, 'enterprise_operator', 'Mine@2026') : null;
    await run(baseUrl, cookie);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(directory, { recursive: true, force: true });
  }
}

async function loginAs(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function requestJson(url, options = {}, cookie = null) {
  const headers = new Headers(options.headers || {});
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json();
  return { response, payload };
}

test('health check exposes deployment identity without credentials', async () => {
  await withServer(async (baseUrl) => {
    const { response, payload } = await requestJson(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(payload.release, 'competition-audit-v1');
    assert.equal(payload.auth_provider, 'local');
    assert.ok(!JSON.stringify(payload).includes('KEY'));
  }, { authenticate: false });
});

test('current endpoint exposes real source, eight metrics, and XGBoost output', async () => {
  await withServer(async (baseUrl, cookie) => {
    const { response, payload } = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    assert.equal(response.status, 200);
    assert.equal(payload.data_source, 'teacher_real_csv_xgboost');
    assert.equal(payload.provenance.source_sha256, EXPECTED_SOURCE_HASH);
    assert.equal(payload.model_output.best_model, 'xgboost');
    assert.equal(Object.keys(payload.metrics).length, 8);
    assert.equal(payload.risk.level, 'red');
  });
});

test('expert advice endpoint exposes transparent DeepSeek configuration state', async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginAs(baseUrl, 'expert_analyst', 'Model@2026');
    const status = await requestJson(`${baseUrl}/api/roof-risk/expert-advice/status`, {}, cookie);
    assert.equal(status.response.status, 200);
    assert.equal(status.payload.configured, false);
    const current = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    const advice = await requestJson(`${baseUrl}/api/roof-risk/expert-advice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ risk: current.payload.risk, evidence: current.payload.feature_evidence, closed_loop: current.payload.closed_loop }),
    }, cookie);
    assert.equal(advice.response.status, 503);
    assert.equal(advice.payload.error.code, 'DEEPSEEK_NOT_CONFIGURED');
  }, { authenticate: false });
});

test('portal query URL serves the application without redirecting to itself', async () => {
  await withServer(async (baseUrl, cookie) => {
    const response = await fetch(`${baseUrl}/?scene=v2&view=underground&field=risk&portal=expert`, {
      redirect: 'manual',
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^text\/html/);
    assert.match(await response.text(), /id="expertPortal"/);
  });
});

test('event selection updates current, history, and explanation together', async () => {
  await withServer(async (baseUrl, cookie) => {
    const selected = await requestJson(`${baseUrl}/api/roof-risk/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_id: 'REAL-LOW-001' }),
    }, cookie);
    assert.equal(selected.response.status, 200);
    assert.equal(selected.payload.current.event_id, 'REAL-LOW-001');

    const current = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    const history = await requestJson(`${baseUrl}/api/roof-risk/history`, {}, cookie);
    const explain = await requestJson(`${baseUrl}/api/roof-risk/explain`, {}, cookie);
    assert.equal(current.payload.risk.level, 'green');
    assert.equal(history.payload.event_id, current.payload.event_id);
    assert.equal(history.payload.feature_schema.length, 8);
    assert.equal(Object.keys(history.payload.points[0].metrics).length, 8);
    assert.equal(history.payload.points[0].metrics.roof_separation_rate.unit, 'mm/d');
    assert.equal(explain.payload.model_output.record_id, current.payload.model_output.record_id);
  });
});

test('record evaluation returns precomputed model output and rejects unknown ids', async () => {
  await withServer(async (baseUrl, cookie) => {
    const current = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    const evaluated = await requestJson(`${baseUrl}/api/roof-risk/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_id: current.payload.model_output.record_id }),
    }, cookie);
    assert.equal(evaluated.response.status, 200);
    assert.equal(evaluated.payload.model_output.record_id, current.payload.model_output.record_id);

    const missing = await requestJson(`${baseUrl}/api/roof-risk/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_id: 'missing' }),
    }, cookie);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.payload.error.code, 'RECORD_NOT_FOUND');
  });
});

test('similar-case endpoint returns authenticated real-data matches and validates ids', async () => {
  await withServer(async (baseUrl, cookie) => {
    const matched = await requestJson(
      `${baseUrl}/api/roof-risk/similar-cases?record_id=REC-202511101149-02909&limit=3`,
      {},
      cookie,
    );
    assert.equal(matched.response.status, 200);
    assert.equal(matched.payload.cases.length, 3);
    assert.equal(matched.payload.source_sha256, EXPECTED_SOURCE_HASH);

    const required = await requestJson(`${baseUrl}/api/roof-risk/similar-cases`, {}, cookie);
    assert.equal(required.response.status, 400);
    assert.equal(required.payload.error.code, 'RECORD_ID_REQUIRED');

    const missing = await requestJson(`${baseUrl}/api/roof-risk/similar-cases?record_id=missing`, {}, cookie);
    assert.equal(missing.response.status, 404);
    assert.equal(missing.payload.error.code, 'RECORD_NOT_FOUND');
  });
});

test('closed-loop advancement cannot change source measurements', async () => {
  await withServer(async (baseUrl, cookie) => {
    const before = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    const advanced = await requestJson(`${baseUrl}/api/roof-risk/closed-loop/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'advance' }),
    }, cookie);
    const after = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
    assert.equal(advanced.response.status, 200);
    assert.deepEqual(after.payload.metrics, before.payload.metrics);
    assert.equal(after.payload.model_output.record_id, before.payload.model_output.record_id);
    assert.ok(after.payload.closed_loop.progress > before.payload.closed_loop.progress);
  });
});

test('invalid JSON and unsupported actions return structured errors', async () => {
  await withServer(async (baseUrl, cookie) => {
    const invalidJson = await requestJson(`${baseUrl}/api/roof-risk/select`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }, cookie);
    assert.equal(invalidJson.response.status, 400);
    assert.equal(invalidJson.payload.error.code, 'INVALID_JSON');

    const invalidAction = await requestJson(`${baseUrl}/api/roof-risk/closed-loop/advance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'invalid' }),
    }, cookie);
    assert.equal(invalidAction.response.status, 400);
    assert.equal(invalidAction.payload.error.code, 'INVALID_ACTION');
  });
});

test('unauthenticated application and RoofRisk requests are blocked', async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(`${baseUrl}/?portal=expert`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login');

    const api = await requestJson(`${baseUrl}/api/roof-risk/current`);
    assert.equal(api.response.status, 401);
    assert.equal(api.payload.error.code, 'AUTH_REQUIRED');

    const loginPage = await fetch(`${baseUrl}/login`);
    assert.equal(loginPage.status, 200);
    assert.match(await loginPage.text(), /id="loginForm"/);
  }, { authenticate: false });
});

test('health check is public and identifies the deployed data source', async () => {
  await withServer(async (baseUrl) => {
    const health = await requestJson(`${baseUrl}/healthz`);
    assert.equal(health.response.status, 200);
    assert.equal(health.payload.status, 'ok');
    assert.equal(health.payload.data_source, 'teacher_real_csv_xgboost');
  }, { authenticate: false });
});

test('session endpoint exposes identity and logout invalidates the cookie', async () => {
  await withServer(async (baseUrl, cookie) => {
    const session = await requestJson(`${baseUrl}/api/auth/session`, {}, cookie);
    assert.equal(session.response.status, 200);
    assert.equal(session.payload.authenticated, true);
    assert.equal(session.payload.user.role, 'enterprise');

    const logout = await requestJson(`${baseUrl}/api/auth/logout`, { method: 'POST' }, cookie);
    assert.equal(logout.response.status, 200);
    assert.match(logout.response.headers.get('set-cookie') || '', /Max-Age=0/);

    const expired = await requestJson(`${baseUrl}/api/auth/session`, {}, cookie);
    assert.equal(expired.response.status, 401);
    assert.equal(expired.payload.error.code, 'AUTH_REQUIRED');
  });
});

test('HTTPS proxy requests receive a Secure session cookie', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-proto': 'https',
      },
      body: JSON.stringify({ username: 'expert_analyst', password: 'Model@2026' }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') || '', /; Secure(?:;|$)/);
  }, { authenticate: false });
});

test('invalid credentials are generic and repeated failures are rate limited', async () => {
  await withServer(async (baseUrl) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const invalid = await requestJson(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'missing', password: 'wrong' }),
      });
      assert.equal(invalid.response.status, 401);
      assert.equal(invalid.payload.error.code, 'INVALID_CREDENTIALS');
    }
    const limited = await requestJson(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'missing', password: 'wrong' }),
    });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.payload.error.code, 'RATE_LIMITED');
    assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
  }, { authenticate: false });
});

test('closed-loop mutations enforce the approved role matrix', async () => {
  await withServer(async (baseUrl) => {
    const accounts = {
      enterprise: ['enterprise_operator', 'Mine@2026'],
      regulator: ['regulator_officer', 'Safe@2026'],
      expert: ['expert_analyst', 'Model@2026'],
    };
    const expected = {
      enterprise: { advance: 200, archive: 403, reset: 200 },
      regulator: { advance: 200, archive: 403, reset: 403 },
      expert: { advance: 403, archive: 200, reset: 403 },
    };

    for (const [role, credentials] of Object.entries(accounts)) {
      const cookie = await loginAs(baseUrl, ...credentials);
      const read = await requestJson(`${baseUrl}/api/roof-risk/current`, {}, cookie);
      assert.equal(read.response.status, 200);
      const select = await requestJson(`${baseUrl}/api/roof-risk/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_id: 'REAL-SEVERE-001' }),
      }, cookie);
      assert.equal(select.response.status, 200);

      for (const [action, status] of Object.entries(expected[role])) {
        const result = await requestJson(`${baseUrl}/api/roof-risk/closed-loop/advance`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        }, cookie);
        assert.equal(result.response.status, status, `${role} ${action}`);
        if (status === 403) assert.equal(result.payload.error.code, 'FORBIDDEN');
      }
    }
  }, { authenticate: false });
});

test('authenticated replay endpoints expose metadata and a traceable frame', async () => {
  await withServer(async (baseUrl, cookie) => {
    const meta = await requestJson(`${baseUrl}/api/roof-risk/replay/meta`, {}, cookie);
    assert.equal(meta.response.status, 200);
    assert.equal(meta.payload.total, 20_000);
    const frame = await requestJson(
      `${baseUrl}/api/roof-risk/replay/frame?index=${meta.payload.default_index}&window=48`,
      {},
      cookie,
    );
    assert.equal(frame.response.status, 200);
    assert.equal(frame.payload.current.provenance.record_id, frame.payload.current.model_output.record_id);
    assert.equal(frame.payload.history.feature_schema.length, 8);
  });
});

test('replay endpoints reject unauthenticated and invalid index requests', async () => {
  await withServer(async (baseUrl, cookie) => {
    const unauthenticated = await requestJson(`${baseUrl}/api/roof-risk/replay/meta`);
    assert.equal(unauthenticated.response.status, 401);
    const invalid = await requestJson(`${baseUrl}/api/roof-risk/replay/frame?index=nope`, {}, cookie);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.error.code, 'INVALID_REPLAY_INDEX');
  });
});

test('multi-agent API runs the six-agent graph from a traceable XGBoost record', async () => {
  await withServer(async (baseUrl, cookie) => {
    const status = await requestJson(`${baseUrl}/api/multi-agent/status`, {}, cookie);
    assert.equal(status.response.status, 200);
    assert.equal(status.payload.perception_backend, 'teacher_real_csv_xgboost');
    assert.deepEqual(status.payload.node_order, ['A1', 'A2', 'A3', 'A5', 'A4', 'A6']);

    const run = await requestJson(`${baseUrl}/api/multi-agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_id: 'REC-202511101149-02909' }),
    }, cookie);
    assert.equal(run.response.status, 200);
    assert.equal(run.payload.algorithm.model, 'xgboost');
    assert.equal(run.payload.nodes.length, 6);
    assert.equal(run.payload.nodes[4].status, 'waiting_human');
    assert.equal(run.payload.nodes[4].output.delivery_mode, 'dry_run');
  });
});

test('multi-agent API authenticates requests and validates record input', async () => {
  await withServer(async (baseUrl, cookie) => {
    const anonymous = await requestJson(`${baseUrl}/api/multi-agent/status`);
    assert.equal(anonymous.response.status, 401);
    const invalid = await requestJson(`${baseUrl}/api/multi-agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, cookie);
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.error.code, 'RECORD_ID_REQUIRED');
    const resources = await requestJson(`${baseUrl}/api/multi-agent/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_id: 'REC-202511101149-02909', resource_snapshot: { personnel_available: 'abc' } }),
    }, cookie);
    assert.equal(resources.response.status, 400);
    assert.equal(resources.payload.error.code, 'INVALID_WORKFLOW_INPUT');
  });
});
