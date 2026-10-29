/** Artificial legacy-state regression fixtures, never campaign progression.
 * Cold position overrides do not run entry initializers: the stage-2 test must
 * leave through native stairs to zone212 and reenter213 before interaction.
 * Only writes new save/evidence files under build/research-legacy-runtime. */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createQaSave,validateQaSaveChecksums,DEFAULT_QA_SAVE} from './qa-save';
import {readU16,writeU16,writeU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {getTestBattleConfig,refreshTestBattleSaveBlockChecksum} from '../vendor/pokeweb-serverless/src/pokeweb/testBattle';
const dir='build/research-legacy-runtime';mkdirSync(dir,{recursive:true});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function crc(b:Uint8Array){let v=0xffff;for(const n of b){v^=n<<8;for(let i=0;i<8;i++)v=((v<<1)^((v&0x8000)?0x1021:0))&0xffff;}return v;}
for(const stage of [1,2]){
 const path=`${dir}/stage${stage}.sav`;if(existsSync(path))throw Error('Existing fixture refused');
 const input=readFileSync(DEFAULT_QA_SAVE),opts={setCaught:[644],clearCaught:[646],setFlags:[0x3ec,...(stage===1?[0x29b]:[])],clearFlags:[0x1e0,0x390,0xf9,...(stage===2?[0x29b]:[])]};
 const result=createQaSave(input,opts),out=result.save,allowed=new Set<number>();
 const before=new Uint8Array(out),config=getTestBattleConfig('BW2');
 const allow=(at:number,len:number)=>{for(let i=0;i<len;i++)allowed.add(at+i);};
 for(const half of [0,0x26000]){
  if(crc(out.subarray(half+0x19500,half+0x195a8))!==readU16(out,half+0x195aa))throw Error('Invalid position CRC input');
  for(const [id,value]of[[0x4072,4],[0x411b,stage]]){const at=half+0x1ff00+2*(id-0x4000);writeU16(out,at,value);allow(at,2);}
  writeU32(out,half+0x19580,213);writeU32(out,half+0x19584,(16<<16)|0x8000);writeU32(out,half+0x19588,0);writeU32(out,half+0x1958c,(14<<16)|0x8000);allow(half+0x19580,16);
  for(const [offset,length,checksum,index]of[[0x1ff00,0x4e0,0x203e2,45],[0x19500,0xa8,0x195aa,28]]){
   refreshTestBattleSaveBlockChecksum(out,config.saveLayout,half,offset,length,checksum,index);allow(half+checksum,2);allow(half+0x25f00+index*2,2);
   if(crc(out.subarray(half+offset,half+offset+length))!==readU16(out,half+checksum))throw Error('Output block CRC');
  }allow(half+0x25fa2,2);
 }
 for(let i=0;i<out.length;i++)if(out[i]!==before[i]&&!allowed.has(i))throw Error('Unexpected save mutation');
 validateQaSaveChecksums(out,opts);
 writeFileSync(path,out);writeFileSync(`${dir}/stage${stage}.json`,JSON.stringify({fixtureOnly:true,naturalCampaignProof:false,romModified:false,stage,source:DEFAULT_QA_SAVE,sourceSha256:sha(input),outputSha256:sha(out),baseEdits:result.report.edits,workOverrides:{'4072':4,'411b':stage},positionOverride:{zone:213,x:16.5,y:0,z:14.5},checksumsVerified:true},null,2)+'\n');
 console.log(path,sha(out));
}
