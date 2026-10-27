// DEV loopback preview: read only the two selected canary MP3s and their new public-safe envelope.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export function localSpeechPreview(){
  const local=resolve(fileURLToPath(new URL('../../.local/',import.meta.url)));
  const files=new Map([['manifest.json',resolve(local,'speech-tp294/preview-manifest.json')],
    ['02-en-excited.mp3',resolve(local,'speech-tp291-run/02-en-excited.mp3')],
    ['04-es-prosody.mp3',resolve(local,'speech-tp291-run/04-es-prosody.mp3')]]);
  return{name:'timepitch-local-saved-speech',apply:'serve',configureServer(server){
    server.middlewares.use('/speech-preview/',(req,res)=>{
      if(!['GET','HEAD'].includes(req.method??'')){res.statusCode=405;res.end();return;}
      const file=files.get((req.url??'').split('?')[0].replace(/^\/+/,''));
      if(!file){res.statusCode=404;res.end();return;}
      try{
        for(let node=file;node.startsWith(local);node=dirname(node))if(lstatSync(node).isSymbolicLink())throw new Error('Linked preview path');
        const real=realpathSync(file);if(!real.startsWith(realpathSync(local)+sep))throw new Error('Invalid saved Speech path');
        const bytes=readFileSync(real);res.setHeader('Content-Type',file.endsWith('.mp3')?'audio/mpeg':'application/json; charset=utf-8');
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Length',bytes.length);
        res.end(req.method==='HEAD'?undefined:bytes);
      }catch{res.statusCode=404;res.end();}
    });
  }};
}
