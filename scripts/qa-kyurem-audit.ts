import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../vendor/pokeweb-serverless/src/nds/narc';
import {readU16,readU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {decompileBw2Script} from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import {gen5ScriptEntries} from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
const dir='build/research-legacy-kyurem';mkdirSync(dir,{recursive:true});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const bytes=readFileSync('build/candidate-final.nds');
if(sha(bytes)!=='32f0891f30ca94331d4410486abc37e46bc4bb009be60ac32336a84ccb51987a')throw Error('Production hash changed');
const rom=new NintendoDSRom(bytes,{fileData:'view'});
const arc=(path:string)=>new NARC(rom.getFileByName(path));
const headers=arc('a/0/1/2').files[0],events=arc('a/1/2/6'),scripts=arc('a/0/5/6');
const rows=[];
for(let id=0;id<headers.length/48;id++){
 const h=headers.subarray(id*48,id*48+48),event=readU16(h,22),e=events.files[event];
 const warps=[];for(let n=0;n<e[6];n++){const at=8+e[4]*20+e[5]*36+n*20;warps.push({index:n,offset:at,words:Array.from({length:10},(_,i)=>readU16(e,at+i*2))});}
 if(id===604||warps.some(w=>w.words[0]===604)){
  const npcs=[];for(let n=0;n<e[5];n++){const at=8+e[4]*20+n*36;npcs.push({index:n,offset:at,words:Array.from({length:18},(_,i)=>readU16(e,at+i*2))});}
  rows.push({id,event,script:readU16(h,6),level:readU16(h,8),header:[...h],eventSha256:sha(e),warps,npcs});
 }
}
const members=[1208,1209,1238];
const baseBytes=readFileSync('roms/pokemon-black2-us.nds'),base=new NintendoDSRom(baseBytes,{fileData:'view'});
const originalScripts=new NARC(base.getFileByName('a/0/5/6'));
const targetTail=gen5ScriptEntries(scripts.files[1208])[7];
const integrity=[
 {name:'native Kyurem and DNA scripts plus complete remaining tail',from:targetTail,source:originalScripts.files[1208].subarray(targetTail),production:scripts.files[1208].subarray(targetTail)},
 ...[1209,1238].map(id=>({name:`native member${id}`,from:0,source:originalScripts.files[id],production:scripts.files[id]})),
 ...[284,285].map(id=>({name:`native event${id}`,from:0,source:new NARC(base.getFileByName('a/1/2/6')).files[id],production:events.files[id]})),
].map(row=>({name:row.name,offset:row.from,sourceSha256:sha(row.source),productionSha256:sha(row.production),identical:sha(row.source)===sha(row.production)}));
if(!integrity.every(i=>i.identical))throw Error('Native target bytes changed');
const result={productionSha256:sha(bytes),baseSourceSha256:sha(baseBytes),noQaRomFixture:true,rows,members:members.map(id=>({id,sha256:sha(scripts.files[id]),entries:gen5ScriptEntries(scripts.files[id])})),integrity};
for(const id of members){writeFileSync(`${dir}/script-${id}.bin`,scripts.files[id]);if(id!==1209)writeFileSync(`${dir}/script-${id}.bws`,decompileBw2Script(scripts.files[id]).source);}
writeFileSync(`${dir}/native-audit.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
