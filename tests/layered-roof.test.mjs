import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setupLayeredRoof } from '../js/layered-roof-ui.mjs';
const require = createRequire(import.meta.url);
const { createLayeredRoofService } = require('../server/layered-roof-service.js');
const { createExpertAdviceService } = require('../server/expert-advice-service.js');
const { createAppServer } = require('../server.js');
const { createFileWorkflowStore } = require('../server/workflow-store.js');
const artifact = require('../data/layered-roof-v1.json');

test('all published frames conserve load and retain source hashes across line endings', () => {
  const service = createLayeredRoofService();
  for (const [source, expected] of Object.entries(artifact.provenance.sources)) {
    const bytes = readFileSync(new URL('../'+source, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
  assert.equal(service.catalog().cases.flatMap(c=>c.frames).length, 84);
  const weak = service.getCase('anchor-weakening', 20), load = service.getCase('load-increase', 20);
  assert.ok(weak.comparison.opening_delta_mm > 0 && weak.comparison.anchor_force_delta_kn < 0);
  assert.ok(load.comparison.opening_delta_mm > 0 && load.comparison.anchor_force_delta_kn > 0);
  assert.equal(weak.comparison.same_load, true); assert.equal(load.comparison.same_load, false);
  const contact = service.getCase('upper-loading', 20).frame;
  assert.equal(contact.max_opening_mm, 0); assert.ok(contact.max_contact_overlap_mm > 0);
  const clone = service.catalog(); clone.cases[0].frames[0].max_opening_mm = 999;
  assert.notEqual(service.getCase('reference', 0).frame.max_opening_mm, 999);
});

test('tampered gap, tie force, contact and conservation data fail closed', () => {
  for (const mutate of [a=>a.cases[0].frames[0].opening_mm[12]++, a=>a.cases[0].frames[0].anchor_forces_kn[12]++, a=>a.cases[3].frames[0].contact_forces_kn[0]++, a=>a.cases[0].frames[0].applied_load_kn++, a=>a.cases[0].frames[0].energy_relative_error = -1]) {
    const copy = structuredClone(artifact); mutate(copy);
    assert.throws(()=>createLayeredRoofService({artifact:copy}), TypeError);
  }
});

test('advice receives computed opening and reference evidence, with an explicit fallback', async () => {
  let input;
  const service = createLayeredRoofService({adviceService:{async generateWorkflowAdvice(value){ input=value; return {source:'test'}; }}});
  const result = await service.explain({caseId:'anchor-weakening',step:20});
  assert.equal(input.evidence_origin, 'mechanics_simulation');
  assert.equal(input.feature_evidence.find(e=>e.key==='opening').value, result.frame.max_opening_mm);
  assert.ok(input.knowledge_chunks.length > 0); assert.equal(input.risk.score, null);
  assert.equal(result.interpretation_kind,'known_preset_comparison');
  const fallback = await createLayeredRoofService({adviceService:createExpertAdviceService({apiKey:''})}).explain({caseId:'reference',step:0});
  assert.equal(fallback.advice.fallback_reason,'not_configured'); assert.equal(fallback.business_event_created,false);
});

test('layered API checks auth, role and server-owned inputs without changing warning events', async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'layered-api-'));
  const server = createAppServer({expertAdviceService:createExpertAdviceService({apiKey:''}),workflowStore:createFileWorkflowStore({directory})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${server.address().port}`, route = '/api/roof-risk/layered-roof';
  assert.equal((await fetch(base+route)).status,401);
  const login = async(username,password)=>(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})})).headers.get('set-cookie').split(';')[0];
  const cookie = await login('enterprise_operator','Mine@2026');
  const get = url=>fetch(base+url,{headers:{cookie}});
  const post = (body, auth=cookie)=>fetch(base+route+'/explain',{method:'POST',headers:{cookie:auth,'content-type':'application/json'},body:JSON.stringify(body)});
  const before = await (await get('/api/roof-risk/current')).json();
  assert.equal((await get(route)).status,200);
  for(const body of [null, [], {}, {case_id:'fake',step:0},{case_id:'reference',step:'0'},{case_id:'reference',step:21},{case_id:'reference',step:0,opening_mm:999}]) assert.equal((await post(body)).status,400);
  const result = await (await post({case_id:'anchor-weakening',step:20})).json();
  assert.equal(result.human_approval_required,true);assert.equal(result.advice.fallback_reason,'not_configured');
  const regulator = await login('regulator_officer','Safe@2026');
  assert.equal((await post({case_id:'reference',step:0},regulator)).status,403);
  const after = await (await get('/api/roof-risk/current')).json();
  assert.equal(after.model_output.record_id,before.model_output.record_id);assert.deepEqual(after.risk,before.risk);
  assert.deepEqual((await (await get('/api/multi-agent/runs')).json()).runs,[]);
});

test('UI clears stale explanations on scenario change and ignores late replies', async t => {
  const elements = new Map();
  globalThis.document = {getElementById(id){if(!elements.has(id))elements.set(id,{value:'0',innerHTML:'',textContent:'',disabled:true,listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);}});return elements.get(id);}};
  t.after(()=>delete globalThis.document);
  const el = id=>document.getElementById(id);
  let resolve;
  const ui = setupLayeredRoof({role:'enterprise',authFetch:async url=>url.endsWith('/explain') ? new Promise(r=>resolve=r) : {ok:true,json:async()=>structuredClone(artifact)}});
  await ui.ready;
  assert.match(el('layeredProfile').innerHTML,/<svg/);
  assert.match(el('layeredTable').innerHTML,/载荷增加/);
  const pending = el('layeredExplain').listeners.get('click')();
  el('layeredCase').value='anchor-weakening';el('layeredStep').value='20';el('layeredCase').listeners.get('change')();
  assert.equal(el('layeredOpening').textContent,artifact.cases[2].frames[20].max_opening_mm.toFixed(3));
  resolve({ok:true,json:async()=>({advice:{source:'deepseek',summary:'stale',recommendations:[],evidence_ids:[]}})});
  await pending;
  assert.equal(el('layeredAdvice').innerHTML,'');assert.equal(el('layeredExplain').disabled,false);
  ui.destroy();assert.equal(el('layeredCase').listeners.size,0);
});
