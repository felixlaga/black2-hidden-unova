#!/usr/bin/env python3
"""Runner contract only: no core, ROM, live session or gameplay state is opened."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('autoturn_runner_test', ROOT/'scripts/playthrough-runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Integration(unittest.TestCase):
    def exercise(self, request, rejected=False, validation_error=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rom = root/'game.nds'; rom.write_bytes(b'mock ROM')
            core = root/'.cache/emulator/desmume_libretro.dylib'
            core.parent.mkdir(parents=True); core.write_bytes(b'mock core')
            (root/'scripts').mkdir()
            (root/'scripts/emulator-check.py').write_bytes(b'mock harness')
            out = root/'run'
            emu = Mock(); emu.frame = 0
            emu.queried_options = {b'desmume_num_cores': b'1'}
            calls = []
            def advance(frames, buttons, touch=None):
                calls.append((frames, buttons, touch)); emu.frame += frames
            emu.run.side_effect = advance
            emu.screenshot.side_effect = lambda path: path.write_bytes(b'mock image')
            def persist(directory):
                for name in ['latest.state','latest.sav','latest.ram']:
                    (directory/name).write_bytes(b'mock '+name.encode())
            emu.persist.side_effect = persist
            controller = Mock()
            controller.validate_auto_battle.side_effect = validation_error
            def automate(emu, config, run_input):
                run_input(6, [], touch=[60,105], source='autoturn', phase='submission')
                run_input(12, [], source='autoturn', phase='wait')
                return {'turns':1,'reason':'test-bound'}
            controller.run_auto_battle.side_effect = automate
            stdin = io.StringIO(json.dumps(request)+'\n{"quit":true}\n')
            with patch.object(runner,'ROOT',root), patch.object(runner.module,'Emulator',return_value=emu), \
                 patch.object(runner,'auto_battle_controller',return_value=(controller,'loaded-code-hash')) as load, \
                 patch.object(runner,'read_position',return_value={'valid':False}), \
                 patch.object(sys,'argv',['runner',str(rom),'--out',str(out)]), \
                 patch.object(sys,'stdin',stdin), patch('sys.stdout',io.StringIO()):
                if rejected:
                    with self.assertRaises(ValueError): runner.main()
                    emu.run.assert_not_called()
                    controller.run_auto_battle.assert_not_called()
                    return
                runner.main()
            result=json.loads((out/'latest.json').read_text())
            if 'autoBattle' in request:
                self.assertEqual(result['autoBattleControllerSha256'],'loaded-code-hash')
                self.assertEqual(result['autoBattle'],{'turns':1,'reason':'test-bound'})
                self.assertEqual(len(calls),2+len(request.get('actions',[])))
                self.assertEqual(result['replayRequest']['actions'][-2:],[
                    {'frames':6,'buttons':[],'touch':[60,105]}, {'frames':12,'buttons':[]}])
                events=[json.loads(line) for line in (out/'timeline.jsonl').read_text().splitlines()]
                auto_inputs=[e for e in events if e.get('source')=='autoturn']
                self.assertEqual([e['frames'] for e in auto_inputs],[6,12])
            else:
                load.assert_not_called(); self.assertNotIn('autoBattle',result)

    def test_auto_inputs_flat_replay_and_hash(self):
        self.exercise({'autoBattle':{},'label':'mock'})

    def test_existing_actions_then_auto(self):
        self.exercise({'actions':[{'frames':4,'buttons':['a']}],'autoBattle':{}})

    def test_invalid_auto_refuses_preceding_inputs(self):
        self.exercise({'actions':[{'frames':4}],'autoBattle':None},True,ValueError('invalid'))

    def test_walk_auto_combination_refused(self):
        self.exercise({'walk':[],'autoBattle':{}},True)

    def test_legacy_does_not_load_controller(self):
        self.exercise({'actions':[{'frames':4,'buttons':['a']}]})


if __name__ == '__main__': unittest.main()
