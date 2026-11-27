// Only interface text is translated. Marked user data (including workbook text)
// goes through HTML escaping without passing through the phrase dictionary.
const phrases={
  "已保存处理记录，计算差额仍按原始规则展示。":"Decision saved. The calculated difference is still based on the source amounts.",
  "已生成 Excel，含对账明细、逐字段证据及未决事项。":"Excel workbook generated with review results, field evidence and open items.",
  "已载入合成演示。示例金额不代表真实交易。":"Synthetic sample files loaded. These figures are fictional.",
  "可载入合成示例，或导入自己的两份文件。":"Load the sample files or choose your own invoice and purchase documents.",
  "没有符合当前条件的明细。":"No rows meet the current filter.",
  "导入文件后即可查看。":"Import documents to see the results.",
  "需核原件 · ":"Original needs review · ", "已有处理备注 · ":"Source note recorded · ",
  "已手工核对文件":"Document reviewed", "原件与明细":"Original and rows", "补录明细":"Add a line",
  "移除":"Remove", "核对状态":"Check", "运单号 / 供应商":"Shipment / supplier", "币种 · 单位":"Currency · unit",
  "账单金额":"Billed", "采购基准金额":"Agreed amount","采购基准":"Purchase baseline","查看处理":"View decision",
  "查看 / 复核":"Review", "上页":"Previous", "上一页":"Previous", "下一页":"Next", "差额":"Difference", "复核":"Review",
  "供应商账单":"Supplier invoice","供应商":"Supplier","运单号":"Shipment","费用名":"Charge","币种":"Currency",
  "计费单位":"Billing unit","行金额":"Amount","处理状态":"Decision","保存处理记录":"Save decision",
  "文件明细":"Source rows","打开原件":"Open original","补录一行":"Add a line","导入提示":"Import notes",
  "整份文件的核对说明":"Document review note","例如：逐页核对，共两条费用已转录":"e.g. Both charge lines were transcribed and checked.",
  "保存说明":"Save source note","PDF 逐页文本与本机模型辅助":"Page text and optional local model",
  "本机 Ollama 仅在点击后接收选中页的文本。候选仍需逐行确认。":"Ollama receives the selected page only after you request suggestions. Review every proposed row.",
  "选择页":"Page","本机服务":"Local endpoint","已安装的模型名称":"Installed model name","填写本机已有模型":"Enter a locally installed model",
  "为本页生成待核候选":"Suggest rows for this page","点击行可校正或确认字段。每项保留原始值、证据位置和当前依据。":"Open a row to verify or correct its fields. Original values and sources are retained.",
  "此页无文字层。":"This page has no text layer.","来源行":"Source row","位置":"Location","运单":"Shipment",
  "费用 / 金额":"Charge / amount","字段依据":"Evidence status","查看 / 校正":"View / correct","关闭":"Close",
  "前 200 行在此预览，其余可通过主表搜索运单查看。":"Showing the first 200 rows. Search for a shipment in the main table to find further rows.",
  "核对原文字段":"Verify source fields","人工补录一行":"Add a source line","原件行、页或单元格位置":"Source page, row or cell",
  "例如：第 2 页，第 3 行":"e.g. Page 2, line 3","原件核对笔记":"Evidence note","填写原文片段或核对说明":"Enter the source excerpt or what you checked",
  "原文：":"Source text: ","未取得":"Unavailable","本行已排除：":"Excluded: ","。确认字段并保存可恢复本行。":". Verify and save to restore this row.",
  "说明原因后，可排除非费用行或重复提取的候选。":"To exclude a non-charge or a duplicate candidate, describe the reason first.",
  "排除本行":"Exclude row","保存后重新核算，受影响行的旧处理结论将清空。":"Saving recalculates the results and clears earlier decisions on changed rows.",
  "返回文件":"Back to document","确认字段并保存":"Verify fields and save","已保存人工核对。":"Verified fields saved.",
  "取值":"Value","依据":"Basis","原件位置":"Source location","证据原文":"Source excerpt","字段":"Field","校正或确认字段":"Correct or confirm fields",
  "待补凭证":"Awaiting evidence","确认差异":"Difference confirmed","差异已解释":"Difference explained","确认一致":"Match confirmed",
  "已核对，等待补证":"Checked, evidence pending","复核备注":"Review note","记录依据或待补凭证":"Record the evidence or missing document",
  "此页没有文本，请人工转录。":"This page has no text. Transcribe a line from the original.",
  "正在联系所选本机模型…":"Contacting the selected local model…","模型未完成：":"Local model did not complete: ",
  "已从核对中排除本行，原始证据及排除原因保留在底稿中。":"Row excluded. The workbook retains its evidence and exclusion reason.",
  "已产生 ":"Added "," 行待复核候选。重复候选不会覆盖原始明细。":" candidate rows for manual review. Original rows were retained.",
  "移除此文件并重新核算？受影响行的人工处理结论将清空。":"Remove this document and recalculate? Prior decisions on affected rows will be cleared.",
  "更改语言会重新打开工作台，当前数据请先导出。继续？":"Changing languages starts a new session. Have you exported any work you want to keep?",
  " 条核对结果 · ":" review rows · "," 条一致 · ":" matched · "," 条已人工处理 · ":" decisions saved · "," 个文件待核":" documents needing review",
  "已导入 ":"Imported ", " 个文件":" file(s)", "，跳过 ":"; skipped "," 个相同内容的重复文件":" identical file(s)",
  "。有 ":". ", " 个文件与另一侧内容完全相同，未作为独立采购或账单依据":" file(s) matched a document already used on the other side and were excluded",
  "操作未完成：":"Operation incomplete: ","示例文件不可用":"Sample file is unavailable","未处理":"No decision",
  "表头直接读取":"Read directly from header","人工转录已核":"Verified transcription","人工核对":"Human verified","待人工":"Needs human review","缺失":"Missing",
  "账单高于基准":"Billed above agreed","账单低于基准":"Billed below agreed","无采购基准":"No purchase baseline","基准未见账单":"No billed line",
  "币种或单位不符":"Currency or unit mismatch","多行同键，需拆分":"Ambiguous duplicate","资料待核":"Incomplete fields","字段待复核":"Unverified fields",
  "对侧资料待核":"Counterpart incomplete","一致":"Matched","费率":"Rate",
  "表头无法唯一对应六个字段，请手工核对。":"The six headers could not be uniquely identified. Check the original.",
  "非普通工作表，需复核":"Unsupported worksheet type. Check the original.",
  "无法按表头提取，需人工转录":"Table headers could not be recognized. Transcribe the source.",
  "未提取到文本，需人工查看原件或先做 OCR":"No text was found. Inspect the original or run OCR separately.",
  " 行表格外文字，请确认是否含费用。":" text lines outside the table. Check for additional charges.",
  "导入未完成：":"Import incomplete: ","。请核对原件。":". Check the original.",
  "未读取到任何明细，请核对原件。":"No charge lines were read. Check the original.",
  "文件超过 24 MB，请拆分":"File exceeds 24 MB. Split it first.",
  "只支持 UTF-8 CSV、XLSX 或 PDF":"Choose a UTF-8 CSV, XLSX or PDF file.",
  "超过 20,000 行，请拆分":"More than 20,000 rows. Split the file.",
  "工作簿展开后过大，请拆分":"Workbook is too large after decompression. Split the file.",
  "PDF 超过 100 页，请拆分":"PDF exceeds 100 pages. Split the file.","单表超过 20,000 行，请拆分":"Sheet exceeds 20,000 rows. Split the file.",
  "文档类型":"Document type","文档名":"Document","文件 SHA-256":"File SHA-256","来源位置":"Source location","原始取值":"Original value",
  "排除原因":"Exclusion reason","账单减基准":"Billed minus agreed","人工处理":"Reviewer decision","账单来源":"Invoice source","基准来源":"Baseline source",
  "明细行数":"Row count","人工核对说明":"Document review note","已识别明细":"Rows recognized",
  "对账明细":"Review results","逐字段证据":"Field evidence","文件与未决事项":"Documents and open items",
  " 个文件":" file(s)"," 行":" rows", " 页":"", "第 ":"Page ", "。":"."
};
const pattern=new RegExp(Object.keys(phrases).sort((a,b)=>b.length-a.length).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"g");
export const english=document.documentElement.lang==="en";
export const ui=s=>english?String(s).replace(pattern,k=>phrases[k]):String(s);
export function escapeData(v){
  const escaped=String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;").replaceAll("\uE000","&#57344;").replaceAll("\uE001","&#57345;");
  return english?"\uE000"+escaped+"\uE001":escaped;
}
export function markup(s){
  return !english?s:s.split(/(\uE000[\s\S]*?\uE001)/).map(part=>part.startsWith("\uE000")?part.slice(1,-1):ui(part)).join("");
}
export function englishWorkbook(report){
  if(!english)return report;
  return Object.fromEntries(Object.entries(report).map(([title,rows],sheet)=>{
    const translated=rows.map((row,i)=>{
      if(i===0)return row.map(ui);
      const r=[...row];
      if(sheet===0){r[0]=ui(r[0]);r[9]=ui(r[9])}
      if(sheet===1){r[0]=ui(r[0]);r[4]=ui(r[4]);r[6]=ui(r[6])}
      if(sheet===2){r[0]=ui(r[0]);r[4]=ui(r[4])}
      return r;
    });
    return [ui(title),translated];
  }));
}
