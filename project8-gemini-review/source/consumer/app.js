'use strict';
const $ = id => document.getElementById(id);
const ui = {
  zh:{language:'界面语言',headline:'把口述变成一张卡片',subhead:'说一段出货进度或日常随想，核对原话，存成图片。',edit:'编辑原文',style:'卡片样式',cargo:'出货简报',journal:'随手记',title:'卡片标题',text:'口述原文',clean:'省略独立出现的「嗯」「呃」',save:'保存 PNG',preview:'卡片预览',open:'打开图片以保存',start:'开始口述',stop:'停止口述',unsupported:'此浏览器未提供可用的语音转写。可输入、粘贴，或用手机键盘听写。',supported:'点击后浏览器会请求麦克风权限，语音可能由浏览器的在线服务处理。',listening:'正在听写。完成后请核对单号、日期和件数。',ended:'听写结束，可编辑原文。',refused:'未获得麦克风权限。可直接输入、粘贴，或使用键盘听写。',failed:'语音转写暂不可用。请改用输入、粘贴或键盘听写。',blank:'还没有正文。',long:'超过 600 字，请缩短原文再保存。',exported:'PNG 已生成。若未自动下载，可打开图片长按保存。',exportError:'浏览器未能生成图片，请换用其他浏览器。',sampleNote:'当前是虚构示例。输入自己的内容可替换。',overflow:'达到字数上限，本段转写未加入。请缩短文本后重试。',sample:'嗯，样品单 DEMO-27 今天已入仓，共 3 箱。\n预计周五安排提货，具体时间待仓库确认。',cargoTitle:'出货进度',journalTitle:'今日手记'},
  en:{language:'Interface',headline:'From spoken note to shareable card',subhead:'Capture a shipment update or a personal note. Check the wording, then save it as an image.',edit:'Edit your note',style:'Card style',cargo:'Dispatch brief',journal:'Journal',title:'Card title',text:'Original words',clean:'Remove standalone “um” and “uh”',save:'Save PNG',preview:'Card preview',open:'Open image to save',start:'Start dictation',stop:'Stop dictation',unsupported:'Dictation is unavailable here. Type, paste, or use your phone keyboard’s dictation.',supported:'Starting dictation requests microphone access. Your browser may process speech online.',listening:'Listening. Check identifiers, dates and quantities afterwards.',ended:'Dictation ended. You can edit your note.',refused:'Microphone permission was unavailable. Type, paste or use keyboard dictation.',failed:'Speech transcription is unavailable. Type, paste or use keyboard dictation.',blank:'Enter your note first.',long:'The note exceeds 600 characters. Shorten it to export.',exported:'PNG is ready. If it did not download, open the image and save it.',exportError:'This browser could not generate the image. Try another browser.',sampleNote:'Fictional example. Replace it with your own note.',overflow:'This speech segment exceeds the limit and was not added. Shorten the note and retry.',sample:'Um, sample order DEMO-27 reached the warehouse today, 3 cartons in total.\nPickup is expected on Friday. The warehouse has yet to confirm a time.',cargoTitle:'Shipment update',journalTitle:'Journal note'}
};
let lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
let active = null, ownClip = null;
let customTitle = false, synthetic = true;
const speechAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
const strings = () => ui[lang];
const isVoiceAvailable = () => Boolean(speechAPI && window.isSecureContext && navigator.onLine);
function resetClip() {
  if (ownClip) URL.revokeObjectURL(ownClip);
  ownClip = null;
  $('image-link').hidden = true;
  $('image-link').removeAttribute('href');
}
function updateCard() {
  resetClip();
  const raw = $('raw').value;
  const len = NoteCore.chars(raw).length;
  const body = NoteCore.tidy(raw, $('clean').checked);
  $('count').textContent = len + ' / ' + NoteCore.MAX;
  $('example').textContent = synthetic ? strings().sampleNote : '';
  $('export').disabled = !body || len > NoteCore.MAX || Boolean(active);
  $('status').textContent = len > NoteCore.MAX ? strings().long : (!body ? strings().blank : '');
  const title = $('title').value.trim() || strings()[$('style').value + 'Title'];
  const previewBody = len > NoteCore.MAX ? strings().long : body;
  drawNote($('card'), {style:$('style').value,title,body:previewBody,lang,synthetic});
  $('card').setAttribute('aria-label',title + ' — ' + previewBody);
}
function updateVoice() {
  $('mic').disabled = !active && !isVoiceAvailable();
  $('mic-label').textContent = strings()[active ? 'stop' : 'start'];
  $('voice-note').textContent = strings()[isVoiceAvailable() ? 'supported' : 'unsupported'];
}
function localize() {
  $('lang').value=lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN':'en';
  document.querySelectorAll('[data-i]').forEach(el => {el.textContent = strings()[el.dataset.i];});
  if (synthetic) $('raw').value = strings().sample;
  if (!customTitle) $('title').value = strings()[$('style').value + 'Title'];
  updateVoice();
  updateCard();
}
$('lang').addEventListener('change', () => { if(active) active.abort(); lang = $('lang').value; localize(); });
$('style').addEventListener('change', () => {if (!customTitle) $('title').value=strings()[$('style').value+'Title'];updateCard();});
$('title').addEventListener('input', () => {customTitle=Boolean($('title').value.trim());updateCard();});
$('raw').addEventListener('input', () => {synthetic = $('raw').value === strings().sample; updateCard();});
$('clean').addEventListener('change',updateCard);
$('mic').addEventListener('click', () => {
  if (active) { active.stop(); return; }
  if (!isVoiceAvailable()) return;
  let recognition, problem = false, began = false;
  try {
    recognition = new speechAPI();
    active = recognition;
    recognition.lang = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = event => {
      if (active !== recognition) return;
      let incoming = '';
      for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) incoming += event.results[i][0].transcript;
      if (!incoming.trim()) return;
      const prefix = synthetic ? '' : $('raw').value;
      const next = [prefix,incoming.trim()].filter(Boolean).join('\n');
      if (NoteCore.chars(next).length > NoteCore.MAX) {problem=true;$('status').textContent=strings().overflow;return;}
      $('raw').value=next; synthetic=false;updateCard();
    };
    recognition.onstart=()=>{began=true;updateVoice();$('status').textContent=strings().listening;};
    recognition.onerror=event=>{problem=true;$('status').textContent=strings()[event.error==='not-allowed'?'refused':'failed'];};
    recognition.onend=()=>{if (active!==recognition)return;const message=problem?$('status').textContent:strings()[began?'ended':'failed'];active=null;updateVoice();updateCard();$('status').textContent=message;};
    updateVoice(); updateCard(); recognition.start();
  } catch {active=null;updateVoice();updateCard();$('status').textContent=strings().failed;}
});
window.addEventListener('offline',updateVoice);
window.addEventListener('online',updateVoice);
$('export').addEventListener('click', () => {
  if ($('export').disabled) return;
  resetClip();
  $('card').toBlob(blob => {
    if (!blob) {$('status').textContent=strings().exportError;return;}
    ownClip=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=ownClip;a.download='dispatch-note.png';document.body.append(a);a.click();a.remove();
    $('image-link').href=ownClip;$('image-link').hidden=false;
    $('status').textContent=strings().exported;
  },'image/png');
});
localize();
if ('serviceWorker' in navigator && ['https:','http:'].includes(location.protocol))
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
