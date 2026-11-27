'use strict';
// Browser integration run against the shipped parser and audit entry points.
// BENCH_PLAYWRIGHT and BENCH_CHROMIUM optionally point to an installed runtime.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.BENCH_PLAYWRIGHT || 'playwright-core');
const home=__dirname;
const project=path.resolve(home,'..');
const truth=JSON.parse(fs.readFileSync(path.join(home,'answer-key.json'),'utf8'));
const types={'.mjs':'application/javascript','.js':'application/javascript','.html':'text/html','.bcmap':'application/octet-stream'};
const sortOutcomes=items=>items.map(([key,status,delta])=>key+'|'+status+'|'+(delta===null?'':delta)).sort();
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.BENCH_CHROMIUM?{executablePath:process.env.BENCH_CHROMIUM}:{})});
  let reports=[];
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='https://benchmark.invalid')return route.abort();
      if(url.pathname==='/')return route.fulfill({body:'<!doctype html><html><head><title>Synthetic QA</title></head><body></body></html>',contentType:'text/html'});
      if(!url.pathname.startsWith('/b2b/'))return route.abort();
      const local=path.resolve(project,'.'+url.pathname);
      if(!local.startsWith(path.join(project,'b2b')+path.sep)||!fs.existsSync(local))return route.fulfill({status:404,body:''});
      return route.fulfill({path:local,contentType:types[path.extname(local)]||'application/octet-stream'});
    });
    await page.goto('https://benchmark.invalid/');
    await page.addScriptTag({url:'/b2b/vendor/jszip.min.js'});
    for(const item of truth){
      const data=Object.fromEntries(Object.entries(item.files).map(([side,name])=>[side,{name:path.basename(name),content:fs.readFileSync(path.join(home,name)).toString('base64')}]));
      const outcome=await page.evaluate(async ({data,answers})=>{
        const {importDocument}=await import('/b2b/formats.mjs');
        const {auditDocuments,keys}=await import('/b2b/core.mjs');
        const docs=[],summary={},problems=[];
        let checked=0, referenced=0, pdfPending=0;
        for(const side of ['invoice','baseline']){
          const {name,content}=data[side];
          const bytes=Uint8Array.from(atob(content),c=>c.charCodeAt(0));
          const doc=await importDocument(new File([bytes],name),side);
          const blocked=answers.unreadableSides.includes(side);
          const expected=answers.cells[side];
          summary[side]={format:name.split('.').at(-1),importedRows:doc.rows.length,issues:doc.issues};
          if(blocked){
            if(doc.rows.length||!doc.issues.length)problems.push(side+': unsupported layout should yield a document issue and no candidate');
          }else{
            if(doc.issues.length)problems.push(side+': parser issues: '+doc.issues.join(' / '));
            if(doc.rows.length!==expected.length)problems.push(side+': incorrect row count');
            for(const [i,row] of doc.rows.entries()){
              for(const [j,k] of keys.entries()){
                const f=row.fields[k],v=expected[i]?.[j];
                if(f.value!==v)problems.push(side+':'+i+':'+k+' value mismatch: '+f.value+' vs '+v);
                else checked++;
                if(!f.source_ref||!row.sourceRef||!doc.sha)problems.push(side+':'+i+':'+k+' missing source');
                else referenced++;
                if(name.endsWith('.pdf')&&f.value){
                  if(f.confidence!=='待人工')problems.push(side+':'+i+':'+k+' expected candidate');
                  else pdfPending++;
                }
              }
            }
          }
          docs.push(doc);
        }
        const raw=auditDocuments(docs),signals=raw.map(r=>[r.status,r.delta]);
        // After every extracted field equals its independently authored fixture,
        // exercise the post-confirmation path. This simulates a reviewer and does
        // not constitute a real human confirmation, invoice or time measurement.
        const checkedDocs=structuredClone(docs);
        const after=checkedDocs.flatMap(doc=>doc.rows);
        if(!problems.length){
          for(const row of after)for(const f of Object.values(row.fields))
            if(f.confidence==='待人工')f.confidence='人工转录已核';
        }
        const audited=auditDocuments(checkedDocs);
        const outputRows=audited.map(r=>{
          const source=r.invoice||r.bases[0];
          const number=after.filter(v=>v.side===source.side).findIndex(v=>v.id===source.id)+1;
          return [source.side+':'+number,r.status,r.delta];
        });
        return {summary,checked,referenced,pdfPending,raw:signals,after:outputRows,problems};
      },{data,answers:item});
      const invalid=item.unreadableSides.length>0;
      const assertions=[...outcome.problems];
      const expected=item.expectedAfterSourceCheck.map(([status,delta],idx)=>
        [(idx<item.cells.invoice.length?'invoice:'+(idx+1):'baseline:'+(idx-item.cells.invoice.length+1)),status,delta]);
      if(!invalid&&JSON.stringify(sortOutcomes(outcome.after))!==JSON.stringify(sortOutcomes(expected)))assertions.push('post-review source rows/statuses/deltas differ from answer key');
      if(invalid&&outcome.raw.some(([,amount])=>amount!==null))assertions.push('partial document produced a monetary difference');
      if(invalid&&(!outcome.raw.length||outcome.raw.some(([status])=>status!=='incomplete')))assertions.push('an unreadable counterparty document did not route every unilateral entry to incomplete');
      if(item.requiresPdfConfirmation&&outcome.raw.some(([,amount])=>amount!==null))assertions.push('PDF generated a financial outcome before independent comparison');
      reports.push({id:item.id,expected:item.expectedAfterSourceCheck,layoutReview:invalid,passed:assertions.length===0,...outcome,assertions});
    }
  }finally{await browser.close()}
  const totals={pairs:reports.length,passed:reports.filter(r=>r.passed).length,
    normalLayouts:reports.filter(r=>!r.layoutReview).length,documentLevelReview:reports.filter(r=>r.layoutReview).length,
    fieldsChecked:reports.reduce((s,r)=>s+r.checked,0),sourceReferencesPresent:reports.reduce((s,r)=>s+r.referenced,0),
    pdfFieldsMarkedForReview:reports.reduce((s,r)=>s+r.pdfPending,0),
    formats:reports.flatMap(r=>Object.values(r.summary)).reduce((f,d)=>(f[d.format]=(f[d.format]||0)+1,f),{})};
  fs.writeFileSync(path.join(home,'regression-results.json'),JSON.stringify({evidence:'Synthetic fixtures only. Local Chromium HTTPS interception; no live hosting or real person.',totals,cases:reports},null,2)+'\n');
  console.log(JSON.stringify(totals));
  for(const r of reports.filter(r=>!r.passed))console.error(r.id,r.assertions,r.raw,r.after);
  if(totals.passed!==totals.pairs)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
