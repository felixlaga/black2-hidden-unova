import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readU16,readU32} from '../vendor/pokeweb-serverless/src/nds/binary';
import {decryptPk5Party,decryptPk5Stored} from '../vendor/pokeweb-serverless/src/pokeweb/testBattleTeam';
const path=process.argv[2],out=process.argv[3],bytes=readFileSync(path);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const checksum=(b:Uint8Array)=>{let n=0;for(let at=8;at<136;at+=2)n=(n+readU16(b,at))&65535;return n;};
const row=(b:Uint8Array,encrypted:Uint8Array,where:string,offset:number)=>({where,offset,species:readU16(b,8),personality:readU32(b,0),checksum:readU16(b,6),checksumValid:checksum(b)===readU16(b,6),experience:readU32(b,0x10),encryptedSha256:sha(encrypted),nickname:Array.from({length:11},(_,i)=>readU16(b,0x48+i*2)).filter(c=>c!==0&&c!==0xffff).map(c=>String.fromCharCode(c)).join('')});
const halves=[];
for(const h of [0,0x26000]){
 const party=[];for(let s=0;s<readU32(bytes,h+0x18e04);s++){const at=h+0x18e08+s*220,e=new Uint8Array(bytes.subarray(at,at+220)),d=decryptPk5Party(e);party.push({...row(d,e,`party${s+1}`,at),level:d[0x8c]});}
 const kyurem=[];let occupied=0,invalid=0;
 for(let box=0;box<24;box++)for(let slot=0;slot<30;slot++){
  const at=h+0x400+box*0x1000+slot*136,e=new Uint8Array(bytes.subarray(at,at+136)),d=decryptPk5Stored(e);
  const species=readU16(d,8);if(species){occupied++;if(checksum(d)!==readU16(d,6))invalid++;}
  if(species===646)kyurem.push(row(d,e,`box${box+1} slot${slot+1}`,at));
 }
 if(invalid||party.some(p=>!p.checksumValid))throw Error('Invalid Pokemon checksum');
 halves.push({half:h,party,boxedOccupied:occupied,invalidBoxChecksums:invalid,kyurem});
}
const result={file:path,sha256:sha(bytes),readOnly:true,halves};
if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
