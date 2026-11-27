import http from "node:http";
import path from "node:path";
import {readFile, readdir, mkdir, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const common = {
  zh: {lang:"zh-CN", title:"产品试用", alt:"English", altPath:"/en/", heading:"选择要试用的产品",
    b:"供应商账单核对", bd:"导入账单和采购约价，逐行查看差额、依据和待核项，导出 Excel。",
    c:"寄语 · 口述卡片", cd:"录入一段口述或文字，校对内容、选择版式，保存为可分享的图片。"},
  en: {lang:"en", title:"Product trials", alt:"中文", altPath:"/", heading:"Choose a product",
    b:"Freight invoice review", bd:"Compare supplier invoices with agreed purchase costs. Review evidence and exceptions, then export to Excel.",
    c:"Dispatch Notes", cd:"Turn a voice note or a draft into an editable card and save the result as an image."}
};
function home(t) {
  return `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.title} · Freight & Dispatch</title><meta name="description" content="${t.bd} ${t.cd}">
<link rel="alternate" hreflang="zh-CN" href="/"><link rel="alternate" hreflang="en" href="/en/"><style>
*{box-sizing:border-box}body{margin:0;background:#f4f7f6;color:#173b38;font:17px/1.65 'DM Sans',system-ui,sans-serif}
main{margin:9vh auto;padding:0 24px;max-width:1000px}nav{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #cadbd6;padding-bottom:18px}
nav a{color:inherit}h1{font-size:clamp(34px,6.5vw,68px);line-height:1.12;letter-spacing:-.045em;margin:62px 0 34px}section{display:grid;grid-template-columns:1fr 1fr;gap:18px}
section a{display:block;text-decoration:none;background:#173f3b;color:white;padding:30px 32px;border-radius:14px;min-height:190px}
section a:nth-child(2){background:#eadfce;color:#312c25}h2{font-size:26px;line-height:1.3;margin:0 0 16px}p{margin:0;max-width:42ch}
a:hover h2{text-decoration:underline}a:focus-visible{outline:4px solid #d68136;outline-offset:4px}
@media(max-width:640px){section{grid-template-columns:1fr}main{margin:30px auto}h1{margin:40px 0 24px}section a{min-height:140px}}
</style></head><body><main><nav><strong>Freight &amp; Dispatch</strong><a href="${t.altPath}">${t.alt}</a></nav>
<h1>${t.heading}</h1><section><a href="/b2b/${t.lang === "en" ? "en.html" : "index.html"}"><h2>${t.b}</h2><p>${t.bd}</p></a>
<a href="/consumer/index.html${t.lang === "en" ? "?lang=en" : ""}"><h2>${t.c}</h2><p>${t.cd}</p></a></section></main></body></html>`;
}
const files = new Map();
async function include(rel) { files.set("/" + rel, await readFile(path.join(root,rel))); }
for (const f of ["index.html","style.css","app.mjs","core.mjs","formats.mjs","ollama.mjs"]) await include("b2b/" + f);
async function includeDirectory(d) {
  for (const entry of await readdir(path.join(root,d), {withFileTypes:true})) {
    const relative = d + "/" + entry.name;
    if (entry.isDirectory()) await includeDirectory(relative);
    else if (entry.isFile()) await include(relative);
  }
}
for (const d of ["b2b/vendor","b2b/samples"]) await includeDirectory(d);
for (const f of await readdir(path.join(root,"b2b"))) {
  if (/^(?:i18n|lang|locale|translations)(?:[.\w-]*)\.(?:js|mjs|json)$/.test(f) || f === "en.html") await include("b2b/" + f);
}
for (const f of ["index.html","style.css","app.js","card.js","core.js","sw.js","manifest.webmanifest","icon-192.png","icon-512.png"]) await include("consumer/"+f);
files.set("/index.html", Buffer.from(home(common.zh)));
files.set("/en/index.html", Buffer.from(home(common.en)));
const types={".html":"text/html; charset=utf-8",".js":"application/javascript",".mjs":"application/javascript",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".csv":"text/csv; charset=utf-8",".png":"image/png",".txt":"text/plain; charset=utf-8",".md":"text/plain; charset=utf-8",".pdf":"application/pdf",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
if(process.argv[2]==="--build"){
  if (!process.argv[3]) throw new Error("Provide a destination directory for static files.");
  for(const [url,content] of files){
    const dest=path.join(path.resolve(process.argv[3]),url.slice(1));
    await mkdir(path.dirname(dest),{recursive:true});
    await writeFile(dest,content);
  }
  console.log("Static build:",files.size,"files");
}else{
  const server=http.createServer((req,res)=>{
    if(!["GET","HEAD"].includes(req.method)){res.writeHead(405);res.end();return;}
    let url=new URL(req.url,"http://localhost").pathname;if(url.endsWith("/"))url+="index.html";
    const body=files.get(url);if(!body){res.writeHead(404);res.end();return;}
    res.writeHead(200,{"Content-Type":types[path.extname(url)]||"application/octet-stream","X-Content-Type-Options":"nosniff"});
    res.end(req.method==="HEAD"?undefined:body);
  });
  server.listen(Number(process.env.PORT||0),"127.0.0.1",()=>{
    const url="http://127.0.0.1:"+server.address().port+"/";
    console.log("Product trials: "+url);
    if(process.argv.includes("--open")){
      let command, args;
      if(process.platform==="win32"){command="rundll32.exe";args=["url.dll,FileProtocolHandler",url];}
      else if(process.platform==="darwin"){command="open";args=[url];}
      else {command="xdg-open";args=[url];}
      const child=spawn(command,args,{detached:true,stdio:"ignore"});child.on("error",()=>{});child.unref();
    }
  });
}
