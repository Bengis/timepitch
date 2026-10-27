import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localSummarySpeechPreview,verifySummaryPreview} from './local-summary-speech-preview.mjs';
import {existsSync,readFileSync} from 'node:fs';
const privateFixture=existsSync(new URL('../../.local/speech-tp301/preview-manifest.json',import.meta.url));
function request(url,method='GET',host='127.0.0.1:18125'){
  let middleware;localSummarySpeechPreview().configureServer({middlewares:{use(prefix,handler){assert.equal(prefix,'/speech-summary-preview/');middleware=handler;}}});
  const headers={},res={statusCode:200,setHeader(k,v){headers[k]=v;},end(body){this.body=body;}};
  middleware({url,method,headers:{host}},res);return res;
}
test('DEV route serves fifty original MP3s and only the public-safe composed manifest',{skip:!privateFixture},()=>{
  const r=request('/manifest.json');assert.equal(r.statusCode,200);const m=JSON.parse(r.body);
  assert.equal(m.items.length,50);assert.equal(m.kind,'azure-summary-complete');
  assert.equal(m.proof,undefined);assert.equal(m.budget,undefined);assert.equal(m.authorization,undefined);
  assert.equal(request('/parent/005-en-en-goal.mp3').statusCode,200);assert.equal(request('/parent/005-en-en-goal.mp3','HEAD').body,undefined);
  assert.equal(request('/recovery/001-en-en-goal.mp3').statusCode,200);
  for(const item of m.items)assert.equal(request(item.asset.file.replace('/speech-summary-preview','')).statusCode,200);
});
test('DEV route denies foreign host, POST, traversal and private/rejected files',()=>{
  assert.equal(request('/manifest.json','POST').statusCode,405);
  assert.equal(request('/manifest.json','GET','attacker.test').statusCode,403);
  for(const p of ['/../speech-summary-ledger.sqlite3','/%2e%2e/authorization.json','/011-en-en-goal.mp3','/parent/011-en-en-goal.mp3','/recovery/../001-en-en-goal.mp3','/result.json','/authorization.json'])assert.equal(request(p).statusCode,404);
});
test('DEV manifest validation rejects extra private fields, duplicate clips and altered provenance',{skip:!privateFixture},()=>{
  const m=JSON.parse(readFileSync(new URL('../../.local/speech-tp301/preview-manifest.json',import.meta.url),'utf8'));
  for(const mutate of [x=>x.authorization={private:true},x=>x.items[1]=x.items[0],x=>x.items[0].origin.artifactSha256='0'.repeat(64),x=>x.items[0].slot.clock='replay',x=>x.items[0].asset.durationMs=1]){
    const altered=structuredClone(m);mutate(altered);assert.throws(()=>verifySummaryPreview(altered));
  }
});
