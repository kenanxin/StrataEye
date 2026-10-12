import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('QA capture waits for the expected invocation despite delayed and stale IPC delivery', async () => {
  const { createAdviceCaptureBarrier } = require('../tools/capture-teacher-feedback-qa.cjs');
  const barrier = createAdviceCaptureBarrier();
  barrier.capture({ invocation_id: 'WF-old:v1', memory: [] });
  let complete = false;
  const wait = barrier.wait('WF-current:v2', 200).then(value => { complete = true; return value; });
  barrier.capture({ invocation_id: 'WF-current:v1', memory: [] });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(complete, false, 'older captures cannot satisfy the new invocation');
  barrier.capture({ invocation_id: 'WF-current:v2', memory: [{ workflow_run_id: 'WF-source' }] });
  assert.deepEqual(await wait, [{ workflow_run_id: 'WF-source' }]);
  assert.deepEqual(await barrier.wait('WF-current:v2', 50), [{ workflow_run_id: 'WF-source' }]);
  await assert.rejects(barrier.wait('WF-missing:v1', 15), /IPC advice capture timeout/);
});
