import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  canRolePerformDemoAction,
  demoStatusView,
  getWarningDemoAdviceContext,
  validateDisposalDraft,
  setupWarningDemo,
} from '../js/warning-demo-ui.mjs';
import { createInitialDemoState, reduceDemoState } from '../js/warning-demo-state.mjs';
import { createWorkflowCoordinator } from '../js/workflow-client.mjs';
import { setupMultiAgentWorkflow } from '../js/multi-agent-workflow-ui.mjs';

const now = () => '2026-09-07T10:00:00.000Z';
const enterprise = { role: 'enterprise', displayName: '企业' };
const regulator = { role: 'regulator', displayName: '监管' };
const expert = { role: 'expert', displayName: '专家' };

test('demo actions are restricted to their responsible portal', () => {
  assert.equal(canRolePerformDemoAction('enterprise', 'START_DEMO'), true);
  assert.equal(canRolePerformDemoAction('enterprise', 'APPROVE'), false);
  assert.equal(canRolePerformDemoAction('regulator', 'APPROVE'), true);
  assert.equal(canRolePerformDemoAction('regulator', 'ARCHIVE'), false);
  assert.equal(canRolePerformDemoAction('expert', 'ARCHIVE'), true);
  assert.equal(canRolePerformDemoAction('viewer', 'ARCHIVE'), false);
});

test('status view exposes stable labels and progress for all seven states', () => {
  const expectations = [
    ['ready', '尚未启动', 0],
    ['alert_triggered', '橙色预警已触发', 12],
    ['disposal_in_progress', '企业现场处置中', 30],
    ['pending_review', '等待监管核验', 58],
    ['changes_requested', '监管已驳回，等待整改', 48],
    ['verified', '监管核验通过', 82],
    ['archived', '事件已闭环归档', 100],
  ];
  expectations.forEach(([status, label, progress]) => assert.deepEqual(demoStatusView(status), { label, progress }));
});

test('disposal draft validation preserves explicit evidence requirements', () => {
  assert.equal(validateDisposalDraft({}).code, 'DISPOSAL_INCOMPLETE');
  assert.equal(validateDisposalDraft({
    measures: '加密锚索', workOrder: 'GD-01', responsiblePerson: '张工',
    completedAt: '2026-09-07T10:20', photos: [{ id: 'p1' }],
  }).valid, true);
});

class FixtureElement {
  constructor(){this.value='';this.textContent='';this.children=[];this.dataset={};this.listeners={};this.open=false;this.classList={add(){},remove(){},toggle(){}};}
  addEventListener(type,fn){(this.listeners[type]??=new Set()).add(fn);}
  removeEventListener(type,fn){this.listeners[type]?.delete(fn);}
  async fire(type){for(const fn of this.listeners[type]||[])await fn({preventDefault(){},currentTarget:this});}
  querySelectorAll(){return this.controls||[];}
  querySelector(selector){this.parts ||= {};return this.parts[selector] ||= new FixtureElement();}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function fixture(){const elements=new Map();globalThis.document={body:new FixtureElement(),getElementById:id=>elements.get(id)||null,createElement:()=>new FixtureElement()};
  ['warningDemoStatus','warningDemoEventId','warningDemoLauncher','warningDemoReset','enterpriseDisposalForm','enterpriseDisposalDrawer','enterpriseWarningDialog','warningDialogAcknowledge','disposalMeasures','disposalWorkOrder','disposalResponsiblePerson','disposalCompletedAt','enterpriseDisposalError','enterprisePhotoList','regulatorPhotoList','regulatorApproveAction','regulatorRejectAction','regulatorReviewOpinion','regulatorReviewError','expertArchiveAction','workflowResourceForm','workflowReprocessForm','workflowMemoryForm','workflowPersonnel','workflowMaterials','workflowDevices','workflowActionError','workflowReprocessConfirmed','workflowFeedbackReason','workflowMonitoringTrend','workflowExecutionStatus','workflowMemoryConclusion','workflowPlanSource','workflowRunSelection','workflowRefresh'].forEach(id=>elements.set(id,new FixtureElement()));elements.get('enterpriseDisposalForm').controls=['disposalMeasures','disposalWorkOrder','disposalResponsiblePerson','disposalCompletedAt'].map(id=>elements.get(id));return elements;}
function savedRun(id='WF-one',revision=0,status='disposal_in_progress'){const state=createInitialDemoState(now);Object.assign(state,{eventId:id,status});return {workflow_run_id:id,revision,algorithm:{record_id:'REC-1',predicted_class:'较大风险'},demo_state:state,nodes:[{agent_id:'A5',output:{feasibility:'feasible'}}],plan_versions:[{approved:true}],events:[],feedback:[],case_memory:[]};}
test('actual disposal form awaits authoritative save, preserves failed draft and clears after success',async()=>{
  const elements=fixture();let fail=true,sent;const current=savedRun();const coordinator=createWorkflowCoordinator({client:{list:async()=>[current],get:async()=>current,act:async envelope=>{sent=envelope;if(fail)throw new Error('storage unavailable');return savedRun('WF-one',1,'pending_review');}},storage:null,pollInterval:0});await coordinator.refresh();
  const media={list:async()=>[{id:'opaque.photo-1',name:'photo.png',size:12,type:'image/png'}]};const widget=await setupWarningDemo({user:enterprise,coordinator,media});
  for(const id of ['disposalMeasures','disposalWorkOrder','disposalResponsiblePerson','disposalCompletedAt'])elements.get(id).value='draft';elements.get('enterpriseDisposalDrawer').showModal();
  await elements.get('enterpriseDisposalForm').fire('submit');assert.equal(elements.get('disposalMeasures').value,'draft');assert.equal(elements.get('enterpriseDisposalDrawer').open,true);assert.match(elements.get('enterpriseDisposalError').textContent,/unavailable/);
  fail=false;await coordinator.refresh();await elements.get('enterpriseDisposalForm').fire('submit');assert.equal(sent.expectedRevision,0);assert.deepEqual(sent.payload.photos,[{id:'opaque.photo-1',name:'photo.png',size:12}]);assert.equal(elements.get('disposalMeasures').value,'');assert.equal(elements.get('enterpriseDisposalDrawer').open,false);assert.match(elements.get('warningDemoStatus').textContent,/等待监管/);widget.destroy();coordinator.destroy();delete globalThis.document;
});
test('shared run changes clear drafts and stale media cannot leak across selections',async()=>{
  const elements=fixture();let resolveMedia;const first=savedRun();const second=savedRun('WF-two');const coordinator=createWorkflowCoordinator({client:{list:async()=>[first],get:async()=>second},storage:null,pollInterval:0});await coordinator.refresh();
  const widgetPromise=setupWarningDemo({user:enterprise,coordinator,media:{list:id=>id==='WF-one'?new Promise(resolve=>resolveMedia=resolve):Promise.resolve([])}});await Promise.resolve();elements.get('disposalMeasures').value='old draft';const selecting=coordinator.select('WF-two');await selecting;resolveMedia([{id:'old',name:'old.png'}]);const widget=await widgetPromise;assert.equal(elements.get('disposalMeasures').value,'');assert.equal(elements.get('warningDemoEventId').textContent,'WF-two');assert.equal(elements.get('enterprisePhotoList').children.some(row=>row.children?.some(child=>child.textContent?.includes('old.png'))),false);widget.destroy();coordinator.destroy();delete globalThis.document;
});
test('viewer has no signing actions; metadata-only photos explain missing local original',async()=>{
  const elements=fixture();const current=savedRun();current.demo_state.disposal.photos=[{id:'missing',name:'saved.png',size:99,storage_source:'browser-local'}];const coordinator=createWorkflowCoordinator({client:{list:async()=>[current]},storage:null,pollInterval:0});await coordinator.refresh();const widget=await setupWarningDemo({user:{role:'viewer'},coordinator,media:{list:async()=>[]}});assert.equal(elements.get('warningDemoLauncher').hidden,true);assert.equal(elements.get('warningDialogAcknowledge').hidden,true);assert.equal(elements.get('regulatorApproveAction').hidden,true);assert.equal(elements.get('expertArchiveAction').hidden,true);assert.match(elements.get('regulatorPhotoList').children[0].children.map(e=>e.textContent).join(''),/本浏览器.*原图/);widget.destroy();coordinator.destroy();delete globalThis.document;
});
test('both actual widgets project the same selected revision and regulator conflict retains opinion',async()=>{
  const elements=fixture();for(const id of ['multiAgentRail','multiAgentDetail','multiAgentSource','multiAgentBoundary','runMultiAgentWorkflow'])elements.set(id,new FixtureElement());
  const agent=new FixtureElement();agent.dataset.agentId='A5';elements.get('multiAgentRail').controls=[agent];
  let current=savedRun('WF-one',0,'pending_review'),sent,calls=0;const coordinator=createWorkflowCoordinator({client:{list:async()=>[current],get:async()=>current,act:async envelope=>{calls++;sent=envelope;current=savedRun('WF-one',1,'changes_requested');throw Object.assign(new Error('conflict'),{status:409});}},storage:null,pollInterval:0});await coordinator.refresh();
  const warning=await setupWarningDemo({user:regulator,coordinator,media:{list:async()=>[]}});const rail=setupMultiAgentWorkflow({coordinator});elements.get('regulatorReviewOpinion').value='draft opinion';await elements.get('regulatorApproveAction').fire('click');assert.equal(calls,1);assert.equal(sent.type,'APPROVE');assert.equal(elements.get('regulatorReviewOpinion').value,'draft opinion');assert.match(elements.get('regulatorReviewError').textContent,/草稿已保留/);assert.match(elements.get('warningDemoStatus').textContent,/conflict/);assert.match(elements.get('multiAgentSource').textContent,/不可用/);assert.equal(coordinator.getSnapshot().run.revision,1);rail.destroy();warning.destroy();coordinator.destroy();delete globalThis.document;
});
test('resource zero is submitted, standalone reassessment carries only human feedback and signing stays hidden for low risk',async()=>{
  const elements=fixture();let current=savedRun(),sent;const coordinator=createWorkflowCoordinator({client:{list:async()=>[current],get:async()=>current,act:async envelope=>{sent=envelope;current=savedRun('WF-one',current.revision+1,'alert_triggered');return current;}},storage:null,pollInterval:0});await coordinator.refresh();const widget=await setupWarningDemo({user:enterprise,coordinator,media:{list:async()=>[]}});
  elements.get('workflowPersonnel').value='0';await elements.get('workflowResourceForm').fire('submit');assert.deepEqual(sent.payload,{resource_snapshot:{personnel_available:0}});assert.equal(elements.get('workflowPersonnel').value,'');
  elements.get('workflowReprocessConfirmed').checked=true;elements.get('workflowFeedbackReason').value='人工现场复核';elements.get('workflowMonitoringTrend').value='worsened';await elements.get('workflowReprocessForm').fire('submit');assert.deepEqual(sent.payload,{confirmed:true,feedback:{reason:'人工现场复核',monitoring_trend:'worsened'}});assert.equal(elements.get('workflowReprocessConfirmed').checked,false);
  current=savedRun('WF-one',3,'ready');current.algorithm.predicted_class='低风险';current.phase='finish';current.plan_versions=[];await coordinator.refresh();assert.equal(elements.get('workflowReprocessForm').hidden,true);assert.equal(elements.get('workflowResourceForm').hidden,true);assert.equal(elements.get('warningDialogAcknowledge').disabled,true);widget.destroy();coordinator.destroy();delete globalThis.document;
});
test('expert explicitly approves reviewed memory after archive and destroys only widget subscriptions',async()=>{
  const elements=fixture();let sent;const current=savedRun('WF-one',2,'archived');const coordinator=createWorkflowCoordinator({client:{list:async()=>[current],act:async envelope=>{sent=envelope;return {...current,revision:3,case_memory:[{reviewed:true,reviewed_conclusion:envelope.payload.reviewed_conclusion}]};}},storage:null,pollInterval:0});await coordinator.refresh();const widget=await setupWarningDemo({user:expert,coordinator,media:{list:async()=>[]}});assert.equal(elements.get('workflowMemoryForm').hidden,false);elements.get('workflowMemoryConclusion').value='经审核可参考';await elements.get('workflowMemoryForm').fire('submit');assert.equal(sent.type,'APPROVE_MEMORY');assert.deepEqual(sent.payload,{reviewed_conclusion:'经审核可参考'});assert.equal(elements.get('workflowMemoryForm').hidden,true);widget.destroy();assert.equal(coordinator.getSnapshot().run.revision,3);assert.equal(elements.get('workflowMemoryForm').listeners.submit.size,0);coordinator.destroy();delete globalThis.document;
});
test('saved-run picker selects history for all subscribers without starting or erasing evidence',async()=>{
  const elements=fixture();const first=savedRun(),second=savedRun('WF-two',7,'archived');let starts=0;const client={list:async()=>[first,second],get:async id=>id==='WF-two'?second:first,start:async()=>{starts++;return first;}};const coordinator=createWorkflowCoordinator({client,storage:null,pollInterval:0});await coordinator.refresh();const widget=await setupWarningDemo({user:expert,coordinator,client,media:{list:async()=>[]}});assert.equal(elements.get('workflowRunSelection').children.length,2);elements.get('workflowRunSelection').value='WF-two';await elements.get('workflowRunSelection').fire('change');assert.equal(coordinator.getSnapshot().run.revision,7);assert.equal(elements.get('warningDemoEventId').textContent,'WF-two');assert.equal(starts,0);assert.equal(first.workflow_run_id,'WF-one');widget.destroy();coordinator.destroy();delete globalThis.document;
});

async function settleEvidence() { for (let turn=0;turn<20;turn++) await Promise.resolve(); }

function fixtureText(element) { return [element.textContent, ...(element.children || []).map(fixtureText)].join(' '); }
test('saved current candidate is visible before confirmation, replaces versions and clears during selection and failed loads', async () => {
  const elements = fixture();
  for (const id of ['workflowCurrentPlan', 'enterpriseWarningPlan']) elements.set(id, new FixtureElement());
  let current = savedRun('WF-one', 0, 'alert_triggered'), fail = false, resolveLoad;
  current.plan_versions = [{ version: 1, approved: false, advice: { source: 'deepseek', summary: '保存摘要 <script>文本</script>', recommendations: ['独特服务端建议甲', '独特服务端建议乙'], evidence_ids: ['feature:REC-1:roof'] }, retrieved_context: [{ evidence_id: 'case:WF-source:review:1:r7', workflow_run_id: 'WF-source', record_id: 'REC-1', review_version: 1, review_revision: 7, reviewed_at: now(), source_model: { name: 'xgboost', mode: 'integrated_xgboost' } }] }];
  let signs = 0;
  const coordinator = createWorkflowCoordinator({ client: { list: async () => [current], get: async id => { if (fail) throw new Error('load failed'); if (id === 'WF-two') return new Promise(resolve => { resolveLoad = resolve; }); return current; }, act: async () => { signs++; return current; } }, storage: null, pollInterval: 0 });
  await coordinator.refresh();
  const widget = await setupWarningDemo({ user: enterprise, coordinator, media: { list: async () => [] } });
  try {
    assert.equal(signs, 0);
    assert.equal(elements.get('warningDialogAcknowledge').disabled, false);
    for (const id of ['workflowCurrentPlan', 'enterpriseWarningPlan']) {
      const text = fixtureText(elements.get(id));
      assert.match(text, /独特服务端建议甲.*独特服务端建议乙/);
      assert.match(text, /保存摘要 <script>文本<\/script>/);
      assert.match(text, /已审核工作流.*WF-source/);
      assert.match(text, /实际引用.*feature:REC-1:roof/);
    }
    current = { ...current, revision: 1, plan_versions: [...current.plan_versions, { version: 2, advice: { source: 'local-rule', fallback_reason: 'not_configured', summary: '新版摘要', recommendations: ['独特新版建议'], evidence_ids: [] }, retrieved_context: [] }] };
    await coordinator.refresh();
    assert.match(fixtureText(elements.get('enterpriseWarningPlan')), /独特新版建议/);
    assert.doesNotMatch(fixtureText(elements.get('enterpriseWarningPlan')), /独特服务端建议甲/);
    fail = true; await assert.rejects(coordinator.refresh(), /load failed/);
    assert.doesNotMatch(fixtureText(elements.get('enterpriseWarningPlan')), /独特新版建议/);
    assert.equal(elements.get('warningDialogAcknowledge').disabled, true);
    fail = false; await coordinator.refresh();
    const selecting = coordinator.select('WF-two');
    assert.doesNotMatch(fixtureText(elements.get('enterpriseWarningPlan')), /独特新版建议/);
    assert.equal(elements.get('warningDialogAcknowledge').disabled, true);
    resolveLoad(savedRun('WF-two', 0, 'alert_triggered')); await selecting;
    fail = true; await assert.rejects(coordinator.refresh(), /load failed/);
    assert.doesNotMatch(fixtureText(elements.get('enterpriseWarningPlan')), /独特新版建议|独特服务端建议甲/);
    assert.equal(elements.get('warningDialogAcknowledge').disabled, true);
  } finally { widget.destroy(); coordinator.destroy(); delete globalThis.document; }
});

test('regulator and expert review the same saved candidate and full bounded action list', async () => {
  for (const user of [regulator, expert]) {
    const elements = fixture(); elements.set('workflowCurrentPlan', new FixtureElement());
    const current = savedRun('WF-role-review', 3, 'pending_review');
    current.plan_versions = [{ version: 1, advice: { source: 'local-rule', fallback_reason: 'provider_unavailable', summary: '角色共享保存摘要', recommendations: ['复核顶板', '复核锚杆', '检查支架', '复核工单', '补充测量', '监管核验'], evidence_ids: ['feature:REC-1:roof'] } }];
    const coordinator = createWorkflowCoordinator({ client: { list: async () => [current] }, storage: null, pollInterval: 0 }); await coordinator.refresh();
    const widget = await setupWarningDemo({ user, coordinator, media: { list: async () => [] } });
    try {
      const text = fixtureText(elements.get('workflowCurrentPlan'));
      assert.match(text, /角色共享保存摘要/); assert.match(text, /provider_unavailable/);
      for (const action of current.plan_versions[0].advice.recommendations) assert.ok(text.includes(action));
      assert.equal(elements.get('warningDialogAcknowledge').hidden, true);
    } finally { widget.destroy(); coordinator.destroy(); delete globalThis.document; }
  }
});

test('failed new-run evidence clears displayed risk and comparisons; same-run refresh retries evidence',async()=>{
  const elements=fixture();
  for (const id of ['expertDemoRiskLevel','expertDemoMechanism','expertDemoProbabilities','expertSimilarCases','enterpriseWarningEvidence','regulatorMonitoringComparison']) elements.set(id,new FixtureElement());
  const articles=[new FixtureElement(),new FixtureElement()];elements.get('regulatorMonitoringComparison').controls=articles;
  const first=savedRun('WF-A'),second=savedRun('WF-B');first.algorithm.record_id='REC-A';second.algorithm.record_id='REC-B';
  let failing=true,sourceReads=0;
  const client={list:async()=>[first,second],get:async id=>id==='WF-B'?second:first};
  const authFetch=async(path,init)=>{
    if(path.includes('similar-cases'))return {ok:true,json:async()=>({cases:[],source:'CSV'})};
    const recordId=JSON.parse(init.body).record_id;
    if(recordId==='REC-B'){sourceReads++;if(failing)throw new Error('REC-B evidence unavailable');}
    return {ok:true,json:async()=>({record_id:recordId,risk:{score:recordId==='REC-A'?70:recordId==='REC-B'?82:45},model_output:{record_id:recordId,predicted_class:recordId==='REC-B'?'重大风险':'较大风险',confidence:.8,probabilities:{}},feature_evidence:[]})};
  };
  const coordinator=createWorkflowCoordinator({client,storage:null,pollInterval:0});await coordinator.refresh();
  const widget=await setupWarningDemo({user:expert,coordinator,client,authFetch,media:{list:async()=>[]}});
  try {
    await settleEvidence();assert.equal(elements.get('expertDemoRiskLevel').textContent,'较大风险 · 70');assert.equal(articles[0].querySelector('em').textContent,'REC-A');
    await coordinator.select('WF-B');await settleEvidence();
    assert.equal(elements.get('warningDemoEventId').textContent,'WF-B');assert.equal(elements.get('expertDemoRiskLevel').textContent,'--');
    for(const article of articles){assert.equal(article.querySelector('b').textContent,'--');assert.equal(article.querySelector('em').textContent,'--');}
    assert.match(elements.get('expertDemoMechanism').textContent,/REC-B evidence unavailable/);
    const previousReads=sourceReads;failing=false;await elements.get('workflowRefresh').fire('click');await settleEvidence();
    assert.ok(sourceReads>previousReads);assert.equal(elements.get('expertDemoRiskLevel').textContent,'重大风险 · 82');assert.equal(articles[0].querySelector('b').textContent,82);assert.equal(articles[0].querySelector('em').textContent,'REC-B');assert.equal(articles[1].querySelector('b').textContent,45);
  } finally {widget.destroy();coordinator.destroy();delete globalThis.document;}
});

test('refresh GET success with history-list failure keeps its visible notice until complete success',async()=>{
  const elements=fixture(),current=savedRun();let failing=false;
  const client={get:async()=>current,list:async()=>{if(failing)throw new Error('database list failed');return [current];}};
  const coordinator=createWorkflowCoordinator({client,storage:null,pollInterval:0});await coordinator.refresh();
  const widget=await setupWarningDemo({user:expert,coordinator,client,media:{list:async()=>[]}});
  try {
    await settleEvidence();const oldOptions=elements.get('workflowRunSelection').children;
    failing=true;await elements.get('workflowRefresh').fire('click');
    assert.match(elements.get('workflowActionError').textContent,/保存事件列表不可用.*database list failed/);assert.equal(elements.get('workflowRunSelection').children,oldOptions);
    failing=false;await elements.get('workflowRefresh').fire('click');assert.equal(elements.get('workflowActionError').textContent,'');
  } finally {widget.destroy();coordinator.destroy();delete globalThis.document;}
});

test('expert advice context contains the local demo workflow without replacing model data', () => {
  let state = createInitialDemoState(now);
  state = reduceDemoState(state, { type: 'START_DEMO', actor: enterprise }, { now });
  state = reduceDemoState(state, { type: 'ACKNOWLEDGE', actor: enterprise }, { now });
  state = reduceDemoState(state, {
    type: 'SUBMIT_DISPOSAL', actor: enterprise,
    payload: { measures: '加密锚索', workOrder: 'GD-01', responsiblePerson: '张工', completedAt: '2026-09-07T10:20', photos: [{ id: 'p1' }] },
  }, { now });
  state = reduceDemoState(state, { type: 'APPROVE', actor: regulator, payload: { opinion: '核验通过' } }, { now });
  const context = getWarningDemoAdviceContext({ progress: 68 }, state);
  assert.equal(context.demo_event_id, 'DEMO-ORANGE-001');
  assert.equal(context.demo_status, 'verified');
  assert.equal(context.enterprise_work_order, 'GD-01');
  assert.equal(context.regulator_opinion, '核验通过');
  assert.equal(context.server_closed_loop.progress, 68);
});

test('warning demo controller is isolated from Three.js lifecycle calls', () => {
  const script = fs.readFileSync(new URL('../js/warning-demo-ui.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /initScene|focusRoofWarningStage|switchToUnderground|requestAnimationFrame/);
  assert.match(script, /textContent/);
  assert.match(script, /createWorkflowCoordinator/);
  assert.match(script, /createWarningDemoMediaStore/);
});
