'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/欣/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
async function main(){
  const output=path.resolve('D:/矿业/outputs/support-deformation-20261015');fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false});
  const context=await browser.newContext({viewport:{width:1920,height:1080}});const page=await context.newPage();page.setDefaultTimeout(90_000);
  const report={errors:[],failed:[],snapshots:[],businessWrites:0,externalCalls:0};
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!(r.status()===401&&new URL(r.url()).pathname==='/api/auth/session'))report.failed.push({path:new URL(r.url()).pathname,status:r.status()});});
  async function snapshot(name){
    await page.waitForTimeout(1000);
    const state=await page.locator('#threeContainer').evaluate(el=>({...el.dataset}));
    await page.screenshot({path:path.join(output,`${name}.png`)});report.snapshots.push({name,...state});return state;
  }
  async function stable(){let prev='',count=0;for(let i=0;i<35;i++){const value=await page.locator('#threeContainer').getAttribute('data-camera-position');if(value===prev)count++;else count=0;if(count>=4)return value;prev=value;await page.waitForTimeout(200);}throw new Error('Camera did not settle');}
  try{
    await page.goto('http://127.0.0.1:8162/login');await page.locator('#username').fill('enterprise_operator');await page.locator('#password').fill(process.env.LOCAL_QA_PASSWORD);
    await Promise.all([page.waitForURL(u=>u.searchParams.get('portal')==='enterprise'),page.locator('#loginSubmit').click()]);
    await page.waitForFunction(()=>Number(document.querySelector('#threeContainer')?.dataset.meshes)>0&&document.querySelector('#supportCase')?.disabled===false);
    await page.locator('#supportCase').selectOption('soft-support');await page.locator('#supportStep').focus();await page.locator('#supportStep').press('Home');await page.locator('#supportFocus').click();
    await stable();await snapshot('01-soft-step0');
    await page.locator('#sceneSupportStep').focus();await page.locator('#sceneSupportStep').press('End');await stable();const soft=await snapshot('02-soft-step20');
    await page.locator('#sceneSupportCase').selectOption('stiff-support');const stiff=await snapshot('03-stiff-step20');
    assert.ok(Number(soft.supportSimulationDrop)>Number(stiff.supportSimulationDrop));assert.equal(soft.cameraPosition,stiff.cameraPosition);
    const force=await page.locator('#sceneSupportForce').innerText();await page.locator('#sceneSupportScale').selectOption('50');const scaled=await snapshot('04-scale50');assert.equal(await page.locator('#sceneSupportForce').innerText(),force);
    assert.ok(Math.abs(Number(scaled.supportSimulationDrop)/Number(stiff.supportSimulationDrop)-50/30)<1e-6);
    await page.locator('#sceneSupportPlay').click();await page.waitForTimeout(3300);await page.locator('#sceneSupportPlay').click();assert.ok(Number(await page.locator('#sceneSupportStep').inputValue())>=2);
    await page.locator('#sceneSupportClose').click();assert.equal(await page.locator('#supportScenePanel').isVisible(),false);assert.equal(await page.locator('#threeContainer').getAttribute('data-support-simulation-step'),null);
    await snapshot('05-cleared');
    for(let i=0;i<3;i++){await page.locator('#supportFocus').click();await page.locator('#sceneSupportClose').click();}
    assert.equal(await page.locator('.support-simulation-scene-note').count(),0);
    await page.setViewportSize({width:1280,height:900});await page.locator('#supportFocus').click();await stable();await snapshot('06-1280-study');
    await page.setViewportSize({width:900,height:1000});await stable();await snapshot('07-900-study');
    assert.ok((await page.locator('#threeContainer').boundingBox()).width>850);
    if(process.argv.includes('--with-advice')){
      await page.setViewportSize({width:1920,height:1080});await page.locator('#sceneSupportClose').click();
      await page.locator('#supportCase').selectOption('soft-support');await page.locator('#supportStep').focus();await page.locator('#supportStep').press('End');
      const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/roof-risk/support-simulation/explain')&&r.request().method()==='POST',{timeout:110_000});
      await page.locator('#supportExplain').click();const response=await responsePromise;const result=await response.json();
      assert.equal(result.advice.source,'deepseek');assert.equal(result.business_event_created,false);
      const cited=new Set(result.advice.evidence_ids);
      const citedDomains=[...new Set(result.retrieval.chunks.filter(c=>cited.has(c.id)).map(c=>c.domain))];
      report.advice={source:result.advice.source,delivery:result.advice.delivery,generatedAt:result.advice.generated_at,citedDomains,businessEventCreated:result.business_event_created};
      if(result.advice.delivery!=='cache')report.externalCalls++;
      await page.waitForFunction(()=>document.querySelector('#supportAdviceStatus')?.textContent.includes('DeepSeek'));
      await page.locator('#supportAdvice').scrollIntoViewIfNeeded();await snapshot('08-rag-advice');
      await page.locator('#supportKnowledge').scrollIntoViewIfNeeded();await snapshot('09-rag-domains');
      await page.locator('#supportFocus').click();await stable();await snapshot('10-final-study');
    }
    report.status='passed-pending-visual-review';
  }catch(e){report.status='failed';report.failure=e.message;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw e;}
  finally{fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify(report,null,2));await context.close();await browser.close();}
  console.log(JSON.stringify({status:report.status,errors:report.errors,failed:report.failed,shots:report.snapshots.length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
