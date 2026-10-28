import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../vendor/pokeweb-serverless/src/nds/narc';
import {readU16,readU32,writeU16} from '../vendor/pokeweb-serverless/src/nds/binary';
import {parseGen5MatrixFile} from '../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import {extractGameFreakContainer,parseVMapTerrain} from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import {decodeGen5TextBank} from '../vendor/pokeweb-serverless/src/pokeweb/text';
import {gen5ScriptCommandSize,gen5ScriptEntries} from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import {scanGen5ScriptPokemonCommands} from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptPokemonScanner';
import {decompileBw2Script} from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import {applyWorld,WORLD_FIRST_ZONE,WORLD_PATHS} from '../scripts/rom/world';
import {installMapCameraTestWarp} from '../vendor/pokeweb-serverless/src/pokeweb/mapCameraTest';
import {applyCampaignDefinitions} from '../scripts/rom/campaign';
import {applySpecies} from '../scripts/rom/species';
import {compareTextArchives} from '../scripts/dialogue-guard';
import {decompressCode} from '../vendor/pokeweb-serverless/src/nds/codeCompression';
import {auditWorldQuestState,assertWorldStateLiteralAbsence,WORLD_QUEST_FLAGS,WORLD_QUEST_WORK,WORLD_ROOT_FLAGS} from '../scripts/rom/world-state';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const source=readFileSync('roms/pokemon-black2-us.nds'),baseHash='39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99';assert.equal(hash(source),baseHash);
const original=new NintendoDSRom(source,{fileData:'view'});
// An odd-position set_flag command is legal bytecode. Its operand must never
// evade the allocator as the previous offset+=2 scan did.
for(const id of [...WORLD_QUEST_FLAGS,...WORLD_ROOT_FLAGS,...WORLD_QUEST_WORK]){
 const odd=new Uint8Array([0,0x23,0,id&255,id>>>8,2,0]);
 assert.throws(()=>assertWorldStateLiteralAbsence(odd,[id],'odd-command'),/odd-command:3/);
}
for(const [id,path]of [[WORLD_QUEST_FLAGS[0],'a/0/5/6'],[WORLD_ROOT_FLAGS[0],'a/0/5/6'],[WORLD_QUEST_WORK[0],'a/1/2/6']]as const){
 const fileId=original.fileId(path),old=original.files[fileId],narc=new NARC(new Uint8Array(old));
 narc.files[0]=new Uint8Array([0,0x23,0,id&255,id>>>8,2,0]);original.files[fileId]=narc.save();
 assert.throws(()=>auditWorldQuestState(original),new RegExp(`Reserved world state 0x${id.toString(16)} already used`));original.files[fileId]=old;
}
// Guard the inspected native tables, pointer formula, zero initializer and the
// larger computed-consumer review against subsequent native-code changes.
const oldArm=original.arm9;
for(const [address,value,error]of [[0x02092238,WORLD_ROOT_FLAGS[0],/flag overlaps native table/],[0x0208FA60,WORLD_QUEST_WORK[0],/work overlaps native table/],[0x02019294,0,/native work signature/],[0x0201919C,0,/native work signature/],[0x02020000,0,/Native work audit binaries changed/]]as const){
 original.arm9=new Uint8Array(decompressCode(oldArm));const offset=address-original.arm9RamAddress;writeU16(original.arm9,offset,value===0?readU16(original.arm9,offset)^1:value);
 assert.throws(()=>auditWorldQuestState(original),error);original.arm9=oldArm;
}
const originalAudit=auditWorldQuestState(original);
// Native initializer signature proves zero initialization; the bundled raw
// save independently confirms these words are zero in both save slots.
const initialSave=readFileSync('vendor/pokeweb-serverless/src/assets/testbattle/test.sav');
for(const half of [0,0x26000])for(const w of originalAudit.savedWork)assert.equal(readU16(initialSave,half+0x1FF00+w.byteOffset),0);
const rom=new NintendoDSRom(source,{fileData:'view'}),campaign=applyCampaignDefinitions(rom),before=[...rom.files];
const report:any=applyWorld(rom,{campaign});
assert.equal(WORLD_FIRST_ZONE,616);assert.equal(report.counts.towns,24);assert.equal(report.counts.secrets,96);assert.equal(report.counts.routes,40);assert.equal(report.counts.gyms,12);assert.equal(report.counts.habitats,68);assert.equal(report.counts.staticEncounters,141);assert.equal(report.counts.interiors,48);
assert.equal(hash(source),baseHash);assert.equal(hash(rom.data),baseHash);
const owned=new Set([...Object.values(WORLD_PATHS),'a/0/0/2'].map(p=>rom.fileId(p)));for(let id=0;id<rom.files.length;id++)if(!owned.has(id))assert.equal(rom.files[id],before[id],`Unowned file changed ${id}`);
const a=Object.fromEntries(Object.entries(WORLD_PATHS).map(([k,p])=>[k,new NARC(new Uint8Array(rom.getFileByName(p)))]));
const originalHeaders=new NARC(new Uint8Array(before[rom.fileId(WORLD_PATHS.headers)])).files[0];
assert.deepEqual(a.headers.files[0].subarray(0,615*48),originalHeaders,'Native headers preserved, including donor518');assert.deepEqual(a.headers.files[0].subarray(615*48,616*48),new Uint8Array(48),'Header615 is reserved cache sentinel');
for(const key of ['maps','matrix','story'] as const){const native=new NARC(new Uint8Array(before[rom.fileId(WORLD_PATHS[key])]));for(let i=0;i<native.files.length;i++)assert.deepEqual(a[key].files[i],native.files[i],`Original ${key} member${i} changed`);}
for(const path of ['a/0/0/2','a/0/0/3'])assert.equal(compareTextArchives(before[rom.fileId(path)],rom.getFileByName(path)).differences.length,0);
const locations=decodeGen5TextBank(new NARC(new Uint8Array(rom.getFileByName('a/0/0/2'))).files[109]);
for(const area of report.areas){
 const h=a.headers.files[0].subarray(area.headerId*48,(area.headerId+1)*48);assert.notEqual(area.headerId,615);assert.equal(readU16(h,4),area.matrixId);assert.equal(readU16(h,6),area.scriptId);assert.equal(readU16(h,8),area.levelScriptId);assert.equal(readU16(h,10),area.textBankId);assert.equal(readU16(h,22),area.eventId);assert.equal(locations[h[26]|((h[27]&3)<<8)][1],area.name);
 const m=parseGen5MatrixFile(a.matrix.files[area.matrixId]);assert.equal(m.matrix_flags,0);assert.deepEqual(Array.from({length:m.width*m.height},(_,i)=>m[`map_${i}`]),area.mapIds);
 const event=a.events.files[area.eventId],entries=gen5ScriptEntries(a.scripts.files[area.scriptId]);assert.equal(readU32(event,0),event.length-4);
 // The upstream native parser must accept new event tables as fixture origins.
 if(area.headerId===777){const fixture=installMapCameraTestWarp(a.scripts.files[area.scriptId],event,{gridX:23,gridY:0,gridZ:27},{zoneId:810,tileX:8,tileZ:8,height:0,facing:'up'});assert.equal(readU32(fixture.events,0)+4,fixture.events.length);}
 for(let i=0;i<event[5];i++){const at=8+i*36;assert.ok(readU16(event,at+10)>=1&&readU16(event,at+10)<=entries.length);}
 for(let i=0;i<event[7];i++)assert.ok(readU16(event,8+event[5]*36+i*22)<=entries.length);
 const round=decompileBw2Script(a.scripts.files[area.scriptId]);assert.ok(round.roundTripVerified&&round.editable);assert.equal(a.scripts.files[area.levelScriptId].length,4);
 for(const map of area.mapIds){const c=extractGameFreakContainer(a.maps.files[map]);assert.equal(c.signature,'WB');assert.equal(parseVMapTerrain(c.files[1]).tiles.length,1024);}
}
for(const kind of ['town','secret']){const areas=report.areas.filter((x:any)=>x.kind===kind),hashes=new Set(areas.map((x:any)=>x.mapIds.map((i:number)=>hash(a.maps.files[i])).join(':')));assert.equal(hashes.size,areas.length,`Duplicate ${kind} layout resources`);}
assert.equal(new Set(report.areas.flatMap((x:any)=>x.mapIds)).size,report.counts.maps);
for(const key of ['headerId','matrixId','eventId','scriptId','textBankId'])assert.equal(new Set(report.areas.map((x:any)=>x[key])).size,report.areas.length,`Shared ${key}`);
for(const binding of report.staticEncounters){const commands=scanGen5ScriptPokemonCommands(a.scripts.files[binding.scriptId],'BW2').commands.filter(c=>c.entryIndex===binding.entry-1&&c.fields.species?.value===binding.species&&c.fields.level?.value===binding.level);assert.equal(commands.length,1);assert.equal(binding.flagId,null);assert.equal(binding.captureState.mode,1);const text=decompileBw2Script(a.scripts.files[binding.scriptId]).source;assert.match(text,/poke_dex_is_regist/);}
assert.equal(report.storyNpcSpots.length,8);for(const spot of report.storyNpcSpots){const event=a.events.files[spot.eventId];assert.equal(spot.npcIndex,3);assert.equal(readU16(event,8+36*spot.npcIndex),spot.actorId);assert.equal(readU16(event,8+36*spot.npcIndex+2),spot.name==='N'?103:97);assert.equal(readU16(event,8+36*spot.npcIndex+10),4);}
const nativeScriptIds=new Set(report.entrances.map((x:any)=>x.scriptId)),nativeEventIds=new Set(report.entrances.map((x:any)=>x.eventId));
const nativeEvents=new NARC(new Uint8Array(before[rom.fileId(WORLD_PATHS.events)]));
for(const entrance of report.entrances){
 const old=nativeEvents.files[entrance.eventId],next=a.events.files[entrance.eventId];
 const logicalEnd=8+next[4]*20+next[5]*36+next[6]*20+next[7]*22;
 assert.equal(readU32(next,0),logicalEnd-4,'native event size excludes size word and padding');
 assert.equal(readU32(next,0),readU32(old,0)+36,'one NPC grows logical event payload by 36 bytes');
 assert.deepEqual(next.subarray(logicalEnd),old.subarray(readU32(old,0)+4),'native trailing padding preserved');
}
for(const key of ['scripts','events']as const){const native=new NARC(new Uint8Array(before[rom.fileId(WORLD_PATHS[key])]));for(let i=0;i<native.files.length;i++)if(!(key==='scripts'?nativeScriptIds:nativeEventIds).has(i))assert.deepEqual(a[key].files[i],native.files[i],`Unowned native ${key}${i} changed`);}
const sewer=report.entrances.find((x:any)=>x.anchorId==='sewer.native');assert.equal(sewer.headerId,495);assert.equal(sewer.scriptId,990);assert.equal(sewer.eventId,286);assert.equal(sewer.targetHeaderId,788);
const water=report.habitats.filter((h:any)=>h.surfTiles.length);assert.ok(water.length>=6);for(const h of water)assert.ok(h.walkableShore.length>0);

/** Execute the generated native control flow for state safety. Graphics, save
 * serialization and the native VM itself still require emulator tests. */
function runEntry(scriptId:number,entry:number,state:{flags:Set<number>;work:Map<number,number>;badges:number}){
 const bytes=a.scripts.files[scriptId],stack:number[]=[],deleted:number[]=[],writes:number[]=[],messages:number[]=[],warps:number[]=[],workWrites:{workId:number;value:number}[]=[];
 let pc=entry*4+(readU32(bytes,(entry-1)*4)|0),comparison=0;
 const value=(v:number)=>v>=0x4000?state.work.get(v)??0:v;
 const cmp=(k:number,l:number,r:number)=>[l<r,l===r,l>r,l<=r,l>=r,l!==r][k];
 for(let tick=0;tick<2000;tick++){
  const op=readU16(bytes,pc),size=gen5ScriptCommandSize(op,'BW2'),x=readU16(bytes,pc+2),y=readU16(bytes,pc+4);assert.ok(size>0);let next=pc+size;
  switch(op){
   case 0x02:return {deleted,writes,messages,warps,workWrites};
   case 0x08:stack.push(x);break;
   case 0x09:stack.push(value(x));break;
   case 0x10:stack.push(Number(state.flags.has(x)));break;
   case 0x11:{const r=stack.pop()!,l=stack.pop()!;stack.push(Number(cmp(x,l,r)));break;}
   case 0x12:state.work.set(x,value(x)&value(y));workWrites.push({workId:x,value:value(x)});break;
   case 0x13:state.work.set(x,value(x)|value(y));workWrites.push({workId:x,value:value(x)});break;
   case 0x19:comparison=value(x)-y;break;
   case 0x1E:next+=readU32(bytes,pc+2)|0;break;
   case 0x1F:if(bytes[pc+2]===255?stack.pop()!==1:cmp(bytes[pc+2],comparison,0))next+=readU32(bytes,pc+3)|0;break;
   case 0x23:state.flags.add(x);writes.push(x);break;
   case 0x2A:state.work.set(x,value(y));workWrites.push({workId:x,value:value(x)});break;
   case 0x3D:messages.push(y);break;
   case 0x6C:deleted.push(x);break;
   case 0xD7:state.work.set(x,state.badges);break;
   case 0xC2:warps.push(x);break;
   case 0x2E:case 0x2F:case 0x30:case 0x32:case 0x3E:case 0x74:case 0xA6:break;
   default:throw new Error(`Unsupported world test VM opcode 0x${op.toString(16)}`);
  }
  assert.ok(next>=6&&next<bytes.length);pc=next;
 }
 throw new Error('Generated state script did not terminate');
}
assert.equal(report.quests.length,3);assert.deepEqual(report.stateAudit.flags,[0xA99,0xA9B,0xA9F]);assert.equal(report.stateAudit.savedFlagOffset,862);assert.ok(report.stateAudit.trainerLast<0x960);
assert.equal(new Set(report.stateAudit.flags).size,3);assert.deepEqual(report.stateAudit.rootFlagsTableAudited,[...WORLD_ROOT_FLAGS]);assert.deepEqual(report.stateAudit.rootFlagsScriptAndEventAudited,[...WORLD_ROOT_FLAGS]);
assert.equal(report.stateAudit.literalScanStride,1);assert.equal(report.stateAudit.nativeTables.length,7);assert.equal(report.stateAudit.nativeWorkTables.length,4);assert.equal(report.stateAudit.savedWorkWords,431);
assert.deepEqual(report.stateAudit.savedWork.map((w:any)=>w.workId),[0x419C,0x419D,0x419E]);assert.deepEqual(report.stateAudit.savedWork.map((w:any)=>w.byteOffset),[824,826,828]);
assert.equal(report.stateAudit.nativeWorkAudit.initialization.bytes,0x4DE);assert.equal(report.stateAudit.nativeWorkAudit.mapReset.endExclusive,0x401F);assert.equal(report.stateAudit.emulatorPersistenceValidated,false);
const repairOrders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for(const quest of report.quests){
 assert.deepEqual(quest.flags,[quest.completionFlag]);assert.equal(quest.progress.completionMask,63);
 const clues=quest.bindings.filter((b:any)=>b.role==='clue'),repairs=quest.bindings.filter((b:any)=>b.role==='repair'),keeper=quest.bindings.find((b:any)=>b.role==='report');
 for(const [i,b]of [...clues,...repairs].entries()){assert.equal(b.flagId,undefined);assert.equal(b.workId,quest.workId);assert.equal(b.bitMask,1<<i);}
 const binding=report.staticEncounters.find((b:any)=>b.species===quest.species&&b.kind==='quest visitor');assert.ok(binding.requiredFlags.includes(quest.completionFlag));
 assert.equal(keeper.flagId,quest.completionFlag);
 for(const order of repairOrders){
  const state={flags:new Set<number>(),work:new Map<number,number>(WORLD_QUEST_WORK.map(w=>[w,0])),badges:8};
  const run=(b:any)=>runEntry(b.scriptId,b.entry,state);
  const savedWrites=(r:ReturnType<typeof runEntry>)=>r.workWrites.filter(w=>w.workId<0x8000);
  assert.deepEqual(savedWrites(run(repairs[0])),[]);assert.deepEqual(savedWrites(run(clues[2])),[]);assert.deepEqual(savedWrites(run(clues[1])),[]);
  let mask=0;
  for(const c of clues){const result=run(c);mask|=c.bitMask;assert.deepEqual(result.writes,[]);assert.deepEqual(savedWrites(result),[{workId:quest.workId,value:mask}]);assert.deepEqual(savedWrites(run(c)),[]);assert.deepEqual(run(keeper).writes,[]);}
  for(const index of order){const r=repairs[index],result=run(r);mask|=r.bitMask;assert.deepEqual(result.writes,[]);assert.deepEqual(savedWrites(result),[{workId:quest.workId,value:mask}]);assert.deepEqual(savedWrites(run(r)),[]);}
  assert.equal(mask,63);assert.equal(state.work.get(quest.workId),63);
  // Serialize and restore the saved work bytes while discarding temporary VM
  // state; this is a binding/state-machine test, not native save evidence.
  const saved=new Uint8Array(862);for(const [id,v]of state.work)if(id>=0x4000&&id<=0x41AE)writeU16(saved,2*(id-0x4000),v);
  state.work.clear();for(const id of WORLD_QUEST_WORK)state.work.set(id,readU16(saved,2*(id-0x4000)));
  for(const id of WORLD_QUEST_WORK)assert.equal(state.work.get(id),id===quest.workId?63:0,'Quests must not share progress');
  assert.deepEqual(run(keeper).writes,[],'Gym prerequisite still applies after all repairs');
  state.flags.add(quest.requiredGymFlag);state.badges=quest.requiredOriginalBadges-1;assert.deepEqual(run(keeper).writes,[]);
  state.badges=quest.requiredOriginalBadges;assert.deepEqual(run(keeper).writes,[quest.completionFlag]);assert.deepEqual(run(keeper).writes,[]);
 }
 // Exercise every partial six-bit mask, including malformed/out-of-order state.
 // Missing progress cannot pass a keeper, and each repair needs all three clues.
 for(let mask=0;mask<64;mask++){
  const state={flags:new Set<number>([quest.requiredGymFlag]),work:new Map([[quest.workId,mask|0x8000]]),badges:8};
  const result=runEntry(keeper.scriptId,keeper.entry,state);assert.deepEqual(result.writes,mask===63?[quest.completionFlag]:[]);
  for(const b of [...clues,...repairs]){
   state.work.set(quest.workId,mask|0x8000);const result=runEntry(b.scriptId,b.entry,state);
   const expected=(mask&b.requiredWorkMask)===b.requiredWorkMask?mask|b.bitMask:mask;
   assert.equal(state.work.get(quest.workId),expected|0x8000);assert.deepEqual(result.writes,[]);
  }
 }
}
for(const gym of report.gyms){
 const event=a.events.files[gym.eventId],state={flags:new Set<number>(),work:new Map<number,number>(),badges:8};
 const runControl=(control:number)=>runEntry(gym.scriptId,readU16(event,8+(2+control)*36+10),state),order=gym.puzzle.order;
 assert.deepEqual(runControl(order[2]).deleted,[]);assert.equal(state.work.get(0x4000),0);
 assert.deepEqual(runControl(order[0]).deleted,[]);assert.equal(state.work.get(0x4000),1);
 assert.deepEqual(runControl(order[2]).deleted,[]);assert.equal(state.work.get(0x4000),0);
 for(let i=0;i<3;i++){const r=runControl(order[i]);assert.equal(state.work.get(0x4000),i+1);assert.deepEqual(r.deleted,i===2?[5]:[]);assert.deepEqual(r.writes,[]);}
 assert.deepEqual(runControl(order[0]).deleted,[]);const blocker=readU16(event,8+5*36+10);assert.deepEqual(runEntry(gym.scriptId,blocker,state).deleted,[5]);
}

// Traverse actual compiled warp branches at every badge count and clue state.
// Treat all native anchors as starting points, which is stricter than relying
// on their original overworld story barriers.
const nativeZones=new Set<number>(report.entrances.map((e:any)=>e.headerId));
const worldNodes=new Map<number,any>(report.areas.map((n:any)=>[n.headerId,n]));
const edges:Array<{from:number;to:number;scriptId:number;entry:number}>=[];
for(const link of report.links){edges.push({from:link.fromHeader,to:link.toHeader,scriptId:worldNodes.get(link.fromHeader).scriptId,entry:link.fromEntry},{from:link.toHeader,to:link.fromHeader,scriptId:worldNodes.get(link.toHeader).scriptId,entry:link.toEntry});}
for(const e of report.entrances)edges.push({from:e.headerId,to:e.targetHeaderId,scriptId:e.scriptId,entry:e.entry},{from:e.targetHeaderId,to:e.headerId,scriptId:e.returnScriptId,entry:e.returnEntry});
for(let badges=0;badges<=8;badges++)for(const flags of [[],[0xA39]]){
 const state={flags:new Set<number>(flags),work:new Map<number,number>(),badges},allowed=edges.filter(edge=>runEntry(edge.scriptId,edge.entry,state).warps.includes(edge.to));
 for(const entrance of report.entrances){
  const actual=runEntry(entrance.scriptId,entrance.entry,state).warps;
  assert.equal(actual.includes(entrance.targetHeaderId),badges>=entrance.requiredOriginalBadges&&entrance.requiredFlags.every((f:number)=>state.flags.has(f)),`Native guide gate ${entrance.anchorId} at${badges}badges`);
  assert.ok(runEntry(entrance.returnScriptId,entrance.returnEntry,state).warps.includes(entrance.headerId),'Retreat from route to native map must stay unconditional');
 }
 const visit=(start:number)=>{const seen=new Set<number>(),queue=[start];for(let k=0;k<queue.length;k++){const z=queue[k];if(seen.has(z))continue;seen.add(z);for(const e of allowed)if(e.from===z)queue.push(e.to);}return seen;};
 for(const native of nativeZones)for(const zone of visit(native))if(!nativeZones.has(zone)){
  assert.ok(worldNodes.get(zone).requiredOriginalBadges<=badges,`Premature entry ${worldNodes.get(zone).id} at${badges} badges`);
  assert.ok([...visit(zone)].some(z=>nativeZones.has(z)),`Trapped in ${worldNodes.get(zone).id} at${badges} badges`);
 }
}
const species=applySpecies(rom,report);assert.equal(species.coverage.boundOfflineCatalogue,649);assert.deepEqual(species.coverage.missing,[]);assert.equal(species.coverage.preChampionCertified,false);
assert.throws(()=>applyWorld(rom,{campaign}),/615 original headers/);
mkdirSync('build/research-world',{recursive:true});writeFileSync('build/research-world/world-test-report.json',JSON.stringify({counts:report.counts,staticEncounters:report.staticEncounters.length,nativeBaseHash:hash(source),reserved615:true,sourceUnmodified:true,questStatePaths:3,questRepairOrders:18,questPartialMasks:192,savedWorkIds:[...WORLD_QUEST_WORK],questCompletionFlags:[...WORLD_QUEST_FLAGS],oddOffsetAllocationRejection:true,gymPuzzleStatePaths:12,traversalBadgeFlagConfigurations:18,rootFlagsTableAudited:22,all649:species.coverage,emulatorValidated:false},null,2));
console.log('World native allocation/reference/collision/script/immutability/species checks passed',report.counts);
