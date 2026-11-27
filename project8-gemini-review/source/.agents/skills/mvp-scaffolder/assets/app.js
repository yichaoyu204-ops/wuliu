"use strict";

function reviewIdentifier(input) {
  const value = input.trim();
  if (!value) return { ok: false, text: "请填写单号。" };
  if (Array.from(value).length > 60) return { ok: false, text: "单号最多 60 个字符，请核对。" };
  return { ok: true, text: value };
}

if (typeof module !== "undefined") module.exports = reviewIdentifier;
if (typeof document !== "undefined") {
  document.getElementById("check").addEventListener("submit", (event) => {
    event.preventDefault();
    const result = reviewIdentifier(document.getElementById("value").value);
    document.getElementById("result").textContent = result.ok ? "已录入单号 " + result.text : result.text;
  });
}
