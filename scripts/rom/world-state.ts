import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../../vendor/pokeweb-serverless/src/nds/narc';
import {readU16,readU32,writeU32} from '../../vendor/pokeweb-serverless/src/nds/binary';
import {decompressCode} from '../../vendor/pokeweb-serverless/src/nds/codeCompression';

// Only keeper completion uses a flag. Clues and repairs occupy six bits of one
// saved work word per quest. These allocations are disjoint from root and sages.
export const WORLD_QUEST_FLAGS = [0xA99,0xA9B,0xA9F] as const;
export const WORLD_QUEST_WORK = [0x419C,0x419D,0x419E] as const;
export const WORLD_ROOT_FLAGS = [0xA83,0xA0C,0xA85,0xA87,0xA11,0xA88,0xA89,0xA1D,0xA21,0xA8B,0xA24,0xA25,0xA2B,0xA2F,0xA8C,0xA8D,0xA37,0xA39,0xA3B,0xA3D,0xA8F,0xA41] as const;

/** A script command can start at an odd offset. Conservatively reject even an
 * incidental two-byte match, including operands, displacements and event data. */
export function assertWorldStateLiteralAbsence(bytes:Uint8Array,ids:readonly number[],context:string){
 const reserved=new Set(ids);
 for(let offset=0;offset+1<bytes.length;offset++)if(reserved.has(readU16(bytes,offset)))throw new Error(`Reserved world state 0x${readU16(bytes,offset).toString(16)} already used in ${context}:${offset}`);
}

/** Bounded native audit: 50 direct Thumb calls in 345 modules, their indirect
 * lookup tables and script/event operands. Pin those exact binaries so edits
 * cannot silently invalidate the review. This is not universal symbolic proof. */
export function auditWorldQuestState(rom:NintendoDSRom){
 const flags=[...WORLD_QUEST_FLAGS],rootFlags=[...WORLD_ROOT_FLAGS],workIds=[...WORLD_QUEST_WORK],arm=decompressCode(rom.arm9),overlays=rom.loadArm9Overlays();
 const at=(address:number)=>address-rom.arm9RamAddress;
 if(readU32(arm,at(0x02019288))!==383||readU32(arm,at(0x0201928C))!==862)throw new Error('Unexpected native IREO flag storage capacity/offset');
 const ov12=overlays.get(12)!;
 if(readU16(ov12.data,0x02155038-ov12.ramAddress)!==0x225F||readU16(ov12.data,0x0215503A-ov12.ramAddress)!==0x0112)throw new Error('Unexpected IREO trainer flag offset');
 const trainerCount=new NARC(new Uint8Array(rom.getFileByName('a/0/9/1'))).files.length,trainerLast=0x5F0+trainerCount-1;
 if(trainerLast>=0x960)throw new Error('Trainer flags overlap the native system-flag range');
 for(const path of ['a/0/5/6','a/1/2/6'])for(const [member,bytes]of new NARC(new Uint8Array(rom.getFileByName(path))).files.entries())assertWorldStateLiteralAbsence(bytes,[...flags,...rootFlags,...workIds],`${path}:${member}`);
 const tables=[
  {module:0,address:0x02092238,count:14,stride:8,offset:0},
  {module:0,address:0x020927B0,count:25,stride:4,offset:2},
  {module:12,address:0x0216C33C,count:82,stride:20,offset:0},
  {module:36,address:0x021D4704,count:25,stride:4,offset:2},
  {module:65,address:0x021E6710,count:17,stride:4,offset:2},
  {module:298,address:0x021AC5F0,count:57,stride:6,offset:0},
  {module:302,address:0x021AE41C,count:57,stride:6,offset:0},
 ];
 const readTable=(t:{module:number;address:number;count:number;stride:number;offset:number})=>{const mod=t.module?overlays.get(t.module)!:null,bytes=mod?.data??arm,base=mod?.ramAddress??rom.arm9RamAddress;return {...t,values:Array.from({length:t.count},(_,i)=>readU16(bytes,t.address-base+i*t.stride+t.offset))};};
 const checked=tables.map(readTable);
 for(const t of checked)if(t.values.some(v=>[...flags,...rootFlags].includes(v as never)))throw new Error(`World/root flag overlaps native table ${t.address.toString(16)}`);
 const workTables=[
  {module:12,address:0x0216C300,count:10,stride:6,offset:2}, // map variants4031..403A
  {module:65,address:0x021E66C8,count:8,stride:4,offset:0}, // badge work4045..404C
  {module:103,address:0x021EF854,count:9,stride:2,offset:0}, // work40E4..40EC
  {module:0,address:0x0208FA60,count:8,stride:4,offset:0}, // ov332 via02010C6C
 ].map(readTable);
 for(const t of workTables)if(t.values.some(v=>workIds.includes(v as never)))throw new Error(`World quest work overlaps native table ${t.address.toString(16)}`);
 const signatures=[
  {module:0,address:0x0201919C,hex:'014a024b00211847de040000a8870702',purpose:'new-game initializer: memset(block,0,0x4DE)'},
  {module:0,address:0x02019294,hex:'01229203891a490040187047',purpose:'saved work pointer: block + 2*(id-0x4000)'},
  {module:0,address:0x020192A0,hex:'38b50d1c141cfff7f5ff621b002152005ff07aea38bd',purpose:'clear length: 2*(end-start), end exclusive'},
  {module:12,address:0x02153904,hex:'012189030a1c201c1f32c5f6c7fc10bd',purpose:'sole map-reset caller:4000..401E'},
  {module:12,address:0x02154794,hex:'70b5051c0e1c00f0a5f8041c281c311c00f0b4f8218808402080002070bd',purpose:'opcode12 work_and: native16-bit AND/store'},
  {module:12,address:0x021547B4,hex:'70b5051c0e1c00f095f8041c281c311c00f0a4f8218808432080002070bd',purpose:'opcode13 work_or: native16-bit OR/store'},
  {module:12,address:0x02154808,hex:'70b5051c0e1c00f06bf8041c281c311c00f07af82080002070bd',purpose:'opcode2A work_set: resolved source/store'},
 ];
 for(const s of signatures){const mod=s.module?overlays.get(s.module)!:null,bytes=mod?.data??arm,base=mod?.ramAddress??rom.arm9RamAddress;if(Buffer.from(bytes.subarray(s.address-base,s.address-base+s.hex.length/2)).toString('hex')!==s.hex)throw new Error(`Unexpected native work signature: ${s.purpose}`);}
 for(const [opcode,address]of [[0x12,0x02154795],[0x13,0x021547B5],[0x2A,0x02154809]])if(readU32(ov12.data,0x0216B538-ov12.ramAddress+4*opcode)!==address)throw new Error('Unexpected native work opcode dispatch');
 const modules=[{id:0xFFFFFFFF,base:rom.arm9RamAddress,data:arm},...[...overlays].sort(([a],[b])=>a-b).map(([id,o])=>({id,base:o.ramAddress,data:o.data}))],digest=createHash('sha256');
 for(const m of modules){const descriptor=new Uint8Array(12);writeU32(descriptor,0,m.id);writeU32(descriptor,4,m.base);writeU32(descriptor,8,m.data.length);digest.update(descriptor);digest.update(m.data);}
 const nativeModulesSha256=digest.digest('hex');
 if(modules.length!==345||nativeModulesSha256!=='040c7d56fd9fb1e780a161b7e0afd8c8cd3baaa6074617a718682a390c78361b')throw new Error('Native work audit binaries changed; repeat the bounded computed-consumer audit before allocating saved work');
 const savedWork=workIds.map(workId=>({workId,index:workId-0x4000,byteOffset:2*(workId-0x4000),initialValue:0,clueMask:7,repairMask:56,completionMask:63}));
 for(const work of savedWork)if(work.byteOffset<0||work.byteOffset+2>862||work.workId<=0x401E)throw new Error('Quest work falls outside persistent save storage');
 return {flags,savedFlagBytes:383,savedFlagOffset:862,lastConservativeFlag:0xBF3,trainerFlagOffset:0x5F0,trainerLast,excludedDynamicRanges:[{start:0x5F0,end:0x95F,reason:'native trainer allocation ceiling'},{start:0x960,end:0xA00,reason:'native system/lookup-table flags'},{start:0xAA0,end:0xB03,reason:'native daily clear range at020192B8'},{start:0xB04,end:0xBD8,reason:'hidden-item table indexed flags at0215F25C'}],rootFlagsTableAudited:rootFlags,rootFlagsScriptAndEventAudited:rootFlags,nativeTables:checked,scriptAndEventLiteralAbsence:true,literalScanStride:1,savedWorkWords:431,savedWork,nativeWorkTables:workTables,nativeWorkSignatures:signatures,nativeWorkAudit:{moduleCount:345,directCalls:50,constantCalls:35,dynamicCalls:15,nativeModulesSha256,mapReset:{start:0x4000,endExclusive:0x401F,call:0x0215390E},initialization:{address:0x0201919C,bytes:0x4DE,value:0},dynamicConsumers:[{module:0,calls:[0x020192A6],source:'clear-range wrapper; sole caller uses4000..401F exclusive'},{module:12,calls:[0x02153B02,0x02153F50],source:'special-script conditional records and script-variable getter; every-byte script scan'},{module:12,calls:[0x02154DFA,0x02154E5A,0x02154E84],source:'map-variant table216C300;4031..403A'},{module:12,calls:[0x0215D268,0x0215D2CC,0x0215D322,0x0215D368],source:'event-trigger records; every-byte event scan'},{module:65,calls:[0x021E6444],source:'table21E66C8;4045..404C'},{module:97,calls:[0x021EED70],source:'r7=1 at21EEC98, shifted14; work4000 only'},{module:99,calls:[0x021EF044],source:'all20 local setter callers:4000..4003 or40CF..40D1'},{module:103,calls:[0x021EEFC8],source:'table21EF854;40E4..40EC'},{module:332,calls:[0x021C6E00],source:'ARM9 table208FA60 via2010C6C;4045..404C'}]},scope:'IREO rev0 pinned ARM9 and344 overlays; seven flag and four fixed work lookup tables;50 direct work calls with their computed consumers; computed flag intervals and every byte offset of supplied script/event archives. Not a universal symbolic execution proof.',emulatorPersistenceValidated:false};
}
