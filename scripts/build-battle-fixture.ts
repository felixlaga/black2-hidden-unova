/** Isolated runtime QA fixture. Never a release build or a player's save. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NintendoDSRom} from '../vendor/pokeweb-serverless/src/nds/rom';
import {NARC} from '../vendor/pokeweb-serverless/src/nds/narc';
import {readU16,readU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {installMapCameraTestWarp} from '../vendor/pokeweb-serverless/src/pokeweb/mapCameraTest';
import {applyTrainers} from './rom/trainers';
import {applyCampaignDefinitions,ORIGINAL_GYM_ACE_LEVELS,compileCampaignBody} from './rom/campaign';
import {applyWorld,worldEvents,worldNpc,worldText,WORLD_FIRST_ZONE} from './rom/world';
const mode=process.argv[2]??'gym';
if(!['gym','champion'].includes(mode))throw new Error('Use gym or champion');
const source=readFileSync('roms/pokemon-black2-us.nds'),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),baseHash=sha(source);
const rom=new NintendoDSRom(source,{fileData:'view'});
const trainers=applyTrainers(rom,{profile:'full-campaign',gymAceLevels:ORIGINAL_GYM_ACE_LEVELS});
const campaign=applyCampaignDefinitions(rom);
const world=applyWorld(rom,{probe:'geometry-headerless'}),map=world.firstMap as {headerId:number;scriptId:number;eventId:number;textBankId:number};
if(!map||map.headerId!==WORLD_FIRST_ZONE)throw new Error('This fixture requires the isolated first-map probe');
const scripts=new NARC(new Uint8Array(rom.getFileByName('a/0/5/6'))),events=new NARC(new Uint8Array(rom.getFileByName('a/1/2/6'))),texts=new NARC(new Uint8Array(rom.getFileByName('a/0/0/3')));
const gym=campaign.gyms['gym.bramblewick'];let body=gym.body,lines=[...gym.texts],trainerId=gym.trainerId;
if(mode==='champion'){
 trainerId=341;body=body.replace(`call_trainer_battle ${gym.trainerId}, 0, 0`,'call_trainer_battle 341, 0, 0');
 lines=['N awaits.','N: Show me what you and your partners have learned.','N: We will meet again.','N: Follow the road a little farther.','N: I heard your partners clearly. Thank you for this battle.'];
}
scripts.files[map.scriptId]=compileCampaignBody(body).bytes;events.files[map.eventId]=worldEvents([worldNpc(0,mode==='champion'?103:30,1,{x:15,z:25})]);texts.files[map.textBankId]=worldText(lines);
const save=readFileSync('vendor/pokeweb-serverless/src/assets/testbattle/test.sav');
const origin={zoneId:readU32(save,0x19580),gridX:readU16(save,0x19586),gridY:readU16(save,0x1958a),gridZ:readU16(save,0x1958e)};
const headers=new NARC(rom.getFileByName('a/0/1/2')).files[0],scriptId=readU16(headers,origin.zoneId*48+6),eventId=readU16(headers,origin.zoneId*48+22);
const warp=installMapCameraTestWarp(scripts.files[scriptId],events.files[eventId],origin,{zoneId:map.headerId,tileX:15,tileZ:26,height:0,facing:'up'});
scripts.files[scriptId]=warp.scripts;events.files[eventId]=warp.events;
for(const [path,arc]of[['a/0/5/6',scripts],['a/1/2/6',events],['a/0/0/3',texts]]as const)rom.files[rom.fileId(path)]=new Uint8Array(arc.save());
if(sha(source)!==baseHash)throw new Error('Fixture mutated source bytes');
mkdirSync('build',{recursive:true});const out=`build/battle-${mode}`,bytes=rom.save({preserveOriginalLength:true});writeFileSync(out+'.nds',bytes);writeFileSync(out+'.sav',save);writeFileSync(out+'.json',JSON.stringify({fixtureOnly:true,mode,baseHash,outputHash:sha(bytes),trainerId,flagId:gym.flagId,map,trainersProfile:trainers.profile},null,2)+'\n');console.log(JSON.stringify({fixtureOnly:true,out,trainerId,zone:map.headerId}));
