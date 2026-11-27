import {keys,labels,makeRecord,auditDocuments,statusNames} from "./core.mjs";
import {importDocument,writeXlsx,buildReport,sideName} from "./formats.mjs";
import {suggestRows} from "./ollama.mjs";
import {english,ui,markup,escapeData,englishWorkbook} from "./locale.mjs";
const $=sel=>document.querySelector(sel);
const e=escapeData;
const docs=[], decisions=new Map();
let results=[], page=0, busy=false;
const status=s=>$("#status").textContent=ui(s);
const allRows=()=>docs.flatMap(d=>d.rows);
const modal=(html)=>{$("#dialogbody").innerHTML=markup(html);if(!$("#dialog").open)$("#dialog").showModal()};
const close=()=>$("#dialog").close();
const foot='<div class="modalFoot"><button class="secondary" data-action="close">关闭</button></div>';
const action=(name,label,id,cls="secondary small")=>'<button type="button" class="'+cls+'" data-action="'+name+'" data-id="'+e(id)+'">'+label+'</button>';
const docBy=id=>docs.find(d=>d.id===id);
const recordBy=id=>allRows().find(r=>r.id===id);
const decisionFingerprint=r=>JSON.stringify([r.status,r.delta,r.invoice,r.bases]);
function recompute(){
  results=auditDocuments(docs);
  const current=new Map(results.map(r=>[r.id,r]));
  for(const [id,decision] of decisions){
    const result=current.get(id);
    if(!result||decision.fingerprint!==decisionFingerprint(result))decisions.delete(id);
  }
  page=0;render();
}
function render(){
  $("#sourcesSection").hidden=!docs.length;
  $("#export").disabled=busy||!docs.length;
  $("#sources").innerHTML=markup(docs.map(d=>'<div class="document"><div><div class="fileName">'+e(d.name)+'</div><div class="hint">'+sideName(d.side)+' · '+d.rows.length+' 行'+(d.resolution?' · 已手工核对文件':'')+'</div>'+
    (d.issues.length?'<div class="issue">'+(d.resolution?'已有处理备注 · ':'需核原件 · ')+e(ui(d.issues.join(" / ").slice(0,180)))+'</div>':'')+'</div><div class="actions">'+
    action("source","原件与明细",d.id)+action("manual","补录明细",d.id)+action("remove","移除",d.id)+'</div></div>').join(""));
  const unresolved=docs.filter(d=>d.issues.length&&!d.resolution).length;
  $("#summary").textContent=ui(docs.length?results.length+" 条核对结果 · "+results.filter(r=>r.status==="match").length+" 条一致 · "+decisions.size+" 条已人工处理 · "+unresolved+" 个文件待核":"导入文件后即可查看。");
  const q=$("#search").value.trim().toLowerCase(), f=$("#filter").value;
  const rows=results.filter(r=>{
    if(f==="issues"&&r.status==="match"||f==="match"&&r.status!=="match"||f==="unreviewed"&&decisions.has(r.id))return false;
    const rec=r.invoice||r.bases[0];
    return !q||["supplier","shipment","charge"].some(k=>rec.fields[k].value.toLowerCase().includes(q));
  });
  const maxPage=Math.max(0,Math.ceil(rows.length/50)-1);page=Math.min(page,maxPage);
  $("#table").innerHTML=markup(rows.length?'<div class="scroll"><table><thead><tr><th>核对状态</th><th>运单号 / 供应商</th><th>费用名</th><th>币种 · 单位</th><th>账单金额</th><th>采购基准</th><th>差额</th><th>复核</th></tr></thead><tbody>'+
    rows.slice(page*50,page*50+50).map(r=>{
      const rec=r.invoice||r.bases[0],v=k=>e(rec.fields[k].value);
      return '<tr><td><span class="tag '+r.status+'">'+statusNames[r.status]+'</span></td><td>'+v("shipment")+'<div class="hint">'+v("supplier")+'</div></td><td>'+v("charge")+'</td><td>'+v("currency")+' · '+v("unit")+'</td><td class="amount">'+e(r.invoice?.fields.amount.value??"—")+'</td><td class="amount">'+e(r.bases.map(b=>b.fields.amount.value).join(" / ")||"—")+'</td><td class="amount">'+(r.delta===null?"—":(r.delta/100).toFixed(2))+'</td><td>'+action("review",decisions.has(r.id)?"查看处理":"查看 / 复核",r.id)+'</td></tr>';
    }).join("")+'</tbody></table></div>'+(maxPage?'<div class="actions">'+action("prev","上一页","")+'<span>第 '+(page+1)+' / '+(maxPage+1)+' 页</span>'+action("next","下一页","")+'</div>':''):
    '<div class="empty">'+(docs.length?"没有符合当前条件的明细。":"可载入合成示例，或导入自己的两份文件。")+'</div>');
}
async function addFiles(files,side,quiet=false) {
  let added=0,ignored=0,cross=0;
  for(const file of files){
    const doc=await importDocument(file,side);
    if(doc.sha && docs.some(d=>d.sha===doc.sha&&d.side===side)){ignored++;continue}
    if(doc.sha && docs.some(d=>d.sha===doc.sha&&d.side!==side)){cross++;continue}
    docs.push(doc);added++;
  }
  if(added)recompute();
  if(!quiet)status("已导入 "+added+" 个文件"+(ignored?"，跳过 "+ignored+" 个相同内容的重复文件":"")+(cross?"。有 "+cross+" 个文件与另一侧内容完全相同，未作为独立采购或账单依据":"")+"。");
}
async function work(task) {
  if(busy)return;busy=true;
  for(const id of ["#invoice","#baseline","#demo","#export"])$(id).disabled=true;
  try{await task()}catch(err){status("操作未完成："+err.message)}
  finally{busy=false;for(const id of ["#invoice","#baseline","#demo"])$(id).disabled=false;render()}
}
for(const side of ["invoice","baseline"])$("#"+side).addEventListener("change",event=>{
  const files=[...event.target.files];event.target.value="";
  work(()=>addFiles(files,side));
});
$("#demo").onclick=()=>work(async()=>{
  for(const [side,file] of [["invoice","invoices.csv"],["baseline","procurement.csv"]]){
    const response=await fetch("./samples/"+file);if(!response.ok)throw Error("示例文件不可用");
    await addFiles([new File([await response.blob()],file)],side,true);
  }
  status("已载入合成演示。示例金额不代表真实交易。");
});
$("#export").onclick=()=>work(async()=>{
  const blob=await writeXlsx(englishWorkbook(buildReport(docs,results,decisions))), url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=english?"freight-invoice-review.xlsx":"运费对账复核底稿.xlsx";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status("已生成 Excel，含对账明细、逐字段证据及未决事项。");
});
for(const [sel,evt] of [["#search","input"],["#filter","change"]])$(sel).addEventListener(evt,()=>{page=0;render()});
function showSource(d){
  modal('<h2>'+e(d.name)+'</h2><p class="hint">'+sideName(d.side)+' · SHA-256 '+e(d.sha||"未取得")+'</p>'+
    '<div class="actions">'+action("original","打开原件",d.id)+action("manual","补录一行",d.id)+'</div>'+
    (d.issues.length?'<section class="warn"><strong>导入提示</strong><ul>'+d.issues.map(i=>'<li>'+e(ui(i))+'</li>').join("")+'</ul><label class="field">整份文件的核对说明<input id="resolution" placeholder="例如：逐页核对，共两条费用已转录" value="'+e(d.resolution)+'"></label>'+action("resolve","保存说明",d.id)+'</section>':'')+
    (d.pages.length?'<details><summary>PDF 逐页文本与本机模型辅助</summary><p class="hint">本机 Ollama 仅在点击后接收选中页的文本。候选仍需逐行确认。</p><label class="field">选择页<select id="pdfpage">'+d.pages.map((p,i)=>'<option value="'+i+'">'+e(p.ref)+'</option>').join("")+'</select></label><pre id="pagetext" class="pre"></pre><div class="grid"><label class="field">本机服务<input id="endpoint" value="http://127.0.0.1:11434"></label><label class="field">已安装的模型名称<input id="model" placeholder="填写本机已有模型"></label></div>'+action("assist","为本页生成待核候选",d.id)+'<p id="modelStatus" role="status" class="hint"></p></details>':'')+
    '<section><h3>文件明细</h3><p class="hint">点击行可校正或确认字段。每项保留原始值、证据位置和当前依据。</p><div class="scroll"><table><thead><tr><th>位置</th><th>运单</th><th>费用 / 金额</th><th>字段依据</th><th></th></tr></thead><tbody>'+d.rows.slice(0,200).map(r=>'<tr><td>'+e(r.sourceRef)+'</td><td>'+e(r.fields.shipment.value)+'</td><td>'+e(r.fields.charge.value)+' · '+e(r.fields.amount.value)+'</td><td>'+e(ui([...new Set(keys.map(k=>r.fields[k].confidence))].join(" / ")))+'</td><td>'+action("edit","查看 / 校正",r.id)+'</td></tr>').join("")+'</tbody></table></div>'+(d.rows.length>200?'<p class="hint">前 200 行在此预览，其余可通过主表搜索运单查看。</p>':'')+'</section>'+foot);
  if(d.pages.length){const change=()=>$("#pagetext").textContent=d.pages[Number($("#pdfpage").value)].text||ui("此页无文字层。");$("#pdfpage").onchange=change;change()}
}
function showEdit(d,r) {
  const prior=k=>r?.fields[k]||{};
  modal('<h2>'+(r?"核对原文字段":"人工补录一行")+'</h2><p class="hint">'+e(d.name)+' · '+sideName(d.side)+'</p>'+
    '<form id="editForm"><label class="field">原件行、页或单元格位置<input id="ref" required placeholder="例如：第 2 页，第 3 行" value="'+e(r?.sourceRef)+'"></label>'+
    '<div class="grid">'+keys.map(k=>'<label class="field">'+labels[k]+'<input name="'+k+'" required value="'+e(prior(k).value)+'">'+(r?'<span class="hint">'+e(prior(k).source_ref)+' · '+e(ui(prior(k).confidence))+'<br>原文：'+e(prior(k).evidence||ui("未取得"))+'</span>':'')+'</label>').join("")+'</div>'+
    '<label class="field">原件核对笔记<input id="editnote" required placeholder="填写原文片段或核对说明"></label>'+(r?'<p class="hint">'+(r.exclusion?'本行已排除：'+e(r.exclusion)+'。确认字段并保存可恢复本行。':'说明原因后，可排除非费用行或重复提取的候选。')+'</p>'+action("exclude","排除本行",r.id):'')+'<p class="hint">保存后重新核算，受影响行的旧处理结论将清空。</p><div class="modalFoot">'+action("source","返回文件",d.id)+'<button type="submit">确认字段并保存</button></div></form>');
  $("#editForm").onsubmit=ev=>{
    ev.preventDefault();const fields=Object.fromEntries(keys.map(k=>[k,ev.target.elements[k].value.trim()]));
    const ref=$("#ref").value.trim(), note=$("#editnote").value.trim();
    if(!ref||!note||keys.some(k=>!fields[k]))return;
    if(r){
      const oldRef=r.sourceRef;
      for(const k of keys){const f=r.fields[k];
        if(f.original===undefined)f.original=f.value;
        if(f.value!==fields[k]||oldRef!==ref)f.source_ref=ref+" · "+labels[k];
        f.value=fields[k];f.confidence="人工核对";f.evidence=(f.evidence?f.evidence+" | ":"")+note;
      }
      r.sourceRef=ref;
      delete r.exclusion;
    } else {
      const refs=Object.fromEntries(keys.map(k=>[k,ref+" · "+labels[k]]));
      d.rows.push(makeRecord(d,fields,refs,ref,"manual",Object.fromEntries(keys.map(k=>[k,note]))));
    }
    recompute();showSource(d);status("已保存人工核对。")
  };
}
function showReview(result){
  const prior=decisions.get(result.id)||{};
  const choices=result.status==="incomplete"||result.status==="pending"||result.status==="invalid"?
    ["待补凭证","已核对，等待补证"]:["待补凭证","确认差异","差异已解释","确认一致"];
  const records=[...(result.invoice?[result.invoice]:[]),...result.bases];
  const summary=result.delta===null?"":'<div class="amountCheck"><span>账单金额 <b>'+e(result.invoice.fields.amount.value)+'</b></span><span>采购基准 <b>'+e(result.bases[0].fields.amount.value)+'</b></span><span>差额 <b>'+e(result.invoice.fields.currency.value)+' '+(result.delta/100).toFixed(2)+'</b></span></div>';
  modal('<h2>'+statusNames[result.status]+'</h2>'+summary+records.map(r=>'<section><h3>'+sideName(r.side)+' · '+e(r.docName)+'</h3><div class="hint">'+e(r.sourceRef)+'</div><div class="scroll"><table><tr><th>字段</th><th>取值</th><th>依据</th><th>原件位置</th><th>证据原文</th></tr>'+keys.map(k=>{const f=r.fields[k];return '<tr><td>'+labels[k]+'</td><td>'+e(f.value)+'</td><td>'+e(ui(f.confidence))+'</td><td>'+e(f.source_ref)+'</td><td>'+e(f.evidence)+'</td></tr>'}).join("")+'</table></div>'+action("edit","校正或确认字段",r.id)+'</section>').join("")+
    '<form id="reviewForm"><div class="grid"><label class="field">处理状态<select id="decision">'+choices.map(c=>'<option>'+c+'</option>').join("")+'</select></label><label class="field">复核备注<input id="note" required value="'+e(prior.note)+'" placeholder="记录依据或待补凭证"></label></div><div class="modalFoot">'+action("close","关闭","")+'<button>保存处理记录</button></div></form>');
  if(prior.status)$("#decision").value=prior.status;
  $("#reviewForm").onsubmit=ev=>{ev.preventDefault();const note=$("#note").value.trim();if(!note)return;decisions.set(result.id,{status:$("#decision").value,note,fingerprint:decisionFingerprint(result)});render();close();status("已保存处理记录，计算差额仍按原始规则展示。")};
}
document.addEventListener("click",async event=>{
  if(event.target.closest("a[data-language]")&&docs.length&&!confirm(ui("更改语言会重新打开工作台，当前数据请先导出。继续？"))){event.preventDefault();return}
  const btn=event.target.closest("[data-action]");if(!btn)return;const {action:a,id}=btn.dataset;
  if(a==="close"){event.preventDefault();close();return}
  if(a==="prev"||a==="next"){page=Math.max(0,page+(a==="next"?1:-1));render();return}
  const d=docBy(id);
  if(a==="source"){event.preventDefault();showSource(d)}
  if(a==="manual")showEdit(d,null);
  if(a==="review")showReview(results.find(r=>r.id===id));
  if(a==="edit"){const r=recordBy(id);showEdit(docBy(r.docId),r)}
  if(a==="exclude"){event.preventDefault();const note=$("#editnote").value.trim();if(!note){$("#editnote").reportValidity();return}const r=recordBy(id);r.exclusion=note;recompute();showSource(docBy(r.docId));status("已从核对中排除本行，原始证据及排除原因保留在底稿中。")}
  if(a==="original"){const url=URL.createObjectURL(d.file);window.open(url,"_blank","noopener,noreferrer");setTimeout(()=>URL.revokeObjectURL(url),60000)}
  if(a==="resolve"){const value=$("#resolution").value.trim();if(!value)return;d.resolution=value;recompute();showSource(d)}
  if(a==="remove"){if(confirm(ui("移除此文件并重新核算？受影响行的人工处理结论将清空。"))){docs.splice(docs.indexOf(d),1);recompute()}}
  if(a==="assist"){
    const pg=d.pages[Number($("#pdfpage").value)], output=$("#modelStatus");
    if(!pg.text){output.textContent=ui("此页没有文本，请人工转录。");return}
    btn.disabled=true;const model=$("#model").value.trim();
    output.textContent=ui("正在联系所选本机模型…");
    try{
      const lines=pg.text.split("\n").map(line=>line.replace(/^L\d+ /,""));
      const suggestions=await suggestRows({text:lines.join("\n"),model,endpoint:$("#endpoint").value.trim()});
      if(!docs.includes(d))return;
      let added=0;
      for(const s of suggestions){
        const ref=pg.ref+" · "+s.sourceRef, fields=s.fields;
        if(d.rows.some(r=>r.sourceRef===ref&&keys.every(k=>r.fields[k].value===String(fields[k]??"").trim())))continue;
        const refs=Object.fromEntries(keys.map(k=>{
          const excerpt=s.evidence[k], hits=excerpt?lines.flatMap((line,i)=>line.includes(excerpt)?[i+1]:[]):[];
          return [k,pg.ref+" · "+(hits.length?"文字行 "+hits.join(" / "):"页内引文待定位")+" · "+labels[k]];
        }));
        d.rows.push(makeRecord(d,fields,refs,ref,"model",s.evidence));added++;
      }
      if(added)recompute();showSource(d);status("已产生 "+added+" 行待复核候选。重复候选不会覆盖原始明细。");
    }catch(err){output.textContent=ui("模型未完成："+err.message)}finally{btn.disabled=false}
  }
});
render();
