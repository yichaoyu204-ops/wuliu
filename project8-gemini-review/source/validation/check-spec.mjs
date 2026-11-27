import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { audit, headerMap, keys, parseCSV, readTable } from "../b2b/core.mjs";
import { buildReport, importDocument, writeXlsx } from "../b2b/formats.mjs";

// The browser loads this same vendored ZIP library before formats.mjs.
globalThis.JSZip = createRequire(import.meta.url)("../b2b/vendor/jszip.min.js");

const header = ["Supplier", "Shipment", "Charge", "Currency", "Unit", "Amount"];
const baseRow = ["DEMO warehouse", "DEMO-01", "Handling", "CNY", "kg", "55.10"];

function row({ shipment, charge, currency, unit, amount } = {}) {
  return [baseRow[0], shipment ?? baseRow[1], charge ?? baseRow[2],
    currency ?? baseRow[3], unit ?? baseRow[4], amount ?? baseRow[5]];
}

function table(side, rows, { pdf = false, formulas = [] } = {}) {
  const doc = { id: side, name: side + ".demo", side, rows: [], issues: [], sha: "" };
  const name = pdf ? "第 2 页" : "Sheet 1";
  const cells = rows.map((values, index) => ({ row: index + 2, cells: values, formulas }));
  readTable(doc, [{ row: 1, cells: header }, ...cells], name, { pdf });
  return doc;
}

async function csvFile(name, text, side) {
  return importDocument(new File([text], name, { type: "text/csv" }), side);
}

const checks = {
  async intake() {
    await Promise.all(["invoice", "baseline"].map(async side => {
      const doc = await csvFile(side + ".csv", [header.join(","), row().join(",")].join("\n"), side);
      assert.equal(doc.side, side);
      assert.equal(doc.rows.length, 1);
      assert.match(doc.sha, /^[a-f\d]{64}$/);
      assert.deepEqual(doc.issues, []);
    }));
    const wrong = await csvFile("rate.csv", "费项,每公斤单价\n仓租,5", "baseline");
    assert.equal(wrong.rows.length, 0);
    assert.ok(wrong.issues.length);
  },

  async csv() {
    const data = '\uFEFF供应商,运单号,费用名,币种,计费单位,行金额\r\n"甲,乙",D1,"入库\n搬运",CNY,件,5\r\n甲,D2,仓租,CNY,件,6';
    const doc = await csvFile("multi.csv", data, "invoice");
    assert.equal(doc.rows.length, 2);
    assert.equal(doc.rows[0].fields.supplier.value, "甲,乙");
    assert.equal(doc.rows[0].fields.charge.value, "入库\n搬运");
    assert.match(doc.rows[1].fields.amount.source_ref, /F4$/);
    assert.equal(headerMap([...header, "金额"]), null);
    assert.throws(() => parseCSV('Supplier,Amount\n"unclosed,5'));
  },

  async fields() {
    const doc = table("invoice", [row({ amount: "" })]);
    const fields = doc.rows[0].fields;
    assert.deepEqual(Object.keys(fields).sort(), [...keys].sort());
    for (const field of Object.values(fields)) {
      assert.match(field.source_ref, /Sheet 1![A-F]2$/);
      assert.equal(field.evidence, field.value);
      assert.ok(field.confidence);
    }
    assert.equal(fields.amount.confidence, "缺失");
    assert.equal(fields.currency.confidence, "表头直接读取");
    assert.equal(audit(doc.rows)[0].status, "invalid");
  },

  async candidates() {
    for (const options of [{ pdf: true }, { formulas: ["F2"] }]) {
      const doc = table("invoice", [row()], options);
      const baseline = table("baseline", [row()]);
      for (const value of Object.values(doc.rows[0].fields)) assert.equal(value.confidence, "待人工");
      if (options.pdf) assert.match(doc.rows[0].fields.amount.source_ref, /第 2 页.*行 2/);
      const result = audit([...doc.rows, ...baseline.rows]).find(item => item.invoice);
      assert.equal(result.status, "pending");
      assert.equal(result.delta, null);
    }
  },

  async match() {
    const invoice = table("invoice", [row(), row({ charge: "Storage" })]);
    const baseline = table("baseline", [row({ charge: "Storage" }), row()]);
    assert.deepEqual(audit([...invoice.rows, ...baseline.rows]).map(item => item.status), ["match", "match"]);
    for (const side of ["invoice", "baseline"]) {
      const extra = table(side, [row()]);
      const items = audit([...invoice.rows, ...baseline.rows, ...extra.rows]);
      const ambiguous = items.filter(item => item.invoice?.fields.charge.value === "Handling");
      assert.ok(ambiguous.length);
      assert.ok(ambiguous.every(item => item.status === "duplicate" && item.delta === null));
    }
  },

  async amounts() {
    for (const [actual, expected, status, delta] of [
      ["55.11", "55.10", "over", 1], ["55.09", "55.10", "under", -1],
      ["1,200.99", "1200.99", "match", 0], ["5.001", "5.00", "invalid", null],
    ]) {
      const invoice = table("invoice", [row({ amount: actual })]);
      const baseline = table("baseline", [row({ amount: expected })]);
      const item = audit([...invoice.rows, ...baseline.rows]).find(item => item.invoice);
      assert.equal(item.status, status);
      assert.equal(item.delta, delta);
    }
  },

  async units() {
    const invoice = table("invoice", [row()]);
    for (const [changes, status] of [
      [{ unit: "磅" }, "mismatch"], [{ currency: "USD" }, "mismatch"], [{ unit: "公斤" }, "match"],
    ]) {
      const baseline = table("baseline", [row(changes)]);
      const [result] = audit([...invoice.rows, ...baseline.rows]);
      assert.equal(result.status, status);
      assert.equal(result.delta, status === "match" ? 0 : null);
    }
  },

  async missing() {
    const invoice = table("invoice", [row({ shipment: "D1" })]);
    const baseline = table("baseline", [row({ shipment: "D2" })]);
    const results = audit([...invoice.rows, ...baseline.rows]);
    assert.deepEqual(results.map(item => item.status).sort(), ["missing", "unbilled"]);
    assert.ok(results.every(item => item.delta === null));
  },

  async review() {
    const invoice = table("invoice", [row({ amount: "55.11" })]);
    const baseline = table("baseline", [row()]);
    const results = audit([...invoice.rows, ...baseline.rows]);
    const decisions = new Map([[results[0].id, { status: "已复核", note: "核对过两处原文" }]]);
    const report = buildReport([invoice, baseline], results, decisions);
    const detail = report["对账明细"][1];
    assert.equal(detail[8], 0.01);
    assert.deepEqual(detail.slice(9, 11), ["已复核", "核对过两处原文"]);
    assert.ok(detail[11].includes(invoice.name) && detail[12].includes(baseline.name));
    assert.equal(report["逐字段证据"].length - 1, keys.length * 2);
  },

  async workbook() {
    const docs = [];
    for (const [side, name] of [["invoice", "invoices.csv"], ["baseline", "procurement.csv"]]) {
      const path = new URL("../b2b/samples/" + name, import.meta.url);
      docs.push(await csvFile(name, await readFile(path, "utf8"), side));
    }
    assert.ok(docs.every(doc => doc.rows.length && !doc.issues.length));
    const results = audit(docs.flatMap(doc => doc.rows));
    assert.ok(results.some(item => item.status === "over" && item.delta > 0));
    const report = buildReport(docs, results, new Map());
    const blob = await writeXlsx(report);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const workbook = await zip.file("xl/workbook.xml").async("string");
    for (const label of ["对账明细", "逐字段证据", "文件与未决事项"]) assert.ok(workbook.includes(label));
    const evidence = await zip.file("xl/worksheets/sheet2.xml").async("string");
    assert.ok(evidence.includes("CSV!F2") && evidence.includes(docs[0].sha));
  },
};

const selected = process.argv[2] || "all";
if (selected !== "all" && !Object.hasOwn(checks, selected)) {
  throw Error("Unknown check. Choose " + Object.keys(checks).join(", ") + ", or all.");
}
for (const [name, check] of Object.entries(checks)) {
  if (selected !== "all" && name !== selected) continue;
  await check();
  console.log("PASS", name);
}
