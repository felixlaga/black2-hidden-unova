/** Real source ROM composed in memory. No exports, saves or report writes.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/climax.test.ts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptCommandOffsets, gen5ScriptCommandSize, gen5ScriptEntries } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { scanGen5ScriptPokemonCommands } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptPokemonScanner';
import { decodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { applyTrainers, TRAINER_BASE_SHA256, TRAINER_PATHS } from '../scripts/rom/trainers';
import { applyCampaignDefinitions, ORIGINAL_GYM_ACE_LEVELS } from '../scripts/rom/campaign';
import { applyRouteTrainerDefinitions } from '../scripts/rom/route-trainers';
import { prepareCampaignAccess, applyAccess } from '../scripts/rom/access';
import { applyWorld } from '../scripts/rom/world';
import { applySpecies } from '../scripts/rom/species';
import { applyStory } from '../scripts/rom/story';
import { applyClimax, CLIMAX_LEVELS, CLIMAX_PATHS, CLIMAX_PINS, FRIGATE_PARTIES, FRIGATE_DISPATCH, LEGACY_DRAGON_WITNESSES } from '../scripts/rom/climax';
import { compareTextArchives } from '../scripts/dialogue-guard';
import { formatAddedDialogue } from '../scripts/rom/dialogue';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = readFileSync(new URL('../roms/pokemon-black2-us.nds', import.meta.url));
assert.equal(sha(bytes), TRAINER_BASE_SHA256);
const rom = new NintendoDSRom(bytes, { fileData: 'view' });
const archive = (path: string, target = rom) => new NARC(new Uint8Array(target.getFileByName(path)));
const trainers = applyTrainers(rom, { profile:'full-campaign', gymAceLevels:ORIGINAL_GYM_ACE_LEVELS });
const campaign = applyCampaignDefinitions(rom), routeTrainers = applyRouteTrainerDefinitions(rom,campaign);
prepareCampaignAccess(campaign);
const world = applyWorld(rom,{campaign,routeTrainers}), species = applySpecies(rom,world);
applyStory(rom,world,trainers,campaign); applyAccess(rom);
const beforeFiles = [...rom.files], beforeWorld = structuredClone(world), beforeSpecies = structuredClone(species);
const before = Object.fromEntries(Object.entries(CLIMAX_PATHS).map(([key,path])=>[key,archive(path)]));
const hashes = beforeFiles.map(sha);
const beforeText = new Map([['messages',new Uint8Array(rom.getFileByName('a/0/0/2'))],['story',new Uint8Array(rom.getFileByName('a/0/0/3'))]]);
const report = applyClimax(rom,world,species);
const after = Object.fromEntries(Object.entries(CLIMAX_PATHS).map(([key,path])=>[key,archive(path)]));
assert.equal(report.allocatedTrainerCount,0); assert.deepEqual(report.newSavedFlags,[]);
assert.equal(archive(TRAINER_PATHS.data).files.length,878);
assert.deepEqual(rom.getFileByName(TRAINER_PATHS.data),beforeFiles[rom.fileId(TRAINER_PATHS.data)]);

// Entire-member equality proves identities/items/moves/AI and all native branch,
// retry, result, healing, capture flag and story operands are preserved.
const expectedParty = new Uint8Array(before.parties.files[345]);
for(const [slot,level] of [68,68,68,68,68,70].entries())writeU16(expectedParty,slot*18+2,level);
assert.deepEqual(after.parties.files[345],expectedParty);
assert.equal(sha(expectedParty),'43b7947c83d004b684b356a1c157a03d905066260ec9c6ea607938a97c73d154');
const expectedChasm = new Uint8Array(before.scripts.files[1208]);
writeU16(expectedChasm,0xd99,68);writeU16(expectedChasm,0xdc4,68);
assert.deepEqual(after.scripts.files[1208],expectedChasm);
assert.equal(sha(expectedChasm),'c272250a90570f812bc0598ba5638712c438b0b9af61700a4b20122b07aac34b');
assert.equal(readU16(after.scripts.files[1208],0xf50),70,'unfused capture unchanged');
assert.equal(sha(after.scripts.files[556]),CLIMAX_PINS.scripts[556]);
for(const p of FRIGATE_PARTIES){
  const expected=new Uint8Array(before.parties.files[p.id]),stride=expected.length/p.before.length;
  p.after.forEach((level,slot)=>writeU16(expected,slot*stride+2,level));
  assert.deepEqual(after.parties.files[p.id],expected,`only levels change: ${p.id}`);
}
for(const d of FRIGATE_DISPATCH)assert.deepEqual(after.scripts.files[d.member],before.scripts.files[d.member]);
const owned = {scripts:new Set([426,1208,1521]),parties:new Set([345,...FRIGATE_PARTIES.map(p=>p.id)]),story:new Set([272,792])};
for(const key of Object.keys(owned) as (keyof typeof owned)[]) {
  assert.equal(before[key].files.length,after[key].files.length);
  before[key].files.forEach((b,id)=>{if(!owned[key].has(id))assert.deepEqual(after[key].files[id],b,`unowned ${key}:${id}`);});
}
beforeFiles.forEach((b,id)=>{
  assert.equal(sha(b),hashes[id],'caller-owned Buffer changed');
  if(!report.changedFiles.some(f=>f.fileId===id))assert.equal(rom.files[id],b,`unowned file ${id}`);
});
for(const f of report.changedFiles){assert.notEqual(rom.files[f.fileId].buffer,bytes.buffer);assert.notEqual(rom.files[f.fileId].buffer,beforeFiles[f.fileId].buffer);}
const diff = compareTextArchives(beforeText.get('story')!,rom.getFileByName('a/0/0/3'),[]);
assert.deepEqual(diff.differences,[]);assert.equal(diff.addedEntries,3);
for(const id of [272,792]) {
  const old=decodeGen5TextBank(before.story.files[id]),now=decodeGen5TextBank(after.story.files[id]);
  assert.deepEqual(now.slice(0,old.length),old,'existing dialogue entries preserved');
}
// Appended wrappers shift the entire native payload together. Relative branch
// displacements and movement references are unchanged, including opaque data.
const tower=after.scripts.files[426],oldTower=before.scripts.files[426];
assert.deepEqual(tower.subarray(22,oldTower.length+8),oldTower.subarray(14));
assert.equal(gen5ScriptEntries(tower)[0],gen5ScriptEntries(oldTower)[0]+8);
for(const g of report.zekrom.guards){assert.equal(gen5ScriptEntries(tower)[g.entry-1],g.appendedOffset);assert.equal(g.nativeOffset,gen5ScriptEntries(oldTower)[g.entry-1]+8);}
const vault=after.scripts.files[1521],oldVault=before.scripts.files[1521];
assert.deepEqual(vault.subarray(30,oldVault.length+4),oldVault.subarray(26));
gen5ScriptEntries(oldVault).forEach((at,index)=>{if(index!==4)assert.equal(gen5ScriptEntries(vault)[index],at+4);});
assert.equal(gen5ScriptEntries(vault)[4],report.zekrom.guide.appendedOffset);
assert(!gen5ScriptCommandOffsets(vault,'BW2').some(at=>readU16(vault,at)===0x174&&readU16(vault,at+2)===644));
for(const id of [426,1208,1521]){const d=decompileBw2Script(after.scripts.files[id],id===1521?{}:{overlayId:66});assert(d.editable&&d.roundTripVerified);}

assert.equal((world.staticEncounters as any[]).length,(beforeWorld.staticEncounters as any[]).length-1);
assert(!(world.staticEncounters as any[]).some(b=>b.species===644));
assert.deepEqual(species.coverage,beforeSpecies.coverage);assert.equal(species.coverage.boundOfflineCatalogue,649);
assert(species.coverage.all649OfflineSourcesBound);
assert.equal(species.staticEncounters.verified.length,beforeSpecies.staticEncounters.verified.length);
const zekrom=species.acquisition.find(s=>s.species===644)!;
assert.deepEqual(zekrom.sources,[report.zekrom.nativeSource]);assert(zekrom.offlineSourceBound);assert.equal(zekrom.preChampionCertified,false);
assert.equal(report.zekrom.nativeSource.entrance.accessFlag,0xA41);
assert.deepEqual(report.zekrom.nativeSource.entrance.requiresNativeGhetsisCompletion,{work:0x4072,value:4});
for(const s of species.acquisition)if(s.species!==644)assert.deepEqual(s,beforeSpecies.acquisition[s.species-1]);
// Byte scanner partitions by address, so it cannot assign ownership through a
// backward wrapper jump. Use the control-flow walker for the public entry.
const scan=scanGen5ScriptPokemonCommands(tower,'BW2');
assert.equal(scan.commands.filter(c=>c.type==='wild_battle'&&c.fields.species?.value===644&&c.fields.level?.value===70).length,1);
assert(gen5ScriptCommandOffsets(tower,'BW2',{overlayId:66,entryIndices:[2]}).includes(0x37a+8));

/** Bounded semantic execution, not emulation. Battle results, version and menu
 * choices are inputs. Unknown opcodes fail; listed presentation ops are ignored. */
const decodedPrograms=new WeakMap<Uint8Array,ReturnType<typeof compileBw2Script>>();
function program(code:Uint8Array){
  let c=decodedPrograms.get(code);
  if(!c){c=compileBw2Script(decompileBw2Script(code,{overlayId:66}).source);decodedPrograms.set(code,c);}
  return c;
}
function run(code:Uint8Array,opts:{entry?:number;start?:number;stop?:number;caught?:boolean;version?:number;win?:boolean;wildWin?:boolean;result?:number;answer?:number;flags?:number[];works?:Record<number,number>;bag?:Record<number,number>}={}) {
  const works=new Map(Object.entries(opts.works??{}).map(([k,v])=>[Number(k),v])),flags=new Set(opts.flags??[]);
  const bag=new Map(Object.entries(opts.bag??{}).map(([k,v])=>[Number(k),v]));
  // Native calls and expressions share one stack. A helper must consume its
  // expressions before returning, or it will use their value as its return PC.
  const stack:number[]=[],messages:number[]=[],battles:number[][]=[],effects:number[][]=[],writes:number[][]=[],actorEffects:number[][]=[];
  const instructions=new Map(program(code).instructions.map(i=>[i.offset,i]));
  let pc=opts.start??gen5ScriptEntries(code)[(opts.entry??1)-1],cmp=0;
  const compare=(id:number,a:number,b:number)=>{const v=[a<b,a===b,a>b,a<=b,a>=b,a!==b,a===1||b===1,a===1&&b===1];assert(id>=0&&id<v.length);return v[id];};
  const pop=()=>{assert(stack.length>0,`stack underflow at ${pc.toString(16)}`);return stack.pop()!;};
  const finish=(reason:string)=>({reason,stackDepth:stack.length,flags:[...flags].sort((a,b)=>a-b),savedWorks:[...works].filter(([k])=>k>=0x4000&&k<0x8000).sort(([a],[b])=>a-b),battles,messages,effects,writes,actorEffects,bag:[...bag].sort(([a],[b])=>a-b)});
  const presentation=new Set([0x3,0x6,0x2e,0x2f,0x30,0x32,0x36,0x39,0x3f,0x4b,0x4c,0x64,0x65,0x69,0x6b,0x6c,0x6d,0x75,0x98,0x9e,0xa6,0xa8,0xab,0xac,0xb3,0xb4,0x13f,0x140,0x141,0x142,0x143,0x144,0x145,0x147,0x148,0x14a,0x14b,0x154,0x1a3,0x1a4,0x1a7,0x235,0x238,0x24f,0x2b5,0x2e9]);
  for(let step=0;step<2500;step++){
    if(pc===opts.stop)return finish('native');
    const i=instructions.get(pc);assert(i,`no instruction at ${pc.toString(16)}`);
    const [a,b,c,d]=i.operands,op=i.opcode,next=pc+gen5ScriptCommandSize(op,'BW2',66);
    switch(op){
      case 2:return finish('end');
      case 4:stack.push(next);pc=next+(a|0);continue;
      // An empty return terminates a directly entered helper in this harness.
      case 5:if(!stack.length)return finish('return');pc=pop();continue;
      case 8:stack.push(a);break;
      case 9:stack.push(works.get(a)??0);break;
      case 0xa:works.set(a,pop());break;
      case 0x10:stack.push(Number(flags.has(a)));break;
      case 0x11:{const right=pop(),left=pop();stack.push(Number(compare(a,left,right)));break;}
      case 0x13:works.set(a,(works.get(a)??0)|b);break;
      case 0x19:cmp=(works.get(a)??0)-b;break;
      case 0x1e:pc=next+(a|0);continue;
      case 0x1f:if(a===255?pop()!==1:compare(a,cmp,0)){pc=next+(b|0);continue;}break;
      case 0x23:flags.add(a);writes.push([op,a]);break;
      case 0x24:flags.delete(a);writes.push([op,a]);break;
      case 0x28:case 0x2a:{
        // Native reader 0x02153F6C dereferences once only inside [4000,C000).
        const value=op===0x2a&&b>=0x4000&&b<0xc000?(works.get(b)??0):b;
        works.set(a,value);if(a>=0x4000&&a<0x8000)writes.push([op,a,value]);break;
      }
      case 0x34:case 0x38:case 0x4a:messages.push(a);break;
      case 0x3c:case 0x3d:messages.push(b);break;
      case 0x49:messages.push(opts.version===0x16?b:c);break;
      case 0x47:works.set(a,opts.answer??0);break;
      case 0x74:case 0x3e:break; // face_player / close_message, talk macro
      case 0x6b:case 0x6c:actorEffects.push([op,a]);break;
      case 0x68:works.set(a,16);works.set(b,18);break;
      case 0x6e:case 0x78:works.set(a,0);break;
      case 0x85:battles.push([op,a,b,c]);break;
      case 0x8d:works.set(a,Number(opts.win??true));break;
      case 0x8c:return finish('trainer-loss');
      case 0x8e:case 0x104:case 0x175:effects.push([op]);break;
      case 0xb6:effects.push([op,a,b]);bag.set(a,Math.max(0,(bag.get(a)??0)-b));works.set(c,1);break;
      // Global handler dispatch/parameters are separately witnessed below. This
      // records reaching its native handoff; it does not simulate item delivery.
      case 0x1c:assert.equal(a,2807);effects.push([op,a,works.get(0x8000)!,works.get(0x8001)!]);break;
      case 0xe4:effects.push([op,a]);break; // native capture wallpaper reward
      case 0xdf:assert.equal(a,1);assert.equal(b,644);works.set(c,Number(opts.caught??false));break;
      case 0xe0:works.set(a,opts.version??0x17);break;
      case 0x174:battles.push([op,a,b,c>=0x4000?works.get(c)!:c]);break;
      case 0x176:return finish('wild-loss');
      case 0x177:works.set(a,Number(opts.wildWin??true));break;
      case 0x178:works.set(a,opts.result??0);break;
      case 0x297:battles.push([op,a,b,c,works.get(d)!]);break;
      case 0x2b4:works.set(b,0);break;
      case 0x262:case 0x3ec:case 0x3ed:case 0x3ef:case 0x3f4:effects.push([op,...i.operands]);break;
      default:assert(presentation.has(op),`unhandled 0x${op.toString(16)} at 0x${pc.toString(16)}`);
    }
    pc=next;
  }
  assert.fail('step limit');
}
let branchCases=0;
const saved={0x4072:4,0x4114:3,0x411b:1,0x4148:1,0x4123:8},flags=[0xA41,0x960,0x390];
// These semantic oracles do not compare two executions of the same VM: a
// literal-only work_set or a private call stack must fail them independently.
let variableCopyCases=0;
for(const [operand,works,expected] of [
  [0,{},0],[0x3fff,{0x3fff:9},0x3fff],[0x4000,{0x4000:9},9],
  [0x4072,{0x4072:4},4],[0x4072,{0x4072:0},0],
  [0x4072,{0x4072:0xffff},0xffff],
  [0x8000,{0x8000:628},628],[0x8020,{0x8020:70},70],
  [0x8020,{0x8020:0x4072,0x4072:4},0x4072], // One resolution, not recursive.
  [0x8020,{},0],
  // Operand classification boundaries, not assertions that each ID has
  // allocated native storage. Conflicting map values catch overbroad reads.
  [0xbfff,{0xbfff:9},9],[0xc000,{0xc000:9},0xc000],[0xffff,{0xffff:9},0xffff],
] as [number,Record<number,number>,number][]){
  const code=compileBw2Script(`preserve_layout\nscript :copy, entry: 1 do\nwork_set 0x4000, ${operand}\nwork_set_const 0x4001, ${operand}\nhalt\nend`).bytes;
  assert.deepEqual(program(code).instructions.slice(0,2).map(i=>[i.opcode,...i.operands]),[[0x2a,0x4000,operand],[0x28,0x4001,operand]]);
  const r=run(code,{works});
  assert.equal(new Map(r.savedWorks).get(0x4000),expected);
  assert.equal(new Map(r.savedWorks).get(0x4001),operand,'work_set_const retains its literal');
  assert.deepEqual(r.writes,[[0x2a,0x4000,expected],[0x28,0x4001,operand]]);
  assert.equal(r.stackDepth,0);variableCopyCases++;
}
const nestedCalls=compileBw2Script(`preserve_layout
script :nested, entry: 1 do
  stack_push_const 0xffff
  call :outer
  stack_pop 0x4000
  halt
end
def outer
  stack_push_const 7
  call :inner
  stack_pop 0x4001
  vm_return
end
def inner
  stack_push_const 1
  stack_push_const 1
  stack_cmp 7
  stack_pop 0x4002
  vm_return
end`).bytes;
const nested=run(nestedCalls);
assert.equal(nested.reason,'end');assert.equal(nested.stackDepth,0);
assert.deepEqual(nested.savedWorks,[[0x4000,0xffff],[0x4001,7],[0x4002,1]]);
let returnStackCases=1;
const observeReturn=compileBw2Script(`preserve_layout
script :observe, entry: 1 do
  stack_push_const 0xffff
  call :observe_helper
  halt
end
def observe_helper
  stack_pop 0x4000
  halt
end`).bytes;
const call=program(observeReturn).instructions.find(i=>i.opcode===4)!;
const observed=run(observeReturn);
assert.deepEqual(observed.savedWorks,[[0x4000,call.offset+gen5ScriptCommandSize(4,'BW2',66)]]);
assert.equal(observed.reason,'end');assert.equal(observed.stackDepth,1,'caller expression remains below the popped continuation');
returnStackCases++;
for(const helper of ['stack_push_const 0xffff','stack_pop 0x8020']){
  // Leftover expression: return jumps to 0xffff. Missing return address:
  // return consumes the caller's saved 0xffff instead. A separate call stack
  // incorrectly accepts both helpers and reaches halt.
  const code=compileBw2Script(`preserve_layout\nscript :bad, entry: 1 do\nstack_push_const 0xffff\ncall :broken\nhalt\nend\ndef broken\n${helper}\nvm_return\nend`).bytes;
  assert.throws(()=>run(code),/no instruction at ffff/);returnStackCases++;
}
const underflow=compileBw2Script('preserve_layout\nscript :underflow, entry: 1 do\nstack_pop 0x4000\nhalt\nend').bytes;
assert.throws(()=>run(underflow),/stack underflow/);returnStackCases++;
// Separate truth-table tests prevent reversing native comparison6 (OR) and7
// (AND) while still passing differential checks against the same flawed VM.
for(const op of [6,7])for(const a of [0,1,2,0xffff])for(const b of [0,1,2,0xffff]){
  const code=compileBw2Script(`preserve_layout\nscript :truth, entry: 1 do\nstack_push_const ${a}\nstack_push_const ${b}\nstack_cmp ${op}\nstack_pop 0x4000\nhalt\nend`).bytes;
  assert.equal(run(code).savedWorks[0][1],Number(op===6?a===1||b===1:a===1&&b===1));
}
let legacyCases=0,legacyRepeatCases=0;
for(const g of report.zekrom.guards)for(const caught of [false,true])
for(const stage of [0,1,2,3,0xffff])for(const ghetsis of [0,3,4,5])
for(const done of [false,true])for(const kyuremHidden of [false,true])
for(const kyuremCaught of [false,true])for(const zekromHidden of [false,true]){
  const inputFlags=[0xA41,0x960,0x3eb,0x1e1,0x1e3,0x391,0xea,0x3c8,
    ...(done?[0x1e0]:[]),...(kyuremHidden?[0x3ec]:[]),...(kyuremCaught?[0xf9]:[]),...(zekromHidden?[0x29b]:[])];
  const works={...saved,0x411b:stage,0x4072:ghetsis,0x4000:8},bag={617:stage===1?1:0,628:1};
  const r=run(tower,{entry:g.entry,stop:g.nativeOffset,caught,works,flags:inputFlags,bag});
  assert.equal(r.stackDepth,0,'guard consumes its comparisons and returns cleanly');
  const eligible=caught&&!done&&[1,2].includes(stage)&&ghetsis===4;
  const expectedFlags=new Set(inputFlags),expectedWorks={...works};
  if(eligible){expectedFlags.add(0x29b);expectedFlags.add(0x1e0);expectedFlags.add(0x390);if(!kyuremCaught)expectedFlags.delete(0x3ec);expectedWorks[0x411b]=2;}
  assert.equal(r.reason,caught?'end':'native');
  assert.deepEqual(r.flags,[...expectedFlags].sort((a,b)=>a-b));
  assert.deepEqual(r.savedWorks,Object.entries(expectedWorks).map(([k,v])=>[Number(k),v]).sort(([a],[b])=>a-b));
  assert.deepEqual(r.writes,eligible?[[0x23,0x29b],[0x28,0x411b,2],[0x23,0x1e0],[0x23,0x390],...(!kyuremCaught?[[0x24,0x3ec]]:[])]:[]);
  assert.deepEqual(r.actorEffects,eligible&&g.entry===3&&!zekromHidden?[[0x6c,0]]:[]);
  assert.deepEqual(r.battles,[]);assert.deepEqual(r.effects,[]);
  assert.deepEqual(r.bag,Object.entries(bag).map(([k,v])=>[Number(k),v]));
  assert.deepEqual(r.messages,caught?[eligible?report.zekrom.completionMessageId:report.zekrom.caughtMessageId]:[]);
  if(eligible)for(const repeatEntry of [2,3]){
    // Simulate a subsequent native Kyurem encounter hiding it again. Reopening
    // the tower must preserve both a defeated dragon and a captured one.
    const repeatFlags=[...new Set([...r.flags,0x3ec])];
    const repeat=run(tower,{entry:repeatEntry,caught:true,works:Object.fromEntries(r.savedWorks),flags:repeatFlags,bag:Object.fromEntries(r.bag)});
    assert.equal(repeat.stackDepth,0);
    assert.deepEqual(repeat.flags,repeatFlags.sort((a,b)=>a-b));assert.deepEqual(repeat.savedWorks,r.savedWorks);
    assert.deepEqual(repeat.writes,[]);assert.deepEqual(repeat.actorEffects,[]);assert.deepEqual(repeat.battles,[]);assert.deepEqual(repeat.effects,[]);assert.deepEqual(repeat.bag,r.bag);
    legacyRepeatCases++;
  }
  legacyCases++;
}
for(const caught of [false,true]){const r=run(vault,{entry:5,caught,works:saved,flags});assert.deepEqual(r.battles,[]);assert.deepEqual(r.effects,[]);assert.deepEqual(r.messages,[caught?report.zekrom.guide.caughtMessageId:report.zekrom.guide.messageId]);branchCases++;}
for(const version of [0x17,0x16]){
  for(const answer of [0,1]){const input={entry:2,version,answer,works:saved,flags};assert.deepEqual(run(tower,input),run(oldTower,input));branchCases++;}
  for(const wildWin of [false,true])for(const result of [0,1,2]){const input={entry:3,version,wildWin,result,works:{...saved,0x411b:2},flags};assert.deepEqual(run(tower,input),run(oldTower,input));branchCases++;}
}
// Initial handoff, direct helper and retry retain identical win/loss behavior.
for(const start of [0x6ec,0x7a0,0x8d4])for(const win of [false,true]){
  const input={start,win,works:{0x4072:3},flags:[0x379,0x3c8,0x3c9]},r=run(after.scripts.files[1208],input);
  assert.deepEqual(r,run(before.scripts.files[1208],input));assert.deepEqual(r.battles,[[0x85,345,0,0]]);
  assert.equal(r.savedWorks.find(([k])=>k===0x4072)?.[1],win?4:3);branchCases++;
}
for(const version of [0x17,0x16])for(const wildWin of [false,true])for(const result of [0,1,2]){
  const input={entry:6,version,wildWin,result,works:{0x4072:2},flags:[]};
  const old=run(before.scripts.files[1208],input),now=run(after.scripts.files[1208],input);
  assert.equal(now.battles[0][2],68);assert.deepEqual(now.battles[0].slice(3),[version===0x17?2:1,0x811]);
  old.battles[0][2]=68;assert.deepEqual(now,old);branchCases++;
}

// Exact native witnesses and actual event records establish what the legacy
// flags unlock; descriptive names in the new report are not evidence.
for(const w of LEGACY_DRAGON_WITNESSES){
  const i=program(before.scripts.files[w.member]).instructions.find(i=>i.offset===w.offset)!;
  assert.equal(i.opcode,w.opcode);assert.deepEqual(i.operands,[...w.operands]);
}
const chasmEvents=archive('a/1/2/6').files[285];
assert.equal(sha(chasmEvents),CLIMAX_PINS.chasmEvents);
const nativeActor=(index:number)=>{
  const at=8+chasmEvents[4]*20+index*36;
  return {id:readU16(chasmEvents,at),hide:readU16(chasmEvents,at+8),entry:readU16(chasmEvents,at+10)};
};
assert.deepEqual(nativeActor(8),{id:8,hide:0x3ec,entry:9});
assert.deepEqual(nativeActor(7),{id:7,hide:0x3eb,entry:8});
const items=decodeGen5TextBank(archive('a/0/0/2').files[64]);
assert.equal(items[617][1],'Dark Stone');assert.equal(items[628][1],'DNA Splicers');
const itemHandoff=program(after.scripts.files[1208]).instructions.filter(i=>i.offset>=0xf0f&&i.offset<=0xf1b);
assert.deepEqual(itemHandoff.map(i=>[i.opcode,...i.operands]),[[0x2a,0x8000,628],[0x2a,0x8001,1],[0x1c,2807]]);
const overlay12=rom.loadArm9Overlays([12]).get(12)!;
assert.deepEqual(Array.from({length:5},(_,i)=>readU16(overlay12.data,0x1add6+i*2)),[2800,2819,1238,3,437]);
const nativeItem=after.scripts.files[1238];
assert.equal(gen5ScriptEntries(nativeItem)[2807-2800],432);
const nativeItemInstructions=program(nativeItem).instructions;
for(const [offset,opcode,operands] of [[432,4,[47]],[503,0xb7,[0x8000,0x8001,0x8020]],[564,0xb5,[0x8000,0x8001,0x8010]]] as const){
  const i=nativeItemInstructions.find(i=>i.offset===offset)!;
  assert.equal(i.opcode,opcode);assert.deepEqual(i.operands,[...operands]);
}
assert(gen5ScriptCommandOffsets(nativeItem,'BW2',{entryIndices:[7]}).includes(564),'native item-add command reachable from global2807');
// This unchanged native respawn tail uses AND(7) for all three requirements.
const ending=after.scripts.files[1242],respawnStart=0x6a0;
assert.deepEqual(program(ending).instructions.filter(i=>i.offset>=respawnStart&&i.offset<=0x6d7).map(i=>[i.opcode,...i.operands]),[
  [0x10,0x3ec],[8,1],[0x11,1],[0x10,0xf9],[8,0],[0x11,1],[0x10,0x1e0],[8,1],[0x11,1],[0x11,7],[0x11,7],[0x1f,255,8],[0x24,0x3ec],[0x23,0x3eb],
]);
let downstreamCases=0;
for(const entry of [2,3])for(const stage of [1,2])for(const result of [0,1,2]){
  const legacy=run(tower,{entry,caught:true,flags:[0xA41,0x3ec,0x3eb,...(entry===2?[0x29b]:[])],works:{...saved,0x411b:stage},bag:{617:1}});
  assert(legacy.flags.includes(0x1e0));assert(!legacy.flags.includes(nativeActor(8).hide));
  // Native Kyurem encounter stays Lv70 and reaches the original DNA actor
  // reveal on a victory/capture input. No new gift or capture is invented.
  const kyurem=run(after.scripts.files[1208],{entry:nativeActor(8).entry,flags:legacy.flags,works:Object.fromEntries(legacy.savedWorks),bag:Object.fromEntries(legacy.bag),wildWin:true,result});
  assert.equal(kyurem.stackDepth,0);
  assert.deepEqual(kyurem.battles,[[0x174,646,70,1]]);
  assert(kyurem.flags.includes(0x3ec));assert(!kyurem.flags.includes(nativeActor(7).hide));
  assert(kyurem.actorEffects.some(([op,id])=>op===0x6b&&id===7));
  assert.equal(kyurem.flags.includes(0xf9),result===0);
  const dna=run(after.scripts.files[1208],{entry:nativeActor(7).entry,flags:kyurem.flags,works:Object.fromEntries(kyurem.savedWorks),bag:Object.fromEntries(kyurem.bag)});
  assert.equal(dna.stackDepth,0,'native DNA parameters are popped before ending');
  assert(dna.effects.some(e=>JSON.stringify(e)===JSON.stringify([0x1c,2807,628,1])),'native DNA item handler reached with correct parameters');
  assert(dna.flags.includes(0x1e1)&&dna.flags.includes(0x3eb));
  assert.equal(new Map(dna.bag).get(617),1,'legacy stone never consumed');
  for(const repeatEntry of [2,3]){
    const repeated=run(tower,{entry:repeatEntry,caught:true,flags:dna.flags,works:Object.fromEntries(dna.savedWorks),bag:Object.fromEntries(dna.bag)});
    assert.deepEqual(repeated.flags,dna.flags);assert.deepEqual(repeated.savedWorks,dna.savedWorks);assert.deepEqual(repeated.writes,[]);assert.deepEqual(repeated.actorEffects,[]);
    const respawn=run(ending,{start:respawnStart,flags:repeated.flags,works:Object.fromEntries(repeated.savedWorks)});
    assert.equal(repeated.stackDepth,0);assert.equal(respawn.stackDepth,0);
    assert.equal(respawn.flags.includes(0x3ec),result===0,'captured Kyurem stays hidden; native noncapture respawn retained');
    downstreamCases++;
  }
}
// The previous P1 reproduction cannot be masked by another true condition in
// the ending predicate: completion, hidden state and uncaught state all matter.
for(const done of [false,true])for(const hidden of [false,true])for(const captured of [false,true]){
  const seed=[...(done?[0x1e0]:[]),...(hidden?[0x3ec]:[]),...(captured?[0xf9]:[])];
  const r=run(ending,{start:respawnStart,flags:seed});
  assert.equal(r.stackDepth,0);
  assert.deepEqual(r.writes,done&&hidden&&!captured?[[0x24,0x3ec],[0x23,0x3eb]]:[]);
  downstreamCases++;
}
for(const result of [0,1,2])for(const wildWin of [false,true]){
  const seed=[0x1e0,0x1e1,0x1e3,0x3eb];
  const r=run(after.scripts.files[1208],{entry:9,flags:seed,wildWin,result});
  assert.equal(r.stackDepth,0);
  assert(r.flags.includes(0x3eb));assert(!r.actorEffects.some(([op,id])=>op===0x6b&&id===7),'already received DNA is not re-added');
  if(!wildWin){assert.deepEqual(r.flags,seed.sort((a,b)=>a-b));assert.deepEqual(r.writes,[]);}
  downstreamCases++;
}
for(const entry of [2,3]){
  // Legacy supplemental captures need not have native capture markerEA. The
  // unchanged ending may redisplay Zekrom; the permanent caught guard must
  // still suppress another battle without forging EA or reopening Kyurem.
  const legacy=run(tower,{entry,caught:true,flags:[0xA41,0x3ec,0x3eb],works:{...saved,0x411b:entry===2?1:2},bag:{617:1}});
  assert(!legacy.flags.includes(0xea));
  const capturedFlags=[...new Set([...legacy.flags,0x3ec,0xf9,0x1e1,0x1e3])];
  const reset=run(ending,{start:0x669,flags:capturedFlags,works:Object.fromEntries(legacy.savedWorks),bag:Object.fromEntries(legacy.bag)});
  assert(!reset.flags.includes(0x29b));assert(reset.flags.includes(0x3ec));
  for(const repeatEntry of [2,3]){
    const r=run(tower,{entry:repeatEntry,caught:true,flags:reset.flags,works:Object.fromEntries(reset.savedWorks),bag:Object.fromEntries(reset.bag)});
    assert.equal(reset.stackDepth,0);assert.equal(r.stackDepth,0);
    assert.deepEqual(r.flags,reset.flags);assert.deepEqual(r.savedWorks,reset.savedWorks);assert.deepEqual(r.writes,[]);assert.deepEqual(r.battles,[]);assert.deepEqual(r.bag,reset.bag);
    downstreamCases++;
  }
}
assert.deepEqual({variableCopyCases,returnStackCases,branchCases,legacyCases,legacyRepeatCases,downstreamCases},
  {variableCopyCases:13,returnStackCases:5,branchCases:36,legacyCases:1280,legacyRepeatCases:64,downstreamCases:42});

// Corruption fails closed. All shared pre-patch refs, Buffers and reports survive.
for(const kind of ['script','party','text','header','events','chasm-events','report','duplicate']){
  const reject=new NintendoDSRom(bytes,{fileData:'view'});reject.files=[...beforeFiles];
  const w=structuredClone(beforeWorld),s=structuredClone(beforeSpecies);
  if(kind==='report')s.acquisition[643].sources=[];
  else if(kind==='duplicate')reject.files=[...rom.files];
  else{
    const [path,id,at]:[string,number,number]=kind==='script'?['a/0/5/6',426,0x37a]:kind==='party'?[TRAINER_PATHS.parties,345,2]:kind==='text'?['a/0/0/3',792,20]:kind==='header'?['a/0/1/2',0,213*48+6]:['a/1/2/6',kind==='chasm-events'?285:263,10];
    const a=archive(path,reject);a.files[id][at]^=1;reject.files[reject.fileId(path)]=a.save();
  }
  const refs=[...reject.files],hs=refs.map(sha),wr=structuredClone(w),sr=structuredClone(s);
  assert.throws(()=>applyClimax(reject,w,s),/Climax:/);
  reject.files.forEach((f,id)=>{assert.equal(f,refs[id]);assert.equal(sha(f),hs[id]);});assert.deepEqual(w,wr);assert.deepEqual(s,sr);
}
formatAddedDialogue(rom,beforeText,[]);
assert.deepEqual(compareTextArchives(beforeText.get('story')!,rom.getFileByName('a/0/0/3'),[]).differences,[]);
assert.equal(sha(bytes),TRAINER_BASE_SHA256);
assert.equal(sha(readFileSync(new URL('../roms/pokemon-black2-us.nds',import.meta.url))),TRAINER_BASE_SHA256);
JSON.stringify(report);
console.log(JSON.stringify({passed:true,baseSha256:sha(bytes),ghetsisLevels:CLIMAX_LEVELS.ghetsis,fusedKyuremLevel:CLIMAX_LEVELS.fusedKyurem,frigate:report.frigate.parties.map(p=>({id:p.trainerId,levels:p.afterLevels})),variableCopyCases,returnStackCases,branchCases,legacyCases,legacyRepeatCases,downstreamCases,sourceAndUnownedBytesPreserved:true,originalDialogueChanged:0,newSavedFlags:0,allocatedTrainers:0,offlineSourcesBound:species.coverage.boundOfflineCatalogue,routeTrainersPreserved:36,nativeDnaItemHandlerReached:true,itemDeliveryEmulated:false,romFilesWritten:false,emulatorValidated:false},null,2));
