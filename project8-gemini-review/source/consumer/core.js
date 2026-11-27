(function (root) {
  'use strict';
  const MAX = 600;
  function chars(s) { return Array.from(s); }
  function tidy(s, enabled) {
    const text = s.replace(/\r\n?/g, '\n').trim();
    if (!enabled) return text;
    // Only isolated hesitation tokens with explicit separators. Do not rewrite numbers, units or facts.
    return text.replace(/(^|[，,。.!！?？；;、\n])(?:[ \t]*(?:嗯+|呃+|[Uu]h|[Uu]m)[ \t]*(?:[，,、]|(?=\n|$)))+/gu, '$1').trim();
  }
  // Line-start prohibition (避头尾): keep closing marks attached to the preceding text.
  const closingMark=/^[。，、；：！？）》〉】〕］｝」』〗〙〛”’…,.!?;:%％)\]}]+$/u;
  function bindClosing(parts) {
    const groups=[];
    for (const value of parts) {
      if (closingMark.test(value) && groups.length) {
        let suffix=value;
        if(groups.length>1 && /^[ \t]+$/.test(groups.at(-1)))suffix=groups.pop()+suffix;
        groups[groups.length-1]+=suffix;
      } else groups.push(value);
    }
    return groups;
  }
  function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      const tokens = paragraph.match(/[A-Za-z0-9]+(?:[.\-/:][A-Za-z0-9]+)*|[ \t]+|[^\x00-\x7F]|./gu) || [];
      const joined=bindClosing(tokens);
      const full=ctx.measureText(paragraph).width;
      // Balance short two-line Chinese paragraphs, while retaining room for whole identifiers.
      const balance=Math.ceil(full*0.60);
      const canBalance=/\p{Script=Han}/u.test(paragraph) && full>width && full<1.35*width &&
        joined.every(token=>ctx.measureText(token).width<=balance);
      const lineWidth=canBalance?balance:width;
      for (const token of joined) {
        if (ctx.measureText(line + token).width <= lineWidth) { line += token; continue; }
        if (line.trimEnd()) lines.push(line.trimEnd());
        line = token.trimStart();
        if (ctx.measureText(line).width > width) {
          let part = '';
          for (const ch of bindClosing(chars(line))) {
            if (part && ctx.measureText(part + ch).width > width) { lines.push(part); part = ''; }
            part += ch;
          }
          line = part;
        }
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  const api = {MAX, chars, tidy, wrap};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoteCore = api;
})(globalThis);
