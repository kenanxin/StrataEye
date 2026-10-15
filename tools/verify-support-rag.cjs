'use strict';
const fs=require('node:fs');const path=require('node:path');
const {createExpertAdviceService}=require('../server/expert-advice-service.js');
const {createSupportSimulationService}=require('../server/support-simulation-service.js');
async function main(){
  if(!process.argv.includes('--allow-generation'))throw new Error('Explicit generation flag required');
  const adviceService=createExpertAdviceService({cacheDirectory:path.resolve('.runtime/expert-advice-cache')});
  const service=createSupportSimulationService({adviceService});const results=[];
  for(const caseId of ['soft-support','stiff-support']){
    const start=performance.now(),r=await service.explain({caseId,step:20});
    const cited=new Set(r.advice.evidence_ids);
    const result={caseId,elapsedMs:Math.round(performance.now()-start),source:r.advice.source,delivery:r.advice.delivery,generatedAt:r.advice.generated_at,
      summary:r.advice.summary,recommendations:r.advice.recommendations,evidenceIds:r.advice.evidence_ids,
      citedDomains:[...new Set(r.retrieval.chunks.filter(c=>cited.has(c.id)).map(c=>c.domain))],fallbackReason:r.advice.fallback_reason,businessEventCreated:r.business_event_created};
    results.push(result);
    console.log(JSON.stringify({caseId,source:result.source,delivery:result.delivery,elapsedMs:result.elapsedMs,citedDomains:result.citedDomains}));
  }
  fs.writeFileSync('D:/矿业/outputs/support-deformation-20261015/rag-comparison.json',JSON.stringify(results,null,2));
  if(results.some(r=>r.source!=='deepseek'))process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error('Support RAG verification failed; no credentials logged');process.exitCode=1;});
