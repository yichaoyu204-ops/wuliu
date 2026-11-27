'use strict';
// Rebuild from the two sibling source trees, retaining each original.
const fs=require('node:fs'), path=require('node:path');
const root=path.dirname(__dirname);
const read=(project,file)=>fs.readFileSync(path.join(root,project,file),'utf8');
const bytes=(project,file)=>fs.readFileSync(path.join(root,project,file)).toString('base64');
const save=(name,text)=>fs.writeFileSync(path.join(__dirname,name),text);
const script=js=>'<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>';
const asJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
function substitute(src,needle,repl){
  if(!src.includes(needle))throw Error('Unsupported source version: '+needle.slice(0,80));
  return src.replace(needle,()=>repl);
}
function consumer(){
  const file=name=>read('consumer',name);
  let html=file('index.html').replace(/\s*<link rel="(?:manifest|apple-touch-icon)"[^>]+>/g,'')
    .replace(/\s*<script defer src="[^"]+"><\/script>/g,'');
  html=substitute(html,'href="icon-192.png"','href="data:image/png;base64,'+bytes('consumer','icon-192.png')+'"');
  html=substitute(html,'<link rel="stylesheet" href="style.css">','<style>'+file('style.css')+'</style>');
  const app=file('app.js');
  const sw=app.indexOf("if ('serviceWorker' in navigator");
  if(sw<0)throw Error('Missing worker hook');
  html=substitute(html,'</body>',script(file('core.js'))+script(file('card.js'))+script(app.slice(0,sw))+'</body>');
  save('Dispatch-Notes.html',html);
}
function freight(){
  const file=name=>read('b2b',name);
  const cmaps={};
  for(const name of fs.readdirSync(path.join(root,'b2b','vendor','cmaps')).filter(n=>n.endsWith('.bcmap')))
    cmaps[name]=bytes('b2b','vendor/cmaps/'+name);
  const assets={cmaps,samples:{},core:file('core.mjs'),ollama:file('ollama.mjs'),locale:file('locale.mjs'),formats:file('formats.mjs'),app:file('app.mjs'),
    pdf:file('vendor/pdf.min.mjs'),worker:file('vendor/pdf.worker.min.mjs')};
  for(const name of ['invoices.csv','procurement.csv'])assets.samples[name]=file('samples/'+name);
  const cmapLicense=fs.readdirSync(path.join(root,'b2b','vendor','cmaps')).find(n=>/license/i.test(n));
  const licenses=[file('vendor/LICENSE-jszip.md'),file('vendor/LICENSE-pdfjs.txt')];
  if(cmapLicense)licenses.push(file('vendor/cmaps/'+cmapLicense));
  const languageLinks=source=>source.replace(/href="\.\/en\.html"/g,'href="?lang=en"').replace(/href="\.\/index\.html"/g,'href="?lang=zh"');
  const en=file('en.html');
  assets.enTitle=en.match(/<title>([^<]*)<\/title>/)[1];
  assets.enBody=languageLinks(en.match(/<body>([\s\S]+)<\/body>/)[1]);
  assets.enBody=substitute(assets.enBody,'href="./samples/template-en.csv" download','href="data:text/csv;charset=utf-8;base64,'+bytes('b2b','samples/template-en.csv')+'" download="template-en.csv"');
  assets.enBody=substitute(assets.enBody,'Use HTTPS or open the local server.','Open this single file in a modern desktop browser. Optional Ollama assistance requires a configured local service and browser permission.');
  let html=languageLinks(file('index.html'));
  html=substitute(html,'<link rel="stylesheet" href="./style.css">','<style>'+file('style.css')+'</style>');
  html=substitute(html,'<script src="./vendor/jszip.min.js" defer></script><script type="module" src="./app.mjs"></script>','');
  html=substitute(html,'href="./samples/template.csv" download','href="data:text/csv;charset=utf-8;base64,'+bytes('b2b','samples/template.csv')+'" download="template.csv"');
  html=substitute(html,'使用本机服务或 HTTPS 打开本页。','本单文件可在现代桌面浏览器直接打开。可选 Ollama 仍依赖已配置的本机服务与浏览器许可。');
  assets.formats=substitute(assets.formats,'import("./vendor/pdf.min.mjs")','globalThis.offlineFreight.openPdf()');
  assets.formats=substitute(assets.formats,'pdfjs.GlobalWorkerOptions.workerSrc=new URL("./vendor/pdf.worker.min.mjs",import.meta.url).href;','');
  assets.formats=substitute(assets.formats,'cMapUrl:new URL("./vendor/cmaps/",import.meta.url).href','BinaryDataFactory:globalThis.offlineFreight.BinaryFactory,useWorkerFetch:false,useWasm:false,cMapUrl:"embedded-cmaps/"');
  assets.app=substitute(assets.app,'fetch("./samples/"+file)','Promise.resolve(new Response(globalThis.offlineFreight.samples[file],{headers:{"Content-Type":"text/csv;charset=utf-8"}}))');
  // Browsers and managed environments may suppress a script-triggered download.
  assets.app=substitute(assets.app,'a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);',
    'a.click();const prior=document.querySelector("#offline-save");if(prior){URL.revokeObjectURL(prior.href);prior.remove()}const save=a.cloneNode();save.id="offline-save";save.textContent=english?"Save this workbook manually":"手动保存本次 Excel";document.querySelector("#export").after(save);');
  const boot=`
  (async function(){
    const data=JSON.parse(document.getElementById('offline-resources').textContent);
    if(new URLSearchParams(location.search).get('lang')==='en'){
      document.documentElement.lang='en';
      document.title=data.enTitle;
      document.body.innerHTML=data.enBody;
    }
    const toModule=source=>URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
    const core=toModule(data.core),ollama=toModule(data.ollama),locale=toModule(data.locale);
    const resolve=(text,name,url)=>text.split('"./'+name+'"').join(JSON.stringify(url));
    const formats=toModule(resolve(data.formats,'core.mjs',core));
    let pdfPromise;
    globalThis.offlineFreight={
      samples:data.samples,
      openPdf:()=>pdfPromise||= (async()=>{
        const worker=toModule(data.worker);
        globalThis.pdfjsWorker=await import(worker);
        const pdf=await import(toModule(data.pdf));
        pdf.GlobalWorkerOptions.workerSrc=worker;
        return pdf;
      })(),
      BinaryFactory:class{
        async fetch({kind,filename}){
          const encoded=kind==='cMapUrl' && data.cmaps[filename];
          if(!encoded)throw Error('未内嵌 PDF 资源 '+filename);
          return Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        }
      }
    };
    const app=resolve(resolve(resolve(resolve(data.app,'formats.mjs',formats),'core.mjs',core),'ollama.mjs',ollama),'locale.mjs',locale);
    await import(toModule(app));
    document.documentElement.dataset.offlineReady='true';
  })().catch(e=>{document.getElementById('status').textContent='当前浏览器无法打开单文件。请用新版桌面 Chrome 或 Edge 打开。'+e.message;});
  `;
  html=substitute(html,'</body>',
    '<script id="offline-licenses" type="application/json">'+asJSON(licenses)+'</script>'+
    '<script id="offline-resources" type="application/json">'+asJSON(assets)+'</script>'+
    script(file('vendor/jszip.min.js'))+script(boot)+'</body>');
  save('Freight-Review.html',html);
}
consumer();freight();
