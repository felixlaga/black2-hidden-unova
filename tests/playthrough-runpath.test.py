import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('runpath', Path(__file__).resolve().parents[1] / 'scripts/playthrough-runpath.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def point(x=0, z=0):
    return {'header': 108, 'x': x, 'z': z}


class Mock:
    def __init__(self, duration=8, commit=1, delay=0, blocked=False, fault=None):
        self.p = {'valid': True, 'header': 108, 'verifiedHeader': 108,
                  'x': 0, 'z': 0, 'raw': {'x': 32768, 'y': 0, 'z': 32768},
                  'actor': {'x': 0, 'z': 0},
                  'chain': {k: 0x02001000 + i * 4 for i, k in enumerate(sorted(m.CHAIN_KEYS))}}
        self.duration, self.commit, self.delay = duration, commit, delay
        self.blocked, self.fault = blocked, fault
        self.calls = []
        self.motion = None

    def read(self, emu):
        return copy.deepcopy(self.p)

    def input(self, frames, buttons, **context):
        assert frames == 1 and context['source'] == 'runPath'
        assert not buttons or buttons[0] == 'b'
        self.calls.append((list(buttons), copy.deepcopy(self.p)))
        if self.motion is None and buttons and not self.blocked:
            if self.delay:
                self.delay -= 1
                return
            axis, sign = {'right': ('x', 1), 'left': ('x', -1), 'down': ('z', 1), 'up': ('z', -1)}[buttons[1]]
            self.motion = [axis, sign, self.p['raw'][axis], self.p['actor'][axis], 0]
        if self.motion:
            axis, sign, raw, tile, tick = self.motion
            tick += 1
            self.p['raw'][axis] = raw + sign * (65536 * tick // self.duration)
            self.p['raw']['y'] += 64  # Stairs may change height.
            if tick >= self.commit:
                self.p['actor'][axis] = tile + sign
            self.motion[-1] = tick
            if tick == self.duration:
                self.motion = None
        for k in ('x', 'z'):
            self.p[k] = self.p['raw'][k] // 65536
        if self.fault:
            self.fault(self)
        return {'ignored': True}


class RunPathTests(unittest.TestCase):
    def run_mock(self, mock, **changes):
        request = {'start': point(), 'waypoints': [point(2), point(2, 1)], **changes}
        return m.run_path(object(), request, mock.input, mock.read)

    def test_early_and_middle_commit_coast_and_turn(self):
        for commit in (1, 4, 8):
            mock = Mock(commit=commit, delay=3)
            result = self.run_mock(mock)
            self.assertEqual(result['status'], 'reached')
            self.assertEqual(result['frames'], 27)
            for buttons, before in mock.calls:
                if buttons:
                    # Any new direction starts from exact raw center.
                    if buttons[1] == 'down':
                        self.assertEqual(before['raw']['x'], 2 * 65536 + 32768)
                    self.assertEqual(before['actor']['z'], 0)
            self.assertEqual(result['remainingWaypoints'], [])

    def test_slow_stairs(self):
        result = self.run_mock(Mock(duration=64, commit=1))
        self.assertEqual(result['status'], 'reached')
        self.assertEqual(result['frames'], 192)

    def test_obstruction_no_retries(self):
        mock = Mock(blocked=True)
        result = self.run_mock(mock)
        self.assertEqual(result['reason'], 'obstacle_or_no_control')
        self.assertEqual(result['frames'], 32)

    def test_actor_arrival_is_not_reached(self):
        mock = Mock(duration=64)
        result = self.run_mock(mock, waypoints=[point(1)], maxFrames=2)
        self.assertEqual(result['status'], 'stopped')
        self.assertEqual(result['reachedWaypoints'], 0)
        self.assertEqual(mock.calls[-1][0], [])

    def test_start_unsettled_zero_input(self):
        mock = Mock()
        mock.p['raw']['x'] += 1
        self.assertEqual(self.run_mock(mock)['status'], 'stopped')
        self.assertEqual(mock.calls, [])

    def test_malformed_paths_zero_input(self):
        invalid = [
            {'waypoints': [point(1), point(2, 1)]},
            {'waypoints': [point(1), dict(point(2), extra=0)]},
            {'waypoints': []}, {'waypoints': [point()]},
            {'waypoints': [point(65)]}, {'waypoints': [point(1, 1)]},
            {'maxFrames': 601}, {'maxFrames': True},
            {'start': point(True)}, {'waypoints': [dict(point(1), header=109)]},
            {'waypoints': [point(32768)]}, {'extra': 1},
        ]
        for changes in invalid:
            mock = Mock()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.run_mock(mock, **changes)
            self.assertEqual(mock.calls, [])

    def test_field_and_motion_faults(self):
        def chain(mock):
            mock.p['chain']['actor'] += 4
        def header(mock):
            mock.p['header'] = 109
        def invalid(mock):
            mock.p['valid'] = False
        def sideways(mock):
            mock.p['raw']['z'] += 1
        def overshoot(mock):
            mock.p['raw']['x'] += 2 * 65536
            mock.p['x'] = mock.p['raw']['x'] // 65536
        def wrong_actor(mock):
            mock.p['actor']['z'] = 1
        for fault in (chain, header, invalid, sideways, overshoot, wrong_actor):
            mock = Mock(fault=fault)
            result = self.run_mock(mock)
            self.assertEqual(result['status'], 'stopped')
            self.assertEqual(result['frames'], 1)

    def test_reverse_motion(self):
        def reverse(mock):
            if len(mock.calls) == 2:
                mock.p['raw']['x'] -= 12000
                mock.p['x'] = mock.p['raw']['x'] // 65536
        self.assertEqual(self.run_mock(Mock(fault=reverse))['reason'], 'unexpected_movement')

    def test_committed_but_frozen_never_reached(self):
        def freeze(mock):
            if len(mock.calls) > 1:
                mock.p['raw']['x'] = 32768 + 8192
                mock.p['x'] = 0
        mock = Mock(fault=freeze)
        result = self.run_mock(mock, waypoints=[point(1)])
        self.assertEqual(result['reason'], 'obstacle_or_no_control')
        self.assertEqual(result['reachedWaypoints'], 0)
        self.assertTrue(all(not buttons for buttons, _ in mock.calls[1:]))

    def test_invalid_initial_chain(self):
        mock = Mock()
        mock.p['chain']['actor'] = 0
        self.assertEqual(self.run_mock(mock)['reason'], 'invalid_chain')
        self.assertEqual(mock.calls, [])

    def test_negative_direction(self):
        self.assertEqual(self.run_mock(Mock(), waypoints=[point(-2), point(-2, -1)])['status'], 'reached')

    def test_step_and_total_limits(self):
        result = self.run_mock(Mock(duration=128), waypoints=[point(1)])
        self.assertEqual(result['reason'], 'step_limit')
        self.assertEqual(result['frames'], 96)
        result = self.run_mock(Mock(), waypoints=[point(64)])
        self.assertEqual(result['status'], 'reached')
        self.assertEqual(result['frames'], 512)
        result = self.run_mock(Mock(duration=16), waypoints=[point(64)])
        self.assertEqual(result['reason'], 'frame_limit')
        self.assertEqual(result['frames'], 600)


if __name__ == '__main__':
    unittest.main()
