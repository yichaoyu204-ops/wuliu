'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.NOTE_PLAYWRIGHT||'playwright-core');
const start=require('./serve.cjs');
const mode=process.argv[2]||'check';
async function main(){
  const s=start(0);
  await new Promise(resolve=>s.once('listening',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.NOTE_CHROMIUM?{executablePath:process.env.NOTE_CHROMIUM}:{})});
    const use=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
    const page=await use.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(mode==='icons'){
      for(const px of [192,512]){
        const base=await page.evaluate(size=>{
          const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');
          g.scale(size/100,size/100);g.fillStyle='#203d32';g.fillRect(0,0,100,100);
          g.fillStyle='#fbf5e8';g.fillRect(21,19,58,62);g.fillStyle='#a7492f';g.fillRect(29,28,10,10);
          g.fillStyle='#203d32';g.fillRect(44,32,25,3);g.fillRect(29,48,40,3);g.fillRect(29,57,34,3);
          return c.toDataURL().split(',')[1];
        },px);
        fs.writeFileSync(path.join(__dirname,'icon-'+px+'.png'),Buffer.from(base,'base64'));
      }
      console.log('Generated 192px and 512px PWA icons.');return;
    }
    await page.addInitScript(()=>{window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;});
    const localFile=process.env.NOTE_FILE_TEST==='1';
    const url=localFile?pathToFileURL(path.join(__dirname,'index.html')).href:'http://127.0.0.1:'+s.address().port+'/';
    await page.goto(url);
    await page.waitForFunction(()=>document.querySelector('#card').width===1080);
    const baseline=await page.evaluate(()=>({
      previewTop:Math.round(document.querySelector('#card').getBoundingClientRect().top),
      jump:!!document.querySelector('a[href="#prev-head"]'),
      cleanup:NoteCore.tidy('嗯，呃，样品 3 箱。',true)
    }));
    console.log('Mobile and copy observation',JSON.stringify(baseline));
    if(mode==='observe')return;
    assert.ok(baseline.jump,'mobile preview shortcut');
    assert.equal(baseline.cleanup,'样品 3 箱。','consecutive isolated fillers');
    assert.ok(await page.locator('#mic').isDisabled());assert.match(await page.locator('#voice-note').innerText(),/键盘听写/);
    for(const w of [320,390,768,1280]){
      await page.setViewportSize({width:w,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+w);
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(__dirname,'mobile-preview.png'),fullPage:true});
    const linked=await use.newPage();await linked.goto(url+'?lang=en');
    assert.equal(await linked.locator('html').getAttribute('lang'),'en');assert.equal(await linked.locator('#lang').inputValue(),'en');
    assert.match(await linked.locator('#raw').inputValue(),/sample order DEMO-27/);await linked.close();
    const sample=await page.locator('#raw').inputValue();
    const split=await page.locator('#card').evaluate(c=>{const ctx=c.getContext('2d');ctx.font='50px "DM Sans","PingFang SC","Microsoft YaHei",Arial,sans-serif';return NoteCore.wrap(ctx,NoteCore.tidy(document.querySelector('#raw').value,true),912);});
    assert.ok(split.every(line=>!/^[。，、；：！？）》]/u.test(line)),JSON.stringify(split));
    console.log('Export sample body lines',JSON.stringify(split));
    await page.locator('#raw').fill('USD 19.95 / 2 cartons / DEMO-002; ETA unconfirmed.');
    await page.selectOption('#lang','en');assert.match(await page.locator('#raw').inputValue(),/19.95/);
    await page.selectOption('#style','journal');
    assert.match(await page.locator('#title').inputValue(),/Journal/);
    assert.match(await page.locator('#card').getAttribute('aria-label'),/DEMO-002/);
    await page.locator('#raw').fill(' ');assert.ok(await page.locator('#export').isDisabled());assert.match(await page.locator('#status').innerText(),/Enter your note/);
    await page.locator('#raw').fill('一'.repeat(601));assert.ok(await page.locator('#export').isDisabled());
    await page.locator('#raw').fill('一'.repeat(600));assert.equal(await page.locator('#export').isEnabled(),true);
    const size=await page.locator('#card').evaluate(c=>[c.width,c.height]);assert.ok(size[1]>1320);
    await page.locator('#raw').fill(sample);await page.selectOption('#lang','zh');
    await page.selectOption('#style','cargo');await page.reload();
    const dlPromise=page.waitForEvent('download');
    await page.locator('#export').click();const dl=await dlPromise;
    const downloadIssue=await dl.failure();
    if(downloadIssue){
      await page.locator('#image-link').waitFor({state:'visible'});
      const bytes=await page.locator('#image-link').evaluate(async a=>Array.from(new Uint8Array(await (await fetch(a.href)).arrayBuffer())));
      fs.writeFileSync(path.join(__dirname,'sample-card.png'),Buffer.from(bytes));
      console.log('Automatic download reported '+downloadIssue+'; saved exact bytes from the visible Open image fallback instead.');
    }else await dl.saveAs(path.join(__dirname,'sample-card.png'));
    const png=fs.readFileSync(path.join(__dirname,'sample-card.png'));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1080);
    assert.ok(await page.locator('#image-link').isVisible());
    if(!localFile){await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);}
    await use.setOffline(true);await page.reload();await page.waitForSelector('#card');
    await page.locator('#raw').fill('离线样品 DEMO-21');assert.ok(await page.locator('#export').isEnabled());
    const offlineDl=page.waitForEvent('download');await page.locator('#export').click();await offlineDl;
    await use.setOffline(false);
    const speech=await browser.newContext();
    const p=await speech.newPage();
    await p.addInitScript(()=>{
      window.SpeechRecognition=class {
        constructor(){window.testSpeech=this;}
        start(){this.onstart();}
        stop(){this.onend();}
        abort(){this.onend();}
      };
    });
    await p.goto(url);await p.locator('#mic').click();assert.ok(await p.locator('#export').isDisabled());
    await p.evaluate(()=>window.testSpeech.onresult({resultIndex:0,results:[Object.assign([{transcript:'测试订单 TEST-42 共 8 箱'}],{isFinal:true})]}));
    await p.locator('#mic').click();assert.equal(await p.locator('#raw').inputValue(),'测试订单 TEST-42 共 8 箱');
    await p.locator('#mic').click();await p.evaluate(()=>{testSpeech.onerror({error:'not-allowed'});testSpeech.onend();});
    assert.match(await p.locator('#status').innerText(),/麦克风权限/);assert.match(await p.locator('#raw').inputValue(),/TEST-42/);
    assert.deepEqual(errors,[]);console.log('PASS widths 320/390/768/1280, language, templates, 600-char bounds, PNG, offline reload and export, fallback and stubbed recognition events; no page errors. Transport: '+(localFile?'local files':'HTTP with installed service worker'));
  }finally{if(browser)await browser.close();await new Promise(resolve=>s.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
