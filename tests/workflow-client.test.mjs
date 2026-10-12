import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowClient, createWorkflowCoordinator, projectWorkflowClosedLoop } from '../js/workflow-client.mjs';
const run = (id='WF-one',revision=0,status='alert_triggered') => ({workflow_run_id:id,revision,algorithm:{record_id:'REC-1',predicted_class:'较大风险'},demo_state:{eventId:id,status,timeline:[]},events:[]});
const response = (body,status=200) => ({ok:status<400,status,json:async()=>body});
test('action envelope preserves zero revision and command ID across a network retry',async()=>{
  const sent=[]; const client=createWorkflowClient({authFetch:async(url,init)=>{sent.push(JSON.parse(init.body));if(sent.length===1)throw new Error('offline');return response(run('WF-one',1,'disposal_in_progress'));}});
  const actual=await client.act({runId:'WF-one',type:'ACKNOWLEDGE',payload:{},expectedRevision:0});
  assert.equal(sent[0].expected_revision,0);assert.match(sent[0].command_id,/^[A-Za-z0-9_-]+$/);assert.equal(sent[0].command_id,sent[1].command_id);assert.equal(actual.demo_state.status,'disposal_in_progress');
});
test('typed HTTP errors never retry a human conflict',async()=>{
  let calls=0;const client=createWorkflowClient({authFetch:async()=>{calls++;return response({error:'WORKFLOW_CONFLICT'},409);}});
  await assert.rejects(client.act({runId:'WF-one',type:'APPROVE',payload:{opinion:'yes'},expectedRevision:0}),e=>e.status===409&&e.code==='WORKFLOW_CONFLICT');assert.equal(calls,1);
});
test('shared selection publishes authoritative state, refreshes conflicts and reset retains old evidence',async()=>{
  let current=run();const seen=[];const cache=new Map();const coordinator=createWorkflowCoordinator({client:{list:async()=>[current],get:async()=>current,start:async()=>run('WF-two'),act:async()=>{current=run('WF-one',1);throw Object.assign(new Error('conflict'),{status:409});}},storage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)},pollInterval:0});
  coordinator.subscribe(s=>seen.push(s.run?.revision));await coordinator.refresh();assert.equal(coordinator.getSnapshot().run.workflow_run_id,'WF-one');
  await assert.rejects(coordinator.dispatch({type:'ACKNOWLEDGE',payload:{}}));assert.equal(coordinator.getSnapshot().run.revision,1);
  const previous=coordinator.getSnapshot().run;await coordinator.reset({recordId:'REC-1'});assert.equal(previous.workflow_run_id,'WF-one');assert.equal(coordinator.getSnapshot().run.workflow_run_id,'WF-two');assert.ok(seen.includes(1));assert.deepEqual([...cache.values()],['WF-two']);coordinator.destroy();
});
test('late refresh cannot overwrite a mutation or new selection',async()=>{
  let resolveRead;const coordinator=createWorkflowCoordinator({client:{list:async()=>[run()],get:()=>new Promise(resolve=>resolveRead=resolve),start:async()=>run('WF-two'),act:async()=>run('WF-one',2)},pollInterval:0,storage:null});
  await coordinator.refresh();const pending=coordinator.refresh();await coordinator.start({recordId:'REC-2'});resolveRead(run('WF-one',1));await pending;assert.equal(coordinator.getSnapshot().run.workflow_run_id,'WF-two');coordinator.destroy();
});
test('closed-loop projection shares event/revision and low risk keeps ready/finish',()=>{
  const actual=projectWorkflowClosedLoop(run('WF-one',4,'pending_review'));assert.equal(actual.eventId,'WF-one');assert.equal(actual.progress,58);assert.match(actual.source,/保存/);
  const low=projectWorkflowClosedLoop({...run(),phase:'finish',algorithm:{record_id:'REC-1',predicted_class:'低风险'},demo_state:{status:'ready'}});assert.equal(low.progress,0);assert.equal(low.canSign,false);
});
test('historical idempotent action snapshot never downgrades selected revision',async()=>{
  const coordinator=createWorkflowCoordinator({client:{list:async()=>[run('WF-one',4)],get:async()=>run('WF-one',5),act:async()=>run('WF-one',1)},pollInterval:0,storage:null});
  await coordinator.refresh();await coordinator.dispatch({type:'ACKNOWLEDGE'});assert.equal(coordinator.getSnapshot().run.revision,5);coordinator.destroy();
});
test('one pending mutation guard prevents concurrent human submissions',async()=>{
  let resolve,calls=0;const coordinator=createWorkflowCoordinator({client:{list:async()=>[run()],act:()=>{calls++;return new Promise(r=>resolve=r);}},pollInterval:0,storage:null});await coordinator.refresh();const saving=coordinator.dispatch({type:'ACKNOWLEDGE'});await assert.rejects(coordinator.dispatch({type:'ACKNOWLEDGE'}),/正在保存/);assert.equal(calls,1);assert.equal(coordinator.getSnapshot().pending,true);resolve(run('WF-one',1));await saving;assert.equal(coordinator.getSnapshot().pending,false);coordinator.destroy();
});
