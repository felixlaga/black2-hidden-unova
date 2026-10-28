import { buildFullWorld, type WorldBuildOptions } from './world-build';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16, writeU32, concatBytes } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { decompressCode } from '../../vendor/pokeweb-serverless/src/nds/codeCompression';
import { encodeGen5TextBank, decodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { compileBw2Script, decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { materializeGen5MatrixFile } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import { blankLayout, addBuilding, addLandmark, path, buildWorldChunk, type WorldLayout, type Point } from './world-geometry';

export const WORLD_PATHS={headers:'a/0/1/2',maps:'a/0/0/8',matrix:'a/0/0/9',events:'a/1/2/6',scripts:'a/0/5/6',story:'a/0/0/3'} as const;
export const WORLD_FIRST_ZONE=616;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export type WorldReport={changedFiles:Array<{path:string;fileId:number;beforeSha256:string;afterSha256:string;bytes:number}>;[key:string]:unknown};

export function worldNpc(uid:number,sprite:number,entry:number,p:Point,flag=0){
 const b=new Uint8Array(36);writeU16(b,0,uid);writeU16(b,2,sprite);writeU16(b,8,flag);writeU16(b,10,entry);writeU16(b,12,1);writeU16(b,28,p.x);writeU16(b,30,p.z);return b;
}
export function worldTrigger(entry:number,p:Point,width=1,height=1,altitude=0){
 const b=new Uint8Array(22);writeU16(b,0,entry);writeU16(b,10,p.x);writeU16(b,12,p.z);writeU16(b,14,width);writeU16(b,16,height);writeU16(b,18,altitude);return b;
}
export function worldEvents(npcs:Uint8Array[],triggers:Uint8Array[]=[]){
 // Native size excludes its own four-byte word (and any trailing padding).
 const out=concatBytes([new Uint8Array(8),...npcs,...triggers]);writeU32(out,0,out.length-4);out[5]=npcs.length;out[7]=triggers.length;return out;
}
export function worldScript(entries:string[]){
 const source='preserve_layout\nwork :work_8000, 0x8000\nwork :work_8010, 0x8010\nwork :world_puzzle_stage, 0x4000\nwork :world_puzzle_gym, 0x4001\n'+entries.map((body,i)=>`script :world_${i+1}, entry: ${i+1} do\n${body}\nend\n`).join('\n');
 const compiled=compileBw2Script(source),round=decompileBw2Script(compiled.bytes);
 if(!round.roundTripVerified||!round.editable)throw new Error('Generated world script failed native compiler verification');return {source,...compiled};
}
export function worldText(texts:string[]){return encodeGen5TextBank(texts.map((s,i)=>[`0_${i}`,s,0]));}

/** Mutates owned NitroFS archive bytes only. Never saves or exports a ROM. */
export function applyWorld(rom:NintendoDSRom,options:WorldBuildOptions & {probe?:'donor'|'geometry'|'header'|'donor-headerless'|'geometry-headerless'}={}):WorldReport{
 if(rom.idCode!=='IREO'||rom.data[0x1e]!==0)throw new Error('World expansion requires US Black2 revision0');
 const arm9=decompressCode(rom.arm9);
 // IREO native header reader: resource offset=zone*48, byte count48. This is
 // deliberately checked before appending; no arbitrary engine patch is made.
 const signature=[0x30,0x23,0x22,0x1c,0x00,0x21,0x5a,0x43];
 if(!signature.every((n,i)=>arm9[0x02018846-rom.arm9RamAddress+i]===n))throw new Error('Unsupported native map-header lookup');
 // Retail cache initialization uses zone615 as the empty-cache sentinel.
 // Reusing it renders after an entry warp but fails fresh saved-game loading.
 if(readU16(arm9,0x02018774-rom.arm9RamAddress)!==615)throw new Error('Unsupported native map-header cache sentinel');
 if(!options.probe)return buildFullWorld(rom,options);
 const archives=Object.fromEntries(Object.entries(WORLD_PATHS).map(([k,p])=>[k,new NARC(new Uint8Array(rom.getFileByName(p)))])) as Record<keyof typeof WORLD_PATHS,NARC>;
 const counts=Object.fromEntries(Object.entries(archives).map(([k,a])=>[k,a.files.length]));
 if(archives.headers.files[0].length!==615*48)throw new Error('World is already applied or base header layout has changed');
 const l=blankLayout('Bramblewick');
 path(l,{x:16,z:28},{x:16,z:5});path(l,{x:5,z:17},{x:26,z:17});
 addBuilding(l,{x:5,z:5,w:5,h:4},0);addBuilding(l,{x:21,z:7,w:5,h:4},1);
 addLandmark(l,'Two-leaf shelter','plaza',{x:13,z:12,w:7,h:7});
 addLandmark(l,'Mara berry beds','garden',{x:5,z:21,w:5,h:5});
 addLandmark(l,'Mossstep spring','pool',{x:22,z:21,w:5,h:4});
 const mapId=archives.maps.files.length,matrixId=archives.matrix.files.length,eventId=archives.events.files.length,scriptId=archives.scripts.files.length,textBankId=archives.story.files.length;
 const built=buildWorldChunk(archives.maps.files[54],l,0,0);archives.maps.files.push(options.probe?.startsWith('donor')?archives.maps.files[717].slice():built.bytes);
 archives.matrix.files.push(materializeGen5MatrixFile({width:1,height:1,matrix_flags:options.probe?.endsWith('headerless')?0:1,footer_length:0,map_0:mapId,header_0:616},new Uint8Array()));
 const script=worldScript(['  lock\n  talk message: 0\n  finish_interaction']);archives.scripts.files.push(script.bytes);
 archives.story.files.push(worldText(['Mara: Welcome to Bramblewick!\\nThe two-leaf shelter is open.']));
 archives.events.files.push(worldEvents([worldNpc(0,30,1,{x:17,z:20})]));
 const donor=options.probe==='header'?331:518;
 const header=archives.headers.files[0].slice(donor*48,(donor+1)*48);
 if(!options.probe?.startsWith('donor'))writeU16(header,2,34);
 writeU16(header,4,matrixId);writeU16(header,6,scriptId);writeU16(header,8,5);writeU16(header,10,textBankId);writeU16(header,20,8191);writeU16(header,22,eventId);writeU16(header,24,616);writeU32(header,36,15);writeU32(header,40,0);writeU32(header,44,26);
 archives.headers.files[0]=concatBytes([archives.headers.files[0],new Uint8Array(48),header]);
 const changedFiles=Object.entries(WORLD_PATHS).map(([key,p])=>{const fileId=rom.fileId(p),beforeSha256=digest(rom.files[fileId]),bytes=archives[key as keyof typeof WORLD_PATHS].save();rom.files[fileId]=bytes.slice();return {path:p,fileId,beforeSha256,afterSha256:digest(bytes),bytes:bytes.length};});
 return {changedFiles,phase:'first-native-allocation',probe:options.probe??'geometry',countsBefore:counts,firstMap:{headerId:616,mapIds:[mapId],matrixId,eventId,scriptId,textBankId,landing:{x:15,z:26},nativeWarpCommand:'map_change_warp 616, 15, 26, 0'},geometry:{polygons:built.polygons,vertices:built.vertices},nativeEvidence:{headerReaderAddress:'0x02018818',headerLookup:'zoneId * 48 via NARC member0; signature checked',emulatorValidated:false},staticEncounters:[],limitations:['First allocation only; all24 settlements,96 secrets, route connections and campaign hooks are not yet integrated.']};
}
