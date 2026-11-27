// Use only the listed static assets. Incoming documents stay in the browser.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const port=Number(process.argv[2]||8765);
if(!Number.isInteger(port)||port<1||port>65535){console.error("Invalid port");process.exit(1)}
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".mjs":"application/javascript",".js":"application/javascript",".csv":"text/csv; charset=utf-8",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",".md":"text/plain; charset=utf-8"};
const allowed=new Set(["index.html","en.html","style.css","app.mjs","core.mjs","formats.mjs","locale.mjs","ollama.mjs","README.md","OLLAMA.md"]);
const server=http.createServer((req,res)=>{
  try{
    if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return}
    const url=new URL(req.url,"http://localhost"),relative=decodeURIComponent(url.pathname).slice(1)||"index.html";
    const file=path.resolve(__dirname,relative);
    const permitted=allowed.has(relative)||relative.startsWith("vendor/")||relative.startsWith("samples/");
    if(!permitted||!file.startsWith(__dirname+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
      res.writeHead(404);res.end();return;
    }
    res.setHeader("Content-Type",mime[path.extname(file)]||"application/octet-stream");
    res.setHeader("X-Content-Type-Options","nosniff");
    if(req.method==="HEAD"){res.end();return}fs.createReadStream(file).pipe(res);
  }catch{res.writeHead(400);res.end()}
});
server.on("error",err=>{console.error("无法启动："+err.message);process.exit(1)});
server.listen(port,"127.0.0.1",()=>console.log("运费核对台  http://127.0.0.1:"+port+"/  (Ctrl+C 退出)"));
