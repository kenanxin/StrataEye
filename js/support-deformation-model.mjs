export const DISPLAY_SCALES = Object.freeze([10,30,50]);
export function sampleBeamProfile(frame,samplesPerElement=4){
  const p=frame?.beam_profile;
  if(!p||!Array.isArray(p.node_positions_m)||p.node_positions_m.length<2||!Array.isArray(p.displacement_mm)||!Array.isArray(p.rotation_rad)
    ||p.node_positions_m.length!==p.displacement_mm.length||p.rotation_rad.length!==p.displacement_mm.length
    ||![...p.node_positions_m,...p.displacement_mm,...p.rotation_rad].every(Number.isFinite)
    ||!Number.isInteger(samplesPerElement)||samplesPerElement<1||samplesPerElement>16)throw new TypeError('Invalid beam profile');
  const points=[];
  for(let i=0;i<p.node_positions_m.length-1;i++){
    const x=p.node_positions_m[i],length=p.node_positions_m[i+1]-x;
    if(length<=0)throw new TypeError('Invalid beam profile positions');
    for(let j=0;j<samplesPerElement;j++){
      const t=j/samplesPerElement,t2=t*t,t3=t2*t;
      const w=(1-3*t2+2*t3)*p.displacement_mm[i]+length*(t-2*t2+t3)*p.rotation_rad[i]*1000
        +(3*t2-2*t3)*p.displacement_mm[i+1]+length*(-t2+t3)*p.rotation_rad[i+1]*1000;
      points.push({x_m:x+length*t,displacement_mm:w});
    }
  }
  points.push({x_m:p.node_positions_m.at(-1),displacement_mm:p.displacement_mm.at(-1)});
  return points;
}
export function buildDeformationSnapshot(frame,scale=30){
  if(!DISPLAY_SCALES.includes(scale))throw new TypeError('Unsupported display scale');
  const points=sampleBeamProfile(frame);
  if(!Number.isFinite(frame.support_displacement_mm)||!Number.isFinite(frame.support_force_kn)||!(frame.display_reference_max_mm>0))throw new TypeError('Invalid physical values');
  return {points:points.map(p=>({...p,drop_m:p.displacement_mm/1000*scale})),scale,forceKn:frame.support_force_kn,
    displacementMm:frame.support_displacement_mm,centerDropM:frame.support_displacement_mm/1000*scale,
    colorReferenceMm:frame.display_reference_max_mm,lengthM:points.at(-1).x_m-points[0].x_m};
}
