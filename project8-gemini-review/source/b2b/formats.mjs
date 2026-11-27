import {keys,labels,headerMap,numberToColumn,parseCSV,readTable,statusNames} from "./core.mjs";
const MAX_FILE = 24 * 1024 * 1024;
const lim=(ok,msg)=>{if(!ok)throw Error(msg)};
const xml=(input)=>{
  const d=new DOMParser().parseFromString(input,"application/xml");
  if(d.getElementsByTagName("parsererror").length)throw Error("工作簿 XML 损坏");
  return d;
};
const elems=(node,name)=>Array.from(node.getElementsByTagNameNS("*",name));
const safe=(s)=>String(s??"").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
async function loadXlsx(doc, data) {
  const z=await JSZip.loadAsync(data);
  const expanded=Object.values(z.files).reduce((sum,f)=>sum+(f._data?.uncompressedSize||0),0);
  lim(expanded<90*1024*1024,"工作簿展开后过大，请拆分");
  async function part(path){const f=z.file(path);if(!f)throw Error("工作簿部件缺失："+path);return xml(await f.async("string"))}
  const shared=z.file("xl/sharedStrings.xml")?elems(await part("xl/sharedStrings.xml"),"si").map(si=>elems(si,"t").map(t=>t.textContent).join("")):[];
  const book=await part("xl/workbook.xml"), rels=elems(await part("xl/_rels/workbook.xml.rels"),"Relationship");
  for(const sh of elems(book,"sheet")){
    const rel=rels.find(r=>r.getAttribute("Id")===sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships","id"));
    const name=sh.getAttribute("name");
    if(!rel||!rel.getAttribute("Type")?.endsWith("/worksheet")||rel.getAttribute("TargetMode")==="External"){doc.issues.push(name+"：非普通工作表，需复核");continue}
    const path=new URL(rel.getAttribute("Target"),"https://package.invalid/xl/workbook.xml").pathname.slice(1);
    const sheet=await part(path), rows=[];
    for(const row of elems(sheet,"row")){
      const cells=[], formulas=[];
      for(const c of elems(row,"c")){
        const a=c.getAttribute("r")||"", m=/^([A-Z]{1,3})(\d+)$/.exec(a);
        if(!m)throw Error("单元格缺少位置，无法溯源");
        const col=[...m[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
        const type=c.getAttribute("t"), raw=elems(c,"v")[0]?.textContent||"";
        cells[col]=type==="s"?shared[Number(raw)]??"":type==="inlineStr"?elems(c,"t").map(t=>t.textContent).join(""):raw;
        if(elems(c,"f").length||type==="e")formulas.push(a);
      }
      if(cells.some(v=>String(v).trim())||formulas.length)rows.push({row:Number(row.getAttribute("r")), cells:Array.from(cells,v=>v??""),formulas});
    }
    if(rows.length>20000)throw Error("单表超过 20,000 行，请拆分");
    readTable(doc,rows,name);
  }
}
function pdfLines(items) {
  const groups=[];
  for(const item of items.filter(i=>i.str?.trim()).sort((a,b)=>b.transform[5]-a.transform[5] || a.transform[4]-b.transform[4])){
    const y=item.transform[5], prev=groups.at(-1);
    if(!prev||Math.abs(prev.y-y)>2.2)groups.push({y, items:[item]});else prev.items.push(item);
  }
  return groups.map((g,i)=>({row:i+1,items:g.items.sort((a,b)=>a.transform[4]-b.transform[4])}));
}
async function loadPDF(doc,data) {
  const pdfjs=await import("./vendor/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc=new URL("./vendor/pdf.worker.min.mjs",import.meta.url).href;
  const pdf=await pdfjs.getDocument({data,cMapUrl:new URL("./vendor/cmaps/",import.meta.url).href,cMapPacked:true,isEvalSupported:false,useSystemFonts:true}).promise;
  try {
    lim(pdf.numPages<=100,"PDF 超过 100 页，请拆分");
    for(let pg=1;pg<=pdf.numPages;pg++) {
      const page=await pdf.getPage(pg);
      const lines=pdfLines((await page.getTextContent()).items);
      const ref="第 "+pg+" 页", text=lines.map(l=>"L"+l.row+" "+l.items.map(i=>i.str).join(" | ")).join("\n");
      doc.pages.push({ref,text});
      let positions=null, header=[], got=0, skipped=0;
      for(const ln of lines) {
        const words=ln.items.map(i=>i.str.trim());
        if(headerMap(words)){positions=ln.items.map(i=>i.transform[4]);header=words;continue}
        if(!positions){skipped++;continue}
        const cells=positions.map(()=>"");
        for(const item of ln.items){
          const x=item.transform[4];let idx=0;
          // Each column starts at its header x; allow a small alignment tolerance.
          while(idx+1<positions.length && x>=positions[idx+1]-2)idx++;
          cells[idx]+=(cells[idx]?" ":"")+item.str.trim();
        }
        readTable(doc,[{row:0,cells:header},{row:ln.row,cells}],ref,{pdf:true});got++;
      }
      if(!got||skipped)doc.issues.push(ref+"："+(!got?(text?"无法按表头提取，需人工转录":"未提取到文本，需人工查看原件或先做 OCR"):"有 "+skipped+" 行表格外文字，请确认是否含费用。"));
    }
  } finally {await pdf.destroy()}
}
export async function importDocument(file,side) {
  const doc={id:crypto.randomUUID(),side,name:file.name,rows:[],issues:[],pages:[],file,sha:""};
  try{
    lim(file.size<=MAX_FILE,"文件超过 24 MB，请拆分");
    const buf=await file.arrayBuffer();
    doc.sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buf)),v=>v.toString(16).padStart(2,"0")).join("");
    const ext=file.name.toLowerCase().split(".").pop();
    if(ext==="csv") {
      const body=new TextDecoder("utf-8",{fatal:true}).decode(buf);
      const rows=parseCSV(body);lim(rows.length<=20001,"超过 20,000 行，请拆分");
      readTable(doc,rows,"CSV");
    } else if(ext==="xlsx")await loadXlsx(doc,buf);
    else if(ext==="pdf")await loadPDF(doc,new Uint8Array(buf));
    else throw Error("只支持 UTF-8 CSV、XLSX 或 PDF");
    if(!doc.rows.length && !doc.issues.length)doc.issues.push("未读取到任何明细，请核对原件。");
  }catch(e){doc.rows=[];doc.issues.push("导入未完成："+e.message+"。请核对原件。")}
  return doc;
}
function textSheet(rows) {
  const cell=(v,i,n)=>typeof v==="number"&&Number.isFinite(v)?'<c r="'+numberToColumn(i)+n+'"><v>'+v+'</v></c>':
    '<c r="'+numberToColumn(i)+n+'" t="inlineStr"><is><t xml:space="preserve">'+safe(v)+'</t></is></c>';
  return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17"/><cols><col min="1" max="32" width="23" customWidth="1"/></cols><sheetData>'+
    rows.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((v,j)=>cell(v,j,i+1)).join("")+'</row>').join("")+'</sheetData>'+
    '<autoFilter ref="A1:'+numberToColumn(rows[0].length-1)+Math.max(1,rows.length)+'"/></worksheet>';
}
export async function writeXlsx(sheets) {
  const z=new JSZip(), names=Object.keys(sheets);
  const docNS="http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkNS="http://schemas.openxmlformats.org/package/2006/relationships";
  z.file("[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+names.map((n,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join("")+'</Types>');
  z.file("_rels/.rels",'<Relationships xmlns="'+pkNS+'"><Relationship Id="rId1" Type="'+docNS+'/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  z.file("xl/workbook.xml",'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+docNS+'"><sheets>'+names.map((n,i)=>'<sheet name="'+safe(n)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join("")+'</sheets></workbook>');
  z.file("xl/_rels/workbook.xml.rels",'<Relationships xmlns="'+pkNS+'">'+names.map((n,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+docNS+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join("")+'</Relationships>');
  names.forEach((n,i)=>z.file("xl/worksheets/sheet"+(i+1)+".xml",textSheet(sheets[n])));
  return z.generateAsync({type:"blob",compression:"DEFLATE",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
export const sideName=side=>side==="invoice"?"供应商账单":"采购基准";
export function buildReport(docs, results, decisions) {
  const detail=[["核对状态","供应商","运单号","费用名","币种","计费单位","账单金额","采购基准金额","账单减基准","人工处理","复核备注","账单来源","基准来源"]];
  const evidence=[["文档类型","文档名","文件 SHA-256","来源行","字段","取值","字段依据","来源位置","证据原文","原始取值","排除原因"]];
  const manifest=[["文档类型","文档名","文件 SHA-256","明细行数","导入提示","人工核对说明"]];
  for(const d of docs) {
    manifest.push([sideName(d.side),d.name,d.sha,d.rows.length,d.issues.join("\n")||"已识别明细",d.resolution||""]);
    for(const r of d.rows)for(const k of keys){
      const f=r.fields[k];evidence.push([sideName(d.side),d.name,d.sha,r.sourceRef,labels[k],f.value,f.confidence,f.source_ref,f.evidence,f.original??f.value,r.exclusion||""]);
    }
  }
  for(const row of results){
    const r=row.invoice||row.bases[0], get=k=>r.fields[k].value, who=decisions.get(row.id)||{};
    const ref=r=>r.docName+" · "+r.sourceRef;
    detail.push([statusNames[row.status],get("supplier"),get("shipment"),get("charge"),get("currency"),get("unit"),row.invoice?.fields.amount.value||"",row.bases.map(b=>b.fields.amount.value).join(" / "),row.delta===null?"":row.delta/100,who.status||"未处理",who.note||"",row.invoice?ref(row.invoice):"",row.bases.map(ref).join("\n")]);
  }
  return {"对账明细":detail,"逐字段证据":evidence,"文件与未决事项":manifest};
}
