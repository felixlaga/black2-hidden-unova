import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16, writeU32, concatBytes } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { materializeGen5MatrixFile, parseGen5MatrixFile } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import { extractGameFreakContainer, parseVMapTerrain, parseAreaHeader, readNitroResources, readNitroModelNames, buildModelPrimitives } from '../../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { readFollowerStockAppearances } from '../../vendor/pokeweb-serverless/src/pokeweb/followingPokemonModel';
import { appendFieldSceneScript } from '../../vendor/pokeweb-serverless/src/pokeweb/fieldSceneTest';
import { decodeGen5TextBank, encodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { WORLD_PATHS, WORLD_FIRST_ZONE, worldEvents, worldNpc, worldScript, worldText, worldTrigger, type WorldReport } from './world';
import { blankLayout, buildWorldChunk, paint, path, reachable, isOpen, addNativeProp, type Point, type WorldLayout } from './world-geometry';
import { TOWN_DETAILS, TOWN_PORTS, SECRET_MOUTHS, townLayout, secretLayout, corridorLayout, type PropBounds } from './world-content';
import { auditWorldQuestState, WORLD_QUEST_FLAGS, WORLD_QUEST_WORK } from './world-state';
import { WORLD_MYTHICAL_QUESTS, questClueBody, questRepairBody, questReportBody } from './world-quests';
import { WORLD_GYM_PUZZLES, WORLD_PUZZLE_WORK, puzzleReset, puzzleSwitchBody, puzzleBlockerBody } from './world-puzzles';
import { SUPPLEMENTAL_SECRET_VISITORS } from './species';
import type { applyCampaignDefinitions } from './campaign';
import expansion from '../../content/expansion.json';
import geography from '../../content/world-map.json';
import story from '../../content/story.json';

export type WorldBuildOptions={campaign?:ReturnType<typeof applyCampaignDefinitions>};
type Kind='town'|'secret'|'route'|'gym'|'sewer'|'interior';
type Node={id:string;name:string;kind:Kind;headerId:number;mapIds:number[];matrixId:number;eventId:number;scriptId:number;levelScriptId:number;textBankId:number;layout:WorldLayout;landing:Point;texts:string[];entries:string[];npcs:Uint8Array[];triggers:Uint8Array[];checks:Point[];donorHeader?:number;donorMap?:number;encounterId?:number;theme:string;badges:number;minLevel:number;maxLevel:number;port:number;parents:string[]};
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const gates:Record<string,number>={'gate.first_badge':1,'gate.second_badge':2,'gate.third_badge':3,'gate.fourth_badge':4,'gate.fifth_badge':5,'gate.sixth_badge':6,'gate.seventh_badge':7,'gate.eighth_badge':8,'gate.late_campaign':8};
const badgeCount=(conditions:Array<{gate_id?:string}>)=>Math.max(0,...conditions.map(x=>x.gate_id?gates[x.gate_id]??0:0));
const stages=[0,12,20,28,32,40,50,55,60];
const talk=(id:number)=>`lock\ntalk message: ${id}\nfinish_interaction`;
function textWrap(value:string){
 return value.split(/\\n|\n/).flatMap(line=>{const lines:string[]=[];let cur='';for(const word of line.split(/\s+/)){if(cur.length+word.length+1>32){lines.push(cur);cur='';}cur+=(cur?' ':'')+word;}if(cur)lines.push(cur);return lines;}).map((line,i)=>`${i?(i%2?'\\n':'\\r') : ''}${line}`).join('');
}
function nativeProps(rom:NintendoDSRom):PropBounds{
 const area=parseAreaHeader(rom.getFileByName('a/0/1/3'),34),archive=new NARC(new Uint8Array(rom.getFileByName('a/2/2/5'))),bundle=extractGameFreakContainer(archive.files[area.buildingsId]);
 const result:PropBounds=new Map();
 for(let i=0;i<bundle.files.length/2;i++){
  const model=bundle.files[i+bundle.files.length/2],primitives=buildModelPrimitives(readNitroResources(model),[]),positions=primitives.flatMap(p=>Array.from(p.positions));
  result.set(readU16(bundle.files[i],0),{name:readNitroModelNames(model).join(','),min:[0,1,2].map(k=>Math.min(...positions.filter((_,j)=>j%3===k))),max:[0,1,2].map(k=>Math.max(...positions.filter((_,j)=>j%3===k)))});
 }return result;
}
function donorLayout(bytes:Uint8Array,label:string){
 const l=blankLayout(label),terrain=parseVMapTerrain(extractGameFreakContainer(bytes).files[1]);
 l.tiles=terrain.tiles.map(t=>t.flags&1?'#':t.tileClass>=61&&t.tileClass<=68?'w':'s');return l;
}

/** Full allocation is staged in owned NARCs; no ROM bytes are assigned until all
 * references, scripts, original resources and walkable connections validate. */
export function buildFullWorld(rom:NintendoDSRom,options:WorldBuildOptions):WorldReport{
 const archives=Object.fromEntries(Object.entries(WORLD_PATHS).map(([k,p])=>[k,new NARC(new Uint8Array(rom.getFileByName(p)))])) as Record<keyof typeof WORLD_PATHS,NARC>;
 const countsBefore=Object.fromEntries(Object.entries(archives).map(([k,v])=>[k,v.files.length]));
 const originalHeaders=archives.headers.files[0].slice();
 if(originalHeaders.length!==615*48)throw new Error('Expected exactly 615 original headers; refusing duplicate world allocation');
 const stateAudit=auditWorldQuestState(rom),quests:any[]=[];
 const messages=new NARC(new Uint8Array(rom.getFileByName('a/0/0/2'))),locationNames=decodeGen5TextBank(messages.files[109]),locationBase=locationNames.length,pokemonNames=decodeGen5TextBank(messages.files[90]).map(e=>e[1]);
 if(pokemonNames[494]!=='Victini'||pokemonNames[647]!=='Keldeo'||pokemonNames[491]!=='Darkrai')throw new Error('Unexpected native species name bank');
 const props=nativeProps(rom),nodes:Node[]=[],byId=new Map<string,Node>();
 const storyNpcSpots:any[]=[],staticEncounters:any[]=[],habitats:any[]=[],links:any[]=[],entrances:any[]=[],gyms:any[]=[],interiors:any[]=[];
 function allocate(id:string,name:string,kind:Kind,layout:WorldLayout,badges:number,theme:string,encounterId?:number,donorHeader?:number,donorMap?:number){
  if(byId.has(id))throw new Error(`Duplicate world node ${id}`);
  const node:Node={id,name,kind,layout,badges,theme,encounterId,donorHeader,donorMap,headerId:WORLD_FIRST_ZONE+nodes.length,mapIds:[],matrixId:archives.matrix.files.length,eventId:archives.events.files.length,scriptId:archives.scripts.files.length,levelScriptId:archives.scripts.files.length+1,textBankId:archives.story.files.length,landing:{x:15,z:27},texts:[],entries:[],npcs:[],triggers:[],checks:[],minLevel:stages[badges]||12,maxLevel:Math.min(70,(stages[badges]||12)+6),port:0,parents:[]};
  for(let c=0;c<layout.width*layout.height/1024;c++){node.mapIds.push(archives.maps.files.length);archives.maps.files.push(new Uint8Array());}
  archives.matrix.files.push(new Uint8Array());archives.events.files.push(new Uint8Array());archives.scripts.files.push(new Uint8Array(),new Uint8Array(4));archives.story.files.push(new Uint8Array());nodes.push(node);byId.set(id,node);return node;
 }
 const towns=expansion.settlements.map((town,i)=>allocate(town.id,town.name,'town',townLayout(i,town.name,props),badgeCount(town.progression.all_of),TOWN_DETAILS[i][2],175+i));
 const secrets=expansion.hidden_areas.map((area,i)=>{const ti=expansion.settlements.findIndex(t=>t.id===area.settlement_id),town=towns[ti],l=secretLayout(area.name,i,TOWN_DETAILS[ti][1]);addNativeProp(l,[21,48,69,24][i%4],{x:24,z:10},props.get([21,48,69,24][i%4])!);const n=allocate(area.id,area.name,'secret',l,town.badges,town.theme);n.parents.push(town.id);return n;});
 const routes=geography.routes.map((route,i)=>{const ends=[byId.get(route.from),byId.get(route.to)].filter(Boolean) as Node[],badges=badgeCount(route.forward_requirements.all_of),theme=[...new Set(ends.flatMap(n=>n.theme.split(' ')))].join(' '),l=corridorLayout(route.name,i,TOWN_DETAILS[expansion.settlements.findIndex(t=>t.id===ends[0].id)][1]);if(/coast|wetland/.test(theme))paint(l,{x:23,z:9,w:5,h:10},'w');return allocate(route.id,route.name,'route',l,badges,theme,135+i);});
 const gymNodes=expansion.gyms.map((gym,i)=>{const ti=expansion.settlements.findIndex(t=>t.id===gym.settlement_id),l=blankLayout(gym.building.name,32,32,TOWN_DETAILS[ti][1]);paint(l,{x:3,z:3,w:26,h:26},'s');path(l,{x:15,z:28},{x:15,z:8});for(const x of [7,23])addNativeProp(l,[48,69,21][i%3],{x,z:13+(i%3)*2},props.get([48,69,21][i%3])!);return allocate(gym.id,gym.building.name,'gym',l,towns[ti].badges,towns[ti].theme);});
 const sewerNames=['Southworks Intake','Silt-Archive Walk','Overflow Nursery','Copper Service Run'];
 const sewers=sewerNames.map((name,i)=>{const l=corridorLayout(name,i,1,true);path(l,{x:15,z:2},{x:15,z:6});l.materials={ground:'miti00',path:'miti01',stone:'miti00',water:'suimen00',wood:'door',garden:'simi00',wall:'kabe00',roof:'machine'};return allocate(`sewer.${i}`,name,'sewer',l,3,i===2?'wetland cavern':'workshop cavern quarry',199+i);});
 // Native furnished rooms preserve their actual collision/texture/camera contract.
 // Each new room still owns independent map/matrix/header/event/script/text files.
 const rooms=towns.flatMap((town,i)=>[0,1].map(j=>{const name=j?`${town.name} Field Office`:`${town.name} Rest House`,n=allocate(`interior.${town.id}.${j}`,name,'interior',donorLayout(archives.maps.files[977],name),town.badges,town.theme,undefined,441,977);n.landing={x:6,z:8};n.parents.push(town.id);interiors.push({id:n.id,townId:town.id,headerId:n.headerId,role:j?'local clues and habitat notes':'repeatable free party healing',nativeFurnishedRoomTemplate:977});return n;}));
 function addText(n:Node,value:string){const id=n.texts.length;n.texts.push(textWrap(value));return id;}
 function entry(n:Node,body:string){n.entries.push(body);return n.entries.length;}
 function actor(n:Node,p:Point,sprite:number,body:string){const index=n.npcs.length,scriptEntry=entry(n,body);n.npcs.push(worldNpc(index,sprite,scriptEntry,p));n.checks.push(p);return {npcIndex:index,actorId:index,entry:scriptEntry,...p};}
 function step(n:Node,p:Point,body:string,width=1){const scriptEntry=entry(n,body);n.triggers.push(worldTrigger(scriptEntry,p,width));n.checks.push(p);return scriptEntry;}
 function warpBody(target:Node|{headerId:number;landing:Point},badges=0,flags:number[]=[],missingText?:number){
  const checks=badges?[`trainer_card_get_badge_count 0x8010`,`if work_8010 < ${badges}`,missingText!==undefined?`  talk message: ${missingText}`:'',`  finish_interaction`,`end`]:[];
  for(const flag of flags)checks.push(`unless flag_set?(${flag})`,missingText!==undefined?`  talk message: ${missingText}`:'',`  finish_interaction`,`end`);
  const gymIndex=gymNodes.findIndex(g=>g.headerId===target.headerId);
  return ['lock',...checks,...(gymIndex>=0?[puzzleReset(gymIndex)]:[]),`map_change_warp ${target.headerId}, ${target.landing.x}, ${target.landing.z}, 0`,'finish_interaction'].join('\n');
 }
 function connect(a:Node,ap:Point,alanding:Point,b:Node,bp:Point,blanding:Point,badges=0,flags:number[]=[],reason?:string){
  const msgA=addText(a,reason??`The route to ${b.name} opens after ${badges} original Badges. Follow your Gym journey first.`),msgB=addText(b,`This return path leads to ${a.name}.`);
  const ea=step(a,ap,warpBody({headerId:b.headerId,landing:blanding},badges,flags,msgA)),eb=step(b,bp,warpBody({headerId:a.headerId,landing:alanding}));
  a.checks.push(alanding);b.checks.push(blanding);a.parents.push(b.id);b.parents.push(a.id);
  links.push({from:a.id,to:b.id,fromHeader:a.headerId,toHeader:b.headerId,fromEntry:ea,toEntry:eb,source:a.id,target:b.id,pointA:ap,landingA:alanding,pointB:bp,landingB:blanding,requiredOriginalBadges:badges,requiredFlags:flags,returnAlwaysOpen:true});
 }
 // Town NPC order is an integration contract: resident/crisis, craftsperson,
 // rest steward, then the existing mentor slot (only in mentor towns).
 towns.forEach((n,i)=>{
  const town=expansion.settlements[i],detail=TOWN_DETAILS[i],crisis=options.campaign?.towns[town.id];
  if(crisis)n.texts.push(...crisis.texts.map(textWrap));else addText(n,`${town.resident}: Welcome to ${town.name}. ${detail[6]}`);
  actor(n,{x:17,z:20},30,crisis?.body??talk(0));
  actor(n,{x:20,z:18},32,talk(addText(n,`${detail[3]} keeper: ${detail[7]}`)));
  actor(n,{x:18,z:23},40,talk(addText(n,`The first house offers a free rest. The field office records the four local trails. ${town.description}`)));
  const mentor=options.campaign?.mentors.find(m=>m.townId===town.id);
  if(mentor){const binding=actor(n,{x:19,z:21},mentor.spriteId,'halt');storyNpcSpots.push({townId:town.id,settlementId:town.id,semanticKey:mentor.semanticKey,name:mentor.name,...binding,scriptId:n.scriptId,eventId:n.eventId,textBankId:n.textBankId,zone:n.headerId,headerId:n.headerId});}
  for(let j=0;j<2;j++){
   const room=rooms[i*2+j],p=n.layout.props[j],door={x:p.x,z:p.footprint.z+p.footprint.h};
   // Keep the actual rendered structure blocked, with a one-tile street door.
   paint(n.layout,{...door,w:1,h:1},'p');const street={x:door.x,z:door.z+1};
   connect(n,door,street,room,{x:5,z:9},room.landing,0);room.triggers[0]=worldTrigger(room.entries.length,{x:5,z:9},3);
   const clues=expansion.hidden_areas.filter(a=>a.settlement_id===n.id);
   actor(room,{x:5,z:5},j?32:40,j?talk(addText(room,`${detail[3]}: ${detail[6]}`)):`lock\ntalk message: ${addText(room,'Rest here. Your partners can recover before you continue.')}\npoke_party_recover_all\ntalk message: ${addText(room,'Everyone is rested. Come back whenever you need shelter.')}\nfinish_interaction`);
   actor(room,{x:9,z:5},j?30:32,talk(addText(room,j?clues.map(c=>`${c.name}: ${c.entry_clue}`).join(' '):`${detail[7]} The office next door records our local trails.`)));
   if(j)actor(room,{x:7,z:7},31,talk(addText(room,`Field notes: ${n.theme.split(' ').join(', ')}. Watch from the paths and leave water margins clear. This office shares ranger observation methods with travelers.`)));
  }
  // Clue actors sit next to the permanent, individually named trail mouths.
  const local=secrets.filter(s=>s.parents.includes(n.id));
  local.forEach((secret,j)=>{
   const p=SECRET_MOUTHS[j];connect(n,p,{x:p.x,z:26},secret,{x:15,z:29},secret.landing,n.badges);
   actor(n,{x:p.x+1,z:27},31,talk(addText(n,`${secret.name}. ${expansion.hidden_areas.find(a=>a.id===secret.id)!.entry_clue}`)));
  });
 });
 gymNodes.forEach((n,i)=>{
  const g=expansion.gyms[i],town=byId.get(g.settlement_id)!,campaign=options.campaign?.gyms[g.id];
  if(campaign)n.texts.push(...campaign.texts.map(textWrap));else n.texts.push(...['Welcome.','The leader is preparing.','Come back soon.','Continue your Gym journey.','Well done.'].map(textWrap));
  const leader=actor(n,{x:15,z:8},30,campaign?.body??talk(1));
  const puzzle=WORLD_GYM_PUZZLES[i],clue=addText(n,puzzle.clue),done=addText(n,puzzle.done),wrong=addText(n,'The sequence is out of order. The mechanism resets safely. Read the guide and try again.');
  actor(n,{x:18,z:26},32,talk(clue));
  // One walkable aperture is occupied by the native gatekeeper actor. Solving
  // the three controls removes that actor; terrain itself stays collision-safe.
  paint(n.layout,{x:2,z:12,w:28,h:1},'#');paint(n.layout,{x:15,z:12,w:1,h:1},'p');
  for(const [station,p]of [{x:8,z:21},{x:15,z:24},{x:23,z:21}].entries())actor(n,p,32,puzzleSwitchBody(i,station,{correct:addText(n,`${puzzle.stations[station]} is set. Listen for the next mechanism.`),wrong,done},5));
  actor(n,{x:15,z:12},40,puzzleBlockerBody(i,clue,done,5));
  const door={x:30,z:12};paint(town.layout,{x:29,z:11,w:3,h:3},'s');connect(town,door,{x:30,z:14},n,{x:15,z:29},n.landing);
  actor(town,{x:31,z:12},31,talk(addText(town,`${g.building.name}. Leader ${g.leader.name}. Follow the marked approach to the challenge court.`)));
  gyms.push({id:g.id,townId:town.id,headerId:n.headerId,scriptId:n.scriptId,eventId:n.eventId,textBankId:n.textBankId,leaderNpcId:leader.npcIndex,leaderEntry:leader.entry,landing:n.landing,trainerId:campaign?.trainerId,flagId:campaign?.flagId,puzzleIntegrated:true,puzzle:{stations:puzzle.stations,order:puzzle.order,work:WORLD_PUZZLE_WORK,blockerNpc:5,resetOnEntry:true,emulatorValidated:false}});
 });
 const appearances=readFollowerStockAppearances(rom.getFileByName('a/2/0/8'));
 const staticPositions=[{x:12,z:19},{x:18,z:19},{x:22,z:19},{x:10,z:23},{x:18,z:23},{x:23,z:23},{x:12,z:25},{x:21,z:25}];
 secrets.forEach((n,i)=>{
  const area=expansion.hidden_areas[i],quest=story.secret_quests.filter(q=>q.map_binding.world_secret_key===n.id),visitors=[{species:area.encounter.national_dex_id,level:area.encounter.level,requiredOriginalBadges:n.badges,kind:'resident',flags:[] as number[]},...quest.map(q=>({species:q.national_dex_id,level:q.proposed_level,requiredOriginalBadges:q.national_dex_id===494?5:8,kind:'quest visitor',flags:[options.campaign?.newGymFlags[expansion.gyms[q.national_dex_id===494?2:q.national_dex_id===647?9:11].id],WORLD_QUEST_FLAGS[story.secret_quests.indexOf(q)]].filter(x=>x!==undefined) as number[]})),...SUPPLEMENTAL_SECRET_VISITORS.filter(v=>v.areaId===n.id).map(v=>({...v,kind:'supplemental visitor',flags:[] as number[]}))];
  visitors.forEach((v,j)=>{
   const position=staticPositions[j];if(!position)throw new Error(`Too many visible visitors in ${n.id}`);
   const appearance=appearances.find(a=>a.species===v.species&&a.form===0),sprite=appearance?.code??32;
   const offer=addText(n,`${appearance?`A wild ${pokemonNames[v.species]}`:`Naturalist: ${pokemonNames[v.species]}`} is nearby at level ${v.level}. Would you like to approach?`),caught=addText(n,'You have already registered a capture of this species. The refuge remains open.'),missing=addText(n,`This visitor settles here after ${v.requiredOriginalBadges} original Badges${v.flags.length?' and the earlier additional Gyms':''}. You can return freely.`);
   const prefix=`static_${v.species}_${j}`,body=['lock',`poke_dex_is_regist 1, ${v.species}, 0x8000`,`if work_8000 == 1`,`  talk message: ${caught}`,'  finish_interaction','end',`trainer_card_get_badge_count 0x8010`,`if work_8010 < ${v.requiredOriginalBadges}`,`  talk message: ${missing}`,'  finish_interaction','end',...v.flags.flatMap(flag=>[`unless flag_set?(${flag})`,` talk message: ${missing}`,' finish_interaction','end']),`talk message: ${offer}`,'yes_no_win 0x8010','work_cmp_const 0x8010, 0',`jump_if 0x01, :${prefix}_start`,'finish_interaction',`label :${prefix}_start`,`call_wild_battle ${v.species}, ${v.level}, 1`,'wild_battle_is_victory 0x8010','if work_8010 == 1',' call_wild_battle_end','else',' call_wild_lose','end','finish_interaction'].join('\n');
   const binding=actor(n,position,sprite,body);
   staticEncounters.push({areaId:n.id,headerId:n.headerId,scriptId:n.scriptId,eventId:n.eventId,textBankId:n.textBankId,entry:binding.entry,npcIndex:binding.npcIndex,species:v.species,level:v.level,kind:v.kind,flagId:null,captureState:{type:'native-pokedex-caught',opcode:0xdf,mode:1,species:v.species,destinationWork:0x8000,predicate:'captured bit is clear; previous capture anywhere suppresses this offer',retries:'Permanent until a successful capture; no date, Champion or online condition'},spriteId:sprite,representation:appearance?'native Pokemon walking actor':'visible naturalist interaction; species walking asset unavailable',requiredOriginalBadges:v.requiredOriginalBadges,requiredFlags:v.flags,entrance:{townId:area.settlement_id,headerId:byId.get(area.settlement_id)!.headerId,secretHeaderId:n.headerId,landing:n.landing,returnAlwaysOpen:true,preChampionCertified:false},...position});
  });
 });
 WORLD_MYTHICAL_QUESTS.forEach((quest,qi)=>{
  const completionFlag=WORLD_QUEST_FLAGS[qi],workId=WORLD_QUEST_WORK[qi],bindings:any[]=[],secret=byId.get(quest.areaId)!;
  for(const [ci,clue]of quest.clues.entries()){
   const node=byId.get(clue.node);if(!node)throw new Error(`Missing quest clue node ${clue.node}`);
   const body=questClueBody(qi,ci,addText(node,`${clue.name}: ${clue.text} The note is recorded for this journey.`),addText(node,`Follow the earlier clue first. ${ci?quest.clues[ci-1].name:'The first note'} points here.`),addText(node,`${clue.name}: ${clue.text}`));
   const a=actor(node,clue.point,31,body);bindings.push({role:'clue',index:ci,workId,bitMask:1<<ci,requiredWorkMask:(1<<ci)-1,name:clue.name,headerId:node.headerId,eventId:node.eventId,scriptId:node.scriptId,textBankId:node.textBankId,...a});
  }
  for(const [ri,p]of [{x:8,z:16},{x:24,z:16},{x:6,z:24}].entries()){
   const body=questRepairBody(qi,ri,addText(secret,`${quest.repairs[ri]}. The keeper supplied the tools. The work is complete and recorded.`),addText(secret,'Read all three trail notes before changing the refuge equipment.'),addText(secret,`${quest.repairs[ri]}: already secure. No repair needs to be repeated.`));
   const a=actor(secret,p,32,body);bindings.push({role:'repair',index:ri,workId,bitMask:1<<(3+ri),requiredWorkMask:7,headerId:secret.headerId,eventId:secret.eventId,scriptId:secret.scriptId,textBankId:secret.textBankId,...a});
  }
  const gymFlag=options.campaign?.newGymFlags[expansion.gyms[quest.gymIndex].id],a=actor(secret,{x:25,z:26},30,questReportBody(qi,gymFlag,addText(secret,quest.resolution),addText(secret,`Finish the three notes and three refuge tasks, then bring ${quest.badges} original Badges and complete the first ${quest.gymIndex+1} additional Gyms. The visitor is never required for the repairs.`)));
  bindings.push({role:'report',flagId:completionFlag,workId,requiredWorkMask:63,headerId:secret.headerId,eventId:secret.eventId,scriptId:secret.scriptId,textBankId:secret.textBankId,...a});
  quests.push({id:story.secret_quests[qi].key,name:quest.name,species:quest.species,areaId:quest.areaId,flags:[completionFlag],workId,workByteOffset:2*(workId-0x4000),progress:{storage:'saved-work-u16',initialValue:0,clueMask:7,repairMask:56,completionMask:63,repairOrder:'any'},requiredOriginalBadges:quest.badges,requiredGymFlag:gymFlag,completionFlag,bindings,persistent:true,captureIndependent:true,emulatorValidated:false});
 });
 // Each route has separate north/south approaches. Gates are checked while
 // entering the route, so its backward exit never becomes a trap.
 routes.forEach((n,i)=>{
  const r=geography.routes[i];actor(n,{x:17,z:24},31,talk(addText(n,`${r.name}. ${byId.get(r.from)?.name??'Original Unova'} to ${byId.get(r.to)?.name??'Original Unova'}. ${r.geography}`)));
  for(const [end,which] of [[r.from,0],[r.to,1]] as const){const town=byId.get(end);if(!town)continue;const port=TOWN_PORTS[town.port++];if(!port)throw new Error(`Too many roads at ${town.id}`);const routePoint={x:15,z:which?2:29},routeLanding={x:15,z:which?4:27};paint(n.layout,{...routePoint,w:2,h:1},'p');connect(town,port.point,port.landing,n,routePoint,routeLanding,n.badges);actor(town,{x:port.point.x===61?60:port.point.x===2?3:port.point.x+2,z:port.point.z},31,talk(addText(town,`${r.name}: ${byId.get(end===r.from?r.to:r.from)?.name??'Original Unova'}. The trail opens with ${n.badges} original Badges.`)));}
 });
 const anchors=[{id:'anchor.base.route_twenty',header:446,hint:{x:176,z:665}},{id:'anchor.base.route_six',header:331,hint:{x:152,z:404}},{id:'anchor.base.route_seven',header:337,hint:{x:111,z:266}},{id:'anchor.base.route_twenty_one',header:463,hint:{x:783,z:208}},{id:'sewer.native',header:495,hint:{x:25,z:20}}];
 function addNativeEntrance(anchor:typeof anchors[number],destination:Node,returnPoint:Point){
  const h=originalHeaders.subarray(anchor.header*48,(anchor.header+1)*48),matrix=parseGen5MatrixFile(archives.matrix.files[readU16(h,4)]),eventId=readU16(h,22),scriptId=readU16(h,6),ev=archives.events.files[eventId],candidates:Array<Point&{mapId:number;height:number;score:number}>=[];
  const occupied:Array<Point>=[];for(let k=0;k<ev[5];k++){const a=8+ev[4]*20+k*36;occupied.push({x:readU16(ev,a+28),z:readU16(ev,a+30)});}
  for(let cell=0;cell<matrix.width*matrix.height;cell++){
   if(matrix.matrix_flags&&matrix[`header_${cell}`]!==anchor.header)continue;
   const mapId=matrix[`map_${cell}`];if(mapId===0xffffffff||!archives.maps.files[mapId])continue;
   const container=extractGameFreakContainer(archives.maps.files[mapId]),terrain=parseVMapTerrain(container.files[1]),primitives=buildModelPrimitives(readNitroResources(container.files[0]),[]),cx=cell%matrix.width,cz=Math.floor(cell/matrix.width);
   const open=(x:number,z:number)=>x>=0&&z>=0&&x<32&&z<32&&!(terrain.tiles[z*32+x].flags&3)&&[0,3,22,23,25,31].includes(terrain.tiles[z*32+x].tileClass);
   for(let z=2;z<29;z++)for(let x=2;x<29;x++){
    if(!open(x,z)||!open(x,z+1)||!open(x-1,z)||!open(x+1,z))continue;
    const point={x:cx*32+x,z:cz*32+z};if(occupied.some(p=>Math.abs(p.x-point.x)+Math.abs(p.z-point.z)<4))continue;
    const wx=x*16+8-256,wz=z*16+8-256;let height=-Infinity;
    for(const p of primitives)for(let k=0;k<p.indices.length;k+=3){const a=p.indices[k]*3,b=p.indices[k+1]*3,c=p.indices[k+2]*3,v=p.positions,det=(v[b+2]-v[c+2])*(v[a]-v[c])+(v[c]-v[b])*(v[a+2]-v[c+2]);if(Math.abs(det)<1e-8)continue;const u=((v[b+2]-v[c+2])*(wx-v[c])+(v[c]-v[b])*(wz-v[c+2]))/det,w=((v[c+2]-v[a+2])*(wx-v[c])+(v[a]-v[c])*(wz-v[c+2]))/det;if(u>=0&&w>=0&&u+w<=1)height=Math.max(height,u*v[a+1]+w*v[b+1]+(1-u-w)*v[c+1]);}
    if(Number.isFinite(height))candidates.push({...point,mapId,height,score:Math.abs(point.x-anchor.hint.x)+Math.abs(point.z-anchor.hint.z)});
   }
  }
  const spot=candidates.sort((a,b)=>a.score-b.score)[0];if(!spot)throw new Error(`No verified native entrance site for ${anchor.id}`);
  const requiredFlags=anchor.id==='sewer.native'?[0xA39]:[],missingText=addText(destination,anchor.id==='sewer.native'?'The Southworks channel is sealed. Earn three original Badges, then start with the Battle Company receptionist and finish the Castelia shipping inquiry.':`The trail to ${destination.name} opens after ${destination.badges} original Badges. Continue the Unova Gym journey, then return to this guide.`);
  // Native scripts retain their own header bank. The explicit bank operand sends
  // only this new guard's message to the new area's owned bank.
  const guardBody=warpBody(destination,destination.badges,requiredFlags,missingText).replaceAll(`talk message: ${missingText}`,`msg_actor ${destination.textBankId}, ${missingText}, 0, 0\ninput_wait_last\nmsg_actor_close`);
  const compiled=worldScript([guardBody]),appended=appendFieldSceneScript(archives.scripts.files[scriptId],compiled);archives.scripts.files[scriptId]=appended.bytes;
  const uid=Math.max(-1,...Array.from({length:ev[5]},(_,i)=>readU16(ev,8+ev[4]*20+i*36)))+1,npc=worldNpc(uid,31,appended.entryId,spot);writeU32(npc,32,Math.round(spot.height*4096)>>>0);
  const insert=8+ev[4]*20+ev[5]*36,newEvent=concatBytes([ev.subarray(0,insert),npc,ev.subarray(insert)]);newEvent[5]++;writeU32(newEvent,0,4+newEvent[4]*20+newEvent[5]*36+newEvent[6]*20+newEvent[7]*22);archives.events.files[eventId]=newEvent;
  const returnLanding={x:spot.x,z:spot.z+1};const returnEntry=step(destination,returnPoint,warpBody({headerId:anchor.header,landing:returnLanding}));
  entrances.push({anchorId:anchor.id,headerId:anchor.header,scriptId,eventId,npcIndex:ev[5],actorId:uid,entry:appended.entryId,...spot,returnLanding,targetHeaderId:destination.headerId,targetLanding:destination.landing,returnScriptId:destination.scriptId,returnEntry,requiredOriginalBadges:destination.badges,requiredFlags,guardMessage:{bank:destination.textBankId,entry:missingText,explicitBank:true},trigger:'Interact with allocated trail guide NPC',nativeWalkTerrainVerified:true,emulatorValidated:false});
 }
 for(const anchor of anchors.slice(0,4)){const route=geography.routes.find(r=>r.from===anchor.id)!;addNativeEntrance(anchor,byId.get(route.id)!,{x:15,z:29});}
 addNativeEntrance(anchors[4],sewers[0],{x:15,z:29});
 sewers.forEach((n,i)=>{actor(n,{x:17,z:24},32,talk(addText(n,i===0?'The sealed Southworks channel needs the Castelia shipping inquiry. Start with the Battle Company receptionist, then follow the six-building trail.':`${n.name}: the maintenance crew follows the old Plasma shipment route. The quiet water margins shelter different partners.`)));if(i<sewers.length-1)connect(n,{x:15,z:2},{x:15,z:4},sewers[i+1],{x:15,z:29},sewers[i+1].landing,3,i===0?[0xA39]:[],i===0?'The Southworks route is sealed. Start with the Battle Company receptionist and finish the Castelia shipping inquiry.':undefined);});
 const copper=byId.get('settlement.copperbrook')!,cp=TOWN_PORTS[copper.port++];connect(sewers[3],{x:15,z:2},{x:15,z:4},copper,cp.point,cp.landing,3,[0xA39],'Complete the Castelia shipping inquiry. The Battle Company receptionist has the first lead.');
 const copperSewerEntry=copper.entries.length;
 const copperSewerLink=links.at(-1)!;copperSewerLink.reverseRequiredOriginalBadges=3;copperSewerLink.reverseRequiredFlags=[0xA39];copperSewerLink.returnAlwaysOpen=false;
 copper.entries[copperSewerEntry-1]=warpBody({headerId:sewers[3].headerId,landing:{x:15,z:4}},3,[0xA39],addText(copper,'The sewer maintenance route needs the Castelia shipping inquiry. Begin with the Battle Company receptionist.'));
 // Render/compile only after every connection has claimed its geometry.
 if(locationBase+nodes.length>1024)throw new Error('Native location-name field capacity exceeded');
 const headerRows:Uint8Array[]=[originalHeaders,new Uint8Array(48)],geometry:any[]=[];
 for(const n of nodes){
  for(const prop of n.layout.props)paint(n.layout,prop.footprint,'b');
  const reachableTiles=reachable(n.layout,n.landing);
  for(const p of n.checks)if(!reachableTiles.has(p.z*n.layout.width+p.x))throw new Error(`${n.id}: disconnected or blocked event/landing ${p.x},${p.z}`);
  for(const [index,npc]of n.npcs.entries()){const p={x:readU16(npc,28),z:readU16(npc,30)};if(![{x:p.x-1,z:p.z},{x:p.x+1,z:p.z},{x:p.x,z:p.z-1},{x:p.x,z:p.z+1}].some(q=>reachableTiles.has(q.z*n.layout.width+q.x)))throw new Error(`${n.id} actor${index} cannot be approached`);}
  const width=n.layout.width/32,height=n.layout.height/32,matrix:any={width,height,matrix_flags:0,footer_length:0};
  n.mapIds.forEach((mapId,c)=>{matrix[`map_${c}`]=mapId;const chunk=n.donorMap!==undefined?{bytes:archives.maps.files[n.donorMap].slice(),polygons:null,vertices:null}:buildWorldChunk(archives.maps.files[n.kind==='sewer'?642:54],n.layout,c%width,Math.floor(c/width));archives.maps.files[mapId]=chunk.bytes;geometry.push({headerId:n.headerId,mapId,sha256:sha(chunk.bytes),polygons:chunk.polygons,vertices:chunk.vertices,nativePropCount:n.layout.props.filter(p=>Math.floor(p.x/32)===c%width&&Math.floor(p.z/32)===Math.floor(c/width)).length});});
  archives.matrix.files[n.matrixId]=materializeGen5MatrixFile(matrix,new Uint8Array());archives.events.files[n.eventId]=worldEvents(n.npcs,n.triggers);archives.scripts.files[n.scriptId]=worldScript(n.entries.length?n.entries:['halt']).bytes;archives.story.files[n.textBankId]=worldText(n.texts.length?n.texts:[n.name]);
  const header=originalHeaders.slice((n.donorHeader??518)*48,((n.donorHeader??518)+1)*48);
  if(n.donorHeader===undefined)writeU16(header,2,n.kind==='sewer'?298:34);
  writeU16(header,4,n.matrixId);writeU16(header,6,n.scriptId);writeU16(header,8,n.levelScriptId);writeU16(header,10,n.textBankId);writeU16(header,20,n.encounterId===undefined?8191:n.encounterId);writeU16(header,22,n.eventId);writeU16(header,24,n.headerId);writeU32(header,36,n.landing.x);writeU32(header,40,0);writeU32(header,44,n.landing.z);const locationId=locationBase+n.headerId-WORLD_FIRST_ZONE;header[26]=locationId&255;header[27]=(header[27]&252)|(locationId>>>8)|(n.kind==='interior'?0:4);locationNames.push([`0_${locationId}`,n.name,0]);headerRows.push(header);
  if(n.encounterId!==undefined){const grass=n.layout.tiles.flatMap((s,k)=>s==='e'?[{x:k%n.layout.width,z:Math.floor(k/n.layout.width)}]:[]),water=n.layout.tiles.flatMap((s,k)=>s==='w'?[{x:k%n.layout.width,z:Math.floor(k/n.layout.width)}]:[]),shores=water.flatMap(p=>[{x:p.x-1,z:p.z},{x:p.x+1,z:p.z},{x:p.x,z:p.z-1},{x:p.x,z:p.z+1}].filter(q=>reachableTiles.has(q.z*n.layout.width+q.x)));
   if(!grass.length||!grass.some(p=>reachableTiles.has(p.z*n.layout.width+p.x)))throw new Error(`No reachable encounter terrain in ${n.id}`);
   habitats.push({headerId:n.headerId,areaId:n.id,mapId:n.mapIds[0],mapIds:n.mapIds,theme:n.theme,minLevel:n.minLevel,maxLevel:n.maxLevel,encounterId:n.encounterId,encounterTiles:grass,surfTiles:water,walkableShore:shores,tileClasses:{grass:{tileClass:4,flags:36},water:{tileClass:63,flags:22}},collisionWalkFromEntrance:true,nativeTraversalCertified:false,preChampionCertified:false});}
 }
 archives.headers.files[0]=concatBytes(headerRows);
 if(archives.headers.files[0].length/48!==WORLD_FIRST_ZONE+nodes.length)throw new Error('Header allocation mismatch');
 messages.files[109]=encodeGen5TextBank(locationNames);
 const staged=Object.entries(WORLD_PATHS).map(([key,path])=>({path,bytes:archives[key as keyof typeof WORLD_PATHS].save()}));staged.push({path:'a/0/0/2' as any,bytes:messages.save()});
 const changedFiles:Array<{path:string;fileId:number;beforeSha256:string;afterSha256:string;bytes:number}>=staged.map(({path,bytes})=>({path,fileId:rom.fileId(path),beforeSha256:sha(rom.getFileByName(path)),afterSha256:sha(bytes),bytes:bytes.length}));
 for(const update of staged)rom.files[rom.fileId(update.path)]=update.bytes.slice();
 const bindings=(n:Node)=>({id:n.id,name:n.name,kind:n.kind,headerId:n.headerId,mapIds:n.mapIds,matrixId:n.matrixId,eventId:n.eventId,scriptId:n.scriptId,levelScriptId:n.levelScriptId,textBankId:n.textBankId,landing:n.landing,requiredOriginalBadges:n.badges,landmarks:n.layout.landmarks,props:n.layout.props,reachableTileCount:reachable(n.layout,n.landing).size});
 return {module:'world',phase:'full-native-allocation',changedFiles,countsBefore,counts:{towns:towns.length,secrets:secrets.length,routes:routes.length,gyms:gymNodes.length,sewers:sewers.length,interiors:rooms.length,headers:nodes.length,maps:geometry.length,habitats:habitats.length,staticEncounters:staticEncounters.length},firstMap:bindings(towns[0]),towns:towns.map(bindings),areas:nodes.map(bindings),storyNpcSpots,gyms,interiors,quests,stateAudit,habitats,staticEncounters,entrances,links,geometry,campaignBound:!!options.campaign,nativeEvidence:{reservedHeader615:'Native cache initializer uses 615 as invalid-cache sentinel. First playable header is616. Cold save/reload in616 has been observed by root; this build requires independent runtime verification.',matrixFlags:0,allNewMapResourcesIndependent:true,sourceRomUnmodified:true,emulatorValidated:false},limitations:['Native textured town exteriors and furnished functional rest/field-office interiors are allocated; full-world native traversal and camera/prop verification remain pending.','Gym battle bodies and crisis interactions are bound only when options.campaign is supplied. Three-control Gym puzzles gate the physical lane; native runtime validation is pending.','Secret resident and supplemental encounters use native Dex-caught predicates. The three mythical quests now bind ordered portable clues, three permanent repairs and keeper completion to three audited saved work words and three keeper-completion flags; save persistence and complete quest playthrough still require emulator validation.','Visible naturalist actors stand in for species without stock walking graphics; this is reported per encounter.','Native route guides and reciprocal links are integrated, but no complete pre-Champion playthrough, habitat encounter test, capture/retry cycle or physical-console test is claimed.']};
}
