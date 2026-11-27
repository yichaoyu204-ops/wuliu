'use strict';
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.NOTE_PLAYWRIGHT||'playwright-core');
const zip=require(path.join(__dirname,'../b2b/vendor/jszip.min.js'));
function cjkPdf(){
  // CID font with predefined CMap and no ToUnicode; extraction needs the embedded CMaps.
  const txt='虚构货物已入仓', hex=Array.from(txt,c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const content='BT /F1 20 Tf 30 200 Td <'+hex+'> Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 0 >> /DW 1000 /FontDescriptor << /Type /FontDescriptor /FontName /STSong-Light /Ascent 752 /Descent -271 /CapHeight 737 /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /StemV 58 >> >>'];
  let out='%PDF-1.4\n';const starts=[];
  objects.forEach((v,i)=>{starts.push(out.length);out+=(i+1)+' 0 obj\n'+v+'\nendobj\n';});
  const x=out.length;out+='xref\n0 7\n0000000000 65535 f \n'+starts.map(i=>String(i).padStart(10,'0')+' 00000 n \n').join('')+
    'trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n'+x+'\n%%EOF';
  return Buffer.from(out,'ascii');
}
async function main(){
  // Give each app its own directory with only its standalone HTML.
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-standalone-'));
  const own=filename=>{
    const dir=path.join(temp,filename.slice(0,-5));
    fs.mkdirSync(dir);const target=path.join(dir,filename);
    fs.copyFileSync(path.join(__dirname,filename),target);return pathToFileURL(target).href;
  };
  const browser=await chromium.launch({headless:true,...(process.env.NOTE_CHROMIUM?{executablePath:process.env.NOTE_CHROMIUM}:{})});
  try{
    const ctx=await browser.newContext({offline:true});
    const page=await ctx.newPage(),outgoing=[],errors=[];
    page.setDefaultTimeout(8500);
    page.on('request',r=>{if(/^https?:/.test(r.url()))outgoing.push(r.url());});
    page.on('pageerror',e=>errors.push(e.message));
    if(process.env.NOTE_DEBUG)page.on('console',m=>{if(['warning','error','log'].includes(m.type()))console.log(m.text().slice(0,420));});
    await page.goto(own('Dispatch-Notes.html'));
    await page.locator('#raw').fill('嗯，虚构单 OFF-27 已入仓。2 箱，待确认。');
    assert.match(await page.locator('#card').getAttribute('aria-label'),/OFF-27/);
    assert.ok(await page.locator('#mic').isDisabled());
    await page.selectOption('#lang','en');assert.match(await page.locator('#raw').inputValue(),/2 箱/);
    await page.locator('#export').click();await page.locator('#image-link').waitFor({state:'visible'});
    const png=await page.locator('#image-link').evaluate(async a=>{const b=await fetch(a.href).then(r=>r.blob());const im=await createImageBitmap(b);return [b.type,im.width,im.height];});
    assert.equal(png[0],'image/png');assert.equal(png[1],1080);console.log('C3 isolated HTML: typed note, locale, offline fallback and decodable real PNG '+png.slice(1).join('x'));
    const freight=own('Freight-Review.html');
    await page.goto(freight);
    await page.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');
    await page.locator('#demo').click();
    await page.locator('#summary').filter({hasText:'8 条核对结果'}).waitFor();
    await page.locator('#table tr').filter({hasText:'DEMO-002'}).getByRole('button').click();
    await page.locator('#decision').selectOption('确认差异');await page.locator('#note').fill('离线合成验证');
    await page.getByRole('button',{name:'保存处理记录'}).click();
    await page.locator('#export').click();await page.locator('#offline-save').waitFor();
    const xlsx=Buffer.from(await page.locator('#offline-save').evaluate(async a=>[...new Uint8Array(await fetch(a.href).then(r=>r.arrayBuffer()))]));
    const book=await zip.loadAsync(xlsx),sheet=await book.file('xl/worksheets/sheet1.xml').async('string');
    assert.match(sheet,/离线合成验证/);assert.match(sheet,/<v>6<\/v>/);
    for(let i=1;i<=3;i++)assert.ok(book.file('xl/worksheets/sheet'+i+'.xml'));
    console.log('B2B isolated HTML: two embedded CSV samples -> 8 results -> review note and amount -> real 3-sheet XLSX.');
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');
    const pair=id=>path.join(__dirname,'../benchmarks/pairs',id,id);
    await page.locator('#baseline').setInputFiles(pair('SIM03')+'_baseline.xlsx');
    await page.locator('#sources .document').first().waitFor();
    await page.locator('#invoice').setInputFiles(pair('SIM03')+'_invoice.pdf');
    await page.waitForFunction(()=>document.querySelectorAll('#sources .document').length===2);
    await page.locator('#sources .document').filter({hasText:'SIM03_invoice.pdf'}).getByRole('button',{name:'原件与明细'}).click();
    const txt=await page.locator('#dialogbody').innerText();const evidence=await page.locator('#pagetext').textContent();
    assert.match(evidence,/DEMO-FWD/);assert.match(evidence,/0017/);assert.doesNotMatch(txt,/解析未完成/);
    assert.ok(await page.locator('#dialogbody button[data-action="edit"]').count()>=1);
    console.log('B2B isolated HTML: imported uploaded XLSX and PDF with text layer/position evidence. Embedded CMaps: '+await page.evaluate(()=>Object.keys(JSON.parse(document.querySelector('#offline-resources').textContent).cmaps).length)+'.');
    const map=await page.evaluate(async()=>{const data=await new offlineFreight.BinaryFactory().fetch({kind:'cMapUrl',filename:'UniGB-UCS2-H.bcmap'});return data.length;});assert.ok(map>500);
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');
    await page.locator('#invoice').setInputFiles({name:'synthetic-cjk.pdf',mimeType:'application/pdf',buffer:cjkPdf()});
    await page.locator('#sources .document').getByRole('button',{name:'原件与明细'}).click();
    assert.match(await page.locator('#pagetext').textContent(),/虚构货物已入仓/);
    console.log('B2B actual CJK PDF without ToUnicode: extracted the full original Chinese string offline.');
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.offlineReady==='true');
    await page.getByRole('link',{name:'English'}).click();await page.waitForFunction(()=>document.documentElement.lang==='en'&&document.documentElement.dataset.offlineReady==='true');
    await page.locator('#demo').click();await page.waitForFunction(()=>document.querySelectorAll('#table tbody tr').length===8);
    await page.getByRole('button',{name:'Export Excel'}).click();await page.getByRole('link',{name:'Save this workbook manually'}).waitFor();
    const en=await zip.loadAsync(Buffer.from(await page.locator('#offline-save').evaluate(async a=>[...new Uint8Array(await fetch(a.href).then(r=>r.arrayBuffer()))])));
    assert.match(await en.file('xl/workbook.xml').async('string'),/Field evidence/);
    console.log('English switch, English UI controls and English workbook verified, from the same file.');
    assert.deepEqual(outgoing,[]);assert.deepEqual(errors,[]);console.log('PASS: no external HTTP requests or page errors. Chinese CMap bytes available: '+map+'.');
  }finally{await browser.close();for(const dir of fs.readdirSync(temp)){const d=path.join(temp,dir);for(const f of fs.readdirSync(d))fs.unlinkSync(path.join(d,f));fs.rmdirSync(d);}fs.rmdirSync(temp);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
