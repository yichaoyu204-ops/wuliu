const { test } = require("node:test");
const assert = require("node:assert/strict");
const reviewIdentifier = require("./app.js");

test("preserves a mixed-case order ID and internal numbers", () => {
  assert.deepEqual(reviewIdentifier("  Demo-042  "), { ok: true, text: "Demo-042" });
});
test("blank input requests the missing field", () => {
  assert.deepEqual(reviewIdentifier("  "), { ok: false, text: "请填写单号。" });
});
test("accepts 60 Unicode characters and rejects 61", () => {
  assert.equal(reviewIdentifier("箱".repeat(60)).ok, true);
  assert.equal(reviewIdentifier("箱".repeat(61)).ok, false);
});
