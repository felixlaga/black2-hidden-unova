"""Mock the actual runner loop: precise inputs, provenance, and atomic rejection."""
import hashlib
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


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


runner = load('runpath_integration_runner', ROOT / 'scripts/playthrough-runner.py')
fixture = load('runpath_unit_fixture', ROOT / 'tests/playthrough-runpath.test.py')


class Integration(unittest.TestCase):
    def exercise(self, request, rejected=False, blocked=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rom = root / 'game.nds'; rom.write_bytes(b'mock ROM')
            core = root / '.cache/emulator/desmume_libretro.dylib'
            core.parent.mkdir(parents=True); core.write_bytes(b'mock core')
            (root / 'scripts').mkdir()
            (root / 'scripts/emulator-check.py').write_bytes(b'mock harness')
            controller_bytes = (ROOT / 'scripts/playthrough-runpath.py').read_bytes()
            (root / 'scripts/playthrough-runpath.py').write_bytes(controller_bytes)
            out = root / 'run'
            movement = fixture.Mock(commit=1, delay=2, blocked=blocked)
            emu = Mock(); emu.frame = 0
            emu.queried_options = {b'desmume_num_cores': b'1'}
            calls = []

            def advance(frames, buttons, touch=None):
                calls.append((frames, list(buttons)))
                self.assertIsNone(touch)
                movement.input(frames, buttons, source='runPath')
                emu.frame += frames

            emu.run.side_effect = advance
            emu.screenshot.side_effect = lambda path: path.write_bytes(b'image')
            emu.persist.side_effect = lambda path: (path / 'latest.state').write_bytes(b'state')
            with patch.object(runner, 'ROOT', root), patch.object(runner, '_RUN_PATH', None), \
                 patch.object(runner.module, 'Emulator', return_value=emu), \
                 patch.object(runner, 'read_position', side_effect=movement.read), \
                 patch.object(sys, 'argv', ['runner', str(rom), '--out', str(out)]), \
                 patch.object(sys, 'stdin', io.StringIO(json.dumps(request) + '\n{"quit":true}\n')), \
                 patch('sys.stdout', io.StringIO()):
                if rejected:
                    with self.assertRaises(ValueError):
                        runner.main()
                    self.assertEqual(calls, [])
                    self.assertEqual((out / 'timeline.jsonl').read_text(), '')
                    return
                runner.main()
            result = json.loads((out / 'latest.json').read_text())
            events = [json.loads(line) for line in (out / 'timeline.jsonl').read_text().splitlines()]
            inputs = [event for event in events if event['event'] == 'input']
            self.assertEqual(len(inputs), emu.frame)
            self.assertTrue(all(event['source'] == 'runPath' and event['frames'] == 1 for event in inputs))
            self.assertEqual(result['replayRequest']['actions'], [
                {'frames': frames, 'buttons': buttons} for frames, buttons in calls])
            self.assertEqual(result['request'], request)
            self.assertEqual(result['runPathControllerSha256'], hashlib.sha256(controller_bytes).hexdigest())
            self.assertEqual(result['runPath']['frames'], emu.frame)
            return result

    def spec(self):
        return {'start': fixture.point(), 'waypoints': [fixture.point(2), fixture.point(2, 1)], 'maxFrames': 120}

    def test_real_controller_loop_replay_and_hash(self):
        result = self.exercise({'runPath': self.spec()})
        self.assertEqual(result['runPath']['status'], 'reached')
        self.assertEqual(result['runPath']['frames'], 26)
        self.assertEqual(result['runPath']['position']['actor'], {'x': 2, 'z': 1})

    def test_obstruction_checkpoints_without_false_success(self):
        result = self.exercise({'runPath': self.spec()}, blocked=True)
        self.assertEqual(result['runPath']['status'], 'stopped')
        self.assertEqual(result['runPath']['reason'], 'obstacle_or_no_control')

    def test_malformed_later_waypoint_zero_inputs(self):
        spec = self.spec(); spec['waypoints'][1]['header'] = 109
        self.exercise({'runPath': spec}, rejected=True)

    def test_modes_and_repeat_cannot_mix(self):
        for extra in ({'actions': [{'frames': 1}]}, {'walk': []}, {'autoBattle': {}}, {'repeat': 2}, {'repeat': 0}):
            with self.subTest(extra=extra):
                self.exercise({'runPath': self.spec(), **extra}, rejected=True)


if __name__ == '__main__':
    unittest.main()
