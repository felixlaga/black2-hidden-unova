#!/usr/bin/env python3
"""Explicit input validation with a mock emulator; no live session is opened."""
import copy
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
spec = importlib.util.spec_from_file_location('input_validation_runner', ROOT / 'scripts/playthrough-runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class InputValidation(unittest.TestCase):
    def test_canonical_names_and_no_mutation(self):
        actions = [{'frames': 2, 'buttons': ['A', 'SeLeCt', 'left', 'R'], 'touch': [3, 4]},
                   {'frames': 1}, {'frames': 3, 'buttons': list(runner.module.KEYS)}]
        original = copy.deepcopy(actions)
        prepared = runner.canonicalize_actions(actions)
        self.assertEqual(prepared[0]['buttons'], ['a', 'select', 'left', 'r'])
        self.assertEqual(prepared[2]['buttons'], list(runner.module.KEYS))
        self.assertEqual(actions, original)

    def exercise(self, request, rejected=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rom = root / 'game.nds'; rom.write_bytes(b'mock ROM')
            core = root / '.cache/emulator/desmume_libretro.dylib'
            core.parent.mkdir(parents=True); core.write_bytes(b'mock core')
            (root / 'scripts').mkdir()
            (root / 'scripts/emulator-check.py').write_bytes(b'mock harness')
            out = root / 'run'
            emu = Mock(); emu.frame = 0
            emu.queried_options = {b'desmume_num_cores': b'1'}
            calls = []
            def advance(frames, buttons, touch=None):
                calls.append((frames, buttons, touch)); emu.frame += frames
            emu.run.side_effect = advance
            emu.screenshot.side_effect = lambda path: path.write_bytes(b'image')
            emu.persist.side_effect = lambda path: (path / 'latest.state').write_bytes(b'state')
            with patch.object(runner, 'ROOT', root), patch.object(runner.module, 'Emulator', return_value=emu), \
                 patch.object(runner, 'read_position', return_value={'valid': False}), \
                 patch.object(sys, 'argv', ['runner', str(rom), '--out', str(out)]), \
                 patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n{"quit":true}\n')), \
                 patch('sys.stdout', io.StringIO()):
                if rejected:
                    with self.assertRaises(ValueError):
                        runner.main()
                    self.assertEqual(calls, [])
                    self.assertEqual(emu.frame, 0)
                    self.assertEqual((out / 'timeline.jsonl').read_text(), '')
                    return
                runner.main()
            result = json.loads((out / 'latest.json').read_text())
            self.assertEqual(result['request'], request)
            self.assertEqual(result['replayRequest']['actions'], [
                {'frames': frames, 'buttons': buttons, **({'touch': touch} if touch is not None else {})}
                for frames, buttons, touch in calls])
            return calls

    def test_mixed_batch_repeat_and_touch(self):
        request = {'repeat': 2, 'actions': [
            {'frames': 2, 'buttons': ['A', 'UP'], 'touch': [10, 20]},
            {'frames': 1, 'buttons': ['b', 'Start']}, {'frames': 3}]}
        self.assertEqual(self.exercise(request), [(2, ['a', 'up'], [10, 20]),
                         (1, ['b', 'start'], None), (3, [], None)] * 2)

    def test_unknown_later_button_refused_before_input(self):
        self.exercise({'actions': [{'frames': 2, 'buttons': ['A']},
                                   {'frames': 1, 'buttons': ['not-a-key']}]}, rejected=True)

    def test_malformed_later_actions_refused_before_input(self):
        invalid = [None, {}, {'frames': 'bad'}, {'frames': -1}, {'frames': True},
                   {'frames': 1, 'buttons': 'A'}, {'frames': 1, 'buttons': [1]},
                   {'frames': 1, 'touch': [1]}, {'frames': 1, 'touch': [256, 0]},
                   {'frames': 1, 'touch': [0, 192]}, {'frames': 1, 'touch': [True, 0]},
                   {'frames': 1, 'touch': [0, 1.5]}]
        for action in invalid:
            with self.subTest(action=action):
                self.exercise({'actions': [{'frames': 2}, action]}, rejected=True)

    def test_invalid_batch_and_repeat_refused_before_input(self):
        for request in [{'actions': {}}, {'actions': None},
                        *({'actions': [{'frames': 2}], 'repeat': value}
                          for value in [-1, True, '2', None])]:
            with self.subTest(request=request):
                self.exercise(request, rejected=True)

    def test_zero_frames_and_touch_bounds(self):
        request = {'actions': [{'frames': 0}, {'frames': 1, 'touch': [0, 0]},
                               {'frames': 1, 'touch': [255, 191]},
                               {'frames': 0, 'touch': None}]}
        self.assertEqual(self.exercise(request), [(0, [], None), (1, [], [0, 0]),
                                                  (1, [], [255, 191]), (0, [], None)])


if __name__ == '__main__':
    unittest.main()
