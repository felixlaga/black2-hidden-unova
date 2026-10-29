/** Isolated native loading/render tour. Its QA warps are never a campaign test. */
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../vendor/pokeweb-serverless/src/nds/narc';
import {readU16, readU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {installMapCameraTestWarp} from '../vendor/pokeweb-serverless/src/pokeweb/mapCameraTest';
import {extractGameFreakContainer, parseVMapTerrain} from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import {parseGen5MatrixFile} from '../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import {decodeGen5TextBank} from '../vendor/pokeweb-serverless/src/pokeweb/text';
import {WORLD_GYM_PUZZLES} from './rom/world-puzzles';

const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const outArg=process.argv.indexOf('--out'),out=outArg>=0?process.argv[outArg+1]:'build/world-tour/tour';
if(!out||existsSync(`${out}.nds`)||existsSync(`${out}.json`))throw Error('Use a new tour output prefix');
const sourceArg=process.argv.indexOf('--source'),sourcePath=sourceArg>=0?process.argv[sourceArg+1]:'build/black2-hidden-unova.nds';
if(!sourcePath?.endsWith('.nds'))throw Error('Tour source must be a built .nds path');
const source=readFileSync(sourcePath);
const report=JSON.parse(readFileSync(sourcePath.replace(/\.nds$/,'.json'),'utf8'));
if(sha(source)!==report.outputSha256)throw Error('Build/report mismatch');
const rom=new NintendoDSRom(source,{fileData:'view'});
if(rom.idCode!=='IREO'||source[0x1e]!==0)throw Error('IREO revision0 only');
const headers=new NARC(new Uint8Array(rom.getFileByName('a/0/1/2'))).files[0];
const scripts=new NARC(new Uint8Array(rom.getFileByName('a/0/5/6')));
const events=new NARC(new Uint8Array(rom.getFileByName('a/1/2/6')));
const maps=new NARC(new Uint8Array(rom.getFileByName('a/0/0/8')));
const matrices=new NARC(new Uint8Array(rom.getFileByName('a/0/0/9')));
const save=readFileSync('vendor/pokeweb-serverless/src/assets/testbattle/test.sav');
type Scene={zoneId:number;name:string;kind:string;tileX:number;tileZ:number;mapId:number;chunk:number};
const houseOnly=process.argv.includes('--houses'),houseTour=houseOnly||process.argv.includes('--verify-doors');
const scenes:Scene[]=report.modules.world.areas.flatMap((area:any)=>area.mapIds.map((mapId:number,chunk:number)=>({
 zoneId:area.headerId,name:area.name,kind:area.kind,tileX:area.kind==='interior'?6:15+chunk*32,
 tileZ:area.kind==='interior'?7:27,mapId,chunk,
}))).filter((s:Scene)=>!houseOnly||(s.kind==='town'&&s.chunk===0));
for(const scene of scenes){
 const h=headers.subarray(scene.zoneId*48,(scene.zoneId+1)*48),matrix=parseGen5MatrixFile(matrices.files[readU16(h,4)]);
 if(matrix[`map_${Math.floor(scene.tileZ/32)*matrix.width+Math.floor(scene.tileX/32)}`]!==scene.mapId)throw Error('Scene matrix mismatch');
 const terrain=parseVMapTerrain(extractGameFreakContainer(maps.files[scene.mapId]).files[1]);
 for(const z of [scene.tileZ,scene.tileZ+1]){const tile=terrain.tiles[(z%32)*32+scene.tileX%32];if((tile.flags&1)||tile.tileClass===63)throw Error(`Blocked tour tile ${scene.zoneId}:${scene.tileX},${z}`);}
 const ev=events.files[readU16(h,22)];
 for(let i=0;i<ev[5];i++){const at=8+ev[4]*20+i*36;if(readU16(ev,at+28)===scene.tileX&&[scene.tileZ,scene.tileZ+1].includes(readU16(ev,at+30)))throw Error('Tour overlaps NPC');}
}
const original={zoneId:readU32(save,0x19580),tileX:readU16(save,0x19586),tileZ:readU16(save,0x1958e),gridY:readU16(save,0x1958a)};
const changed:Array<{zone:number;scriptId:number;eventId:number;entryId:number;target:number}>=[];
for(let i=-1;i<scenes.length;i++){
 const from=i<0?original:scenes[i],to=i+1<scenes.length?scenes[i+1]:original;
 const h=headers.subarray(from.zoneId*48,(from.zoneId+1)*48),scriptId=readU16(h,6),eventId=readU16(h,22);
 const fixture=installMapCameraTestWarp(scripts.files[scriptId],events.files[eventId],
  {gridX:from.tileX,gridY:i<0?original.gridY:0,gridZ:from.tileZ},
  {zoneId:to.zoneId,tileX:to.tileX,tileZ:to.tileZ,height:0,facing:'up'});
 scripts.files[scriptId]=fixture.scripts;events.files[eventId]=fixture.events;
 changed.push({zone:from.zoneId,scriptId,eventId,entryId:fixture.entryId,target:to.zoneId});
}
rom.files[rom.fileId('a/0/5/6')]=scripts.save();rom.files[rom.fileId('a/1/2/6')]=events.save();
// Actual house entries/exits stay unchanged. Only the tour transport is new.
// Store the serialized terrain, NPC occupancy and all step events for input-only
// walking; the runner never writes position or any other emulated memory.
const walkMaps=report.modules.world.areas.map((a:any)=>{
 const h=headers.subarray(a.headerId*48,(a.headerId+1)*48),m=parseGen5MatrixFile(matrices.files[readU16(h,4)]),width=m.width*32,height=m.height*32,blocked:number[]=[];
 for(let cell=0;cell<m.width*m.height;cell++){
  const terrain=parseVMapTerrain(extractGameFreakContainer(maps.files[m[`map_${cell}`]]).files[1]);
  terrain.tiles.forEach((t,k)=>{if(t.flags&1||t.tileClass>=61&&t.tileClass<=68)blocked.push((Math.floor(cell/m.width)*32+Math.floor(k/32))*width+(cell%m.width)*32+k%32);});
 }
 const ev=events.files[a.eventId],npcs=[] as any[],triggers=[] as any[];
 for(let k=0;k<ev[5];k++){const at=8+ev[4]*20+k*36,p={index:k,actorId:readU16(ev,at),entry:readU16(ev,at+10),x:readU16(ev,at+28),z:readU16(ev,at+30)};npcs.push(p);}
 for(let k=0;k<ev[7];k++){const at=8+ev[4]*20+ev[5]*36+ev[6]*20+k*22;triggers.push({x:readU16(ev,at+10),z:readU16(ev,at+12),w:readU16(ev,at+14),h:readU16(ev,at+16)});}
 return {zoneId:a.headerId,width,height,blocked,npcs,triggers};
});
const textBanks=new NARC(new Uint8Array(rom.getFileByName('a/0/0/3')));
const puzzles=report.modules.world.gyms.map((g:any,index:number)=>{
 const authored=WORLD_GYM_PUZZLES[index];
 if(JSON.stringify(authored.stations)!==JSON.stringify(g.puzzle.stations))throw Error('Puzzle definition/report mismatch');
 const bank=decodeGen5TextBank(textBanks.files[g.textBankId]);
 const message=(prefix:string)=>{const matches=bank.filter(row=>row[1].replace(/\\[nrf]/g,' ').replace(/\s+/g,' ').startsWith(prefix));if(matches.length!==1)throw Error(`Ambiguous puzzle text ${prefix}`);return {text:matches[0][1],pages:matches[0][1].split(/\\[rf]/).length};};
 const map=walkMaps.find((m:any)=>m.zoneId===g.headerId)!;
 return {...g,controls:g.puzzle.stations.map((station:string,i:number)=>({...map.npcs[i+2],correct:message(`${station} is set.`)})),wrong:message('The sequence is out of order.'),done:message(authored.done)};
});
const output=rom.save({preserveOriginalLength:true});
if(sha(source)!==report.outputSha256)throw Error('Source mutated');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(`${out}.nds`,output);writeFileSync(`${out}.sav`,save);
writeFileSync(`${out}.json`,JSON.stringify({fixtureOnly:true,campaignProof:false,houseTour,verifyPuzzles:process.argv.includes('--verify-puzzles'),sourceSha256:report.outputSha256,romSha256:sha(output),original,scenes,changed,walkMaps,puzzles,houses:report.modules.world.interiors},null,2)+'\n');
console.log(JSON.stringify({scenes:scenes.length,areas:report.modules.world.areas.length,fixtureOnly:true}));
