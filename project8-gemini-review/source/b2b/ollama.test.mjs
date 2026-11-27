import test from "node:test";
import assert from "node:assert/strict";
import {suggestRows} from "./ollama.mjs";

const text = "Demo Supplier\n运单 DEMO-1\n仓租 CNY 120.00";
const fields = {supplier:"Demo Supplier", shipment:"DEMO-1", charge:"仓租", currency:"CNY", unit:"", amount:"120.00"};
const row = {line:3, fields, evidence:{...fields}};
const input = {text, model:"demo:local"};
function fake(rows, meta = {model_info:{"general.architecture":"test"}}) {
  return async (url, init) => {
    assert.equal(init.redirect, "error");
    const payload = url.endsWith("/api/show") ? meta : {message:{content:JSON.stringify({rows})}};
    return new Response(JSON.stringify(payload));
  };
}
test("source evidence retained, all candidates need review", async () => {
  const [r] = await suggestRows(input, fake([row]));
  assert.equal(r.fields.amount, "120.00"); assert.equal(r.confidence.currency, "待人工"); assert.equal(r.confidence.unit, "缺失");
  assert.match(r.sourceRef, /3/);
});
test("unsupported header is omitted and invented line charge cannot pass", async () => {
  const [r] = await suggestRows(input, fake([{...row,fields:{...fields,supplier:"Other supplier"}}, {...row,line:2}]));
  assert.equal(r.fields.supplier, "");
});
test("partial numeric substrings do not qualify", async () => {
  const out = await suggestRows(input, fake([{...row,fields:{...fields,amount:"20"},evidence:{...fields,amount:"20"}}]));
  assert.deepEqual(out, []);
});
test("remote endpoints and cloud model aliases rejected before sending input", async () => {
  for (const endpoint of ["https://example.org","http://localhost@other.test","http://127.0.0.1:11434/path"]) {
    await assert.rejects(suggestRows({...input,endpoint}, () => assert.fail()), /本机/);
  }
  await assert.rejects(suggestRows({...input,model:"foo:cloud"}, () => assert.fail()), /本机/);
});
test("model metadata checked before disclosing page text", async () => {
  let calls = 0;
  await assert.rejects(suggestRows(input, async (url, init) => {
    calls++; assert.ok(url.endsWith("/api/show")); assert.deepEqual(JSON.parse(init.body), {model:input.model});
    return new Response(JSON.stringify({remote_host:"remote", model_info:{name:"example"}}));
  }), /本机/);
  assert.equal(calls,1);
});
test("invalid selection and malformed model data fail explicitly", async () => {
  await assert.rejects(suggestRows({...input,text:" "}, fake([])), /原文/);
  await assert.rejects(suggestRows(input, fake(null)), /行/);
});
