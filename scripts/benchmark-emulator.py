#!/usr/bin/env python3
"""Benchmark-only isolated core process. Never controls or resumes a live worker.
Instrument the existing harness in memory; no shared harness edits. Options must
be advertised. Hidden CPU mode is rejected as unsupported (no HAVE_JIT).
"""
import argparse, ctypes as C, hashlib, json, time, importlib.util, sys
sys.dont_write_bytecode = True
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1048576), b''): h.update(b)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--rom',type=Path,required=True); p.add_argument('--save',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True); p.add_argument('--options',default='{}')
    p.add_argument('--probe',action='store_true'); p.add_argument('--actions',type=Path)
    a=p.parse_args()
    boundary=(ROOT/'build/playthrough/speed-benchmark').resolve()
    if boundary not in a.out.resolve().parents or boundary not in a.save.resolve().parents:
        p.error('Output and copied input save must be inside benchmark-only directory')
    a.out.mkdir(parents=True,exist_ok=False)
    overrides={k.encode():str(v).encode() for k,v in json.loads(a.options).items()}
    advertised={}; displays={}; queried={}
    class Display(C.Structure): _fields_=[('key',C.c_char_p),('visible',C.c_bool)]
    def observe(command,data):
        if command==55:
            row=C.cast(data,C.POINTER(Display)).contents
            displays[row.key.decode()]=bool(row.visible)
        if command==16:
            rows=C.cast(data,C.POINTER(ns['Variable'])); i=0
            while rows[i].key:
                advertised[rows[i].key.decode()]=rows[i].value.decode(); i+=1
    source=(ROOT/'scripts/emulator-check.py').read_text()
    source=source.replace('self.buttons = set()','self.options.update(OVERRIDES)\n        self.buttons = set()',1)
    source=source.replace('command &= 0xFFFF','command &= 0xFFFF\n            OBSERVE(command, data)',1)
    source=source.replace('row.value = self.options.get(row.key)','row.value = self.options.get(row.key)\n                QUERIED[row.key.decode()] = row.value.decode() if row.value else None',1)
    ns={'__name__':'benchmark_harness','__file__':str(ROOT/'scripts/emulator-check.py'),'OVERRIDES':overrides,'OBSERVE':observe,'QUERIED':queried}
    exec(compile(source,str(ROOT/'scripts/emulator-check.py'),'exec'),ns)
    spec=importlib.util.spec_from_file_location('benchmark_readonly_runner',ROOT/'scripts/playthrough-runner.py')
    runner=importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
    core=ROOT/'.cache/emulator/desmume_libretro.dylib'
    report={'benchmarkOnly':True,'romPath':str(a.rom.resolve()),'romSha256':sha(a.rom),'coreSha256':sha(core),'inputSaveSha256':sha(a.save),'requestedOptions':json.loads(a.options),'advertised':advertised,'visibility':displays,'queried':queried,'segments':[]}
    def write(): (a.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    emu=ns['Emulator'](core,a.out)
    for key,value in json.loads(a.options).items():
        choices=advertised.get(key,'').split('; ',1)[-1].split('|')
        if str(value) not in choices: raise ValueError('Unadvertised option '+key)
    emu.load(a.rom,a.save)
    report['selectedOptions']={k.decode():v.decode() for k,v in emu.options.items()}
    write()
    if overrides.get(b'desmume_cpu_mode')==b'jit' and displays.get('desmume_cpu_mode') is False:
        raise RuntimeError('Core hides CPU mode: built without HAVE_JIT; refusing fallback benchmark')
    if not a.probe:
        actions=json.loads(a.actions.read_text()); report['actions']=actions
        for i,action in enumerate(actions):
            start=time.perf_counter(); emu.run(action['frames'],action.get('buttons',[])); elapsed=time.perf_counter()-start
            capture=a.out/f'segment-{i:02d}.png'; meta=emu.screenshot(capture)
            report['segments'].append({'index':i,'frames':action['frames'],'seconds':elapsed,'fps':action['frames']/elapsed,'imageSha256':sha(capture),'fieldReadOnly':runner.read_position(emu),**meta}); write()
    emu.lib.retro_unload_game(); emu.lib.retro_deinit()
    if emu.battery.exists():
        raw=emu.battery.read_bytes()[:524288]; (a.out/'unloaded-raw.sav').write_bytes(raw)
        report['unloadedRawSha256']=hashlib.sha256(raw).hexdigest(); report['rawUnchanged']=report['unloadedRawSha256']==report['inputSaveSha256']
    report['videoCalls']=emu.video_calls; write()
if __name__=='__main__': main()
