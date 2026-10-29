import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptCommandSize } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { appendTrainer, TRAINER_PATHS, PLASMA_TRAINER_CLASSES, type TrainerPokemon } from './trainers';
import expansion from '../../content/expansion.json';

const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const hex=(n:number)=>`0x${n.toString(16).padStart(4,'0')}`;
const TRAINER_FLAG_BASE=0x5F0;
const TRAINER_FLAG_LIMIT=0x960;
const NEW_FLAGS=[0xA83,0xA0C,0xA85,0xA87,0xA11,0xA88,0xA89,0xA1D,0xA21,0xA8B,0xA24,0xA25];
export const NEW_GYM_FLAGS:Record<string,number>=Object.fromEntries(expansion.gyms.map((g,i)=>[g.id,NEW_FLAGS[i]]));
export const PLASMA_CRISIS_FLAGS={southworks:0xA3B,westbasin:0xA3D,highmarch:0xA8F,eastern:0xA41} as const;
export const ORIGINAL_GYM_ACE_LEVELS={Cheren:14,Roxie:22,Burgh:30,Elesa:37,Clay:42,Skyla:53,Drayden:63,Marlon:67} as const;
const ORIGINAL_NAMES=Object.keys(ORIGINAL_GYM_ACE_LEVELS) as Array<keyof typeof ORIGINAL_GYM_ACE_LEVELS>;
const ORIGINAL_TRAINERS=[156,157,154,153,158,155,159,160];
const ORIGINAL_REQUIRED_FLAGS=[[],[0xA83],[0xA0C],[0xA85],[0xA85],[0xA11],[0xA89],[0xA89]];
export const ORIGINAL_GYM_REQUIREMENTS=ORIGINAL_NAMES.map((name,badgeIndex)=>({name,badgeIndex,trainerId:ORIGINAL_TRAINERS[badgeIndex],requiredBadges:badgeIndex,requiredFlags:ORIGINAL_REQUIRED_FLAGS[badgeIndex],aceLevel:ORIGINAL_GYM_ACE_LEVELS[name]}));
const NEW_LEVELS=[17,25,33,46,49,56,59,70,73,75,78,81];
const NEW_BADGES=[1,2,3,5,5,6,6,8,8,8,8,8];
const CRISIS_FOR_GYM:Record<number,number>={2:PLASMA_CRISIS_FLAGS.southworks,4:PLASMA_CRISIS_FLAGS.westbasin,8:PLASMA_CRISIS_FLAGS.highmarch,11:PLASMA_CRISIS_FLAGS.eastern};
type ProgressionStep={order:number;kind:'original'|'additional';id:string;leader:string;aceLevel:number;requiredBadges:number;requiredFlags:number[];badgeIndex?:number;flagId?:number};
const ORDER:[ 'original'|'additional',number ][]=[['original',0],['additional',0],['original',1],['additional',1],['original',2],['additional',2],['original',3],['original',4],['additional',3],['additional',4],['original',5],['additional',5],['additional',6],['original',6],['original',7],['additional',7],['additional',8],['additional',9],['additional',10],['additional',11]];
export const CAMPAIGN_PROGRESSION:ProgressionStep[]=ORDER.map(([kind,index],i)=>kind==='original'
  ? {order:i+1,kind,id:`gym.original.${ORIGINAL_NAMES[index].toLowerCase()}`,leader:ORIGINAL_NAMES[index],aceLevel:ORIGINAL_GYM_ACE_LEVELS[ORIGINAL_NAMES[index]],badgeIndex:index,requiredBadges:index,requiredFlags:ORIGINAL_REQUIRED_FLAGS[index]}
  : {order:i+1,kind,id:expansion.gyms[index].id,leader:expansion.gyms[index].leader.name,aceLevel:NEW_LEVELS[index],flagId:NEW_FLAGS[index],requiredBadges:NEW_BADGES[index],requiredFlags:[...(index?[NEW_FLAGS[index-1]]:[]),...(CRISIS_FOR_GYM[index]?[CRISIS_FOR_GYM[index]]:[])]});

function p(species:string,level:number,moves?:string[],item?:string):TrainerPokemon {
  return {species,level,...(moves?{moves}:{}),...(item?{held_item:item}:{}),packed_iv_difficulty_target:level<35?120:level<60?180:240};
}
const GYM_TEAMS:TrainerPokemon[][]=[
  [p('Budew',15,['Mega Drain','Stun Spore','Growth','Water Sport']),p('Petilil',16,['Mega Drain','Sleep Powder','Leech Seed','Growth']),p('Ivysaur',17,['Razor Leaf','PoisonPowder','Leech Seed','Tackle'],'Oran Berry')],
  [p('Growlithe',23,['Flame Wheel','Bite','Roar','Helping Hand']),p('Pignite',24,['Flame Charge','Arm Thrust','Rollout','Defense Curl']),p('Charmeleon',25,['Flame Burst','Dragon Rage','Smokescreen','Slash'],'Sitrus Berry')],
  [p('Ferroseed',31,['Gyro Ball','Pin Missile','Leech Seed','Protect']),p('Mawile',32,['Iron Head','Bite','Rock Tomb','Fake Tears']),p('Magneton',33,['Volt Switch','Flash Cannon','Thunder Wave','SonicBoom'],'Sitrus Berry')],
  [p('Sandslash',44,['Earthquake','Rock Slide','Swords Dance','Slash']),p('Palpitoad',44,['Muddy Water','Mud Shot','Sludge Wave','Rain Dance']),p('Gabite',45,['Dragon Claw','Dig','Rock Slide','Sandstorm']),p('Excadrill',46,['Earthquake','Iron Head','Rock Slide','Swords Dance'],'Sitrus Berry')],
  [p('Lanturn',47,['Scald','Thunderbolt','Confuse Ray','Thunder Wave']),p('Ludicolo',47,['Giga Drain','Scald','Ice Beam','Rain Dance']),p('Jellicent',48,['Scald','Shadow Ball','Recover','Will-O-Wisp']),p('Kingdra',49,['Dragon Pulse','Surf','Ice Beam','Agility'],'Sitrus Berry')],
  [p('Crustle',54,['Rock Slide','X-Scissor','Shell Smash','Earthquake']),p('Rhydon',54,['Earthquake','Rock Slide','Megahorn','Rock Polish']),p('Carracosta',55,['Waterfall','Aqua Jet','Stone Edge','Shell Smash']),p('Aggron',56,['Iron Head','Rock Slide','Earthquake','Thunder Wave'],'Sitrus Berry')],
  [p('Crobat',57,['Acrobatics','Cross Poison','U-turn','Roost']),p('Gliscor',57,['Acrobatics','Earthquake','Swords Dance','Roost']),p('Sigilyph',58,['Psychic','Air Slash','Reflect','Roost']),p('Staraptor',59,['Brave Bird','Close Combat','U-turn','Quick Attack'],'Sitrus Berry')],
  [p('Abomasnow',68,['Blizzard','Wood Hammer','Ice Shard','Protect'],'Sitrus Berry'),p('Froslass',68,['Ice Beam','Shadow Ball','Thunderbolt','Will-O-Wisp']),p('Mamoswine',69,['Earthquake','Icicle Crash','Ice Shard','Stone Edge']),p('Walrein',69,['Surf','Ice Beam','Rest','Sleep Talk'],'Leftovers'),p('Weavile',70,['Ice Punch','Night Slash','Low Kick','Ice Shard'],'Focus Sash')],
  [p('Mienshao',71,['Hi Jump Kick','U-turn','Fake Out','Stone Edge']),p('Scrafty',71,['Drain Punch','Crunch','Ice Punch','Bulk Up']),p('Heracross',72,['Close Combat','Megahorn','Stone Edge','Night Slash']),p('Lucario',72,['Aura Sphere','Flash Cannon','Dark Pulse','ExtremeSpeed'],'Sitrus Berry'),p('Conkeldurr',73,['Drain Punch','Mach Punch','Payback','Bulk Up'],'Leftovers')],
  [p('Rotom',73,['Thunderbolt','Shadow Ball','Will-O-Wisp','Volt Switch']),p('Magnezone',73,['Thunderbolt','Flash Cannon','Thunder Wave','Volt Switch']),p('Eelektross',74,['Thunderbolt','Flamethrower','Giga Drain','Crunch'],'Sitrus Berry'),p('Galvantula',74,['Thunder','Bug Buzz','Energy Ball','Volt Switch'],'Focus Sash'),p('Electivire',75,['Wild Charge','Ice Punch','Earthquake','Cross Chop'],'Expert Belt')],
  [p('Reuniclus',76,['Psychic','Focus Blast','Recover','Calm Mind'],'Leftovers'),p('Slowking',76,['Scald','Psychic','Flamethrower','Slack Off']),p('Bronzong',77,['Gyro Ball','Earthquake','Light Screen','Reflect']),p('Sigilyph',77,['Psychic','Air Slash','Ice Beam','Roost']),p('Gallade',78,['Psycho Cut','Close Combat','Night Slash','Leaf Blade'],'Sitrus Berry'),p('Alakazam',78,['Psychic','Focus Blast','Shadow Ball','Energy Ball'],'Focus Sash')],
  [p('Druddigon',79,['Dragon Claw','Fire Punch','Sucker Punch','Glare']),p('Kingdra',79,['Dragon Pulse','Surf','Ice Beam','Rain Dance']),p('Flygon',80,['Earthquake','Dragon Claw','Fire Punch','U-turn']),p('Haxorus',80,['Dragon Claw','Earthquake','Rock Slide','Dragon Dance'],'Lum Berry'),p('Salamence',81,['Dragon Claw','Flamethrower','Earthquake','Roost'],'Sitrus Berry'),p('Hydreigon',81,['Dragon Pulse','Dark Pulse','Flamethrower','Surf'],'Expert Belt')],
];

type Crisis={id:keyof typeof PLASMA_CRISIS_FLAGS;townId:string;name:string;requiredBadges:number;requiredFlags:number[];teams:TrainerPokemon[][];texts:string[]};
const CRISES:Crisis[]=[
  {id:'southworks',townId:'settlement.copperbrook',name:'Surveyor Rusk',requiredBadges:3,requiredFlags:[0xA0C],teams:[
    [p('Trubbish',29),p('Watchog',30),p('Krokorok',30)],
    [p('Golbat',31),p('Magneton',31,['Volt Switch','Flash Cannon','Thunder Wave','SonicBoom']),p('Pawniard',32),p('Garbodor',32,['Sludge Bomb','Body Slam','Toxic Spikes','Stockpile'],'Sitrus Berry')]],
    texts:[
      'Mara: Our orchard channel is drying up. Those workers put a beacon beside the waterwheel. Now every flock turns away from the fields!',
      'Alder: Bram traced the missing water to this wheel. N is guiding the frightened Pokemon home. You and I will stop the crew!',
      'Surveyor Rusk: Water turns the wheel. The wheel powers our signal. Soon even wild Pokemon will travel where Team Plasma tells them!',
      'Mara: Visit Bram in Sootbell Yard, then bring Burgh\'s Badge. We need someone who can get past this crew.',
      'Mara: The channel is flowing again! Alder and Ferris disconnected the beacon. N says the flocks are finding their own way home.',
      'Alder: The crew has one more Trainer. I\'ll help your partners catch their breath first!',
      'N: That signal was copied from a larger relay. The shipping marks lead through Castelia to the western locks.',
    ]},
  {id:'westbasin',townId:'settlement.reedwake',name:'Lockmaster Venn',requiredBadges:5,requiredFlags:[0xA87,0xA3B],teams:[
    [p('Golbat',45),p('Watchog',46),p('Klang',46),p('Seismitoad',46)],
    [p('Crobat',47),p('Krookodile',47,['Earthquake','Crunch','Rock Slide','Taunt']),p('Ferrothorn',48,['Power Whip','Gyro Ball','Leech Seed','Protect']),p('Jellicent',48,['Scald','Shadow Ball','Recover','Will-O-Wisp'],'Sitrus Berry')]],
    texts:[
      'Keeper Iona: Our boats bring medicine to six towns. Team Plasma chained the lock gates shut and turned the nursery pool into their test channel.',
      'N: The fish turn back whenever that bell rings. I can quiet the lower beacon. Please help Maris reach the lock controls.',
      'Lockmaster Venn: One closed gate, one open gate. We can move every boat and every shoal without anyone asking why!',
      'Keeper Iona: Dune has the lock survey. Earn the Contour Emblem and help Copperbrook before we try to open these gates.',
      'Keeper Iona: The medicine boat is through! Maris has opened the nursery channel. Our crews will keep the beacons disconnected.',
      'Alder: A frightened partner needs a steady hand. Rest here; I\'ll watch the gate while you prepare.',
      'N: They sent their relay charts north. My old words are on the cover. I won\'t let them use those words to take away another choice.',
    ]},
  {id:'highmarch',townId:'settlement.frostmere_hearth',name:'Relay Chief Ione',requiredBadges:8,requiredFlags:[0xA1D,0xA3D],teams:[
    [p('Cryogonal',69),p('Garbodor',69),p('Weavile',70),p('Magnezone',70)],
    [p('Bronzong',71,['Gyro Ball','Psychic','Earthquake','Reflect']),p('Bisharp',71,['Iron Head','Night Slash','Sucker Punch','Swords Dance']),p('Chandelure',72,['Shadow Ball','Flamethrower','Energy Ball','Will-O-Wisp']),p('Mamoswine',72,['Earthquake','Icicle Crash','Ice Shard','Stone Edge'],'Sitrus Berry'),p('Klinklang',72,['Gear Grind','Wild Charge','Shift Gear','Return'])]],
    texts:[
      'Keeper Oren: The mountain shelters are cold. Plasma took the supply carts and connected every warning bell to the relay tower.',
      'Alder: My students are taking blankets along Neve\'s safe path. I wanted to do it all myself. They reminded me I can trust them.',
      'Relay Chief Ione: Every warning bell will carry our signal. When the Pokemon leave their shelters, the energy collectors will be waiting!',
      'Keeper Oren: Neve is marking the safe crossings. Earn her Rime Emblem and help the western locks before you approach the relay.',
      'Keeper Oren: The bells belong to the shelters again! Tor and the students brought the carts back. Every refuge has fuel for tonight.',
      'N: I can hold the relay steady while Alder tends your partners. We will finish this together.',
      'Alder: I\'ll stay with the students. Take the relay chart to Dawnbridge. N and the keepers are already warning the coastal crews.',
    ]},
  {id:'eastern',townId:'settlement.dawnbridge',name:'Signal Chief Corin',requiredBadges:8,requiredFlags:[0xA24,0xA8F],teams:[
    [p('Crobat',77),p('Krookodile',77),p('Drapion',78),p('Eelektross',78)],
    [p('Magnezone',79,['Thunderbolt','Flash Cannon','Volt Switch','Thunder Wave']),p('Gyarados',79,['Waterfall','Ice Fang','Earthquake','Dragon Dance']),p('Bisharp',80,['Iron Head','Night Slash','Sucker Punch','Swords Dance']),p('Chandelure',80,['Flamethrower','Shadow Ball','Energy Ball','Psychic']),p('Hydreigon',80,['Dragon Pulse','Dark Pulse','Flamethrower','Surf'],'Sitrus Berry'),p('Porygon-Z',80,['Tri Attack','Ice Beam','Thunderbolt','Nasty Plot'],'Expert Belt')]],
    texts:[
      'Keeper Sela: The lighthouse signals are wrong. Boats are turning toward the collector platform, and the migrating Pokemon are following them.',
      'N: Veda separated the true signals from the false ones. Every keeper is ready. Stop the platform crew, and we can shut this network down.',
      'Signal Chief Corin: We did not need to catch them. Control the roads, the water and the warning lights, and every Pokemon becomes our source of power!',
      'Keeper Sela: We need Veda\'s Prism Emblem and the northern relay chart. The other keepers must be ready before we change these signals.',
      'Keeper Sela: Every harbor has answered! The collectors are quiet. Our boats and the Pokemon can choose their own routes again.',
      'Alder: The keepers have the controls. Give your team a moment; the last crew is still on that platform.',
      'N: You listened, and you acted. Soren is waiting at Stillwater Fold. When you are ready, bring the team that walked these roads to the League.',
    ]},
];

type MentorSpec={id:string;name:'N'|'Alder';townId:string;requiredBadges:number;requiredFlags:number[];team:TrainerPokemon[];intro:string;win:string};
const MENTOR_SPECS:MentorSpec[]=[
  {id:'alder.first_steps',name:'Alder',townId:'settlement.bramblewick',requiredBadges:1,requiredFlags:[],team:[p('Lillipup',14),p('Larvesta',15,['Ember','String Shot','Leech Life','Take Down'])],intro:'Alder: A good road needs a place to rest! My partners can help you practice while the keepers repair the welcome sign. Shall we?',win:'Alder: You watched your partners closely! Carry that habit with you.'},
  {id:'n.southworks',name:'N',townId:'settlement.sootbell_yard',requiredBadges:2,requiredFlags:[0xA83],team:[p('Timburr',23),p('Woobat',23),p('Zorua',24,['Faint Attack','Fury Swipes','Taunt','Scary Face'])],intro:'N: The Pokemon chose the quiet path beside the kiln. I want to understand how your team makes its choices. Will you show me?',win:'N: I heard their worry. You helped them move forward. I want to learn that part, too.'},
  {id:'alder.western',name:'Alder',townId:'settlement.sandglass_court',requiredBadges:5,requiredFlags:[0xA85],team:[p('Stoutland',42),p('Braviary',43),p('Bouffalant',43),p('Volcarona',44,['Fiery Dance','Bug Buzz','Giga Drain','Quiver Dance'])],intro:'Alder: Four towns asked for four different lessons. Good thing a teacher can listen, too! Would you and your partners like a practice battle?',win:'Alder: A fine idea! Next time I will leave room for my students to say it sooner.'},
  {id:'n.western',name:'N',townId:'settlement.reedwake',requiredBadges:5,requiredFlags:[0xA87],team:[p('Carracosta',46,['Waterfall','Rock Slide','Aqua Jet','Shell Smash']),p('Sigilyph',47),p('Darmanitan',47),p('Zoroark',48,['Night Daze','Flamethrower','Focus Blast','U-turn'])],intro:'N: The keeper found a safer route than mine. Listening to people can be difficult, too. Shall we compare what our partners have learned?',win:'N: You gave each partner room to act. I will remember that when we open the locks.'},
  {id:'alder.highmarch',name:'Alder',townId:'settlement.threadmill_crossing',requiredBadges:6,requiredFlags:[0xA11],team:[p('Escavalier',55),p('Accelgor',55),p('Druddigon',56),p('Bouffalant',56),p('Volcarona',57,['Fiery Dance','Bug Buzz','Giga Drain','Quiver Dance'],'Sitrus Berry')],intro:'Alder: My students are carrying supplies to the shelters. I will keep their meeting place warm. Care to help me prepare the next lesson?',win:'Alder: My students can find their own way. This old Champion needed to learn that.'},
  {id:'n.highmarch',name:'N',townId:'settlement.frostmere_hearth',requiredBadges:8,requiredFlags:[0xA1D],team:[p('Carracosta',69,['Waterfall','Stone Edge','Aqua Jet','Shell Smash']),p('Archeops',69),p('Vanilluxe',70),p('Sigilyph',70),p('Zoroark',71,['Night Daze','Flamethrower','Focus Blast','U-turn'],'Sitrus Berry')],intro:'N: The keepers do not need us to make every choice. They need to know we will return. Before we reach the relay, shall we practice?',win:'N: Your team knows it can depend on you. The people here are learning that, too.'},
  {id:'alder.eastern',name:'Alder',townId:'settlement.saltlamp_quay',requiredBadges:8,requiredFlags:[0xA21],team:[p('Escavalier',75,['Megahorn','Iron Head','Return','Swords Dance']),p('Accelgor',75,['Bug Buzz','Focus Blast','Giga Drain','U-turn']),p('Conkeldurr',76,['Drain Punch','Mach Punch','Payback','Bulk Up']),p('Braviary',76),p('Bouffalant',77),p('Volcarona',78,['Fiery Dance','Bug Buzz','Giga Drain','Quiver Dance'],'Sitrus Berry')],intro:'Alder: The school will carry on while I travel. Volcarona and I still have a lesson to share. Ready for our strongest practice team?',win:'Alder: You earned that victory together! I will be cheering when you reach the League.'},
  {id:'n.final_practice',name:'N',townId:'settlement.stillwater_fold',requiredBadges:8,requiredFlags:[0xA25],team:[p('Carracosta',80,['Waterfall','Stone Edge','Aqua Jet','Shell Smash']),p('Archeops',81,['Acrobatics','Stone Edge','Earthquake','U-turn']),p('Sigilyph',81,['Psychic','Air Slash','Ice Beam','Roost']),p('Vanilluxe',82,['Ice Beam','Flash Cannon','Signal Beam','Protect']),p('Darmanitan',82,['Flare Blitz','Rock Slide','Superpower','U-turn']),p('Zoroark',83,['Night Daze','Flamethrower','Focus Blast','U-turn'],'Sitrus Berry')],intro:'N: Your team has changed, and so has mine. Shall we show each other how far we have come before our battle at the League?',win:'N: I will meet you at the League. Until then, these roads belong to everyone who travels them.'},
];

function guard(requiredBadges:number,flags:number[],prefix:string,missingMessage=3) {
  return [`trainer_card_get_badge_count 0x8010`,`work_cmp_const 0x8010, ${requiredBadges}`,`jump_if 0x00, :${prefix}_missing`,...flags.flatMap(flag=>[`unless flag_set?(${hex(flag)})`,`  talk message: ${missingMessage}`,`  finish_interaction`,`end`])];
}
function battle(trainerId:number,prefix:string) {
  return [`call_trainer_battle ${trainerId}, 0, 0`,`trainer_battle_is_victory 0x8010`,`work_cmp_const 0x8010, 1`,`jump_if 0x01, :${prefix}_won`,`call_trainer_lose`,`finish_interaction`,`label :${prefix}_won`,`call_trainer_battle_end`];
}
function makeGymBody(trainerId:number,flagId:number,requiredBadges:number,requiredFlags:number[],key:string) {
  const prefix=key.replace(/[^a-z0-9]/gi,'_');
  return ['lock','face_player',`if flag_set?(${hex(flagId)})`,`  talk message: 2`,`  finish_interaction`,'end',...guard(requiredBadges,requiredFlags,prefix),'talk message: 1',...battle(trainerId,prefix),`set_flag ${hex(flagId)}`,'talk message: 4','finish_interaction',`label :${prefix}_missing`,'talk message: 3','finish_interaction'].join('\n');
}
function makeCrisisBody(c:Crisis,ids:number[]) {
  const prefix=`plasma_${c.id}`,flag=PLASMA_CRISIS_FLAGS[c.id];
  return ['lock','face_player',`if flag_set?(${hex(flag)})`,'  talk message: 4','  talk message: 6','  finish_interaction','end',...guard(c.requiredBadges,c.requiredFlags,prefix),'talk message: 0','talk message: 1',...battle(ids[0],`${prefix}_lookout`),'talk message: 5','poke_party_recover_all','talk message: 2',...battle(ids[1],`${prefix}_chief`),`set_flag ${hex(flag)}`,'talk message: 4','talk message: 6','finish_interaction',`label :${prefix}_missing`,'talk message: 3','finish_interaction'].join('\n');
}
function makeMentorBody(m:MentorSpec,trainerId:number) {
  const prefix=`mentor_${m.id.replace(/[^a-z0-9]/gi,'_')}`;
  return ['lock','face_player',...guard(m.requiredBadges,m.requiredFlags,prefix),'talk message: 0','yes_no_win 0x8010','work_cmp_const 0x8010, 0',`jump_if 0x01, :${prefix}_accepted`,'talk message: 2','finish_interaction',`label :${prefix}_accepted`,'poke_party_recover_all','talk message: 1',...battle(trainerId,prefix),'poke_party_recover_all','talk message: 4','finish_interaction',`label :${prefix}_missing`,'talk message: 3','finish_interaction'].join('\n');
}

export function compileCampaignBody(body:string) {
  const compiled=compileBw2Script(`preserve_layout\nscript :campaign_interaction, entry: 1 do\n${body}\nend\n`);
  const round=decompileBw2Script(compiled.bytes);
  if(!round.roundTripVerified||!round.editable) throw new Error('Campaign body failed native compiler/decompiler round trip');
  return {bytes:compiled.bytes,source:body,sha256:hash(compiled.bytes),roundTripVerified:round.roundTripVerified};
}
/** Only our generated local talk operands are rebased; native flags/work/IDs stay exact. */
export function rebaseCampaignBody(body:string,textBase:number) {
  if(!Number.isInteger(textBase)||textBase<0||textBase>65000) throw new Error('Invalid campaign message base');
  const rebased=body.replace(/^(\s*talk message: )(\d+)$/gm,(_,prefix,id)=>`${prefix}${Number(id)+textBase}`);
  compileCampaignBody(rebased);return rebased;
}

function verifyNativeBattleContract(rom:NintendoDSRom) {
  const trainerFlags=rom.loadArm9Overlays([12]).get(12)!;
  for(const address of [0x02155038,0x0215504C,0x02155060]) {
    const offset=address-trainerFlags.ramAddress;
    if(readU16(trainerFlags.data,offset)!==0x225F||readU16(trainerFlags.data,offset+2)!==0x0112) throw new Error('Pinned IREO trainer-flag base does not match native test/set/clear accessors');
  }
  const scripts=new NARC(rom.getFileByName('a/0/5/6'));
  const source=decompileBw2Script(scripts.files[1004]);
  if(!source.roundTripVerified||!source.source.includes('call_trainer_battle 0x009d, 0x0000, 0x0000')||!source.source.includes('trainer_battle_is_victory 0x8010')||!source.source.includes('call_trainer_lose')||!source.source.includes('call_trainer_battle_end')) throw new Error('Pinned native Roxie battle flow does not match campaign contract');
  for(const [opcode,size] of [[0x85,8],[0x8D,4],[0x8C,2],[0x8E,2],[0x23,4],[0xD7,4],[0x47,4]] as const) if(gen5ScriptCommandSize(opcode,'BW2')!==size) throw new Error(`Unexpected native opcode layout ${hex(opcode)}`);
  const allFlags=[...NEW_FLAGS,...Object.values(PLASMA_CRISIS_FLAGS)];
  const events=new NARC(rom.getFileByName('a/1/2/6'));
  for(const archive of [scripts,events]) for(let member=0;member<archive.files.length;member++) {
    const bytes=archive.files[member];
    for(let offset=0;offset+2<=bytes.length;offset++) if(allFlags.includes(readU16(bytes,offset))) throw new Error(`Reserved campaign flag already appears in original scripts/events member ${member}, offset ${offset}`);
  }
  return {reference:{path:'a/0/5/6',member:1004,sha256:hash(scripts.files[1004]),roundTripVerified:true},opcodes:{callTrainerBattle:0x85,isVictory:0x8D,battleEnd:0x8E,loss:0x8C,setFlag:0x23,badgeCount:0xD7,yesNo:0x47},reservedFlagAudit:'Absent from all literal words at every byte offset in supplied pre-world scripts/events; not proof of absent hardcoded native use.'};
}

/** Allocates actual trainers now; returns compiled interaction bodies for world/story.
 * Run after full-campaign applyTrainers and before applyWorld. No whole-ROM save. */
export function applyCampaignDefinitions(rom:NintendoDSRom) {
  if(rom.idCode!=='IREO'||rom.data[0x1e]!==0) throw new Error('Campaign requires US Black2 revision0');
  if(expansion.gyms.length!==12) throw new Error('Campaign requires the authored twelve gym definitions');
  const native=verifyNativeBattleContract(rom);
  const initialTrainerCount=new NARC(rom.getFileByName(TRAINER_PATHS.data)).files.length;
  const trainerCount=12+CRISES.length*2+MENTOR_SPECS.length;
  if(TRAINER_FLAG_BASE+initialTrainerCount+trainerCount-1>=TRAINER_FLAG_LIMIT) throw new Error('Allocated trainer defeated flags would reach native system flags');
  // appendTrainer owns its archives. Stage the complete allocation, so a failed
  // move/item validation cannot leave half a campaign in the caller's object.
  const staged=Object.assign(Object.create(NintendoDSRom.prototype),rom) as NintendoDSRom;
  staged.files=[...rom.files];
  const filePaths=Object.values(TRAINER_PATHS),before=new Map(filePaths.map(path=>[path,hash(rom.getFileByName(path))]));
  const gyms:Record<string,{body:string;trainerId:number;flagId:number;requiredBadges:number;requiredFlags:number[];texts:string[];name:string;leader:string;levels:number[];compiledSha256:string;compiledBytes:number[]}>={};
  for(let i=0;i<12;i++) {
    const g=expansion.gyms[i],step=CAMPAIGN_PROGRESSION.find(s=>s.id===g.id)!;
    const allocation=appendTrainer(staged,{name:g.leader.name,trainerClassId:[113,116,115,117,119,117,114,116,115,112,113,118][i],team:GYM_TEAMS[i],bagItems:i<2?[]:i<7?['Hyper Potion']:['Full Restore'],money:40,battleText:{1:`That was a fine battle! The ${g.victory_emblem.name} is yours.`,19:'Our last partner is ready!'}});
    const body=makeGymBody(allocation.trainerId,step.flagId!,step.requiredBadges,step.requiredFlags,g.id),compiled=compileCampaignBody(body);
    gyms[g.id]={body,trainerId:allocation.trainerId,flagId:step.flagId!,requiredBadges:step.requiredBadges,requiredFlags:step.requiredFlags,name:g.name,leader:g.leader.name,levels:allocation.levels,texts:[`Welcome to ${g.building.name}!`,`${g.leader.name}: We keep these roads open together. Let us see what you and your partners have learned!`,`${g.leader.name}: You have earned the ${g.victory_emblem.name}. Keep exploring!`,`${g.leader.name}: The next lesson can wait. Complete the earlier Gyms and help the local keepers first.`,`${g.leader.name}: Well done! Take the ${g.victory_emblem.name}. We will watch the roads while you continue your journey.`],compiledSha256:compiled.sha256,compiledBytes:Array.from(compiled.bytes)};
  }
  const towns:Record<string,{body:string;texts:string[];trainerId:number;trainerIds:number[];flagId:number;requiredBadges:number;requiredFlags:number[];crisisId:string;compiledSha256:string;compiledBytes:number[]}>={};
  for(const crisis of CRISES) {
    const ids=crisis.teams.map((team,i)=>appendTrainer(staged,{name:i?crisis.name:'Plasma Lookout',trainerClassId:i?PLASMA_TRAINER_CLASSES.zinzolin:PLASMA_TRAINER_CLASSES.gruntMale,team,money:25,bagItems:i?['Hyper Potion']:[],battleText:{1:i?'The relay is down... We have to withdraw!':'The chief is still guarding the controls!',19:'The signal cannot fail!'}}).trainerId);
    const body=makeCrisisBody(crisis,ids),compiled=compileCampaignBody(body);
    towns[crisis.townId]={body,texts:crisis.texts,trainerId:ids[0],trainerIds:ids,flagId:PLASMA_CRISIS_FLAGS[crisis.id],requiredBadges:crisis.requiredBadges,requiredFlags:crisis.requiredFlags,crisisId:crisis.id,compiledSha256:compiled.sha256,compiledBytes:Array.from(compiled.bytes)};
  }
  const mentors=MENTOR_SPECS.map(m=> {
    const allocation=appendTrainer(staged,{name:m.name,trainerClassId:m.name==='N'?40:89,team:m.team,money:20,battleText:{1:m.win,19:'Our last partner has something to show you!'}});
    const body=makeMentorBody(m,allocation.trainerId),compiled=compileCampaignBody(body);
    return {id:m.id,semanticKey:`mentor.${m.id}`,name:m.name,townId:m.townId,settlementId:m.townId,spriteId:m.name==='N'?103:97,trainerId:allocation.trainerId,body,texts:[m.intro,`${m.name}: Let us begin!`,`${m.name}: Another time, then. We will be here.`,`${m.name}: There is more to learn along the road first. Complete the earlier Gyms, then come and find us.`,m.win],requiredBadges:m.requiredBadges,requiredFlags:m.requiredFlags,repeatable:true as const,optional:true as const,levels:allocation.levels,compiledSha256:compiled.sha256,compiledBytes:Array.from(compiled.bytes)};
  });
  const changedFiles=filePaths.filter(path=>before.get(path)!==hash(staged.getFileByName(path))).map(path=>({path,fileId:rom.fileId(path),beforeSha256:before.get(path)!,afterSha256:hash(staged.getFileByName(path)),bytes:staged.getFileByName(path).length}));
  for(const file of changedFiles)rom.files[file.fileId]=new Uint8Array(staged.files[file.fileId]);
  return {module:'campaign',changedFiles,gyms,towns,mentors,progression20:CAMPAIGN_PROGRESSION,originalGymRequirements:ORIGINAL_GYM_REQUIREMENTS,originalGymAceLevels:ORIGINAL_GYM_ACE_LEVELS,newGymFlags:NEW_GYM_FLAGS,crisisFlags:PLASMA_CRISIS_FLAGS,initialTrainerCount,allocatedTrainerCount:trainerCount,finalTrainerCount:initialTrainerCount+trainerCount,nativeBattleContract:native,allocator:{trainerDefeatedFlagOffset:TRAINER_FLAG_BASE,highestAllocatedTrainerFlag:TRAINER_FLAG_BASE+initialTrainerCount+trainerCount-1,trainerFlagCeilingExclusive:TRAINER_FLAG_LIMIT,storyCasteliaFlag:0xA39,flags: [...NEW_FLAGS,...Object.values(PLASMA_CRISIS_FLAGS)],nativeFlagCapacityLast:0xBF3},integration:{trainerRecordsApplied:true,worldActorsBound:false,originalGymWrappersApplied:false,leagueGateApplied:false,emulatorBattleValidated:false},limitations:['Trainer records are allocated in the ROM. Compiled bodies require applyWorld/applyStory placement before any new campaign battle is playable.','Only the win branch sets an emblem/crisis flag. A lost two-battle crisis retries from its first opponent; the team heals between opponents.','Mentor offers are optional, repeatable and award no progress flags. A loss follows the native trainer-loss recovery path.','New leaders reuse native battle-class portraits; no new portrait art is claimed.','The 20-step level curve is authored against the configured level-83..90 League. Full-playthrough XP balance and native difficulty adjustments remain untested.','Flag literal scans and bounded trainer allocation do not exclude every possible hardcoded native consumer.']};
}
