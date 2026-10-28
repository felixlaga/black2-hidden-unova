import {WORLD_QUEST_FLAGS,WORLD_QUEST_WORK} from './world-state';
export const WORLD_MYTHICAL_QUESTS=[
 {species:494,areaId:'area.bellows_den',name:'A Small Victory',badges:5,gymIndex:2,clues:[
  {node:'gym.sootbell_yard',point:{x:23,z:26},name:'Training scoreboard',text:'The scoreboard marks acts of help with a little V. Its sketch points to the communal oven in Copperbrook Rest House.'},
  {node:'interior.settlement.copperbrook.0',point:{x:8,z:7},name:'Communal oven log',text:'An ember stayed warm after a lost match. The margin shows a split-wing hearth tile. Search Victory Ember Hearth beside Copperbrook.'},
  {node:'area.bellows_den',point:{x:16,z:25},name:'Split-wing tile',text:'The tile matches the ledger drawing. Three loose shutters control the refuge vents. Inspect each shutter, then tell the keeper.'},
 ],repairs:['Fasten the left vent shutter','Brace the central chimney shutter','Secure the sheltered outlet'],resolution:'Keeper: All three vents are secure. Alder says helping the refuge is a victory worth cheering! Victini may stay here whether you battle it or not.'},
 {species:647,areaId:'area.river_crown',name:'The Patient Crossing',badges:8,gymIndex:9,clues:[
  {node:'interior.settlement.dawnbridge.1',point:{x:8,z:7},name:'Ferryman archive',text:'A sketch shows hoofprints at the water without sinking into mud. A reed emblem directs you to the field office in Reedwake.'},
  {node:'interior.settlement.reedwake.1',point:{x:8,z:7},name:'Nursery reed survey',text:'The reeds bend around the nursery pool. Their direction matches three stones at Oathwater Crossing near Dawnbridge.'},
  {node:'area.river_crown',point:{x:16,z:25},name:'Spillway stones',text:'Three stones outline a shallow path around the nursery. The keeper supplies three markers. Place each one, then report the safe crossing.'},
 ],repairs:['Set the upstream marker above the nursery','Set the quiet-bank marker','Set the downstream landing marker'],resolution:'Keeper: The shared watch can cross without disturbing the nursery. N asked us to leave the visitor the same room. Keldeo can approach freely now.'},
 {species:491,areaId:'area.night_orchard',name:'A Quiet Light',badges:8,gymIndex:11,clues:[
  {node:'interior.settlement.dawnbridge.0',point:{x:8,z:7},name:'Refuge guestbook',text:'Restless dreams began beside a flickering lamp. A keeper drew the shutter workshop in Tideglass. Its field office keeps the old plans.'},
  {node:'interior.settlement.tideglass.1',point:{x:8,z:7},name:'Steady-light shutter plan',text:'The shutters turn flashes into a steady glow. Follow the crescent trail to Hushlantern Sanctuary beside Dawnbridge. The route is safe at any hour.'},
  {node:'area.night_orchard',point:{x:16,z:25},name:'Crescent trail marks',text:'The marks lead around the sleeping grove. Fit the three supplied shutters and mark a quiet bypass, then report to the refuge keeper.'},
 ],repairs:['Fit the grove-side shutter','Fit the shelter-side shutter','Mark the quiet bypass and steady the final lamp'],resolution:'Keeper: The refuge is quiet. Alder supplied a steady lantern, and N left a safe path for the frightened visitor. Darkrai can retreat here without anyone forcing a battle.'},
] as const;
// All persistent updates use native u16 bit operations; work8000 is only a
// temporary test value. Existing progress and unrelated high bits are preserved.
function readMask(questIndex:number,mask:number){return [`work_set 0x8000, ${WORLD_QUEST_WORK[questIndex]}`,`work_and 0x8000, ${mask}`];}
function requireMask(questIndex:number,mask:number,missing:number){return [...readMask(questIndex,mask),`if work_8000 != ${mask}`,` talk message: ${missing}`,' finish_interaction','end'];}
export function questClueBody(questIndex:number,clueIndex:number,text:number,missing:number,repeat:number){
 const bit=1<<clueIndex,prior=bit-1;
 return ['lock',...readMask(questIndex,bit),`if work_8000 == ${bit}`,` talk message: ${repeat}`,' finish_interaction','end',...(prior?requireMask(questIndex,prior,missing):[]),`talk message: ${text}`,`work_or ${WORLD_QUEST_WORK[questIndex]}, ${bit}`,'finish_interaction'].join('\n');
}
export function questRepairBody(questIndex:number,repairIndex:number,text:number,missing:number,repeat:number){
 const bit=1<<(3+repairIndex);
 return ['lock',...requireMask(questIndex,7,missing),...readMask(questIndex,bit),`if work_8000 == ${bit}`,` talk message: ${repeat}`,' finish_interaction','end',`talk message: ${text}`,`work_or ${WORLD_QUEST_WORK[questIndex]}, ${bit}`,'finish_interaction'].join('\n');
}
export function questReportBody(questIndex:number,gymFlag:number|undefined,text:number,missing:number){
 const flag=WORLD_QUEST_FLAGS[questIndex],quest=WORLD_MYTHICAL_QUESTS[questIndex];
 return ['lock',`if flag_set?(${flag})`,`talk message: ${text}`,'finish_interaction','end','trainer_card_get_badge_count 0x8010',`if work_8010 < ${quest.badges}`,`talk message: ${missing}`,'finish_interaction','end',...requireMask(questIndex,63,missing),...(gymFlag!==undefined?[`unless flag_set?(${gymFlag})`,`talk message: ${missing}`,'finish_interaction','end']:[]),`set_flag ${flag}`,`talk message: ${text}`,'finish_interaction'].join('\n');
}
