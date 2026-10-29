/** Native mesh coordinates must agree with permission tiles, not a mirrored preview. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { buildModelPrimitives, extractGameFreakContainer, parseChunkBuildings, parseVMapTerrain, readNitroResources } from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { blankLayout, paint, buildWorldChunk, WORLD_MATERIALS } from '../scripts/rom/world-geometry';
const source=readFileSync('roms/pokemon-black2-us.nds'),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),before=hash(source);
const rom=new NintendoDSRom(source,{fileData:'view'}),template=new NARC(rom.getFileByName('a/0/0/8')).files[54];
const layout=blankLayout('asymmetric coordinate regression',64,64);
paint(layout,{x:4,z:21,w:5,h:3},'w');paint(layout,{x:12,z:5,w:3,h:3},'f');
paint(layout,{x:37,z:20,w:6,h:4},'e');paint(layout,{x:43,z:41,w:4,h:2},'s');
paint(layout,{x:20,z:7,w:2,h:9},'p');paint(layout,{x:8,z:13,w:4,h:1},'#');
layout.props.push({x:20,z:38,uid:44,footprint:{x:19,z:37,w:3,h:3}});
paint(layout,layout.props[0].footprint,'b');
let tested=0,horizontalTriangles=0;
for(let cz=0;cz<2;cz++)for(let cx=0;cx<2;cx++){
 const built=buildWorldChunk(template,layout,cx,cz),container=extractGameFreakContainer(built.bytes);
 const terrain=parseVMapTerrain(container.files[1]),primitives=buildModelPrimitives(readNitroResources(container.files[0]),[]);
 const triangles=primitives.flatMap(p=>Array.from({length:p.indices.length/3},(_,i)=>{
  const vertices=[0,1,2].map(j=>Array.from(p.positions.subarray(p.indices[i*3+j]*3,p.indices[i*3+j]*3+3)));
  return {vertices,material:p.material.name};
 })).filter(t=>t.vertices.every(v=>v[1]===t.vertices[0][1]));
 for(const {vertices:[a,b,c]} of triangles){
  const normalY=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
  assert.ok(normalY>0,'Horizontal native surfaces face upward');horizontalTriangles++;
 }
 for(let z=0;z<32;z++)for(let x=0;x<32;x++){
  const px=x*16+8-256,pz=z*16+8-256;
  const hits=triangles.filter(({vertices:[a,b,c]})=>{
   const det=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
   const u=((b[2]-c[2])*(px-c[0])+(c[0]-b[0])*(pz-c[2]))/det;
   const v=((c[2]-a[2])*(px-c[0])+(a[0]-c[0])*(pz-c[2]))/det;
   return u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7;
  });
  assert.ok(hits.length,`No rendered floor ${cx},${cz}:${x},${z}`);
  const top=Math.max(...hits.map(h=>h.vertices[0][1]));
  const materials=new Set(hits.filter(h=>h.vertices[0][1]===top).map(h=>h.material));
  const symbol=layout.tiles[(cz*32+z)*64+cx*32+x];
  const expected=symbol==='w'?WORLD_MATERIALS.water:symbol==='f'||symbol==='e'?WORLD_MATERIALS.garden:symbol==='p'?WORLD_MATERIALS.path:symbol==='s'||symbol==='b'?WORLD_MATERIALS.stone:WORLD_MATERIALS.ground;
  assert.deepEqual(materials,new Set([expected]),`Visual/collision mismatch ${cx},${cz}:${x},${z} ${symbol}`);
  const t=terrain.tiles[z*32+x];assert.equal(t.tileClass,['#','b'].includes(symbol)?1:symbol==='w'?63:symbol==='e'?4:0);
  tested++;
 }
 const props=parseChunkBuildings(container.files[2],[],0);
 if(cx===0&&cz===1){assert.equal(props.length,1);assert.equal(props[0].x,20*16+8-256);assert.equal(props[0].z,256-((38-32)*16+8));}
 else assert.equal(props.length,0);
}
assert.equal(hash(source),before);assert.equal(hash(rom.data),before);
console.log({pass:true,tiles:tested,chunks:4,horizontalTriangles,nativePropSignPreserved:true,sourceUnchanged:true});
