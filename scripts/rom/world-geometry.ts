import { readU16, writeU16, writeU32 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { extractGameFreakContainer, packGameFreakContainer, parseVMapTerrain, readNitroResources, buildModelPrimitives } from '../../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { writeStaticNitroModel, type StaticModelMesh } from '../../vendor/pokeweb-serverless/src/pokeweb/nitroModelWriter';

export type Point = {x:number;z:number};
export type Rect = Point & {w:number;h:number};
export type WorldLayout = {
 width:number; height:number; tiles:string[]; buildings:Array<Rect & {height:number;style:number}>;
 props:Array<Point & {uid:number;footprint:Rect}>;
 landmarks:Array<{name:string;rect:Rect;kind:'grove'|'pool'|'plaza'|'kiln'|'tower'|'garden'|'canal'}>;
 palette:number; label:string; materials?:Record<keyof typeof WORLD_MATERIALS,string>;
};
export const WORLD_MATERIALS={ground:'grass01ax',path:'michi01a',stone:'gake_futa',water:'kawa_soko',wood:'hashi01a',garden:'kusa_ec1',wall:'gake1_1',roof:'kawasoko_isi'} as const;
const COLORS=[
 [0.77,0.93,0.69], [0.93,0.72,0.52], [1,0.88,0.59], [0.63,0.89,0.8],
 [0.79,0.81,0.95], [0.65,0.85,0.94], [0.86,0.94,1], [0.74,0.92,0.86],
];
export function paint(layout:WorldLayout,rect:Rect,kind:string){
 for(let z=Math.max(0,rect.z);z<Math.min(layout.height,rect.z+rect.h);z++)for(let x=Math.max(0,rect.x);x<Math.min(layout.width,rect.x+rect.w);x++)layout.tiles[z*layout.width+x]=kind;
}
export function path(layout:WorldLayout,a:Point,b:Point,width=2){
 paint(layout,{x:Math.min(a.x,b.x),z:a.z,w:Math.abs(a.x-b.x)+width,h:width},'p');
 paint(layout,{x:b.x,z:Math.min(a.z,b.z),w:width,h:Math.abs(a.z-b.z)+width},'p');
}
export function blankLayout(label:string,width=32,height=32,palette=0):WorldLayout{
 const l:WorldLayout={width,height,tiles:Array(width*height).fill('g'),buildings:[],props:[],landmarks:[],palette,label};
 paint(l,{x:0,z:0,w:width,h:2},'#');paint(l,{x:0,z:height-2,w:width,h:2},'#');
 paint(l,{x:0,z:0,w:2,h:height},'#');paint(l,{x:width-2,z:0,w:2,h:height},'#');return l;
}
export function addBuilding(l:WorldLayout,r:Rect,style=0,height=42){
 l.buildings.push({...r,height,style});paint(l,r,'b');
}
/** Bounds are decoded from the actual native model, including all overhangs. */
export function addNativeProp(l:WorldLayout,uid:number,p:Point,bounds:{min:number[];max:number[]}){
 const x=p.x*16+8,z=p.z*16+8;
 const footprint={x:Math.floor((x+bounds.min[0])/16),z:Math.floor((z+bounds.min[2])/16),w:0,h:0};
 footprint.w=Math.ceil((x+bounds.max[0])/16)-footprint.x;footprint.h=Math.ceil((z+bounds.max[2])/16)-footprint.z;
 if(footprint.x<2||footprint.z<2||footprint.x+footprint.w>l.width-2||footprint.z+footprint.h>l.height-2)throw new Error('Native prop footprint outside settlement');
 l.props.push({...p,uid,footprint});paint(l,footprint,'b');return footprint;
}
export function addLandmark(l:WorldLayout,name:string,kind:WorldLayout['landmarks'][number]['kind'],rect:Rect){
 l.landmarks.push({name,kind,rect});paint(l,rect,kind==='pool'||kind==='canal'?'w':kind==='garden'||kind==='grove'?'f':kind==='tower'||kind==='kiln'?'b':'s');
 if(kind==='tower'||kind==='kiln')l.buildings.push({...rect,height:kind==='tower'?88:30,style:kind==='tower'?4:5});
}
export function isOpen(l:WorldLayout,p:Point){return p.x>=0&&p.z>=0&&p.x<l.width&&p.z<l.height&&!['#','w','b'].includes(l.tiles[p.z*l.width+p.x]);}
export function reachable(l:WorldLayout,start:Point){
 const visited=new Set<number>(),queue=[start];
 for(let cursor=0;cursor<queue.length;cursor++){
  const p=queue[cursor],k=p.z*l.width+p.x;if(!isOpen(l,p)||visited.has(k))continue;visited.add(k);
  queue.push({x:p.x-1,z:p.z},{x:p.x+1,z:p.z},{x:p.x,z:p.z-1},{x:p.x,z:p.z+1});
 }return visited;
}

/** Custom terrain and architecture share a tile plan. All walking surfaces are
 * y=0, using the exact flat native VMap height record (0,3) from grotto map717.
 * Rendered walls/water/architecture are blocked; no collision is borrowed from
 * the terrain model's donor. Native materials and the pinned NSBMD writer are reused. */
export function buildWorldChunk(templateMap:Uint8Array,l:WorldLayout,cx:number,cz:number){
 const template=extractGameFreakContainer(templateMap);
 if(template.signature!=='WB')throw new Error('Expected WB map donor');
 const materials=l.materials??WORLD_MATERIALS;
 const nativeMaterials=readNitroResources(template.files[0]).models[0].materials;
 const groups=new Map<string,{positions:number[];indices:number[];uvs:number[];colors:number[]}>();
 const tint=COLORS[l.palette%COLORS.length];
 function quad(mat:string,vertices:number[],color:number[]=tint,uv=[0,0,16,0,16,16,0,16]){
  let g=groups.get(mat);if(!g){g={positions:[],indices:[],uvs:[],colors:[]};groups.set(mat,g);}
  const n=g.positions.length/3;g.positions.push(...vertices);g.indices.push(n,n+2,n+1,n,n+3,n+2);const m=nativeMaterials.find(m=>m.name===mat)!;g.uvs.push(...uv.map((v,i)=>v/(i%2?m.height*(m.flipT?2:1):m.width*(m.flipS?2:1))));g.colors.push(...color,...color,...color,...color);
 }
 // NSBMD geometry uses north-positive Z; loader presentation reflects it back.
 function box(x:number,z:number,w:number,h:number,y:number,wall:string,top:string,col:number[]=tint){
  const x0=(x-cx*32)*16-256,x1=x0+w*16,z0=256-(z-cz*32)*16,z1=z0-h*16;
  quad(top,[x0,y,z0,x0,y,z1,x1,y,z1,x1,y,z0],col);
  quad(wall,[x0,0,z0,x0,0,z1,x0,y,z1,x0,y,z0],col);
  quad(wall,[x1,0,z1,x1,0,z0,x1,y,z0,x1,y,z1],col);
  quad(wall,[x0,0,z1,x1,0,z1,x1,y,z1,x0,y,z1],col);
  quad(wall,[x1,0,z0,x0,0,z0,x0,y,z0,x1,y,z0],col);
 }
 // Greedy rectangles keep the entire scene comfortably below the DS polygon
 // budget; UVs tile using the original texture repeat modes.
 const used=new Set<number>();
 for(let z=0;z<32;z++)for(let x=0;x<32;x++){
  const k=z*32+x;if(used.has(k))continue;
  const symbol=l.tiles[(cz*32+z)*l.width+cx*32+x];
  let w=1;while(x+w<32&&!used.has(k+w)&&l.tiles[(cz*32+z)*l.width+cx*32+x+w]===symbol)w++;
  let h=1;
  outer:while(z+h<32){for(let n=0;n<w;n++)if(used.has((z+h)*32+x+n)||l.tiles[(cz*32+z+h)*l.width+cx*32+x+n]!==symbol)break outer;h++;}
  for(let dz=0;dz<h;dz++)for(let dx=0;dx<w;dx++)used.add((z+dz)*32+x+dx);
  const mat=symbol==='p'?materials.path:symbol==='s'||symbol==='b'?materials.stone:symbol==='w'?materials.water:symbol==='f'||symbol==='e'?materials.garden:materials.ground;
  const x0=x*16-256,x1=x0+w*16,z0=256-z*16,z1=z0-h*16;
  const col=symbol==='w'?[0.38,0.6,0.86]:symbol==='#'?tint.map(c=>c*0.65):symbol==='p'||symbol==='s'?[0.9,0.87,0.8]:tint;
  const overlay=symbol==='f'||symbol==='e';
  if(overlay)quad(materials.ground,[x0,0,z0,x0,0,z1,x1,0,z1,x1,0,z0],tint,[0,0,0,h*16,w*16,h*16,w*16,0]);
  const floorY=overlay?0.125:0;
  quad(mat,[x0,floorY,z0,x0,floorY,z1,x1,floorY,z1,x1,floorY,z0],col,[0,0,0,h*16,w*16,h*16,w*16,0]);
  // Long raised perimeter faces cross the near camera plane at edge arrivals.
  // Mark the blocked rim with dark ground; retain raised interior puzzle walls.
  const perimeter=cx*32+x<2||cz*32+z<2||cx*32+x+w>l.width-2||cz*32+z+h>l.height-2;
  if(symbol==='#'&&!perimeter)box(cx*32+x,cz*32+z,w,h,28,materials.wall,materials.ground);
 }
 for(const b of l.buildings){
  // Authored buildings never cross a chunk boundary.
  if(Math.floor(b.x/32)!==cx||Math.floor(b.z/32)!==cz)continue;
  if(b.x+b.w>(cx+1)*32||b.z+b.h>(cz+1)*32)throw new Error('Building crosses a chunk boundary');
  const colors=[[0.8,0.66,0.53],[0.68,0.68,0.75],[0.72,0.48,0.32],[0.78,0.82,0.89],[0.72,0.77,0.82],[0.75,0.4,0.26]];
  box(b.x,b.z,b.w,b.h,b.height,materials.wall,materials.roof,colors[b.style%colors.length]);
  // Recessed doorway and two bright windows establish a readable facade.
  const x0=(b.x+b.w/2-cx*32)*16-256,z0=256-(b.z+b.h-cz*32)*16-0.2;
  quad(materials.wood,[x0-7,0,z0,x0+7,0,z0,x0+7,24,z0,x0-7,24,z0],[0.3,0.24,0.22]);
  for(const side of [-1,1]){const wx=x0+side*b.w*4;quad(materials.water,[wx-4,18,z0,wx+4,18,z0,wx+4,27,z0,wx-4,27,z0],[0.72,0.91,1]);}
 }
 const meshes:StaticModelMesh[]=[...groups].map(([materialName,g])=>({materialName,positions:new Float32Array(g.positions),indices:new Uint32Array(g.indices),uvs:new Float32Array(g.uvs),colors:new Float32Array(g.colors)}));
 const model=writeStaticNitroModel(template.files[0],meshes);
 const permissions=new Uint8Array(8196);writeU16(permissions,0,32);writeU16(permissions,2,32);
 for(let z=0;z<32;z++)for(let x=0;x<32;x++){
  const at=4+(z*32+x)*8,s=l.tiles[(cz*32+z)*l.width+cx*32+x],blocked=['#','b'].includes(s);
  writeU16(permissions,at,0);writeU16(permissions,at+2,3);writeU16(permissions,at+4,blocked?1:s==='w'?63:s==='e'?4:0);writeU16(permissions,at+6,blocked?129:s==='w'?22:s==='e'?36:128);
 }
 const props=l.props.filter(p=>Math.floor(p.x/32)===cx&&Math.floor(p.z/32)===cz),placements=new Uint8Array(4+props.length*16);writeU32(placements,0,props.length);
 props.forEach((p,i)=>{const at=4+i*16;writeU32(placements,at,((p.x*16+8-cx*512-256)*4096)>>>0);writeU32(placements,at+8,((256-(p.z*16+8-cz*512))*4096)>>>0);placements[at+14]=p.uid>>>8;placements[at+15]=p.uid&255;});
 const out=packGameFreakContainer('WB',[model,permissions,placements]);
 const parsed=extractGameFreakContainer(out),terrain=parseVMapTerrain(parsed.files[1]);
 if(terrain.tiles.length!==1024||readU16(parsed.files[1],6)!==3)throw new Error('Generated map failed terrain round trip');
 const primitives=buildModelPrimitives(readNitroResources(parsed.files[0]),[]);
 if(!primitives.length)throw new Error('Generated map has no rendered geometry');
 return {bytes:out,polygons:meshes.reduce((n,m)=>n+m.indices.length/6,0),vertices:meshes.reduce((n,m)=>n+m.positions.length/3,0)};
}
