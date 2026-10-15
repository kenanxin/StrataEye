import * as THREE from 'three';
import { buildDeformationSnapshot } from '../support-deformation-model.mjs';

// Independent, removable FEM study layer; the existing mine mesh stays unchanged.
export function createSupportDeformationOverlay({scene,anchor}){
  const root=new THREE.Group();root.name='support-mechanics-study';root.position.copy(anchor);root.rotation.y=Math.PI/2;
  const material=color=>new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:.9});
  const beamMaterial=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:.88});
  const beamGeometry=new THREE.BufferGeometry(),beam=new THREE.Mesh(beamGeometry,beamMaterial);beam.name='computed-beam-field';root.add(beam);
  const ghost=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4,0,0),new THREE.Vector3(4,0,0)]),new THREE.LineDashedMaterial({color:0xc4d4de,dashSize:.13,gapSize:.09,depthTest:false,transparent:true,opacity:.9}));ghost.computeLineDistances();root.add(ghost);
  const footing=new THREE.Mesh(new THREE.BoxGeometry(.9,.18,.72),material(0x4f647b));footing.position.set(0,-2.35,0);root.add(footing);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,1,16),material(0x32c7d9));shaft.name='idealized-elastic-support';root.add(shaft);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(.9,.12,.72),material(0x32c7d9));root.add(cap);
  const springPoints=[];
  for(let i=0;i<=40;i++){const t=i/40;springPoints.push(new THREE.Vector3(Math.cos(t*Math.PI*12)*.18,-2.2+t*1.9,Math.sin(t*Math.PI*12)*.18));}
  const springGeometry=new THREE.BufferGeometry().setFromPoints(springPoints);
  const spring=new THREE.Line(springGeometry,new THREE.LineBasicMaterial({color:0x8ee4eb,depthTest:false}));root.add(spring);
  for(const x of [-4,4]){
    const tip=new THREE.Mesh(new THREE.ConeGeometry(.18,.3,3),material(0x8296b1));tip.position.set(x,-.3,0);root.add(tip);
  }
  const loads=[];
  for(let i=0;i<7;i++){
    const arrow=new THREE.ArrowHelper(new THREE.Vector3(0,-1,0),new THREE.Vector3(-3.6+i*1.2,1.25,0),.8,0xf2b84b,.16,.1);root.add(arrow);loads.push(arrow);
  }
  const reaction=new THREE.ArrowHelper(new THREE.Vector3(0,1,0),new THREE.Vector3(.7,-1.5,0),.7,0x32c7d9,.18,.12);root.add(reaction);
  root.traverse(o=>{o.renderOrder=60;if(o.material)o.material.depthTest=false;});scene.add(root);
  const low=new THREE.Color(0x4c82ad),mid=new THREE.Color(0x32c7d9),high=new THREE.Color(0xf2b84b);
  let disposed=false,pointCount=0;
  function update(frame,scale=30){
    if(disposed)throw new Error('Study layer disposed');
    const snapshot=buildDeformationSnapshot(frame,scale),n=snapshot.points.length;
    if(pointCount!==n){
      beamGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(n*12),3));
      beamGeometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(n*12),3));
      const indices=[];
      for(let i=0;i<n-1;i++)for(let side=0;side<4;side++){
        const a=i*4+side,b=i*4+(side+1)%4,c=(i+1)*4+side,d=(i+1)*4+(side+1)%4;indices.push(a,b,c,b,d,c);
      }
      beamGeometry.setIndex(indices);pointCount=n;
    }
    const positions=beamGeometry.attributes.position,colors=beamGeometry.attributes.color;
    snapshot.points.forEach((p,i)=>{
      const amount=THREE.MathUtils.clamp(Math.abs(p.displacement_mm)/snapshot.colorReferenceMm,0,1);
      const color=amount<.5?low.clone().lerp(mid,amount*2):mid.clone().lerp(high,(amount-.5)*2);
      [[-.12,-.32],[-.12,.32],[.12,.32],[.12,-.32]].forEach(([dy,z],j)=>{
        positions.setXYZ(i*4+j,p.x_m-snapshot.lengthM/2,-p.drop_m+dy,z);colors.setXYZ(i*4+j,color.r,color.g,color.b);
      });
    });
    positions.needsUpdate=true;colors.needsUpdate=true;beamGeometry.computeBoundingSphere();
    const top=-snapshot.centerDropM-.18,bottom=-2.25,height=top-bottom;
    shaft.scale.y=height;shaft.position.y=(top+bottom)/2;cap.position.y=top;
    spring.scale.y=height/1.9;spring.position.y=bottom+2.2*spring.scale.y;
    loads.forEach(arrow=>{
      const length=.3+frame.load_kn_per_m/100*.8;
      const point=snapshot.points.reduce((a,b)=>Math.abs(a.x_m-snapshot.lengthM/2-arrow.position.x)<Math.abs(b.x_m-snapshot.lengthM/2-arrow.position.x)?a:b);
      arrow.position.y=length+.16-point.drop_m;arrow.setLength(length,.16,.1);
    });
    reaction.position.y=top-.9;reaction.setLength(.3+Math.min(snapshot.forceKn/800,1)*.5,.18,.12);
    root.userData={...root.userData,scale,step:frame.step,forceKn:snapshot.forceKn,displacementMm:snapshot.displacementMm};
    return snapshot;
  }
  function dispose(){
    if(disposed)return;disposed=true;scene.remove(root);
    const geometries=new Set(),materials=new Set();
    root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());root.clear();
  }
  return {root,update,dispose};
}
