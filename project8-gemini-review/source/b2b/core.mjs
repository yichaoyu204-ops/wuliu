export const columns = {
  supplier: ["供应商", "供应商名称", "supplier", "vendor"],
  shipment: ["运单号", "运单", "业务编号", "shipment", "shipment id", "shipment_id"],
  charge: ["费用名", "费用名称", "费用项目", "charge", "charge name"],
  currency: ["币种", "货币", "currency"],
  unit: ["计费单位", "单位", "unit"],
  amount: ["行金额", "金额", "应付金额", "预计应付", "实收总额", "应付总额", "amount", "line total"]
};
export const keys = Object.keys(columns);
export const labels = Object.fromEntries(keys.map(k => [k, columns[k][0]]));
export const statusNames = {
  match: "一致", over: "账单高于基准", under: "账单低于基准", missing: "无采购基准",
  unbilled: "基准未见账单", mismatch: "币种或单位不符", duplicate: "多行同键，需拆分",
  invalid: "资料待核", pending: "字段待复核", incomplete:"对侧资料待核"
};
const normalized = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
export function headerMap(cells) {
  const mapped = {};
  for (const [i, cell] of cells.entries()) {
    const key = keys.find(k => columns[k].includes(normalized(cell)));
    if (!key) continue;
    if (key in mapped) return null;
    mapped[key] = i;
  }
  return keys.every(k => k in mapped) ? mapped : null;
}
export function numberToColumn(index) {
  let label = "";
  for (let n = index + 1; n; n = Math.floor((n-1)/26)) label = String.fromCharCode(65 + (n-1)%26) + label;
  return label;
}
export function makeRecord(doc, values, refs, sourceRef, method, evidence = values) {
  return {
    id: crypto.randomUUID(), docId: doc.id, docName: doc.name, side: doc.side, sourceRef, method,
    fields: Object.fromEntries(keys.map(k => [k, {
      value: String(values[k] ?? "").trim(), source_ref: refs[k] || sourceRef,
      evidence: String(evidence[k] ?? ""), confidence: !String(values[k] ?? "").trim() ? "缺失" :
        method === "direct" ? "表头直接读取" : method === "manual" ? "人工转录已核" : "待人工"
    }]))
  };
}
export function parseCSV(input) {
  const body = input.replace(/^\uFEFF/, "");
  const line = body.split(/\r?\n/,1)[0];
  const delim = [",","\t",";"].find(char => headerMap(line.split(char).map(c=>c.replace(/^"|"$/g,"")))) ||
    ([",","\t",";"].sort((a,b)=>line.split(b).length-line.split(a).length)[0]);
  const result = [];
  let cells = [], value = "", quoted = false, closed = false, physical = 1, start = 1;
  function endRow() {
    cells.push(value);
    if (cells.some(c=>c.trim())) result.push({cells,row:start});
    cells=[]; value=""; closed=false;
  }
  for(let i=0;i<body.length;i++) {
    let char=body[i];
    if (char === '"') {
      if(quoted && body[i+1] === '"') {value+='"';i++;continue}
      if(quoted){quoted=false;closed=true;continue}
      if(value || closed) throw Error("CSV 引号格式错误，行 " + physical);
      quoted=true;continue;
    }
    if(char==="\r" || char==="\n") {
      if(char==="\r" && body[i+1]==="\n")i++;
      if(quoted)value+="\n"; else endRow();
      physical++; if(!quoted)start=physical;
    } else if(!quoted && char===delim){cells.push(value);value="";closed=false}
    else {if(closed && char.trim())throw Error("CSV 引号后有非分隔字符");value+=char}
  }
  if(quoted)throw Error("CSV 引号未结束");
  if(value || cells.length || closed)endRow();
  return result;
}
export function readTable(doc, rows, name, options={}) {
  if(!rows.length)return;
  const layout=headerMap(rows[0].cells);
  if(!layout){doc.issues.push(name+"：表头无法唯一对应六个字段，请手工核对。");return}
  for(const row of rows.slice(1)) {
    if(row.cells.every(v=>!String(v??"").trim()) || headerMap(row.cells))continue;
    const values={},refs={};
    for(const k of keys) {
      values[k]=row.cells[layout[k]]??"";
      refs[k]=options.pdf ? name+" · 行 "+row.row+" · "+labels[k] : name+"!"+numberToColumn(layout[k])+row.row;
    }
    const manual=options.pdf || row.formulas?.length;
    const rec=makeRecord(doc,values,refs,name+" · 行 "+row.row,manual?"candidate":"direct");
    doc.rows.push(rec);
  }
}
const validCurrencies=new Set(["CNY","USD","EUR","GBP","HKD","AUD","CAD","SGD","NZD","CHF"]);
export function cents(text) {
  const t=String(text).trim();
  if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(t))return null;
  const value=t.replaceAll(",",""), [major,minor=""]=value.replace(/^-/,"").split(".");
  const n=Number(major)*100+Number(minor.padEnd(2,"0"));
  return Number.isSafeInteger(n) && n<1e13 ? (value.startsWith("-")?-n:n) : null;
}
const unitGroups=[["kg","公斤","千克"],["lb","lbs","磅"],["票","shipment"],["次","time"],["件","piece","pc"],["箱","carton"],["cbm","m3","m³","立方米"],["柜","container"]];
export function audit(records) {
  const prepared=records.map(record=>{
    const f=Object.fromEntries(keys.map(k=>[k,record.fields[k].value]));
    const unit=normalized(f.unit);
    const p={r:record,f,amount:cents(f.amount),currency:normalized(f.currency).toUpperCase(),unit:unitGroups.find(g=>g.includes(unit))?.[0]||unit};
    p.valid=keys.every(k=>normalized(f[k]))&&p.amount!==null&&validCurrencies.has(p.currency);
    p.pending=keys.some(k=>record.fields[k].confidence==="待人工");
    p.id=JSON.stringify(["supplier","shipment","charge"].map(k=>normalized(f[k])));
    p.full=JSON.stringify([p.id,p.unit,p.currency]);
    return p;
  });
  const invoices=prepared.filter(p=>p.r.side==="invoice"), bases=prepared.filter(p=>p.r.side==="baseline");
  function index(rows, prop) {
    const map=new Map();
    for(const row of rows){const k=row[prop];if(!map.has(k))map.set(k,[]);map.get(k).push(row)}
    return map;
  }
  const byBase=index(bases,"id"), byFullBase=index(bases,"full"), byFullInv=index(invoices,"full"), byInv=index(invoices,"id");
  const reviewed=new Set(), out=[];
  function entry(inv, matches, status, delta=null){
    out.push({id:inv?.r.id||matches[0].r.id, invoice:inv?.r||null, bases:matches.map(p=>p.r),status,delta});
    for(const p of matches)reviewed.add(p.r.id);
  }
  for(const inv of invoices){
    const matches=byFullBase.get(inv.full)||[], partial=byBase.get(inv.id)||[];
    if(!inv.valid){entry(inv,[], "invalid");continue}
    if(inv.pending){entry(inv,[], "pending");continue}
    if((byFullInv.get(inv.full)||[]).length>1 || matches.length>1){entry(inv,matches,"duplicate");continue}
    if(!matches.length){entry(inv,partial,partial.length?"mismatch":"missing");continue}
    const b=matches[0];
    if(!b.valid){entry(inv,matches,"invalid");continue}
    if(b.pending){entry(inv,matches,"pending");continue}
    const delta=inv.amount-b.amount;
    entry(inv,matches,delta>0?"over":delta<0?"under":"match",delta);
  }
  for(const b of bases)if(!reviewed.has(b.r.id)){
    const possible=byInv.get(b.id)||[];
    const st=!b.valid?"invalid":b.pending||possible.some(inv=>inv.pending||!inv.valid)?"pending":
      byFullBase.get(b.full).length>1?"duplicate":"unbilled";
    entry(null,[b],st);
  }
  return out;
}
export function auditDocuments(docs) {
  const blocked=new Set(["invoice","baseline"].filter(side=>!docs.some(d=>d.side===side) ||
    docs.some(d=>d.side===side && d.issues.length && !d.resolution)));
  return audit(docs.flatMap(d=>d.rows.filter(r=>!r.exclusion))).map(result=>{
    const incomplete=result.status==="missing" && blocked.has("baseline") || result.status==="unbilled" && blocked.has("invoice");
    return incomplete ? {...result,status:"incomplete",delta:null} : result;
  });
}
