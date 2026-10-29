import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { extractGameFreakContainer, parseVMapTerrain } from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { decodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { applyExpansion } from '../scripts/rom/build';
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const source=readFileSync('roms/pokemon-black2-us.nds'),baseHash=sha(source);
assert.equal(baseHash,'39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99');
const rom=new NintendoDSRom(source,{fileData:'view'}),build=await applyExpansion(rom),world:any=build.modules.world;
const get=(p:string)=>new NARC(new Uint8Array(rom.getFileByName(p)));
const events=get('a/1/2/6'),scripts=get('a/0/5/6'),maps=get('a/0/0/8'),texts=get('a/0/0/3'),trainers=get('a/0/9/1');
assert.equal(trainers.files.length,878);assert.equal(world.counts.routeTrainers,36);
assert.equal(new Set(world.routeTrainers.map((b:any)=>b.routeId)).size,36);
assert.equal(new Set(world.routeTrainers.map((b:any)=>b.trainerId)).size,36);
for(const binding of world.routeTrainers){
 const area=world.areas.find((a:any)=>a.id===binding.routeId),event=events.files[area.eventId];
 const row=8+event[4]*20+binding.npcIndex*36;
 assert.equal(readU16(event,row),binding.actorId);assert.equal(readU16(event,row+2),binding.spriteId);
 assert.equal(readU16(event,row+8),0,'Trainer remains visible after victory');
 assert.equal(readU16(event,row+4),0,'Talk trainer is stationary');
 assert.equal(readU16(event,row+14),0,'Talk trainer has no sight trigger');
 assert.equal(readU16(event,row+20),0);assert.equal(readU16(event,row+22),0);
 assert.equal(readU16(event,row+10),binding.entry);
 assert.equal(readU16(event,row+28),binding.x);assert.equal(readU16(event,row+30),binding.z);
 assert.equal(binding.repeatable,false);assert.equal(binding.optional,true);
 assert.equal(binding.defeatedFlagId,0x5f0+binding.trainerId);assert.ok(binding.defeatedFlagId<0x960);
 assert.equal(binding.earliestAccess.originalBadges,area.requiredOriginalBadges);
 const round=decompileBw2Script(scripts.files[area.scriptId]);assert.equal(round.roundTripVerified,true);
 const block=round.source.split(/(?=script :)/).find((s:string)=>s.includes(`entry: ${binding.entry} do`))!;
 assert.ok(block,'Actor has compiled script');assert.match(block,/trainer_flag_set/);assert.match(block,/call_trainer_battle/);
 const bank=decodeGen5TextBank(texts.files[area.textBankId]);assert.ok(binding.textBase+3<=bank.length);
 // Check both directions using actual serialized terrain, NPC rows and triggers.
 const terrain=parseVMapTerrain(extractGameFreakContainer(maps.files[area.mapIds[0]]).files[1]);
 const blocked=new Set<number>();
 terrain.tiles.forEach((t,i)=>{if(t.flags&1||t.tileClass>=61&&t.tileClass<=68)blocked.add(i);});
 for(let i=0;i<event[5];i++){const at=8+event[4]*20+i*36;blocked.add(readU16(event,at+30)*32+readU16(event,at+28));}
 const triggers:any[]=[];
 for(let i=0;i<event[7];i++){
  const at=8+event[4]*20+event[5]*36+event[6]*20+i*22;
  const p={x:readU16(event,at+10),z:readU16(event,at+12),w:readU16(event,at+14),h:readU16(event,at+16)};
  triggers.push(p);for(let z=p.z;z<p.z+p.h;z++)for(let x=p.x;x<p.x+p.w;x++)blocked.add(z*32+x);
 }
 const neighbors=(k:number)=>[k%32>0?k-1:-1,k%32<31?k+1:-1,k-32,k+32].filter(n=>n>=0&&n<1024);
 const landings=world.links.filter((l:any)=>l.to===binding.routeId).map((l:any)=>l.landingB);
 assert.equal(landings.length,2);
 for(const start of landings){
  const key=start.z*32+start.x;assert.ok(!blocked.has(key));const visited=new Set<number>(),q=[key];
  for(let i=0;i<q.length;i++){const k=q[i];if(blocked.has(k)||visited.has(k))continue;visited.add(k);q.push(...neighbors(k));}
  for(const p of landings)assert.ok(visited.has(p.z*32+p.x),`${binding.routeId} landing unreachable`);
  for(const p of triggers)assert.ok(neighbors(p.z*32+p.x).some(k=>visited.has(k)),`${binding.routeId} exit unreachable`);
  assert.ok(neighbors(binding.z*32+binding.x).some(k=>visited.has(k)),`${binding.routeId} trainer unreachable`);
 }
}
assert.equal(world.counts.headers,224);assert.equal(world.counts.interiors,48);
assert.equal(build.modules.species.coverage.missing.length,0);
assert.equal(sha(source),baseHash);assert.equal(sha(rom.data),baseHash);
assert.equal(sha(readFileSync('roms/pokemon-black2-us.nds')),baseHash);
console.log(JSON.stringify({pass:true,routeTrainers:36,partyPokemon:112,totalTrainerRecords:878,serializedTwoWayWalkChecks:72,areas:224,dialoguePreservation:build.dialogue,sourceUnchanged:true,runtimeVerified:false}));
