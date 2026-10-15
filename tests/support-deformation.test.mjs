import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sampleBeamProfile, buildDeformationSnapshot } from '../js/support-deformation-model.mjs';
import * as THREE from 'three';
import { createSupportDeformationOverlay } from '../js/scene/support-deformation.mjs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createSupportSimulationService}=require('../server/support-simulation-service.js');
const shape=JSON.parse(await readFile(new URL('../data/support-deformation-v1.json',import.meta.url),'utf8'));
const core=JSON.parse(await readFile(new URL('../data/support-simulation-v1.json',import.meta.url),'utf8'));
function frame(caseIndex,step){return {...core.cases[caseIndex].frames[step],beam_profile:{...shape.cases[caseIndex].frames[step],node_positions_m:shape.node_positions_m},display_reference_max_mm:shape.display_reference_max_mm};}
test('all63 FEM profiles retain simple supports and same center response',()=>{
  for(let c=0;c<3;c++)for(let s=0;s<21;s++){
    const f=frame(c,s),points=sampleBeamProfile(f,4);
    assert.equal(points.length,97);assert.ok(Math.abs(points[0].displacement_mm)<1e-8);assert.ok(Math.abs(points.at(-1).displacement_mm)<1e-8);
    assert.ok(Math.abs(points[48].displacement_mm-f.support_displacement_mm)<1e-8);
    assert.ok(points.every(p=>Number.isFinite(p.displacement_mm)));
  }
});
test('display gain changes geometry only; stiffness comparison keeps a common scale',()=>{
  const f=frame(1,20),a=buildDeformationSnapshot(f,10),b=buildDeformationSnapshot(f,50);
  assert.equal(a.forceKn,b.forceKn);assert.equal(a.displacementMm,b.displacementMm);
  assert.ok(Math.abs(b.centerDropM/a.centerDropM-5)<1e-10);
  assert.equal(a.colorReferenceMm,buildDeformationSnapshot(frame(2,20),10).colorReferenceMm);
  assert.ok(buildDeformationSnapshot(frame(1,20),30).centerDropM>buildDeformationSnapshot(frame(2,20),30).centerDropM);
});
test('invalid profiles or unsupported magnification fail instead of rendering fiction',()=>{
  assert.throws(()=>sampleBeamProfile({beam_profile:{node_positions_m:[0,1],displacement_mm:[0],rotation_rad:[0,0]}}),/profile/);
  assert.throws(()=>buildDeformationSnapshot(frame(0,0),1000),/scale/);
});
test('overlay updates one isolated geometry and releases resources idempotently',()=>{
  const scene=new THREE.Scene(),device=new THREE.Group();device.position.set(1,2,3);scene.add(device);
  const original=device.position.toArray(),overlay=createSupportDeformationOverlay({scene,anchor:new THREE.Vector3(1,4,3)});
  overlay.update(frame(1,0));const geometry=overlay.root.children[0].geometry;let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  const before=geometry.attributes.position.array.slice();
  for(let i=0;i<10;i++)overlay.update(frame(1,20));
  assert.equal(overlay.root.children[0].geometry,geometry);assert.notDeepEqual(geometry.attributes.position.array,before);
  assert.deepEqual(device.position.toArray(),original);assert.equal(scene.children.length,2);
  overlay.dispose();overlay.dispose();assert.equal(scene.children.length,1);assert.equal(disposed,1);
});
test('RAG receives selected and same-load reference evidence, with actual domain citations',async()=>{
  let input;
  const service=createSupportSimulationService({adviceService:{async generateWorkflowAdvice(x){input=x;return {source:'deepseek',summary:'依据刚度与位移联合复核',recommendations:['核对现场条件'],evidence_ids:['knowledge:mechanics:beam']};}}});
  const result=await service.explain({caseId:'soft-support',step:20});
  assert.ok(input.feature_evidence.some(x=>x.key==='reference_displacement_mm'));
  assert.equal(result.comparison.load_kn_per_m,result.frame.load_kn_per_m);
  assert.ok(result.frame.support_displacement_mm>result.comparison.support_displacement_mm);
  assert.ok(result.retrieval.chunks.some(x=>x.domain==='结构力学'));
  assert.ok(result.retrieval.chunks.some(x=>x.domain==='矿压监测研究'));
  assert.equal(result.business_event_created,false);
});
