#!/usr/bin/env python3
"""Tiny mocked failure-path checks; no native core, real ROM, or emulator proof.

    PYTHONDONTWRITEBYTECODE=1 python3 tests/world-tour-harness.test.py
"""
import errno
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('world_tour', ROOT / 'scripts/world-tour.py')
tour = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tour)


class WorldTourHarnessTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='world-tour-harness-')
        self.addCleanup(directory.cleanup)
        self.base = Path(directory.name)
        self.out = self.base / 'report'
        self.fixture = self.base / 'tour.json'
        self.rom = b'tiny fake ROM; never passed to a native core'
        self.data = {'sourceSha256': 'fake-source',
                     'romSha256': tour.hashlib.sha256(self.rom).hexdigest(),
                     'original': {'zoneId': 123}, 'scenes': []}
        self.write_fixture()
        self.emulator = mock.Mock()
        self.emulator.lib.retro_get_memory_data.return_value = 0x1000
        self.emulator.lib.retro_get_memory_size.return_value = 0x400000
        self.emulator.screenshot.return_value = {'width': 20, 'height': 40}
        self.constructor = mock.Mock(return_value=self.emulator)
        self.loader = mock.Mock()
        self.patch(tour.importlib.util, 'spec_from_file_location',
                   return_value=SimpleNamespace(loader=self.loader))
        self.patch(tour.importlib.util, 'module_from_spec',
                   return_value=SimpleNamespace(Emulator=self.constructor))
        rendered = mock.MagicMock(width=20, height=40)
        rendered.__enter__.return_value = rendered
        rendered.crop.return_value = rendered
        rendered.convert.return_value = rendered
        rendered.getcolors.return_value = [(1, (n, n, n)) for n in range(20)]
        pillow = mock.patch.dict(sys.modules, {'PIL': SimpleNamespace(
            Image=SimpleNamespace(open=mock.Mock(return_value=rendered)))})
        pillow.start()
        self.addCleanup(pillow.stop)
        self.memory = self.patch(tour.C, 'string_at', side_effect=self.read_memory)
        self.read_bytes = self.patch(Path, 'read_bytes', autospec=True,
                                     side_effect=self.read_fake_file)
        self.stderr, self.stdout = io.StringIO(), io.StringIO()

    def patch(self, target, name, **kwargs):
        patcher = mock.patch.object(target, name, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def write_fixture(self):
        self.fixture.write_text(json.dumps(self.data))

    def read_fake_file(self, path):
        if path == self.fixture.with_suffix('.nds'):
            return self.rom
        if path == ROOT / '.cache/emulator/desmume_libretro.dylib':
            return b'tiny fake core'
        raise AssertionError(f'Unexpected file read: {path}')

    def read_memory(self, address, size):
        if (address, size) == (0x1000 + 0x246820, 4):
            return struct.pack('<I', 123)
        if (address, size) == (0x1000 + 0x23B444, 16):
            return struct.pack('<Iiii', 123, 5 * 65536, 0, 6 * 65536)
        raise AssertionError(f'Unexpected RAM read: {address:#x}/{size}')

    def invoke(self):
        with mock.patch.object(sys, 'argv', ['world-tour.py', '--fixture', str(self.fixture),
                                            '--out', str(self.out)]), \
                mock.patch.object(sys, 'stderr', self.stderr), \
                mock.patch.object(sys, 'stdout', self.stdout):
            tour.main()

    def report(self):
        return json.loads((self.out / 'result.json').read_text())

    def assert_failure(self, report, text):
        self.assertIs(report['pass'], False)
        self.assertIn(text, report['failure'])

    def fail_write(self, names):
        write_text = Path.write_text
        error = OSError(errno.ENOSPC, 'No space left on device')
        def write(path, *args, **kwargs):
            if path.name in names:
                raise error
            return write_text(path, *args, **kwargs)
        self.patch(Path, 'write_text', autospec=True, side_effect=write)
        return error

    def test_mock_success_keeps_boot_and_return_inputs(self):
        self.invoke()
        report = self.report()
        self.assertIs(report['pass'], True)
        self.assertIsNone(report['failure'])
        self.assertEqual(report['finalizationErrors'], [])
        self.assertEqual(report['fixtureSha256'], self.data['romSha256'])
        self.assertEqual(report['finalObservedZone'], 123)
        self.assertIs(report['naturalCampaignProof'], False)
        self.assertEqual(self.emulator.run.call_args_list,
                         [mock.call(600)] + [mock.call(3, ['a']), mock.call(180)] * 5 +
                         [mock.call(600), mock.call(15, ['down']), mock.call(240)])
        self.emulator.persist.assert_called_once_with(self.out)
        self.assertFalse((self.out / 'result.json.tmp').exists())
        self.assertEqual(self.stderr.getvalue(), '')

    def test_malformed_fixture_reports_without_constructing_emulator(self):
        for index, content in enumerate(('{', 'null', '[]', '{}', '{"scenes":null}')):
            with self.subTest(content=content):
                self.out = self.base / f'malformed-{index}'
                self.fixture.write_text(content)
                with self.assertRaises((ValueError, AttributeError, KeyError, TypeError)) as caught:
                    self.invoke()
                self.assert_failure(self.report(), str(caught.exception))
                self.assertEqual(self.report()['finalizationErrors'], [])
        self.constructor.assert_not_called()
        self.memory.assert_not_called()

    def test_rom_hash_mismatch_is_a_reported_bootstrap_failure(self):
        self.data['romSha256'] = 'wrong'
        self.write_fixture()
        with self.assertRaisesRegex(RuntimeError, 'Tour ROM hash mismatch'):
            self.invoke()
        self.assert_failure(self.report(), 'Tour ROM hash mismatch')
        self.constructor.assert_not_called()

    def test_missing_source_provenance_is_a_reported_failure(self):
        del self.data['sourceSha256']
        self.write_fixture()
        with self.assertRaisesRegex(KeyError, 'sourceSha256'):
            self.invoke()
        report = self.report()
        self.assert_failure(report, 'sourceSha256')
        self.assertIsNone(report['sourceSha256'])
        self.assertEqual(report['finalizationErrors'], [])
        self.constructor.assert_not_called()

    def test_import_constructor_and_load_failures_preserve_exception(self):
        for stage, target in (('import', self.loader.exec_module),
                              ('constructor', self.constructor), ('load', self.emulator.load)):
            with self.subTest(stage=stage):
                self.out = self.base / stage
                primary = RuntimeError(f'{stage} failed')
                target.side_effect = primary
                with self.assertRaises(RuntimeError) as caught:
                    self.invoke()
                self.assertIs(caught.exception, primary)
                self.assert_failure(self.report(), str(primary))
                self.assertIsNone(self.report()['finalObservedZone'])
                self.emulator.screenshot.assert_not_called()
                self.emulator.persist.assert_not_called()
                self.memory.assert_not_called()
                target.side_effect = None

    def test_invalid_ram_interface_is_never_read(self):
        self.emulator.lib.retro_get_memory_size.return_value = 8
        with self.assertRaisesRegex(RuntimeError, 'Unexpected DS RAM interface'):
            self.invoke()
        self.assert_failure(self.report(), 'Unexpected DS RAM interface')
        self.assertIsNone(self.report()['finalObservedZone'])
        self.memory.assert_not_called()

    def test_boot_failure_survives_screenshot_and_persist_failures(self):
        primary = RuntimeError('first boot run failed')
        self.emulator.run.side_effect = primary
        self.emulator.screenshot.side_effect = OSError('screenshot failed')
        self.emulator.persist.side_effect = OSError('persist failed')
        with self.assertRaises(RuntimeError) as caught:
            self.invoke()
        self.assertIs(caught.exception, primary)
        report = self.report()
        self.assert_failure(report, str(primary))
        self.assertEqual([e['stage'] for e in report['finalizationErrors']], ['final.png', 'persist'])
        self.emulator.persist.assert_called_once_with(self.out)
        self.assertTrue((self.out / 'walk-actions.json').exists())

    def test_boot_map_mismatch_survives_boot_diagnostic_failure(self):
        self.memory.return_value = struct.pack('<I', 999)
        self.memory.side_effect = None
        self.emulator.screenshot.side_effect = OSError('no video')
        with self.assertRaisesRegex(RuntimeError, 'QA continue did not reach its original map'):
            self.invoke()
        report = self.report()
        self.assert_failure(report, 'QA continue did not reach its original map')
        self.assertEqual([e['stage'] for e in report['finalizationErrors']],
                         ['boot-failure.png', 'final.png'])
        self.emulator.persist.assert_called_once_with(self.out)

    def test_successful_body_fails_if_screenshot_or_persist_fails(self):
        for stage, target in (('final.png', self.emulator.screenshot), ('persist', self.emulator.persist)):
            with self.subTest(stage=stage):
                self.out = self.base / stage
                error = OSError(f'{stage} failed')
                target.side_effect = error
                with self.assertRaises(OSError) as caught:
                    self.invoke()
                self.assertIs(caught.exception, error)
                self.assert_failure(self.report(), f'Finalization failed: {stage}')
                self.assertEqual(self.report()['finalizationErrors'][0]['stage'], stage)
                self.emulator.persist.assert_called_with(self.out)
                target.side_effect = None

    def test_walk_log_failure_does_not_prevent_metadata(self):
        error = self.fail_write({'walk-actions.json'})
        with self.assertRaises(OSError) as caught:
            self.invoke()
        self.assertIs(caught.exception, error)
        self.assert_failure(self.report(), 'walk-actions.json')

    def test_metadata_observation_failures_do_not_prevent_result(self):
        def read(path):
            if path.name.endswith('.dylib'):
                raise OSError('core unreadable')
            return self.read_fake_file(path)
        self.read_bytes.side_effect = read
        self.memory.side_effect = [struct.pack('<I', 123), struct.pack('<I', 123),
                                   RuntimeError('zone unavailable')]
        with self.assertRaisesRegex(OSError, 'core unreadable'):
            self.invoke()
        report = self.report()
        self.assert_failure(report, 'core unreadable')
        self.assertIsNone(report['coreSha256'])
        self.assertIsNone(report['finalObservedZone'])
        self.assertEqual([e['stage'] for e in report['finalizationErrors']],
                         ['coreSha256', 'finalObservedZone'])

    def test_disk_full_report_emits_json_and_fails(self):
        error = self.fail_write({'result.json.tmp'})
        with self.assertRaises(OSError) as caught:
            self.invoke()
        self.assertIs(caught.exception, error)
        fallback = json.loads(self.stderr.getvalue())
        self.assert_failure(fallback, 'No space left on device')
        self.assertEqual(fallback['type'], 'world-tour-result-fallback')
        self.assertEqual(fallback['reportPath'], str(self.out / 'result.json'))
        self.assertEqual(fallback['finalizationErrors'][0]['stage'], 'result.json')
        self.assertFalse((self.out / 'result.json').exists())

    def test_report_replace_failure_falls_back_without_publishing_partial_json(self):
        self.patch(Path, 'replace', side_effect=PermissionError('report path unwritable'))
        with self.assertRaisesRegex(PermissionError, 'report path unwritable'):
            self.invoke()
        self.assert_failure(json.loads(self.stderr.getvalue()), 'report path unwritable')
        self.assertFalse((self.out / 'result.json').exists())

    def test_disk_full_and_broken_stderr_preserve_primary_and_use_stdout(self):
        primary = RuntimeError('original bootstrap failure')
        self.emulator.load.side_effect = primary
        self.fail_write({'walk-actions.json', 'result.json.tmp'})
        self.stderr = mock.Mock()
        self.stderr.write.side_effect = OSError('broken stderr')
        with self.assertRaises(RuntimeError) as caught:
            self.invoke()
        self.assertIs(caught.exception, primary)
        fallback = json.loads(self.stdout.getvalue())
        self.assert_failure(fallback, str(primary))
        self.assertEqual([e['stage'] for e in fallback['finalizationErrors']],
                         ['walk-actions.json', 'result.json'])

    def test_existing_output_evidence_is_untouched(self):
        self.out.mkdir()
        previous = '{"pass":true,"previous":"independent run"}\n'
        (self.out / 'result.json').write_text(previous)
        with self.assertRaisesRegex(RuntimeError, 'Use a new output directory'):
            self.invoke()
        self.assertEqual((self.out / 'result.json').read_text(), previous)
        self.assertEqual([p.name for p in self.out.iterdir()], ['result.json'])
        self.assert_failure(json.loads(self.stderr.getvalue()), 'Use a new output directory')
        self.constructor.assert_not_called()

    def test_output_creation_failure_emits_fallback(self):
        self.patch(Path, 'mkdir', side_effect=PermissionError('cannot create report directory'))
        with self.assertRaisesRegex(PermissionError, 'cannot create report directory'):
            self.invoke()
        self.assert_failure(json.loads(self.stderr.getvalue()), 'cannot create report directory')
        self.constructor.assert_not_called()

    def test_scene_still_requires_exact_position(self):
        self.data['scenes'] = [{'zoneId': 123, 'tileX': 5, 'tileZ': 7, 'chunk': 0, 'kind': 'town'}]
        self.write_fixture()
        with self.assertRaisesRegex(RuntimeError, r'expected \(123, 5, 7\), observed \(123, 5, 6\)'):
            self.invoke()
        report = self.report()
        self.assert_failure(report, 'Scene 0: expected')
        self.assertEqual(report['visited'], 1)
        self.assertEqual(report['records'][0]['observedPosition'], [123, 5, 6])

    def test_interruption_is_a_failure_even_with_empty_exception_message(self):
        primary = KeyboardInterrupt()
        self.emulator.run.side_effect = primary
        with self.assertRaises(KeyboardInterrupt) as caught:
            self.invoke()
        self.assertIs(caught.exception, primary)
        self.assert_failure(self.report(), 'KeyboardInterrupt')


if __name__ == '__main__':
    unittest.main()
