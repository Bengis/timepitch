import { defineConfig } from '@playwright/test';
const baseURL=process.env.TIMEPITCH_SEQUENCE_BASE_URL;
if(!baseURL)throw new Error('Required TIMEPITCH_SEQUENCE_BASE_URL: explicit isolated read-only server');
const url=new URL(baseURL);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!['18092','18093'].includes(url.port))throw new Error('Only isolated loopback sequence acceptance ports allowed');
const output=process.env.TIMEPITCH_SEQUENCE_OUTPUT_DIR;
if(!output)throw new Error('Required ignored TIMEPITCH_SEQUENCE_OUTPUT_DIR');
export default defineConfig({
  testDir:'./tests',testMatch:'sequence-acceptance.spec.ts',fullyParallel:false,workers:1,retries:0,timeout:90000,
  expect:{timeout:12000},outputDir:output,
  reporter:[['list'],['json',{outputFile:`${output}/results.json`}]],
  use:{baseURL,channel:'msedge',headless:true,colorScheme:'dark',serviceWorkers:'block',screenshot:'only-on-failure',trace:'off'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',grepInvert:/@desktop-record/,use:{viewport:{width:390,height:844}}}],
  // Deliberately no webServer hook: never start an engine/model-enabled server here.
});
