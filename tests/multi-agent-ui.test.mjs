import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { setupMultiAgentWorkflow } from '../js/multi-agent-workflow-ui.mjs';
import { createWorkflowCoordinator } from '../js/workflow-client.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../js/multi-agent-workflow-ui.mjs', import.meta.url), 'utf8');

test('expert portal contains an explicit server-backed six-agent workflow panel', () => {
  ['multiAgentWorkbench', 'runMultiAgentWorkflow', 'multiAgentRail', 'multiAgentDetail', 'multiAgentSource', 'multiAgentBoundary']
    .forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  ['A1', 'A2', 'A3', 'A5', 'A4', 'A6'].forEach((id) => assert.match(html, new RegExp(`>${id}<`)));
  assert.match(html, /算法预警 × 多智能体协同研判/);
  assert.match(html, /等待人工确认/);
});

test('workflow UI calls the authenticated server API and exposes failure honestly', () => {
  assert.match(main, /setupMultiAgentWorkflow/);
  assert.match(ui, /coordinator\.refresh/);
  assert.match(ui, /智能体服务不可用/);
  assert.doesNotMatch(ui, /setInterval\([^)]*success/);
});

class Node {
  constructor(agentId){this.dataset={agentId};this.textContent='';this.innerHTML='';this.children=[];this.listeners=new Map();this.selected=false;this.classList={add:()=>this.selected=true,remove:()=>this.selected=false,toggle:(_,v)=>this.selected=v};}
  querySelector(){return this.em ||= new Node();}
  querySelectorAll(){return this.children;}
  addEventListener(type,fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  async click(){for(const fn of this.listeners.get('click')||[])await fn();}
}
function uiFixture(){const elements=new Map(['multiAgentRail','multiAgentDetail','multiAgentSource','multiAgentBoundary','runMultiAgentWorkflow'].map(id=>[id,new Node()]));elements.get('multiAgentRail').children=['A1','A3','A5'].map(id=>new Node(id));globalThis.document={getElementById:id=>elements.get(id)||null};return elements;}
const uiRun=(revision=0)=>({workflow_run_id:'WF-one',revision,algorithm:{record_id:'REC-1',model:'xgboost',predicted_class:'较大风险'},demo_state:{status:'alert_triggered'},nodes:['A1','A3','A5'].map(agent_id=>({agent_id,name:agent_id,status:'success',input_evidence:['known'],output_summary:`${agent_id} output`})),plan_versions:[{version:1,advice:{source:'rule',fallback_reason:'provider unavailable'}}],safety:{statement:'human approval required'}});
test('real expert widget refreshes shared saved run without starting and retains selected node',async()=>{
  const elements=uiFixture();let reads=0,starts=0;const coordinator=createWorkflowCoordinator({client:{list:async()=>[uiRun()],get:async()=>uiRun(++reads),start:async()=>{starts++;return uiRun();}},storage:null,pollInterval:0});await coordinator.refresh();
  const widget=setupMultiAgentWorkflow({coordinator,getCurrentRole:()=> 'expert'});await elements.get('multiAgentRail').children[1].click();assert.match(elements.get('multiAgentDetail').innerHTML,/A3 output/);await elements.get('runMultiAgentWorkflow').click();assert.equal(starts,0);assert.equal(reads,1);assert.match(elements.get('multiAgentDetail').innerHTML,/A3 output/);assert.match(elements.get('multiAgentSource').textContent,/r1/);assert.match(elements.get('multiAgentBoundary').textContent,/provider unavailable/);widget.destroy();assert.equal(elements.get('runMultiAgentWorkflow').listeners.get('click').size,0);coordinator.destroy();delete globalThis.document;
});
test('repeated setup removes listeners and empty selection clears old rail/details',async()=>{
  const elements=uiFixture();let resolve;const coordinator=createWorkflowCoordinator({client:{list:async()=>[uiRun()],get:()=>new Promise(r=>resolve=r)},storage:null,pollInterval:0});await coordinator.refresh();setupMultiAgentWorkflow({coordinator});const widget=setupMultiAgentWorkflow({coordinator});assert.equal(elements.get('runMultiAgentWorkflow').listeners.get('click').size,1);const selecting=coordinator.select('WF-other');assert.match(elements.get('multiAgentDetail').innerHTML,/读取|暂无/);assert.equal(elements.get('multiAgentRail').children[0].dataset.status,'waiting');resolve(uiRun());await selecting;widget.destroy();coordinator.destroy();delete globalThis.document;
});

test('workflow panel has responsive non-overlapping grid rules', () => {
  assert.match(css, /\.multi-agent-workbench\s*\{/);
  assert.match(css, /\.multi-agent-rail\s*\{/);
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
});
test('main coordinator owns saved closed-loop authority and legacy actions reuse material validation forms',()=>{
  assert.match(main,/function renderStageClosedLoop[^\{]*\{\s*if \(hasWorkflowAuthority\(\)\) return/);
  assert.match(main,/function refreshClosedLoop[^\{]*\{\s*if \(hasWorkflowAuthority\(\)\)/);
  assert.match(main,/workflowCoordinator\.subscribe\(renderSavedClosedLoop\)/);
  assert.match(main,/warningController\?\.openCurrent\(\)/);
  assert.match(main,/warningController\?\.resetCurrent\(\)/);
  assert.match(main,/deactivateReplayDisplay\(\);[\s\S]*?\/api\/roof-risk\/select/);
  assert.doesNotMatch(html,/id="enterpriseLoopProgress">83%/);
});
