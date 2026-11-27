const {test}=require('node:test');
const assert=require('node:assert/strict');
const {tidy,wrap,chars}=require('./core.js');
const sample='嗯，订单 DEMO-204；3 箱，22.5 lb，预计 12/02 到。未确认。';
test('clean preserves identifiers, numbers, decimals, date, units and uncertainty',()=>{
  assert.equal(tidy(sample,true),'订单 DEMO-204；3 箱，22.5 lb，预计 12/02 到。未确认。');
  assert.equal(tidy(sample,false),sample);
});
test('ordinary words are untouched in both languages',()=>{
  assert.equal(tidy('嗯，呃，样品 3 箱。',true),'样品 3 箱。');
  assert.equal(tidy('嗯哼，不能确认。Umber, useful; plumber.',true),'嗯哼，不能确认。Umber, useful; plumber.');
  assert.equal(tidy('Um, 10.5 kg. No ETA.',true),'10.5 kg. No ETA.');
});
test('typesetting retains long unbroken strings and wrapping identifiers',()=>{
  const ctx={measureText:s=>({width:chars(s).length*10})};
  const code='SH-01234567890123456789';
  const wrapped=wrap(ctx,code,60);assert.equal(wrapped.join(''),code);
  for(const line of wrapped)assert.ok(chars(line).length<=6);
  assert.equal(wrap(ctx,'👋订单\n\n20.5 lb',100).join('\n'),'👋订单\n\n20.5 lb');
});
test('Chinese closing marks and punctuation stay with the preceding glyph at line breaks',()=>{
  const ctx={measureText:s=>({width:chars(s).length*10})};
  for(const text of ['今天已入仓。','ABCDEF-0000123。','货物已入仓，周五提货；待确认！','订单《参考报价》；待确认。','仓库（需确认）。']){
    const result=wrap(ctx,text,50);
    assert.equal(result.join(''),text);
    assert.ok(result.every(line=>!(/^[。，、；：！？）》〉]/u.test(line))),JSON.stringify(result));
  }
});
