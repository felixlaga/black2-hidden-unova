"""Read-only inspection using production's native block descriptors."""
import argparse,binascii,gzip,hashlib,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'build/research-legacy-kyurem'
p=argparse.ArgumentParser();p.add_argument('path',type=Path);p.add_argument('--ram',action='store_true');p.add_argument('--out',type=Path);a=p.parse_args()
b=a.path.read_bytes();u16=lambda at:struct.unpack_from('<H',b,at)[0];u32=lambda at:struct.unpack_from('<I',b,at)[0]
sha=lambda data:hashlib.sha256(data).hexdigest();crc=lambda data:binascii.crc_hqx(data,0xffff)
flags=[0x1e0,0x390,0x29b,0x3eb,0x3ec,0xf9,0x1e1,0x1e3];work=[0x4072,0x411b,0x4020,0x4021,0x4022]
layout=json.loads((OUT/'native-save-layout.json').read_text())['rows']
def state(base):
 bag=base+0x18400
 items=[{'slot':i//4,'relativeOffset':hex(i),'id':u16(bag+i),'count':u16(bag+i+2)}for i in range(0,0x9ec,4)]
 return {'flags':{hex(i):bool(b[base+0x1ff00+862+i//8]&(1<<(i%8)))for i in flags},'work':{hex(i):u16(base+0x1ff00+2*(i-0x4000))for i in work},'caught':{str(i):bool(b[base+0x21408+(i-1)//8]&(1<<((i-1)%8)))for i in (644,646)},'partyCount':u32(base+0x18e04),'dnaSplicers':[i for i in items if i['id']==628],'masterBalls':[i for i in items if i['id']==1],'bagSha256':sha(b[bag:bag+0x9ec]),'position':struct.unpack_from('<Iiii',b,base+0x19580)}
result={'file':str(a.path),'sha256':sha(b),'readOnly':True,'ram':a.ram}
if a.ram:
 r=lambda addr:u32(addr-0x2000000)
 storage=r(r(r(r(0x2141800)+4))+0x10);base=r(storage+0x34)-0x2000000
 result.update(storage=hex(storage),nativeSaveBuffer=hex(base+0x2000000),livePosition=struct.unpack_from('<Iiii',b,0x23b444),state=state(base))
 if a.out:
  snap=a.out.with_suffix('.ram.gz')
  with snap.open('xb')as f:f.write(gzip.compress(b,mtime=0))
  assert gzip.decompress(snap.read_bytes())==b
  result['immutableRamSnapshot']=str(snap)
else:
 assert len(b)==0x80000
 result['halves']=[]
 for h in (0,0x26000):
  checks=[]
  for row in layout:
   index,offset,length=row['index'],row['offset'],row['length'];c=crc(b[h+offset:h+offset+length])
   checks.append({'index':index,'offset':hex(offset),'length':length,'expected':c,'block':u16(h+offset+length+2),'duplicate':u16(h+0x25f00+index*2),'valid':c==u16(h+offset+length+2)==u16(h+0x25f00+index*2)})
  table=crc(b[h+0x25f00:h+0x25f94])==u16(h+0x25fa2)
  assert all(c['valid']for c in checks)and table,{'half':h,'bad':[c for c in checks if not c['valid']],'table':table}
  result['halves'].append({'offset':h,'all73BlocksAndDuplicatesValid':True,'tableValid':table,'blocks':checks,**state(h)})
if a.out:
 with a.out.open('x')as f:json.dump(result,f,indent=2);f.write('\n')
summary={**result}
if 'halves'in summary:summary['halves']=[{k:v for k,v in h.items()if k!='blocks'}for h in summary['halves']]
print(json.dumps(summary,indent=2))
