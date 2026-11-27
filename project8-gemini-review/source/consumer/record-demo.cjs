'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.NOTE_PLAYWRIGHT||'playwright-core');
(async()=>{
  const dir=path.join(__dirname,'demo');
  fs.mkdirSync(dir,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.NOTE_CHROMIUM?{executablePath:process.env.NOTE_CHROMIUM}:{})});
  try {
    const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,recordVideo:{dir,size:{width:390,height:844}}});
    const p=await ctx.newPage();
    await p.addInitScript(()=>{window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;});
    await p.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
    const pause=ms=>p.waitForTimeout(ms);
    await pause(1800);
    await p.locator('#raw').fill('嗯，虚构演示单 DEMO-08 已入仓，共 2 箱。\n提货时间待确认。');
    await pause(2000);await p.locator('.preview-jump').click();await pause(2700);
    await p.locator('#title').scrollIntoViewIfNeeded();await p.locator('#title').fill('样品入仓通知');await pause(1300);
    await p.locator('#export').click();await pause(2000);
    await p.locator('.preview-jump').click();await pause(2400);
    const recording=p.video();
    await ctx.close();
    const generated=await recording.path();
    const target=path.join(dir,'mobile-demo.webm');
    await fs.promises.copyFile(generated,target);
    if(generated!==target)await fs.promises.unlink(generated);
    console.log('Saved recorded browser flow, '+fs.statSync(target).size+' bytes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
