// Vite dev only: four fixed loopback test-fixture files, no generation route or arbitrary paths.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export function localSpeechTest(){
  const local=resolve(fileURLToPath(new URL('../../.local',import.meta.url))),root=resolve(local,'speech-playback-test');
  const files=new Set(['fictional.json','real.json','normal.wav','goal.wav']);
  return {name:'timepitch-local-speech-test',apply:'serve',configureServer(server){
    server.middlewares.use('/speech-test/',(req,res)=>{
      const name=(req.url??'').split('?')[0].replace(/^\/+/, '');
      if(!['GET','HEAD'].includes(req.method??'')){res.statusCode=405;res.end();return;}
      if(!files.has(name)){res.statusCode=404;res.end();return;}
      try{
        const file=resolve(root,name),real=realpathSync(file);
        if(lstatSync(root).isSymbolicLink()||lstatSync(file).isSymbolicLink()||!real.startsWith(realpathSync(local)+sep))throw new Error('Invalid test fixture path');
        const bytes=readFileSync(real);res.setHeader('Content-Type',name.endsWith('.wav')?'audio/wav':'application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);
      }catch{res.statusCode=404;res.end();}
    });
  }};
}
