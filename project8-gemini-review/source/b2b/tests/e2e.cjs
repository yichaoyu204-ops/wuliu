const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const {createRequire} = require("node:module");
const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ||
  path.join(os.homedir(),".cache","codex-runtimes","codex-primary-runtime","dependencies","node","node_modules");
const dep = name => {try{return require(name)}catch{return createRequire(path.join(runtime,"_loader.cjs"))(name)}};
const {chromium}=dep("playwright"), {PDFDocument,StandardFonts}=dep("pdf-lib"), ZIP=dep("jszip");
const root=path.resolve(__dirname,"..");
const mime={".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",".html":"text/html",".csv":"text/csv"};
async function pdfFixture(blank=false) {
  const doc=await PDFDocument.create(), page=doc.addPage([700,350]);
  if(!blank){
    const font=await doc.embedFont(StandardFonts.Helvetica);
    for(const [j,row] of [["Supplier","Shipment","Charge","Currency","Unit","Amount"],["Alpha","P-01","Handling","CNY","kg","10.50"]].entries())
      row.forEach((value,i)=>page.drawText(value,{x:25+i*105,y:295-j*24,size:11,font}));
  }
  return Buffer.from(await doc.save());
}
(async()=>{
  const base='https://freight-test.invalid';
  const exe=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  let browser; let passed=0;
  const check=name=>{passed++;console.log("PASS "+name)};
  try{
    browser=await chromium.launch({headless:true,...(fs.existsSync(exe)?{executablePath:exe}:{})});
    const page=await browser.newPage({acceptDownloads:true});
    await page.addInitScript(()=>{
      const create=URL.createObjectURL.bind(URL);
      URL.createObjectURL=blob=>{if(blob.type.includes("spreadsheetml"))window.lastExport=blob;return create(blob)};
    });
    await page.route("**/*",route=>{
      const url=new URL(route.request().url());
      if(url.origin!==base)return route.abort();
      const p=path.join(root,url.pathname==="/"?"/index.html":url.pathname);
      if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile())return route.fulfill({status:404,body:""});
      return route.fulfill({path:p,contentType:mime[path.extname(p)]||"application/octet-stream"});
    });
    const errors=[],external=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("request",r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base+"/"))external.push(r.url())});
    await page.goto(base+"/");await page.getByRole("button",{name:"载入合成示例"}).click();
    await page.locator("#summary").filter({hasText:"8 条核对结果"}).waitFor();
    assert.equal(await page.locator("#table tbody tr").count(),8);check("load two demo files; 8 result rows");
    await page.locator("#table tr").filter({hasText:"DEMO-002"}).getByRole("button").click();
    await page.locator("#decision").selectOption("确认差异");await page.locator("#note").fill("核验合成采购行，差额为 6 元");
    if(process.argv.includes("--screenshot")){
      await page.setViewportSize({width:1366,height:1120});
      await page.locator("dialog h2").scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(root,"samples","review-evidence.png")});
    }
    await page.getByRole("button",{name:"保存处理记录"}).click();
    const download=page.waitForEvent("download");await page.locator("#export").click();
    assert.match((await download).suggestedFilename(),/\.xlsx$/);
    const xlsx=Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await window.lastExport.arrayBuffer())]));
    if(process.argv.includes("--save-export"))fs.writeFileSync(path.join(root,"samples","example-review.xlsx"),xlsx);
    const archive=await ZIP.loadAsync(xlsx), detail=await archive.file("xl/worksheets/sheet1.xml").async("string");
    assert.match(detail,/核验合成采购行/);assert.match(detail,/<v>6<\/v>/);
    assert.match(await archive.file("xl/worksheets/sheet2.xml").async("string"),/CSV!F3/);
    assert.match(await archive.file("xl/worksheets/sheet3.xml").async("string"),/procurement.csv/);
    check("human review saved; browser triggers .xlsx download; its actual Blob contains 3 sheets, evidence and note");
    await page.reload();const csv="Supplier,Shipment,Charge,Currency,Unit,Amount\nAlpha,P-01,Handling,CNY,kg,10.50";
    const upload=(field,name,buffer,mimeType)=>page.locator("#"+field).setInputFiles({name,buffer,mimeType});
    await upload("baseline","baseline.csv",Buffer.from(csv),"text/csv");
    await page.locator("#summary").filter({hasText:"1 条核对结果"}).waitFor();
    await upload("invoice","same-bytes.csv",Buffer.from(csv),"text/csv");
    await page.locator("#status").filter({hasText:"另一侧内容完全相同"}).waitFor();check("same document rejected across invoice and procurement roles");
    const pdf=await pdfFixture();
    await upload("invoice","text.pdf",pdf,"application/pdf");
    await page.locator("#table").filter({hasText:"字段待复核"}).waitFor();
    const source=page.locator(".document").filter({hasText:"text.pdf"});
    await source.getByRole("button",{name:"原件与明细"}).click();
    await page.locator("dialog").getByRole("button",{name:"查看 / 校正"}).click();
    await page.locator("#editnote").fill("Synthetic PDF page and row verified");
    await page.getByRole("button",{name:"确认字段并保存"}).click();await page.getByRole("button",{name:"关闭",exact:true}).click();
    await page.locator("#table .tag.match").waitFor();check("genuine text PDF column extraction, manual confirmation and matching");
    await upload("invoice","image-only-or-empty.pdf",await pdfFixture(true),"application/pdf");
    const scan=page.locator(".document").filter({hasText:"image-only-or-empty.pdf"});
    await scan.getByText(/未提取到文本/).waitFor();await scan.getByRole("button",{name:"补录明细"}).click();
    await page.locator("#ref").fill("第 1 页 行 1");
    for(const [key,v] of Object.entries({supplier:"Alpha",shipment:"S-100",charge:"Test",currency:"CNY",unit:"件",amount:"19.99"}))await page.locator('[name="'+key+'"]').fill(v);
    await page.locator("#editnote").fill("Synthetic manual entry for fallback test");
    await page.getByRole("button",{name:"确认字段并保存"}).click();await page.getByRole("button",{name:"关闭",exact:true}).click();
    await page.locator("#table").getByText("S-100").waitFor();check("PDF without text stays unresolved; human can supplement a sourced line");
    // A workbook generated in the browser with two sheets and an explicit spreadsheet formula as text.
    const raw=await page.evaluate(async()=>{
      const {writeXlsx}=await import("./formats.mjs"), h=["供应商","运单号","费用名","币种","计费单位","行金额"];
      const b=await writeXlsx({"业务一":[h,["Beta","X01","=SUM(1,1)","USD","lb","20"]],"业务二":[h,["Beta","X02","Fuel","CNY","次","35"]]});
      return [...new Uint8Array(await b.arrayBuffer())];
    });
    await upload("invoice","two-sheets.xlsx",Buffer.from(raw),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await page.locator("#table").getByText("X02").waitFor();await page.locator("#table").getByText("=SUM(1,1)",{exact:true}).waitFor();
    check("XLSX multi-sheet upload and literal formula-looking text retained");
    await upload("invoice","bad.csv",Buffer.from("one,two\n12,23"),"text/csv");
    await page.locator(".document").filter({hasText:"bad.csv"}).getByText(/表头无法/).waitFor();check("unknown layout visibly queued for review");
    await upload("invoice","dup.xlsx",Buffer.from(raw),"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await page.locator("#status").filter({hasText:"重复文件"}).waitFor();check("byte-identical repeated uploads excluded");
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));check("390px mobile layout without page overflow");
    await page.goto(base+"/en.html");await page.getByRole("button",{name:"Load sample files"}).click();
    await page.getByText("8 review rows",{exact:false}).waitFor();
    await page.locator("#table tr").filter({hasText:"DEMO-002"}).getByRole("button",{name:"Review"}).click();
    await page.getByRole("heading",{name:"Billed above agreed"}).waitFor();
    await page.locator("#decision").selectOption("Difference confirmed");await page.locator("#note").fill("Verified against the sample.");
    await page.getByRole("button",{name:"Save decision"}).click();await page.getByRole("button",{name:"Export Excel"}).click();
    await page.waitForFunction(()=>Boolean(window.lastExport));
    const englishZip=await ZIP.loadAsync(Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await window.lastExport.arrayBuffer())])));
    assert.match(await englishZip.file("xl/workbook.xml").async("string"),/Field evidence/);
    const enRows=await englishZip.file("xl/worksheets/sheet1.xml").async("string");
    assert.match(enRows,/Billed above agreed/);assert.match(enRows,/Verified against the sample/);assert.match(enRows,/演示仓A/);
    check("English review and workbook export; source Chinese data left intact");
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);check("no page errors or external HTTP requests in default flow");
    console.log(passed+" browser scenarios passed");
  }finally{if(browser)await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
