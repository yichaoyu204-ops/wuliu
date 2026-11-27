const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('worker precaches shipped assets and serves same-scope navigation and static files',async()=>{
  const events={}, deletions=[], scope='https://example.invalid/tools/notes/';
  const cached=new Map(),keys=[];
  const cache={addAll:async names=>{for(const name of names){assert.ok(fs.existsSync(path.join(__dirname,name)));cached.set(name,'cached:'+name);}},match:async request=>cached.get(typeof request==='string'?request:new URL(request.url).pathname.split('/').pop())};
  const caches={open:async key=>{keys.push(key);return cache;},keys:async()=>[keys[0],keys[0].replace(/[^-]+$/,'old'),'another-app'],delete:async k=>deletions.push(k)};
  const self={registration:{scope},addEventListener:(e,f)=>{events[e]=f;},skipWaiting:async()=>{},clients:{claim:async()=>{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'sw.js'),'utf8'),{self,caches,URL,fetch:()=>{throw Error('offline');}});
  const fire=async(type,extra={})=>{let p;events[type]({...extra,waitUntil:v=>{p=v;},respondWith:v=>{p=v;}});return await p;};
  await fire('install');await fire('activate');assert.equal(deletions.length,1);
  assert.equal(await fire('fetch',{request:{url:scope,mode:'navigate',method:'GET'}}),'cached:index.html');
  assert.equal(await fire('fetch',{request:{url:scope+'card.js',method:'GET'}}),'cached:card.js');
  assert.equal(await fire('fetch',{request:{url:'https://other.invalid',method:'GET'}}),undefined);
  assert.equal(await fire('fetch',{request:{url:scope+'note',method:'POST'}}),undefined);
});
