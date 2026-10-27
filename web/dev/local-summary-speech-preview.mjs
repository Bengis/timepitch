// DEV-only, loopback, read-only allowlist. No provider, credentials or write capability.
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const local=resolve(fileURLToPath(new URL('../../.local/',import.meta.url)));
const sealed=JSON.parse(readFileSync(new URL('../src/match-centre/narration/fixtures/summary-cache.json',import.meta.url),'utf8'));
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=x=>createHash('sha256').update(x).digest('hex');
function safeRead(file){
  if(!file.startsWith(local+sep))throw new Error('Outside preview');
  for(let node=file;;node=dirname(node)){if(lstatSync(node).isSymbolicLink())throw new Error('Linked preview');if(node===local)break;}
  const real=realpathSync(file);if(!real.startsWith(realpathSync(local)+sep))throw new Error('Outside preview');return readFileSync(real);
}
export function verifySummaryPreview(m){
  const keys=['version','kind','source','parentArtifactSha256','recoveryArtifactSha256','items'];
  if(!m||canonical(Object.keys(m).sort())!==canonical(keys.sort())||m.version!=='saved-summary-preview-2'||m.kind!=='azure-summary-complete'||canonical(m.source)!==canonical(sealed.source)||m.parentArtifactSha256!==sealed.parentArtifactSha256||m.recoveryArtifactSha256!==sealed.recoveryArtifactSha256||!Array.isArray(m.items)||m.items.length!==50)throw new Error('Invalid preview');
  const ids=new Set(),files=new Set();
  for(const item of m.items){
    if(hash(canonical(item))!==sealed.itemHashes[item?.cue?.id]||ids.has(item.cue.id)||files.has(item.asset.file))throw new Error('Unverified preview');
    ids.add(item.cue.id);files.add(item.asset.file);
  }
  return m;
}
export function localSummarySpeechPreview(){
  return{name:'timepitch-local-summary-speech',apply:'serve',configureServer(server){
    server.middlewares.use('/speech-summary-preview/',(req,res)=>{
      if(!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host??'')){res.statusCode=403;res.end();return;}
      if(!['GET','HEAD'].includes(req.method??'')){res.statusCode=405;res.end();return;}
      try{
        const m=verifySummaryPreview(JSON.parse(safeRead(resolve(local,'speech-tp301/preview-manifest.json')).toString('utf8')));
        const files=new Map();
        for(const item of m.items){
          if(hash(canonical(item))!==sealed.itemHashes[item.cue.id]||files.has(item.asset.file))throw new Error('Unverified preview');
          const name=item.asset.file.replace('/speech-summary-preview/','');
          const match=/^(parent|recovery)\/(\d{3}-[\w-]+\.mp3)$/.exec(name);
          if(!match)throw new Error('Invalid audio path');
          files.set('/'+name,{file:resolve(local,match[1]==='parent'?'speech-tp296-run':'speech-tp299-run',match[2]),sha256:item.asset.sha256});
        }
        const url=(req.url??'').split('?')[0];let bytes,mime;
        if(url==='/manifest.json'){bytes=Buffer.from(JSON.stringify(m));mime='application/json; charset=utf-8';}
        else{const entry=files.get(url);if(!entry)throw new Error('Not allowlisted');bytes=safeRead(entry.file);if(hash(bytes)!==entry.sha256)throw new Error('Changed audio');mime='audio/mpeg';}
        res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Length',bytes.length);
        res.end(req.method==='HEAD'?undefined:bytes);
      }catch{res.statusCode=404;res.end();}
    });
  }};
}
