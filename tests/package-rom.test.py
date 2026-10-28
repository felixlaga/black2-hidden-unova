#!/usr/bin/env python3
"""Run after setup-patcher; use BPS_REAL_ROM_TEST=1 to include the 512 MiB ROM.

    python3 scripts/package-rom.py setup-patcher
    python3 tests/package-rom.test.py
    BPS_REAL_ROM_TEST=1 python3 tests/package-rom.test.py

Tests never download ROMs, overwrite inputs, or call a development build final.
"""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import struct
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock
import zlib


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_rom", ROOT / "scripts/package-rom.py")
pkg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pkg)


def footer(body, source, target):
    result = body + struct.pack("<II", zlib.crc32(source), zlib.crc32(target))
    return result + struct.pack("<I", zlib.crc32(result))


def repair_patch_crc(patch):
    return bytes(patch[:-4]) + struct.pack("<I", zlib.crc32(patch[:-4]))


def all_actions_fixture():
    source = bytes(range(256))
    target = bytes([0, 1, 2, 3]) + b"XYZ" + bytes([100, 101, 102, 103, 0, 1, 2]) + b"!!!!!!"
    # Hand-written BPS: all four actions, positive/negative SourceCopy deltas,
    # and an overlapping TargetCopy which repeats the one literal '!'.
    body = bytes.fromhex("42505331008194808c8958595a8e48808a51808121939c")
    return source, target, footer(body, source, target)


def nds_fixture():
    rng = random.Random(531)
    source, target = bytearray(b"\xff" * 0x10000), bytearray(b"\xff" * 0x11000)
    files = [bytes(rng.randrange(256) for _ in range(n)) for n in (8192, 8192, 4096)]
    old_spans = [(0x1000, 0x3000), (0x4000, 0x6000), (0x8000, 0x9000)]
    new_spans = [(0x4000, 0x6000), (0x1000, 0x3000), (0xa000, 0xb003)]
    for rom, spans in ((source, old_spans), (target, new_spans)):
        rom[:0x200] = b"\0" * 0x200
        rom[12:16] = b"IREO"
        struct.pack_into("<II", rom, 0x48, 0x200, len(spans) * 8)
        for i, (start, end) in enumerate(spans):
            struct.pack_into("<II", rom, 0x200 + i * 8, start, end)
            rom[start:start + len(files[i])] = files[i]
    target[0xa012:0xa014] = b"HI"
    target[0xb000:0xb003] = b"new"
    return bytes(source), bytes(target)


class BpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / "build").mkdir(exist_ok=True)
        cls.lib = pkg.load_patcher()

    def assert_roundtrip(self, source, target, patch):
        with tempfile.TemporaryFile(dir=ROOT / "build") as sink:
            self.assertEqual(pkg.independent_apply(source, patch, self.lib, sink), pkg.fingerprints(target))
            sink.seek(0)
            self.assertEqual(sink.read(), target)

    def test_native_worker_failure_does_not_kill_packager(self):
        class FailedNativeLibrary:
            def bps_apply(self, *args):
                os._exit(42)
        source, _, patch = all_actions_fixture()
        with self.assertRaisesRegex(pkg.PackageError, "worker terminated unsuccessfully"):
            pkg.independent_apply(source, patch, FailedNativeLibrary())

    def test_spec_integer_vectors(self):
        for number, expected in ((0, "80"), (127, "ff"), (128, "0080"), (255, "7f80"),
                                 (256, "0081"), (16511, "7fff"), (16512, "000080")):
            with self.subTest(number=number):
                self.assertEqual(bytes(pkg.encode_number(number)).hex(), expected)

    def test_all_four_actions_external_apply(self):
        source, target, patch = all_actions_fixture()
        self.assert_roundtrip(source, target, patch)

    def test_golden_encoded_patch(self):
        patch, _ = pkg.make_patch(b"abcxyzabc", b"abc123abc", nds=False)
        self.assertEqual(patch.hex(), "42505331898980a1616263313233616263cda5d5588680bdb9850aeb3c")
        self.assert_roundtrip(b"abcxyzabc", b"abc123abc", patch)

    def test_relocated_fat_files_changed_file_and_gaps(self):
        source, target = nds_fixture()
        patch, stats = pkg.make_patch(source, target)
        self.assertGreaterEqual(stats["SourceCopy"]["bytes"], 16384)
        self.assertGreater(stats["SourceRead"]["bytes"], 0)
        self.assertGreater(stats["TargetRead"]["bytes"], 0)
        self.assertLess(len(patch), len(target) // 2)
        self.assert_roundtrip(source, target, patch)
        self.assertEqual(pkg.make_patch(source, target)[0], patch)

    def test_linear_boundary_cases(self):
        rng = random.Random(225)
        for length in (0, 1, 127, 128, 4095, 4096, 4097, 16384):
            original = bytes(rng.randrange(256) for _ in range(length))
            for target in (original, original[:length // 2], original + b"extra", original[::-1]):
                with self.subTest(source_size=length, target_size=len(target)):
                    patch, _ = pkg.make_patch(original, target, nds=False)
                    self.assert_roundtrip(original, target, patch)

    def test_changed_padding_uses_bounded_source_dictionary(self):
        source = b"\0" * 4096 + b"\xff" * 65536
        target = b"\0" * len(source)
        patch, stats = pkg.make_patch(source, target, nds=False)
        self.assertLess(len(patch), 256)
        self.assertEqual(stats["TargetRead"]["bytes"], 0)
        self.assertEqual(stats["SourceCopy"]["bytes"], 65536)
        self.assert_roundtrip(source, target, patch)

    def test_wrong_base_crc_and_size(self):
        source, _, patch = all_actions_fixture()
        for wrong in (source[:-1], b"\x01" + source[1:]):
            with self.assertRaisesRegex(pkg.PackageError, "Source CRC32|source size"):
                pkg.independent_apply(wrong, patch, self.lib)
        # Same CRC supplied in footer must still not bypass the source-size check.
        wrong = source[:-1]
        changed = bytearray(patch)
        struct.pack_into("<I", changed, len(changed) - 12, zlib.crc32(wrong))
        with self.assertRaisesRegex(pkg.PackageError, "source size"):
            pkg.independent_apply(wrong, repair_patch_crc(changed), self.lib)

    def test_every_truncation_and_patch_crc_corruption(self):
        source, _, patch = all_actions_fixture()
        for cut in range(len(patch)):
            with self.subTest(cut=cut), self.assertRaises(pkg.PackageError):
                pkg.independent_apply(source, patch[:cut], self.lib)
        for offset in (0, 7, len(patch) - 12, len(patch) - 8, len(patch) - 1):
            corrupt = bytearray(patch)
            corrupt[offset] ^= 1
            with self.subTest(offset=offset), self.assertRaises(pkg.PackageError):
                pkg.independent_apply(source, bytes(corrupt), self.lib)

    def test_forged_target_crc_is_rejected_by_independent_applier(self):
        source, _, patch = all_actions_fixture()
        corrupt = bytearray(patch)
        corrupt[-8] ^= 1
        corrupt = repair_patch_crc(corrupt)
        pkg.validate_patch(source, corrupt)  # Structural and patch/source CRC checks pass.
        with self.assertRaisesRegex(pkg.PackageError, "Independent Flips application failed"):
            pkg.independent_apply(source, corrupt, self.lib)

    def test_malformed_commands_with_valid_patch_crc(self):
        source = b"abc"
        # Headers declare source=3, target=3, no metadata. Each body is malformed.
        for actions in (b"\x8c", b"\x89A", b"\x8a\x89", b"\x8b\x80", b"\0" * 11,
                        b"", b"\x80", b"\x88\x80"):
            patch = footer(b"BPS1\x83\x83\x80" + actions, source, b"abc")
            with self.subTest(actions=actions.hex()), self.assertRaises(pkg.PackageError):
                pkg.independent_apply(source, patch, self.lib)
        for header in (b"BPS1\x83\x83\xff", b"BPS1\x83" + b"\0" * 11):
            with self.assertRaises(pkg.PackageError):
                pkg.validate_patch(source, footer(header, source, b"abc"))

    def test_invalid_fat_rejected(self):
        source, target = nds_fixture()
        for offset, values in ((0x48, (len(target), 24)), (0x48, (0x200, 23)),
                               (0x200, (0x4000, len(target) + 1)), (0x208, (0x4001, 0x5000))):
            bad = bytearray(target)
            struct.pack_into("<II", bad, offset, *values)
            with self.assertRaises(pkg.PackageError):
                pkg.make_patch(source, bytes(bad))
        bad = bytearray(1024 * 1024)
        struct.pack_into("<II", bad, 0x48, 0x200, (pkg.MAX_FAT_FILES + 1) * 8)
        with self.assertRaisesRegex(pkg.PackageError, "too many file IDs"):
            pkg.fat_entries(bad)


class FileSafetyTests(unittest.TestCase):
    def setUp(self):
        (ROOT / "build").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="bps-test-", dir=ROOT / "build")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "build").mkdir()
        (self.root / "roms").mkdir()
        self.source = self.root / pkg.DEFAULT_SOURCE
        self.target = self.root / pkg.DEFAULT_TARGET
        self.source.write_bytes(b"base")
        self.target.write_bytes(b"target")

    def test_output_path_guards(self):
        alias = self.root / "build/alias.nds"
        os.link(self.source, alias)
        symlink = self.root / "build/symlink"
        symlink.symlink_to(self.root / "roms", target_is_directory=True)
        for path in (self.source, self.target, alias, symlink / "output", "build/../../outside", "new.nds"):
            with self.subTest(path=str(path)), self.assertRaises(pkg.PackageError):
                pkg.build_path(path, (self.source, self.target), self.root)
        self.assertEqual(pkg.build_path("build/new.nds", (self.source,), self.root), self.root / "build/new.nds")

    def test_snapshot_detects_concurrent_mutation(self):
        before = self.source.stat()
        values = {name: getattr(before, name) for name in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")}
        values["st_mtime_ns"] += 1
        with mock.patch.object(pkg.os, "fstat", side_effect=[before, SimpleNamespace(**values)]):
            with self.assertRaisesRegex(pkg.PackageError, "changed while being snapshotted"):
                pkg.snapshot(self.source)
        self.assertEqual(self.source.read_bytes(), b"base")

    def test_pinned_base_sha_rejected(self):
        with self.assertRaisesRegex(pkg.PackageError, "Wrong base ROM SHA256"):
            pkg.checked_source(self.source)

    def test_safe_apply_manifest_and_no_clobber(self):
        source, target, patch = all_actions_fixture()
        self.source.write_bytes(source)
        patch_path = self.root / "build/test.bps"
        patch_path.write_bytes(patch)
        manifest_path = self.root / "build/manifest.json"
        manifest = {"schema_version": 1, "format": "BPS1", "source": pkg.fingerprints(source),
                    "target": pkg.fingerprints(target), "patch": pkg.fingerprints(patch)}
        manifest_path.write_text(json.dumps(manifest))
        output = self.root / "build/result.nds"
        library = pkg.load_patcher()
        with mock.patch.object(pkg, "BASE_SHA256", hashlib.sha256(source).hexdigest()), \
                mock.patch.object(pkg, "load_patcher", return_value=library):
            result = pkg.apply_package(self.source, patch_path, manifest_path, output, self.root)
            self.assertEqual(result, pkg.fingerprints(target))
            self.assertEqual(output.read_bytes(), target)
            with self.assertRaisesRegex(pkg.PackageError, "overwrite"):
                pkg.apply_package(self.source, patch_path, manifest_path, output, self.root)
            manifest["target"]["sha256"] = "0" * 64
            manifest_path.write_text(json.dumps(manifest))
            failed_output = self.root / "build/failed.nds"
            with self.assertRaisesRegex(pkg.PackageError, "target SHA256"):
                pkg.apply_package(self.source, patch_path, manifest_path, failed_output, self.root)
            self.assertFalse(failed_output.exists())
            self.assertEqual(list((self.root / "build").glob(".apply-*")), [])
        self.assertEqual(self.source.read_bytes(), source)
        self.assertEqual(self.target.read_bytes(), b"target")
        self.assertEqual(patch_path.read_bytes(), patch)


@unittest.skipUnless(os.environ.get("BPS_REAL_ROM_TEST") == "1", "Set BPS_REAL_ROM_TEST=1 for the real 512 MiB snapshot")
class RealRomTests(unittest.TestCase):
    def test_real_512_mib_snapshot_roundtrip_and_reproducibility(self):
        started = time.monotonic()
        source, source_info = pkg.checked_source(ROOT / pkg.DEFAULT_SOURCE)
        target_path = pkg.input_path(os.environ.get("BPS_TEST_TARGET", pkg.DEFAULT_TARGET))
        target = pkg.snapshot(target_path)
        target_info = pkg.fingerprints(target)
        self.assertEqual(len(source), 512 * 1024 * 1024)
        self.assertEqual(len(target), 512 * 1024 * 1024)
        patch, stats = pkg.make_patch(source, target)
        self.assertEqual(pkg.make_patch(source, target)[0], patch, "Same immutable snapshots must produce identical BPS bytes")
        self.assertGreater(stats["SourceCopy"]["bytes"], 100 * 1024 * 1024)
        self.assertEqual(pkg.independent_apply(source, patch, pkg.load_patcher()), target_info)
        report = {"status": "development_snapshot_test_only", "source": source_info, "target_snapshot": target_info,
                  "patch": pkg.fingerprints(patch), "actions": stats, "deterministic_patch": True,
                  "independent_roundtrip_sha256_match": True, "elapsed_seconds": round(time.monotonic() - started, 3)}
        print("\nREAL ROM SNAPSHOT RESULT: " + json.dumps(report, sort_keys=True), flush=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
