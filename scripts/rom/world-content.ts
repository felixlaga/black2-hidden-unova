import {blankLayout,paint,path,addLandmark,addNativeProp,type WorldLayout,type Point} from './world-geometry';

// Authored identities, landmarks and occupations. Native geometry/resource
// bindings are produced separately and checked against the supplied ROM.
export const TOWN_DETAILS = [
 ['bramblewick',0,'woodland meadow','Two-leaf shelter','garden','Berry terraces','I sort bruised berries for the wild visitors.','The shelter roof catches seeds in every storm.',44,49,112,45],
 ['sootbell_yard',1,'workshop quarry','Bell-ringers court','kiln','Cooling kilns','A quiet bell means the kiln wall is safe to touch.','Our apprentices made the bells from cracked pots.',39,40,44,122],
 ['sandglass_court',2,'quarry ruins','Dew collectors','plaza','Sandstone sundial','Every roof drains into the dew jars.','The shade moves; the old sundial never hurries.',49,112,327,48],
 ['reedwake',3,'wetland woodland','Reed nursery','canal','Lockkeepers channel','Please leave the nursery reeds standing.','The lock opens slowly so small fish can pass.',44,49,122,47],
 ['threadmill_crossing',4,'highland workshop','Ribbon mill','plaza','Wind ribbon court','These ribbons show which lane stays out of the wind.','A torn sail can become a useful trail marker.',327,328,112,45],
 ['saltlamp_quay',5,'coast wetland','Sheltered slipway','pool','Nesting quay','The low lamps guide boats without waking the nests.','The sheltered slipway has room for tired swimmers.',50,49,44,47],
 ['frostmere_hearth',6,'frost cavern workshop','Warmstone courtyard','kiln','Steam shelter','Warm hands first. There is no prize for being cold.','The vents warm the refuge without melting the nesting banks.',44,122,327,45],
 ['stillwater_fold',7,'wetland ruins meadow','Unfinished ledger','pool','Survey spring','An unfinished page is an invitation to the next traveler.','Our spring has four outlets; each tells a different story.',122,49,112,24],
 ['cloverbank',0,'meadow wetland','Clover exchange','garden','Seed market','We swap seeds, not promises about perfect harvests.','The market leaves a strip of clover for the pollinators.',52,44,112,49],
 ['copperbrook',1,'workshop wetland','Copper wheelworks','canal','Waterwheel run','The wheel turns gently enough for a fish to swim beside it.','The drain ledger mentions sealed crates from Castelia.',39,122,44,40],
 ['applecross',0,'woodland meadow','Orchard crossroads','grove','Apple sorting rows','Small apples make the best trail snacks.','We leave the far orchard row unpicked for the wild partners.',44,112,49,52],
 ['heatherford',3,'meadow wetland','Herb terraces','garden','Heather ford','The pale flowers grow above the high-water mark.','Our ford markers are reset after every heavy rain.',49,44,112,122],
 ['ochrestead',2,'quarry workshop','Glaze exchange','kiln','Red clay kilns','Each family fires a different shade of red.','A cracked jar can still shelter a seedling.',39,44,49,40],
 ['lockwillow',3,'wetland workshop','Manual locks','canal','Willow lock','Two people work the lock so no partner is stranded.','The willow roots hold the canal bank together.',122,44,47,49],
 ['flintmarket',1,'quarry ruins workshop','Stonecutters yard','plaza','Flint market','The safe ramp follows the old seam in the stone.','Quarry workers trade tools here before the morning shift.',52,39,327,48],
 ['rainbarrow',7,'meadow highland','Rain cisterns','pool','Rain collectors','The grass roofs hold yesterday rain for tomorrow.','Look under the eaves for the old measuring marks.',49,44,122,112],
 ['windrest',4,'highland meadow','Courier shelter','plaza','Windbreak court','Couriers wait here until the gusts lose their edge.','A sheltered lane can be faster than a straight one.',44,327,49,45],
 ['slatehaven',4,'highland quarry workshop','Slate exchange','plaza','Slate roof yard','Every roof tile carries the quarry mark of its maker.','Our broad steps leave room for partners to pass.',327,328,49,48],
 ['cloudmere',5,'highland wetland ruins','Lake observatory','pool','Cloud mirror','The lake is our second sky on a quiet morning.','We record clouds as carefully as we record stars.',122,49,327,24],
 ['pinewatch',6,'frost woodland meadow','Ranger field station','grove','Pine nursery','Our field notes follow ranger lessons: watch before acting.','We mark safe forest paths without fencing the forest in.',122,44,49,112],
 ['pearlhaven',5,'coast wetland','Pearl divers harbor','pool','Sheltered harbor','Divers take turns keeping watch from the quay.','An empty shell is a home someone else may need.',50,44,49,52],
 ['tideglass',5,'coast workshop quarry','Glassmakers court','plaza','Tidal glass beds','Sea glass rounds its own sharp edges.','The furnace runs only after the nesting watch returns.',39,327,44,40],
 ['gullspire',4,'coast highland','Signal towers','tower','Cliff signal court','One steady lamp is clearer than a frantic flash.','The tower log records every boat that found shelter.',47,327,49,45],
 ['dawnbridge',7,'wetland woodland ruins','Shared-watch bridge','canal','Crossing markers','A safe crossing gives everyone time to choose.','The river carries traces of every town upstream.',122,49,44,45],
] as const;
export type PropBounds = Map<number,{min:number[];max:number[];name:string}>;
export function townLayout(index:number,name:string,props:PropBounds){
 const d=TOWN_DETAILS[index],l=blankLayout(name,64,32,d[1]);
 // Four different native public/private structures are deliberately arranged
 // at different setbacks for each settlement; every footprint comes from ROM.
 const centers=[{x:8,z:7},{x:23,z:8},{x:41,z:7},{x:55,z:8}];
 for(let i=0;i<4;i++){const uid=Number(d[8+i]),p={...centers[i]};p.z+=((index+i)%3)-1;addNativeProp(l,uid,p,props.get(uid)!);}
 path(l,{x:3,z:16},{x:60,z:16});path(l,{x:15,z:3},{x:15,z:28});path(l,{x:47,z:3},{x:47,z:28});
 // Per-town landmarks have different positions, silhouettes and tile extents.
 const rx=4+(index%3)*2,rz=20+(index%2),rw=6+(index%3),rh=3+(index%2);
 addLandmark(l,d[5],d[4] as any,{x:rx,z:rz,w:rw,h:rh});
 if(['pool','canal'].includes(d[4]))paint(l,{x:rx,z:rz,w:rw,h:rh},'w');
 else if(d[4]==='tower'||d[4]==='kiln'){
  // Native textured landmark: no placeholder cube architecture.
  l.buildings=[];paint(l,{x:rx,z:rz,w:rw,h:rh},'s');
  addNativeProp(l,d[4]==='tower'?48:41,{x:rx+2,z:rz+1},props.get(d[4]==='tower'?48:41)!);
 }
 paint(l,{x:33+(index%3)*2,z:20,w:6,h:4},'e');
 if(index%4===0)addNativeProp(l,24,{x:48,z:21},props.get(24)!);
 else if(index%4===1)addNativeProp(l,134,{x:49,z:21},props.get(134)!);
 else if(index%4===2)addNativeProp(l,69,{x:50,z:21},props.get(69)!);
 else addNativeProp(l,26,{x:50,z:21},props.get(26)!);
 // Clear, marked approaches to all four small secret entrances.
 for(const x of [8,24,40,56])path(l,{x,z:26},{x,z:28},1);
 return l;
}
export function corridorLayout(name:string,index:number,palette=0,sewer=false){
 const l=blankLayout(name,32,32,palette);
 if(sewer){l.tiles.fill('#');paint(l,{x:3,z:3,w:26,h:26},'s');paint(l,{x:3,z:3,w:26,h:3},'#');}
 const bends=[8,12,20,24],bend=bends[index%4];
 path(l,{x:15,z:28},{x:bend,z:22});path(l,{x:bend,z:22},{x:bend,z:10});path(l,{x:bend,z:10},{x:15,z:3});
 paint(l,{x:bend<16?21:4,z:13,w:6,h:7},'e');
 if(index%3===0||sewer)paint(l,{x:bend<16?4:23,z:10,w:5,h:9},'w');
 addLandmark(l,sewer?'Maintenance dais':'Trail shelter','plaza',{x:12,z:22,w:7,h:4});
 return l;
}
export function secretLayout(name:string,index:number,palette:number){
 const l=blankLayout(name,32,32,palette);
 // Quiet, readable single-room investigations. The perimeter, recesses and
 // landmark vary independently of resident species and text.
 const inset=3+(index%4);paint(l,{x:2,z:2,w:28,h:inset},'#');
 const divider=8+(index%5)*3;paint(l,{x:divider,z:7,w:2,h:8},'#');
 path(l,{x:15,z:28},{x:15,z:20});path(l,{x:8,z:20},{x:24,z:20});
 paint(l,{x:5,z:8+(index%3),w:3,h:4},index%3===0?'w':'f');
 addLandmark(l,name,index%2?'plaza':'garden',{x:21+(Math.floor(index/4)%3),z:7+(Math.floor(index/12)%3),w:5,h:4+(Math.floor(index/24)%2)});
 return l;
}

export const TOWN_PORTS=[
 {point:{x:15,z:29},landing:{x:15,z:27}}, {point:{x:61,z:16},landing:{x:59,z:16}},
 {point:{x:15,z:2},landing:{x:15,z:4}}, {point:{x:2,z:16},landing:{x:4,z:16}},
 {point:{x:47,z:2},landing:{x:47,z:4}}, {point:{x:47,z:29},landing:{x:47,z:27}},
];
export const SECRET_MOUTHS:Point[]=[{x:8,z:28},{x:24,z:28},{x:40,z:28},{x:56,z:28}];
