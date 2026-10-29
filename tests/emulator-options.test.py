#!/usr/bin/env python3
"""Mock-only regressions: no ROM/core/live worker is opened."""
import ctypes as C
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
harness = load('options_harness', 'emulator-check.py')
runner = load('options_runner', 'playthrough-runner.py')
class Function:
    def __init__(self, callback=lambda *args: None): self.callback = callback
    def __call__(self, *args): return self.callback(*args)
class Core:
    def __init__(self, choices=b'CPU Cores; 1|2', query=True):
        self.calls=[]; self.env=None; self.query=query; self.choices=choices
        self.retro_set_environment=Function(lambda cb: setattr(self,'env',cb))
        self.retro_init=Function(self.init)
        self.retro_load_game=Function(self.load)
        for name in ['video_refresh','audio_sample','audio_sample_batch','input_poll','input_state']:
            setattr(self,'retro_set_'+name,Function())
        for name in ['serialize_size','serialize','unserialize','get_memory_size','get_memory_data','unload_game','deinit','run']:
            setattr(self,'retro_'+name,Function(lambda *a, n=name: self.calls.append(n)))
    def init(self):
        rows=(harness.Variable*3)()
        rows[0]=harness.Variable(b'desmume_num_cores',self.choices)
        rows[1]=harness.Variable(b'desmume_cpu_mode',b'CPU Mode; interpreter')
        self.env(16, C.cast(rows,C.c_void_p))
    def load(self,*args):
        self.calls.append('load')
        if self.query:
            row=harness.Variable(b'desmume_num_cores',None)
            self.env(15,C.cast(C.pointer(row),C.c_void_p))
        return True
class Tests(unittest.TestCase):
    def make(self, core, options=None):
        with patch.object(harness.C,'CDLL',return_value=core):
            return harness.Emulator(Path('mock-core'),Path('/tmp'),options=options)
    def test_default_preserved(self):
        e=self.make(Core()); self.assertEqual(e.requested_options,{})
        self.assertEqual(e.options[b'desmume_num_cores'],b'1')
        self.assertEqual(e.options[b'desmume_cpu_mode'],b'interpreter')
        self.assertEqual(e.options[b'desmume_internal_resolution'],b'256x192')
    def test_opt_in_two(self):
        core=Core();e=self.make(core,{b'desmume_num_cores':b'2'})
        e.load(Path('mock.nds'))
        self.assertEqual(e.queried_options[b'desmume_num_cores'],b'2')
        self.assertNotIn('run',core.calls)
    def test_unsupported_before_load(self):
        core=Core(choices=b'CPU Cores; 1')
        with self.assertRaisesRegex(RuntimeError,'Unsupported'):
            self.make(core,{b'desmume_num_cores':b'2'})
        self.assertNotIn('load',core.calls);self.assertIn('deinit',core.calls)
    def test_missing_query_before_restore(self):
        core=Core(query=False);e=self.make(core,{b'desmume_num_cores':b'2'})
        with self.assertRaisesRegex(RuntimeError,'not queried'):
            e.load(Path('mock.nds'),state=Path('must-not-read.state'))
        self.assertNotIn('unserialize',core.calls);self.assertNotIn('run',core.calls)
    def test_mismatched_query(self):
        e=self.make(Core(),{b'desmume_num_cores':b'2'})
        e.queried_options[b'desmume_num_cores']=b'1'
        with self.assertRaisesRegex(RuntimeError,'not queried'):e.validate_options()
    def test_resume_modes(self):
        for manifest,mode in [({},1),({'renderCores':1},1),({'renderCores':2},2)]:
            runner.validate_render_resume(manifest,mode)
        for manifest,mode in [({},2),({'renderCores':1},2),({'renderCores':2},1)]:
            with self.assertRaisesRegex(RuntimeError,'ordinary raw save'):
                runner.validate_render_resume(manifest,mode)
    def test_manifest_exact_hashes_and_query(self):
        e=self.make(Core(),{b'desmume_num_cores':b'2'});e.load(Path('mock.nds'))
        manifest={};runner.record_emulator_options(manifest,e,2)
        self.assertEqual(manifest['requestedCoreOptions'],{'desmume_num_cores':'2'})
        self.assertEqual(manifest['queriedCoreOptions'],{'desmume_num_cores':'2'})
        self.assertEqual(manifest['runnerSha256'],runner.sha(ROOT/'scripts/playthrough-runner.py'))
        self.assertEqual(manifest['harnessSha256'],runner.sha(ROOT/'scripts/emulator-check.py'))
        e.queried_options[b'desmume_num_cores']=b'1'
        with self.assertRaisesRegex(RuntimeError,'mismatch'):runner.record_emulator_options({},e,2)
    def test_main_resume_guard_before_core(self):
        import io
        for previous,mode,allowed in [(None,1,True),(None,2,False),(2,2,True),(2,1,False)]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();out=root/'out';out.mkdir()
                rom=root/'mock.nds';rom.write_bytes(b'mock')
                core=root/'.cache/emulator/desmume_libretro.dylib';core.parent.mkdir(parents=True);core.write_bytes(b'mock')
                (root/'scripts').mkdir();(root/'scripts/emulator-check.py').write_bytes(b'mock-harness')
                manifest={'romSha256':runner.sha(rom),'coreSha256':runner.sha(core)}
                if previous is not None:manifest['renderCores']=previous
                (out/'manifest.json').write_text(json.dumps(manifest))
                (out/'latest.state').write_bytes(b'mock-state')
                (out/'latest.json').write_text(json.dumps({'stateSha256':runner.sha(out/'latest.state'),'frame':42,'sequence':3}))
                (out/'timeline.jsonl').write_text('')
                fake=unittest.mock.Mock();fake.queried_options={b'desmume_num_cores':str(mode).encode()}
                with patch.object(runner,'ROOT',root),patch.object(runner.module,'Emulator',return_value=fake) as ctor,patch.object(sys,'argv',['runner',str(rom),'--out',str(out),'--resume','--render-cores',str(mode)]),patch.object(sys,'stdin',io.StringIO('{"quit":true}\n')),patch('sys.stdout',io.StringIO()):
                    if allowed:
                        runner.main()
                        fake.load.assert_called_once_with(rom,None,out/'latest.state')
                        self.assertEqual(fake.frame,42);fake.run.assert_not_called()
                    else:
                        with self.assertRaisesRegex(RuntimeError,'ordinary raw save'):runner.main()
                        ctor.assert_not_called()

    def test_main_default_and_opt_in(self):
        # Exercise real CLI/main setup, manifest write, readiness and orderly quit.
        import io
        for requested in [[],['--render-cores','2']]:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp).resolve();rom=root/'mock.nds';rom.write_bytes(b'mock')
                core=root/'.cache/emulator/desmume_libretro.dylib';core.parent.mkdir(parents=True);core.write_bytes(b'mock')
                (root/'scripts').mkdir()
                (root/'scripts/emulator-check.py').write_bytes((ROOT/'scripts/emulator-check.py').read_bytes())
                out=root/'out'; mode=2 if requested else 1
                fake=unittest.mock.Mock();fake.queried_options={b'desmume_num_cores':str(mode).encode()}
                with patch.object(runner,'ROOT',root),patch.object(runner.module,'Emulator',return_value=fake) as ctor,patch.object(sys,'argv',['runner',str(rom),'--out',str(out),*requested]),patch.object(sys,'stdin',io.StringIO('{"quit":true}\n')),patch('sys.stdout',io.StringIO()):
                    runner.main()
                ctor.assert_called_once_with(core,out,options={b'desmume_num_cores':str(mode).encode()})
                manifest=json.loads((out/'manifest.json').read_text())
                self.assertEqual(manifest['renderCores'],mode);fake.run.assert_not_called()
if __name__=='__main__':unittest.main()
