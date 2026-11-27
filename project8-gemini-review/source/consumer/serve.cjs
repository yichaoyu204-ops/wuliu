'use strict';
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const allowed=new Set(['index.html','style.css','core.js','card.js','app.js','manifest.webmanifest','sw.js','icon-192.png','icon-512.png']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
function start(port=4174){
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!allowed.has(file)){res.writeHead(404);res.end();return;}
    fs.readFile(path.join(__dirname,file),(err,data)=>{
      if(err){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});res.end(data);
    });
  });
  return server.listen(port,'127.0.0.1');
}
if(require.main===module){const s=start(Number(process.argv[2]||4174));s.on('listening',()=>console.log('http://127.0.0.1:'+s.address().port+'/'));}
module.exports=start;
