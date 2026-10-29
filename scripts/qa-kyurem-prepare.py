"""Isolated position edit with optional one-slot party capacity correction."""
import argparse,binascii,hashlib,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'build/research-legacy-kyurem'
SOURCE=ROOT/'build/research-legacy-runtime/immutable/stage1-cold-resave.sav'
b=SOURCE.read_bytes()
p=argparse.ArgumentParser();p.add_argument('--free-party-slot',action='store_true');args=p.parse_args()
sha=lambda x:hashlib.sha256(x).hexdigest()
assert sha(b)=='49cc9b097517f03bb7a082ffbff1c38d7ab9bf1866592dd67c3f850eff5d23b8'
o=bytearray(b);allowed=set();checks=[]
crc=lambda data:binascii.crc_hqx(data,0xffff)
u16=lambda data,at:struct.unpack_from('<H',data,at)[0]
for h in (0,0x26000):
 def validate(data):
  for offset,length,index in ((0x19500,0xa8,28),(0x18e00,0x534,26)):
   c=crc(data[h+offset:h+offset+length])
   assert u16(data,h+offset+length+2)==u16(data,h+0x25f00+index*2)==c
  assert crc(data[h+0x25f00:h+0x25f94])==u16(data,h+0x25fa2)
 validate(b)
 # Native map234 warp2 at (16.5,1.5) targets604 warp0. Stand two tiles south.
 struct.pack_into('<Iiii',o,h+0x19580,234,0x108000,0,0x38000)
 for at,size in ((h+0x19580,16),(h+0x195aa,2),(h+0x25f00+28*2,2),(h+0x25fa2,2)):allowed.update(range(at,at+size))
 c=crc(o[h+0x19500:h+0x195a8])
 struct.pack_into('<H',o,h+0x195aa,c);struct.pack_into('<H',o,h+0x25f00+28*2,c)
 if args.free_party_slot:
  assert struct.unpack_from('<I',o,h+0x18e04)[0]==6
  struct.pack_into('<I',o,h+0x18e04,5)
  at=h+0x18e08+5*220;o[at:at+220]=bytes(220)
  for at,size in ((h+0x18e04,4),(at,220),(h+0x19336,2),(h+0x25f00+26*2,2)):allowed.update(range(at,at+size))
  c=crc(o[h+0x18e00:h+0x19334]);struct.pack_into('<H',o,h+0x19336,c);struct.pack_into('<H',o,h+0x25f00+26*2,c)
 struct.pack_into('<H',o,h+0x25fa2,crc(o[h+0x25f00:h+0x25f94]))
 validate(o);checks.append({'half':h,'positionBlockAndDuplicateAndTableValidBeforeAndAfter':True})
diff=[{'offset':hex(i),'before':b[i],'after':o[i]}for i in range(len(b))if b[i]!=o[i]]
assert all(int(d['offset'],16)in allowed for d in diff)
name='initial-capture'if args.free_party_slot else 'initial-position'
with (OUT/(name+'.sav')).open('xb')as f:f.write(o)
report={'source':str(SOURCE),'sourceSha256':sha(b),'outputSha256':sha(o),'isolatedArtificialPreconditions':True,'naturalCampaignEvidence':False,'romModified':False,'onlyEdit':'position 234 x16.5 y0 z3.5'+('; party count6->5 and zero sixth Landorus record'if args.free_party_slot else '')+'; affected block CRCs and table CRCs in both halves','inheritedPartyAndBag':'Synthetic bundled high-level party and preexisting 900 Master Balls; no bag edits; PC boxes unchanged and full, including three inherited Kyurem records; not natural acquisition or balance evidence','checks':checks,'exactByteDiff':diff}
with (OUT/(name+'-diff.json')).open('x')as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps({k:v for k,v in report.items()if k!='exactByteDiff'},indent=2))
