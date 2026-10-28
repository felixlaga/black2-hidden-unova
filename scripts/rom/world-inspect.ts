import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { extractGameFreakContainer, parseVMapTerrain, parseChunkBuildings, mapBuildingMember, parseMapMatrix, readNitroModelNames, readNitroResources, buildModelPrimitives } from '../../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { decompressCode } from '../../vendor/pokeweb-serverless/src/nds/codeCompression';

const rom = new NintendoDSRom(readFileSync('roms/pokemon-black2-us.nds'), {fileData:'view'});
const paths = {headers:'a/0/1/2',maps:'a/0/0/8',matrix:'a/0/0/9',events:'a/1/2/6',scripts:'a/0/5/6',story:'a/0/0/3',messages:'a/0/0/2'};
const a = Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,new NARC(rom.getFileByName(p))]));
const names = decodeGen5TextBank(a.messages.files[109]).map(e=>e[1]);
const rows = Array.from({length:a.headers.files[0].length/48},(_,i)=>{
 const h=a.headers.files[0].subarray(i*48,i*48+48),mx=readU16(h,4),matrix=parseMapMatrix(a.matrix.files[mx]);
 const location=h[26]|((h[27]&3)<<8);
 const maps=matrix.chunkIds.flatMap((id,j)=>id>=0&&(!matrix.hasZones||matrix.zoneIds[j]===i)?[{id,x:j%matrix.width,z:Math.floor(j/matrix.width)}]:[]);
 const event=readU16(h,22),e=a.events.files[event];
 return {id:i,name:names[location],location,area:readU16(h,2),matrix:mx,script:readU16(h,6),level:readU16(h,8),text:readU16(h,10),encounter:readU16(h,20),event,header:[...h],maps,counts:e?[...e.slice(4,8)]:null};
});
const mapInfo=a.maps.files.map((bytes,id)=>{try{
 const c=extractGameFreakContainer(bytes),p=parseVMapTerrain(c.files[1],id),b=parseChunkBuildings(c.files[mapBuildingMember(c.files)],[],id);
 const surfaces=p.tiles.reduce((out,t)=>{const key=[t.heightType,t.height,t.tileClass,t.flags].join('/');out[key]=(out[key]??0)+1;return out;},{} as Record<string,number>);
 return {id,signature:c.signature,members:c.files.map(b=>b.length),models:readNitroModelNames(c.files[0]),buildings:b,surfaces};
 }catch(error){return {id,error:String(error)}}});
mkdirSync('build/research-world',{recursive:true});
writeFileSync('build/research-world/inventory.json',JSON.stringify({counts:Object.fromEntries(Object.entries(a).map(([k,n])=>[k,n.files.length])),rows,mapInfo},null,2));
writeFileSync('build/research-world/arm9.bin',decompressCode(rom.arm9));
writeFileSync('build/research-world/overlays.json',JSON.stringify([...rom.loadArm9Overlays([12,36])].map(([id,o])=>({id,ramAddress:o.ramAddress,size:o.data.length}))));
for(const [id,o] of rom.loadArm9Overlays([12,36]))writeFileSync(`build/research-world/overlay${id}.bin`,o.data);
const diagnostics: unknown[]=[];
for(const mapId of [283,284,717,54,83,827]){
 const c=extractGameFreakContainer(a.maps.files[mapId]),r=readNitroResources(c.files[0]);
 diagnostics.push({mapId,materials:r.models[0].materials.map(m=>({name:m.name,texture:m.textureName,mode:m.textureTransformMode})),primitives:buildModelPrimitives(r,[]).map(p=>({material:p.material.name,min:[0,1,2].map(k=>Math.min(...p.positions.filter((_,i)=>i%3===k))),max:[0,1,2].map(k=>Math.max(...p.positions.filter((_,i)=>i%3===k)))}))});
}
writeFileSync('build/research-world/materials.json',JSON.stringify(diagnostics,null,2));
for(const r of rows.filter(r=>/Cave|Celestial|Dreamyard|Victory|Reversal|Giant Chasm/.test(r.name??''))){try{const d=decompileBw2Script(a.scripts.files[r.script]);if(d.source.includes('call_wild_battle'))writeFileSync(`build/research-world/native-battle-${r.id}.bws`,d.source);}catch{}}
console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(a).map(([k,n])=>[k,n.files.length])),headers:rows.length,base:rom.arm9RamAddress,selected:rows.filter(r=>/Route (20|6|7|21)$|Aspertia|Nuvema|Accumula|Floccesy|Virbank|Lacunosa|Anville|Hidden Grotto/.test(r.name??'')).map(r=>({...r,header:undefined}))},null,2));
