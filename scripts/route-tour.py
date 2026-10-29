#!/usr/bin/env python3
"""Long-lived, input-only route battle QA; read-only native save-work observation.

JSON commands on stdin. No emulated RAM writes, automatic battle wins, or
per-input savestates. Explicit checkpoints are diagnostic, never save proof.
"""
import argparse
import ctypes as C
import hashlib
import importlib.util
import itertools
import json
import difflib
import re
import subprocess
from pathlib import Path
import struct
import sys
import time
from PIL import Image, ImageOps

SPEC = importlib.util.spec_from_file_location('emulator_check', Path(__file__).with_name('emulator-check.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def pokemon(raw):
    p = bytearray(raw)
    u16 = lambda o: struct.unpack_from('<H', p, o)[0]
    pid = struct.unpack_from('<I', p)[0]
    if u16(4) & 3:
        return {'transientDecryptedRecord': True}
    for start, end, seed in [(8,136,u16(6)), (136,220,pid)]:
        for off in range(start,end,2):
            seed = (seed*0x41C64E6D+0x6073)&0xffffffff
            struct.pack_into('<H', p, off, u16(off) ^ (seed>>16))
    physical = bytes(p)
    order = list(itertools.permutations(range(4)))[((pid>>13)&31)%24]
    for source,destination in enumerate(order):
        p[8+32*destination:40+32*destination] = physical[8+32*source:40+32*source]
    if sum(struct.unpack_from('<64H',p,8))&0xffff != u16(6):
        raise RuntimeError('Party checksum failed')
    return dict(species=u16(8),level=p[0x8c],hp=u16(0x8e),maxHP=u16(0x90),
                moves=list(struct.unpack_from('<4H',p,0x28)), pp=list(p[0x30:0x34]))

def inspect_save(path):
    data=path.read_bytes()
    if len(data)!=0x80000:
        raise RuntimeError('Expected ordinary 512 KiB save')
    def crc(bytes_):
        value=0xffff
        for b in bytes_:
            value^=b<<8
            for _ in range(8): value=((value<<1)^(0x1021 if value&0x8000 else 0))&0xffff
        return value
    halves=[]
    for half in [0,0x26000]:
        u16=lambda p:struct.unpack_from('<H',data,half+p)[0]
        blocks=[]
        for name,off,size,footer,index in [('work',0x1ff00,0x4e0,0x203e2,45),('party',0x18e00,0x534,0x19336,26),('position',0x19500,0xa8,0x195aa,28)]:
            expected=crc(data[half+off:half+off+size])
            blocks.append(dict(name=name,crc=expected,footerCRC=u16(footer),tableCRC=u16(0x25f00+index*2),valid=expected==u16(footer)==u16(0x25f00+index*2)))
        flags=[bool(data[half+0x1ff00+862+(flag>>3)]&(1<<(flag&7))) for flag in range(0x93a,0x95e)]
        table=crc(data[half+0x25f00:half+0x25f94])
        halves.append(dict(offset=half,blocks=blocks,checksumTableValid=table==u16(0x25fa2),defeatedFlags=flags,
                           defeatedCount=sum(flags),partyCount=struct.unpack_from('<I',data,half+0x18e04)[0],
                           firstPokemon=pokemon(data[half+0x18e08:half+0x18e08+220]),
                           savedHeader=struct.unpack_from('<I',data,half+0x19580)[0],savedX=u16(0x19586),savedZ=u16(0x1958e)))
    return dict(path=str(path),sha256=sha(path),halves=halves,validatedBlocks=['work','party','position'],
                selectedBlocksChecksumsValid=all(h['checksumTableValid'] and all(b['valid'] for b in h['blocks']) for h in halves),
                checksumScope='Selected work/party/position block footers, table duplicates and both checksum-table CRCs; not all 74 data blocks.')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture',type=Path,default=Path('build/research-route-runtime/tour.json'))
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--rom',type=Path)
    parser.add_argument('--save',type=Path)
    parser.add_argument('--state',type=Path)
    parser.add_argument('--source-relation',type=Path)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    if (args.out/'manifest.json').exists(): raise RuntimeError('Use a new session output directory')
    fixture=json.loads(args.fixture.read_text())
    rom=args.rom or args.fixture.with_suffix('.nds')
    rom_hash=sha(rom)
    if not args.rom and rom_hash!=fixture['romSha256']: raise RuntimeError('Fixture ROM hash mismatch')
    if args.rom:
        production_report=json.loads(rom.with_suffix('.json').read_text())
        if production_report['outputSha256']!=rom_hash:raise RuntimeError('Production ROM/report mismatch')
        if rom_hash!=fixture['sourceSha256']:
            if not args.source_relation:raise RuntimeError('Changed production source needs a verified component relationship')
            relation=json.loads(args.source_relation.read_text())
            if not relation['componentsEqual'] or relation['comparisonSourceSha256']!=rom_hash or relation['fixtureSourceSha256']!=fixture['sourceSha256']:
                raise RuntimeError('Production component relationship mismatch')
    save=args.save or args.fixture.with_suffix('.sav')
    core=Path(__file__).resolve().parents[1]/'.cache/emulator/desmume_libretro.dylib'
    manifest=dict(romPath=str(rom),romSha256=rom_hash,sourceSha256=rom_hash if args.rom else fixture['sourceSha256'],
                  fixtureSourceSha256=fixture['sourceSha256'],romIsQaFixture=not bool(args.rom),sourceRelationPath=str(args.source_relation) if args.source_relation else None,
                  coreSha256=sha(core),harnessSha256=sha(Path(__file__)),
                  savePath=str(save),saveSha256=sha(save),statePath=str(args.state) if args.state else None,
                  coldBoot=not bool(args.state),fixtureOnly=True,naturalCampaignProof=False,balanceProof=False,
                  syntheticParty=True,transportHealing=fixture['transportHealing'] if not args.rom else False,ramWrites=False)
    (args.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    emulator=MODULE.Emulator(core,args.out)
    emulator.load(rom,save,args.state)
    pointer=emulator.lib.retro_get_memory_data(2)
    if not pointer or emulator.lib.retro_get_memory_size(2)!=0x400000: raise RuntimeError('Unexpected RAM interface')
    sequence=0
    records=[]
    def read(address,size):
        offset=address-0x02000000
        if offset<0 or offset+size>0x400000: raise RuntimeError(f'Invalid observed pointer {address:x}')
        return C.string_at(pointer+offset,size)
    def r32(address): return struct.unpack('<I',read(address,4))[0]
    def observe():
        beacon=r32(0x02141800)
        game=r32(beacon+4)
        storage=r32(r32(game)+0x10)
        directory=r32(storage+0x2c)
        table=r32(directory+0x14)
        def block(index): return r32(storage+0x34)+r32(table+index*12+8)
        work=block(45)
        party=block(26)
        if r32(game+0x194)!=party: raise RuntimeError('Party/save directory pointer mismatch')
        count=r32(party+4)
        if not 0<=count<=6: raise RuntimeError('Invalid party count')
        flagbytes=read(work+862+(0x93a>>3),6)
        flags=[bool(flagbytes[(f>>3)-(0x93a>>3)]&(1<<(f&7))) for f in range(0x93a,0x95e)]
        current,x,y,z=struct.unpack('<Iiii',read(0x0223B444,16))
        cache=r32(0x02246820)
        mons=[pokemon(read(party+8+i*220,220)) for i in range(count)]
        return dict(frame=emulator.frame,header=current,headerCache=cache,positionHeaderAgrees=current==cache,
                    x=x//65536,z=z//65536,defeatedFlags=flags,defeatedCount=sum(flags),party=mons)
    def publish(label):
        nonlocal sequence
        sequence+=1
        filename=f'{sequence:04d}-{label}.png'
        video=emulator.screenshot(args.out/filename)
        try: observation=observe()
        except Exception as e: observation={'observationError':str(e),'frame':emulator.frame}
        row=dict(sequence=sequence,label=label,screenshot=filename,**video,**observation)
        with (args.out/'observations.jsonl').open('a') as out: out.write(json.dumps(row)+'\n')
        (args.out/'latest.json').write_text(json.dumps(row,indent=2)+'\n')
        return row
    def run(frames,buttons=(),touch=None):
        with (args.out/'inputs.jsonl').open('a') as out:
            out.write(json.dumps(dict(startFrame=emulator.frame,frames=frames,buttons=buttons,touch=touch))+'\n')
        emulator.run(frames,buttons,touch)
    def press(button,wait=180): run(3,[button]);run(wait)
    def checkpoint(label):
        target=args.out/label
        target.mkdir(exist_ok=True)
        emulator.persist(target)
        return str(target)
    def ui(row):
        with Image.open(args.out/row['screenshot']) as im:
            a,b,c=im.getpixel((190,235)),im.getpixel((10,280)),im.getpixel((10,220))
            if a[0]>150 and a[1]<40 and a[2]<50: return 'fight'
            if a==(57,56,57) and b[0]>100 and b[1]<100: return 'moves'
            if c==(41,32,41):
                white=im.getpixel((5,15))
                return 'field_dialogue' if min(white)>210 else 'field'
            return 'battle_or_transition'
    def foe_and_move(scene,row,weak=False):
        if weak:return 'artificial Magikarp Splash',1,''
        with Image.open(args.out/row['screenshot']) as im:
            name=im.crop((17,30,82,40)).convert('RGB').point(lambda v:255 if v>190 else 0).convert('L').point(lambda v:0 if v>240 else 255)
            name=ImageOps.expand(name.resize((650,100),Image.Resampling.NEAREST),border=20,fill=255)
            name.save(args.out/'ocr-current.png')
        readout=subprocess.run(['tesseract',str(args.out/'ocr-current.png'),'stdout','--psm','7','-c','tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'],capture_output=True,text=True,check=True).stdout.strip()
        token=re.sub('[^a-z]','',readout.lower())
        names=[p['species'] for p in scene['team']]
        scores=[(difflib.SequenceMatcher(None,token,re.sub('[^a-z]','',name.lower())).ratio(),name) for name in names]
        score,name=max(scores)
        if score<.5:raise RuntimeError(f'Opponent OCR needs manual inspection: {readout}; expected {names}')
        moves={
          1:'Timburr Nidorina Roselia Golbat Gurdurr Sawk Heracross Mienshao Rapidash Arcanine Torkoal',
          2:'Sewaddle Deerling Skiploom Maractus Palpitoad Sawsbuck Krokorok Sandslash Sunflora Claydol Abomasnow Altaria Gligar Dugtrio Stunfisk Ludicolo',
          3:'Herdier Sentret Roggenrola Boldore Graveler Lairon Kecleon Nosepass Magneton Stoutland Glaceon Beartic Gigalith Steelix Crustle Lapras Relicanth Carracosta Klang Magcargo',
          4:'Buizel Combee Tranquill Lombre Pikachu Basculin Quagsire Lanturn Castform Pelipper Masquerain Camerupt Dewgong Floatzel Dodrio Swoobat Bronzong Golduck Noctowl Drifblim Leavanny Ampharos Gastrodon Lumineon Cloyster Starmie Octillery Unfezant Skarmory Braviary Espeon Bellossom Xatu Volbeat Illumise Chandelure Whiscash Eelektross Azumarill Walrein Emolga Mandibuzz Poliwrath Seaking Kingler Mantine',
        }
        # Neutral, reliable alternatives for Ground/Water and electric immunities.
        overrides={'Quagsire':1,'Lanturn':1,'Camerupt':1,'Bronzong':3,'Ampharos':1,'Gastrodon':1,'Whiscash':1,'Eelektross':1,'Pikachu':1,'Lombre':2,'Bellossom':2,'Leavanny':2,'Chandelure':4,'Crustle':1,'Lapras':4}
        move=overrides.get(name,next((m for m,n in moves.items() if name in n.split()),2))
        return name,move,readout
    def fight(scene,weak=False):
        index=scene['trainerId']-842
        before=observe()
        if before['defeatedFlags'][index]:raise RuntimeError('Trainer already defeated before native fight')
        if (before['header'],before['x'],before['z'])!=(scene['headerId'],scene['tileX'],scene['tileZ']):raise RuntimeError('Wrong trainer approach position')
        attempts=[]
        seen_battle=False
        press('a')
        for step in range(160):
            row=publish(f"{scene['trainerId']}-battle-{step:03d}")
            mode=ui(row)
            if row['defeatedFlags'][index]:
                if not seen_battle or not attempts: raise RuntimeError('Flag without observed native battle')
                if mode!='field_dialogue' or row['header']!=scene['headerId']:
                    raise RuntimeError('Flag set without completed native battle and field return')
                expected=before['defeatedFlags'].copy();expected[index]=True
                if row['defeatedFlags']!=expected:raise RuntimeError('Unexpected trainer flag changes')
                return dict(trainerId=scene['trainerId'],name=scene['name'],nativeWin=True,before=before,after=row,attacks=attempts)
            if row['defeatedFlags']!=before['defeatedFlags']:raise RuntimeError('Flag changed before native win')
            if seen_battle and row.get('header')!=scene['headerId'] and mode.startswith('field'):
                if row['party'][0]['hp']!=0:raise RuntimeError('Loss recovery lacked observed fainted party')
                loss=dict(trainerId=scene['trainerId'],nativeLoss=True,before=before,after=row,attacks=attempts)
                (args.out/f'{scene["trainerId"]}-native-loss.json').write_text(json.dumps(loss,indent=2)+'\n')
                if weak:return loss
                raise RuntimeError(f'Actual native loss to {scene["trainerId"]}; flag remains clear; stop for recovery')
            if mode=='fight':
                seen_battle=True
                run(3,touch=[190,55]);run(90)
            elif mode=='moves':
                seen_battle=True
                name,move,readout=foe_and_move(scene,row,weak)
                attempts.append(dict(frame=emulator.frame,opponent=name,moveSlot=move,ocr=readout,screenshot=row['screenshot']))
                run(3,touch={1:[60,55],2:[190,55],3:[60,105],4:[190,105]}[move]);run(420)
            else:
                press('a',240)
        raise RuntimeError(f'Native battle exceeded bounded inputs: {scene["trainerId"]}')
    def dismiss(label):
        for i in range(10):
            row=publish(f'{label}-{i}')
            mode=ui(row)
            if mode=='field':return row
            if mode!='field_dialogue':raise RuntimeError(f'Expected field dialogue, got {mode}')
            press('a',120)
        raise RuntimeError('Dialogue did not close')
    def repeat(scene):
        before=dismiss(f'{scene["trainerId"]}-win-dismiss')
        press('a')
        row=publish(f'{scene["trainerId"]}-repeat')
        if ui(row)!='field_dialogue':raise RuntimeError('Repeat interaction did not show field dialogue')
        after=dismiss(f'{scene["trainerId"]}-repeat-dismiss')
        run(300)
        settled=publish(f'{scene["trainerId"]}-repeat-settled')
        if ui(settled)!='field' or settled['defeatedFlags']!=before['defeatedFlags'] or settled['party']!=before['party']:
            raise RuntimeError('Repeat interaction changed flags/party or left field')
        return dict(dialogue=row['screenshot'],settled=settled['screenshot'],noBattle=True,partyAndFlagsUnchanged=True)
    def tour(start,end):
        for index in range(start,end):
            scene=fixture['scenes'][index]
            current=observe()
            if current['header']!=scene['headerId']:
                run(15,['down']);run(240)
            arrival=publish(f'{scene["trainerId"]}-arrival')
            if (arrival['header'],arrival['x'],arrival['z'])!=(scene['headerId'],scene['tileX'],scene['tileZ']):raise RuntimeError('QA transport failed')
            record=fight(scene)
            record['repeat']=repeat(scene)
            record['arrival']=arrival
            record['artificialTransportHeal']=True
            records.append(record)
            (args.out/'results.json').write_text(json.dumps(dict(records=records,completed=len(records),**manifest),indent=2)+'\n')
            print(json.dumps({'completedTrainer':scene['trainerId'],'completedInSession':len(records),'defeatedCount':observe()['defeatedCount']}),flush=True)
    print(json.dumps({'ready':True,**manifest}),flush=True)
    for line in sys.stdin:
        try:
            request=json.loads(line)
            label=request.get('label','capture')
            if request.get('boot'):
                run(600)
                for _ in range(5):press('a')
                run(600)
            for action in request.get('actions',[]): run(action['frames'],action.get('buttons',[]),action.get('touch'))
            if 'tour' in request:tour(*request['tour'])
            if 'fight' in request:
                record=fight(fixture['scenes'][request['fight']],request.get('weak',False))
                (args.out/(label+'-battle.json')).write_text(json.dumps(record,indent=2)+'\n')
                print(json.dumps(record),flush=True)
            if 'repeat' in request:
                record=repeat(fixture['scenes'][request['repeat']])
                (args.out/(label+'-repeat.json')).write_text(json.dumps(record,indent=2)+'\n')
            if request.get('checkpoint'): checkpoint(request['checkpoint'])
            if request.get('inspectSave'):
                result=inspect_save(Path(request['inspectSave']))
                (args.out/(label+'-save.json')).write_text(json.dumps(result,indent=2)+'\n')
                print(json.dumps(result),flush=True)
            result=publish(label)
            print(json.dumps(result),flush=True)
            if request.get('quit'):break
        except Exception as error:
            try: result=publish('error')
            except Exception: result=None
            print(json.dumps({'error':str(error),'capture':result}),flush=True)
    emulator.lib.retro_unload_game()
    emulator.lib.retro_deinit()

if __name__=='__main__':main()
