/** Prepared route battle QA only: native trainers, artificial party/transport. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../vendor/pokeweb-serverless/src/nds/narc';
import {readU16,readU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {installMapCameraTestWarp} from '../vendor/pokeweb-serverless/src/pokeweb/mapCameraTest';
import {compileBw2Script} from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import {gen5ScriptEntries} from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import {createQaSave,DEFAULT_QA_SAVE} from './qa-save';

const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const dir='build/research-route-runtime',prefix=`${dir}/tour`;
const sourcePath=arg('--source','build/route-doors.nds');
const source=readFileSync(sourcePath),sourceSha256=sha(source);
const report=JSON.parse(readFileSync(sourcePath.replace(/\.nds$/,'.json'),'utf8'));
check(sourceSha256===report.outputSha256,'Source/report hash mismatch');
const rom=new NintendoDSRom(source,{fileData:'view'});
check(rom.idCode==='IREO'&&source[0x1e]===0,'IREO revision 0 only');
const archive=(name:string)=>new NARC(new Uint8Array(rom.getFileByName(name)));
const headers=archive('a/0/1/2').files[0],scripts=archive('a/0/5/6'),events=archive('a/1/2/6');
const texts=archive('a/0/0/3'),trainers=archive('a/0/9/1'),parties=archive('a/0/9/2');
const rows=report.modules.world.routeTrainers;
check(rows.length===36&&rows.every((t:any,i:number)=>t.trainerId===842+i&&t.defeatedFlagId===0x93a+i),'Unexpected trainer allocation');
const components=rows.map((t:any)=>{
 const s=scripts.files[t.scriptId],entries=gen5ScriptEntries(s),start=entries[t.entry-1],end=entries[t.entry]??s.length;
 const ev=events.files[t.eventId],npc=8+ev[4]*20+t.npcIndex*36;
 check(readU16(ev,npc)===t.actorId&&readU16(ev,npc+28)===t.x&&readU16(ev,npc+30)===t.z,'NPC binding mismatch');
 return {trainerId:t.trainerId,headerId:t.headerId,scriptId:t.scriptId,eventId:t.eventId,textBankId:t.textBankId,
  headerSha256:sha(headers.subarray(t.headerId*48,(t.headerId+1)*48)),scriptSha256:sha(s),bodySha256:sha(s.subarray(start,end)),
  eventSha256:sha(ev),npcSha256:sha(ev.subarray(npc,npc+36)),textSha256:sha(texts.files[t.textBankId]),
  trainerSha256:sha(trainers.files[t.trainerId]),partySha256:sha(parties.files[t.trainerId])};
});
mkdirSync(dir,{recursive:true});
if(process.argv.includes('--compare')){
 const prior=JSON.parse(readFileSync(`${prefix}.json`,'utf8'));
 const differences=components.flatMap((c:any,i:number)=>Object.keys(c).filter(k=>c[k]!==prior.components[i][k]).map(k=>({trainerId:c.trainerId,component:k,before:prior.components[i][k],after:c[k]})));
 const result={fixtureSourceSha256:prior.sourceSha256,comparisonSourceSha256:sourceSha256,componentsEqual:differences.length===0,differences,
  boundary:'Component equality is preservation evidence, not a full runtime replay of the changed ROM.'};
 writeFileSync(arg('--report',`${dir}/component-comparison.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result));
}else{
 check(!existsSync(`${prefix}.nds`)&&!existsSync(`${prefix}.json`),'One fixture only; existing output must not be overwritten');
 const qa=createQaSave(readFileSync(DEFAULT_QA_SAVE),{party:'mew-smoke',clearFlags:rows.map((t:any)=>t.defeatedFlagId)});
 const save=qa.save,original={zoneId:readU32(save,0x19580),tileX:readU16(save,0x19586),tileZ:readU16(save,0x1958e),gridY:readU16(save,0x1958a)};
 const heal=compileBw2Script('preserve_layout\nscript :qa_heal, entry: 1 do\n poke_party_recover_all\n halt\nend\n');
 const healing=heal.bytes.subarray(heal.entries[0].offset,heal.entries[0].offset+2);
 check(heal.instructions[0].opcode===0x104&&heal.instructions[1].offset-heal.instructions[0].offset===2,'Healing must be the proven two-byte native opcode');
 const scenes=rows.map((t:any)=>({...t,compiledBytes:undefined,tileX:t.x,tileZ:t.z+1}));
 const changed=[],preserved:Array<{scriptId:number;eventId:number;scripts:Uint8Array;events:Uint8Array}>=[];
 for(let i=process.argv.includes('--loss-return')?-2:-1;i<scenes.length;i++){
  const from=i===-2?{zoneId:435,tileX:7,tileZ:12,gridY:0}:i===-1?original:{zoneId:scenes[i].headerId,...scenes[i]};
  const destinationIndex=i===-2?Number(arg('--loss-return-trainer','842'))-842:i<0?0:i+1;
  check(destinationIndex>=0&&destinationIndex<=scenes.length,'Invalid QA recovery target');
  const to=destinationIndex<scenes.length?{zoneId:scenes[destinationIndex].headerId,...scenes[destinationIndex]}:original;
  const scriptId=readU16(headers,from.zoneId*48+6),eventId=readU16(headers,from.zoneId*48+22);
  const before=new Uint8Array(scripts.files[scriptId]),ev=new Uint8Array(events.files[eventId]),oldEntries=gen5ScriptEntries(before);
  preserved.push({scriptId,eventId,scripts:before,events:ev});
  const fixture=installMapCameraTestWarp(before,ev,{gridX:from.tileX,gridY:i===-1?original.gridY:0,gridZ:from.tileZ},{zoneId:to.zoneId,tileX:to.tileX,tileZ:to.tileZ,height:0,facing:'up'});
  const entry=gen5ScriptEntries(fixture.scripts)[fixture.entryId-1];
  check(readU16(fixture.scripts,entry)===0,'Expected two-byte NOP prefix');
  fixture.scripts.set(healing,entry);
  check(fixture.entryId===oldEntries.length+1,'QA transport did not append');
  check(oldEntries.every((offset,index)=>gen5ScriptEntries(fixture.scripts)[index]===offset+4),'Original entry target rebased incorrectly');
  check(sha(before.subarray(oldEntries.length*4))===sha(fixture.scripts.subarray(oldEntries.length*4+4,before.length+4)),'Existing script bodies changed');
  const oldEventEnd=8+ev[4]*20+ev[5]*36+ev[6]*20+ev[7]*22;
  check(sha(ev.subarray(8,oldEventEnd))===sha(fixture.events.subarray(8,oldEventEnd)),'Existing event records changed');
  check(ev[4]===fixture.events[4]&&ev[5]===fixture.events[5]&&ev[6]===fixture.events[6]&&ev[7]+1===fixture.events[7],'Existing event counts changed');
  scripts.files[scriptId]=fixture.scripts;events.files[eventId]=fixture.events;
  changed.push({zoneId:from.zoneId,scriptId,eventId,entryId:fixture.entryId,target:to.zoneId,healingOpcode:readU16(healing,0),nativeScriptBodiesPreserved:true,nativeEventRecordsPreserved:true});
 }
 const ids=[rom.fileId('a/0/5/6'),rom.fileId('a/1/2/6')];
 const originalHashes=rom.files.map(sha);
 rom.files[ids[0]]=scripts.save();rom.files[ids[1]]=events.save();
 check(rom.files.every((b,i)=>ids.includes(i)||sha(b)===originalHashes[i]),'Unexpected NitroFS mutation');
 const output=rom.save({preserveOriginalLength:true});
 const serialized=new NintendoDSRom(output,{fileData:'view'}),serializedScripts=new NARC(serialized.getFileByName('a/0/5/6')),serializedEvents=new NARC(serialized.getFileByName('a/1/2/6'));
 for(const originalMember of preserved){
  const before=originalMember.scripts,after=serializedScripts.files[originalMember.scriptId],entries=gen5ScriptEntries(before);
  check(entries.every((offset,index)=>gen5ScriptEntries(after)[index]===offset+4),'Serialized entry dispatch changed');
  check(sha(before.subarray(entries.length*4))===sha(after.subarray(entries.length*4+4,before.length+4)),'Serialized script body changed');
  const ev=originalMember.events,end=8+ev[4]*20+ev[5]*36+ev[6]*20+ev[7]*22;
  check(sha(ev.subarray(8,end))===sha(serializedEvents.files[originalMember.eventId].subarray(8,end)),'Serialized native event changed');
 }
 check(sha(source)===sourceSha256,'Source mutated');
 writeFileSync(`${prefix}.nds`,output,{flag:'wx'});writeFileSync(`${prefix}.sav`,save,{flag:'wx'});
 const result={fixtureOnly:true,naturalCampaignProof:false,balanceProof:false,sourcePath,sourceSha256,romSha256:sha(output),qaSave:qa.report,
  original,scenes,changed,components,changedNitroFS:ids,transportHealing:true,
  limitations:['Synthetic level 100 Mew with 999 party stats.','Native QA warp and party recovery before each route; no emulated RAM writes.','All original trainer bodies and event/NPC records preserved.','Prepared isolated native battles, not an earned full campaign or balance test.']};
 writeFileSync(`${prefix}.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({sourceSha256,fixtureSha256:result.romSha256,trainers:scenes.length,changed:changed.length,healingOpcode:readU16(healing,0)}));
}
