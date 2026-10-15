import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setupSupportSimulation } from '../js/support-simulation-ui.mjs';
import { buildSupportSimulationOption } from '../js/support-simulation-model.mjs';
import { renderKnowledgeEvidence } from '../js/knowledge-evidence.mjs';
const catalog = JSON.parse(await readFile(new URL('../data/support-simulation-v1.json', import.meta.url), 'utf8'));
catalog.artifact_sha256 = 'a'.repeat(64);
class Element {
  constructor() { this.listeners = new Map(); this.value = '0'; this.innerHTML = ''; this.textContent = ''; this.disabled = true; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  click() { return this.listeners.get('click')?.(); }
  input() { return this.listeners.get('input')?.(); }
  change() { return this.listeners.get('change')?.(); }
  scrollIntoView() { this.scrolled = true; }
}
function documentFixture(t) {
  const elements = new Map();
  globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); } };
  t.after(() => delete globalThis.document);
  return id => document.getElementById(id);
}
test('support UI keeps units, only focuses on click, and clears stale advice on frame change', async t => {
  const el = documentFixture(t); let frames = [], focuses = 0, disposed = 0;
  const widget = setupSupportSimulation({ role: 'enterprise', authFetch: async () => ({ ok: true, json: async () => structuredClone(catalog) }),
    onFrame: f => frames.push(f), onFocus: () => { focuses++; return true; }, disposeChart: () => disposed++ });
  await widget.ready;
  assert.equal(focuses, 0); assert.equal(frames.length, 0);
  assert.equal(el('supportForce').textContent, catalog.cases[0].frames[0].support_force_kn.toFixed(2));
  await el('supportFocus').click(); assert.equal(focuses, 1); assert.equal(el('threeContainer').scrolled, true);
  el('supportAdvice').innerHTML = 'old explanation'; el('supportStep').value = '20'; el('supportStep').input();
  assert.equal(el('supportAdvice').innerHTML, ''); assert.equal(focuses, 1); assert.equal(frames.at(-1).step, 20);
  el('supportClear').click(); assert.equal(frames.at(-1), null);
  widget.destroy(); assert.equal(disposed, 1); assert.equal(el('supportExplain').listeners.size, 0);
});
test('a late advice response cannot overwrite the newly selected loading step', async t => {
  const el = documentFixture(t); let resolve, body;
  const widget = setupSupportSimulation({ role: 'enterprise', authFetch: async (url, options) => {
    if (!url.endsWith('/explain')) return { ok: true, json: async () => structuredClone(catalog) };
    body = JSON.parse(options.body);
    return new Promise(r => resolve = r);
  } });
  await widget.ready;
  const pending = el('supportExplain').click();
  el('supportStep').value = '10'; el('supportStep').input();
  resolve({ ok: true, json: async () => ({ advice: { source: 'deepseek', summary: 'old', recommendations: [], evidence_ids: [] } }) });
  await pending;
  assert.deepEqual(body, { case_id: 'reference-support', step: 0 });
  assert.equal(el('supportAdvice').innerHTML, ''); assert.equal(el('supportExplain').disabled, false);
  widget.destroy();
});
test('regulator is read-only for new simulation advice and missing catalog does not display fake values', async t => {
  const el = documentFixture(t);
  const widget = setupSupportSimulation({ role: 'regulator', authFetch: async () => ({ ok: false, status: 503 }) });
  await widget.ready;
  assert.match(el('supportAdviceStatus').textContent, /加载失败/);
  assert.equal(el('supportExplain').disabled, true);
  assert.equal(el('supportForce').textContent, '');
  widget.destroy();
});

test('cached real advice is visibly historical and retains original generation time', async t => {
  const el = documentFixture(t);
  const widget = setupSupportSimulation({ role: 'enterprise', authFetch: async url => ({ ok: true, json: async () => url.endsWith('/explain')
    ? { advice: { source: 'deepseek', delivery: 'cache', generated_at: '2026-10-15T05:49:14Z', summary: '复核支护', recommendations: ['人工确认'], evidence_ids: [] }, chain: [] }
    : structuredClone(catalog) }) });
  await widget.ready; await el('supportExplain').click();
  assert.match(el('supportAdviceStatus').textContent, /DeepSeek 历史结果/);
  assert.match(el('supportAdviceStatus').textContent, /非本次实时调用/);
  assert.match(el('supportAdviceStatus').textContent, /原生成时间/);
  assert.equal(el('supportExplain').disabled, false); widget.destroy();
});
test('chart binds real precomputed frames to units and loading steps without animation', () => {
  const option = buildSupportSimulationOption(catalog.cases[0], 7);
  assert.equal(option.animation, false);
  assert.equal(option.tooltip.renderMode, 'richText');
  assert.equal(option.xAxis.type, 'category');
  assert.deepEqual(option.series[0].data, catalog.cases[0].frames.map(f => f.support_force_kn));
  assert.deepEqual(option.series[1].data, catalog.cases[0].frames.map(f => f.support_displacement_mm));
  assert.equal(option.series[0].markLine.data[0].xAxis, 7);
});
test('knowledge cards escape all text and do not turn unknown URL schemes into links', () => {
  const html = renderKnowledgeEvidence({ catalog_version: '<bad>', chunks: [{ id: 'knowledge:test', text: '<script>alert(1)</script>', title: '<img>', locator: '<source>', source_url: 'javascript:alert(1)' }] }, ['knowledge:test']);
  assert.ok(!html.includes('<script>') && !html.includes('<img>') && !html.includes('href='));
  assert.match(html, /本建议已引用/); assert.match(html, /&lt;script&gt;/);
});
test('three-dimensional simulation uses a distinct whole-support role and only explicit focus moves camera', async () => {
  const source = await readFile(new URL('../js/scene.js', import.meta.url), 'utf8');
  const feature = source.slice(source.indexOf('export function setSupportSimulationFrame'), source.indexOf('let controlMode'));
  const focused = await readFile(new URL('../js/scene/mine-v2/focused-longwall.js', import.meta.url), 'utf8');
  assert.match(focused, /objectsByRole\.set\('simulationSupport01', support\)/);
  assert.match(feature, /getObject\('simulationSupport01'\)/);
  assert.match(feature, /if \(focus\) \{\s*applyCameraFocusPreset/);
  assert.doesNotMatch(feature, /object\.(position|rotation|scale)\s*[.=]/);
  assert.match(feature, /width:340px/);
});
