import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16,readU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { gen5ScriptCommandSize } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { compareTextArchives } from '../scripts/dialogue-guard';
import { TRAINER_PATHS } from '../scripts/rom/trainers';
import { applyCampaignDefinitions,compileCampaignBody,rebaseCampaignBody,CAMPAIGN_PROGRESSION,ORIGINAL_GYM_ACE_LEVELS,NEW_GYM_FLAGS } from '../scripts/rom/campaign';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const source=readFileSync('roms/pokemon-black2-us.nds'),sourceHash='39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99';
assert.equal(hash(source),sourceHash);
const rom=new NintendoDSRom(source,{fileData:'view'}),originalFiles=[...rom.files];
const report=applyCampaignDefinitions(rom);
assert.equal(report.allocatedTrainerCount,28);assert.equal(report.finalTrainerCount,842);
assert.equal(Object.keys(report.gyms).length,12);assert.equal(Object.keys(report.towns).length,4);assert.equal(report.mentors.length,8);
assert.equal(report.allocator.trainerDefeatedFlagOffset,0x5F0);
assert.equal(report.allocator.highestAllocatedTrainerFlag,0x939);
assert.ok(report.allocator.highestAllocatedTrainerFlag<0x960);
assert.equal(new Set(report.allocator.flags).size,16);
assert.equal(hash(source),sourceHash);assert.equal(hash(rom.data),sourceHash);
const owned=new Set(Object.values(TRAINER_PATHS).map(path=>rom.fileId(path)));
for(let id=0;id<rom.files.length;id++)if(!owned.has(id))assert.equal(rom.files[id],originalFiles[id],`Unowned file ${id} changed`);
for(const path of [TRAINER_PATHS.data,TRAINER_PATHS.parties]) {
  const before=new NARC(new Uint8Array(originalFiles[rom.fileId(path)])),after=new NARC(new Uint8Array(rom.getFileByName(path)));
  assert.equal(after.files.length,842);
  for(let id=0;id<814;id++)assert.deepEqual(after.files[id],before.files[id],`Original trainer ${id} changed in ${path}`);
}
assert.equal(compareTextArchives(originalFiles[rom.fileId(TRAINER_PATHS.messages)],rom.getFileByName(TRAINER_PATHS.messages)).differences.length,0,'All original text retained');
const td=new NARC(new Uint8Array(rom.getFileByName(TRAINER_PATHS.data))),tp=new NARC(new Uint8Array(rom.getFileByName(TRAINER_PATHS.parties)));
for(let id=814;id<842;id++) {
  const record=td.files[id];assert.equal(record[0],3);assert.ok(record[3]>=2&&record[3]<=6);assert.equal(tp.files[id].length,record[3]*18);
  for(let i=0;i<record[3];i++) {
    const at=i*18;assert.ok(tp.files[id][at+2]>=14&&tp.files[id][at+2]<=83);
    assert.ok(readU16(tp.files[id],at+4)>=1&&readU16(tp.files[id],at+4)<=649);
    assert.ok([10,12,14,16].some(offset=>readU16(tp.files[id],at+offset)>0),'Appended party member needs an actual move');
  }
}

/** Focused bytecode control-flow interpreter. The branch convention, opcode sizes
 * and battle result predicate are cross-checked against native Roxie script1004.
 * This tests flag safety and prerequisites, not DS battle execution/rendering. */
function execute(bytes:Uint8Array,{badges=8,flags=[] as number[],wins=[1],answer=0}={}) {
  const set=new Set(flags),writes:number[]=[],battles:number[]=[],messages:number[]=[],stack:number[]=[],work=new Map<number,number>();
  let at=readU32(bytes,0)+4,comparison=0,won=0,loss=false,heals=0;
  const compare=(kind:number,left:number,right:number)=>[left<right,left===right,left>right,left<=right,left>=right,left!==right][kind];
  for(let steps=0;steps<2000;steps++) {
    const op=readU16(bytes,at),size=gen5ScriptCommandSize(op,'BW2');assert.ok(size>0,`Unknown opcode ${op}`);
    const a=readU16(bytes,at+2),b=readU16(bytes,at+4);let next=at+size;
    switch(op) {
      case 0x02:return {flags:set,writes,battles,messages,loss,heals};
      case 0x08:stack.push(a);break;
      case 0x10:stack.push(Number(set.has(a)));break;
      case 0x11:{const right=stack.pop()!,left=stack.pop()!;stack.push(Number(compare(a,left,right)));break;}
      case 0x19:comparison=(work.get(a)??0)-b;break;
      case 0x1f:{const condition=bytes[at+2],jump=condition===255?stack.pop()!==1:compare(condition,comparison,0);if(jump)next+=readU32(bytes,at+3)|0;break;}
      case 0x1e:next+=readU32(bytes,at+2)|0;break;
      case 0x23:set.add(a);writes.push(a);break;
      case 0xd7:work.set(a,badges);break;
      case 0x47:work.set(a,answer);break;
      case 0x85:battles.push(a);won=wins[battles.length-1]??0;break;
      case 0x8d:work.set(a,won);break;
      case 0x8c:loss=true;break; // Continue too: even if native loss returned, no reward may follow.
      case 0x8e:assert.equal(won,1,'Battle-end reward branch must require victory');break;
      case 0x3d:messages.push(b);break;
      case 0x104:heals++;break;
      case 0x2e:case 0x2f:case 0x30:case 0x32:case 0x3e:case 0x74:case 0xa6:break;
      default:throw new Error(`Unsupported focused interpreter opcode ${op.toString(16)}`);
    }
    assert.ok(next>=6&&next<bytes.length,'Branch target must stay in script');at=next;
  }
  throw new Error('Generated campaign body failed to terminate');
}

for(const [id,gym] of Object.entries(report.gyms)) {
  const bytes=Uint8Array.from(gym.compiledBytes);
  assert.equal(hash(bytes),gym.compiledSha256);
  const win=execute(bytes,{badges:gym.requiredBadges,flags:gym.requiredFlags,wins:[1]});
  assert.deepEqual(win.writes,[gym.flagId],id);assert.deepEqual(win.battles,[gym.trainerId]);
  const loss=execute(bytes,{badges:gym.requiredBadges,flags:gym.requiredFlags,wins:[0]});assert.deepEqual(loss.writes,[]);assert.equal(loss.loss,true);
  assert.deepEqual(execute(bytes,{badges:gym.requiredBadges-1,flags:gym.requiredFlags,wins:[1]}).battles,[]);
  for(const missing of gym.requiredFlags)assert.deepEqual(execute(bytes,{badges:8,flags:gym.requiredFlags.filter(f=>f!==missing),wins:[1]}).battles,[],`${id} missingflag ${missing}`);
  const repeat=execute(bytes,{flags:[...gym.requiredFlags,gym.flagId]});assert.deepEqual(repeat.battles,[]);assert.deepEqual(repeat.writes,[]);
}
for(const crisis of Object.values(report.towns)) {
  const bytes=Uint8Array.from(crisis.compiledBytes);
  const success=execute(bytes,{badges:crisis.requiredBadges,flags:crisis.requiredFlags,wins:[1,1]});
  assert.deepEqual(success.battles,crisis.trainerIds);assert.deepEqual(success.writes,[crisis.flagId]);assert.equal(success.heals,1);
  for(const wins of [[0,0],[0,1],[1,0]])assert.deepEqual(execute(bytes,{badges:crisis.requiredBadges,flags:crisis.requiredFlags,wins}).writes,[]);
  assert.deepEqual(execute(bytes,{flags:[...crisis.requiredFlags,crisis.flagId]}).battles,[]);
}
for(const mentor of report.mentors) {
  const bytes=Uint8Array.from(mentor.compiledBytes);
  assert.equal(mentor.spriteId,mentor.name==='Alder'?97:103);
  const accepted=execute(bytes,{badges:mentor.requiredBadges,flags:mentor.requiredFlags,wins:[1],answer:0});
  assert.deepEqual(accepted.battles,[mentor.trainerId]);assert.deepEqual(accepted.writes,[]);
  assert.deepEqual(execute(bytes,{flags:mentor.requiredFlags,answer:1}).battles,[]);
  assert.deepEqual(execute(bytes,{flags:mentor.requiredFlags,wins:[0],answer:0}).writes,[]);
  const rebased=execute(compileCampaignBody(rebaseCampaignBody(mentor.body,200)).bytes,{flags:mentor.requiredFlags,wins:[1]});
  assert.ok(rebased.messages.every(m=>m>=200&&m<=204));assert.deepEqual(rebased.battles,[mentor.trainerId]);
}

// The twenty-Gym dependency graph must admit the advertised sequence. Resolve each
// local crisis as soon as its badge/emblem prerequisites become available.
let badges=0;const flags=new Set<number>();
for(const step of CAMPAIGN_PROGRESSION) {
  for(const c of Object.values(report.towns))if(badges>=c.requiredBadges&&c.requiredFlags.every(f=>flags.has(f)))flags.add(c.flagId);
  assert.ok(badges>=step.requiredBadges,`Badge cycle before ${step.id}`);
  assert.ok(step.requiredFlags.every(f=>flags.has(f)),`Flag cycle before ${step.id}`);
  if(step.kind==='original'){assert.equal(step.aceLevel,ORIGINAL_GYM_ACE_LEVELS[step.leader as keyof typeof ORIGINAL_GYM_ACE_LEVELS]);badges++;}
  else flags.add(step.flagId!);
}
assert.equal(CAMPAIGN_PROGRESSION.length,20);assert.equal(badges,8);assert.ok(Object.values(NEW_GYM_FLAGS).every(flag=>flags.has(flag)));
assert.equal(hash(readFileSync('roms/pokemon-black2-us.nds')),sourceHash);
// Script commands need not begin at even offsets. A newly reserved flag in an
// odd-position operand must be rejected before any trainer allocation commits.
const collisionRom=new NintendoDSRom(source,{fileData:'view'});
const collisionScripts=new NARC(new Uint8Array(collisionRom.getFileByName('a/0/5/6')));
const member=collisionScripts.files[0],padding=member.length%2===0?1:0;
const collision=new Uint8Array(member.length+padding+6);collision.set(member);
const at=member.length+padding;
collision.set([0x23,0,0x83,0x0a,0x02,0],at);
assert.equal((at+2)%2,1);
collisionScripts.files[0]=collision;
collisionRom.files[collisionRom.fileId('a/0/5/6')]=collisionScripts.save();
const collisionFileRefs=[...collisionRom.files];
assert.throws(()=>applyCampaignDefinitions(collisionRom),/Reserved campaign flag already appears/);
collisionRom.files.forEach((bytes,id)=>assert.equal(bytes,collisionFileRefs[id]));
mkdirSync('build/research-species',{recursive:true});writeFileSync('build/research-species/campaign-tested-report.json',JSON.stringify(report,null,2));
console.log('Campaign: 28 real trainer allocations; 12 Gym, 4 two-battle Plasma and 8 mentor native-script roundtrips; bytecode win/loss/repeat/prerequisite checks; 20-Gym acyclic progression; original files/text/base ownership preserved. No emulator battle claim.');
