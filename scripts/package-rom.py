#!/usr/bin/env python3
"""Deterministic BPS packaging; all ROM reads are immutable, checked snapshots.

No dependencies are installed. Run --help for packaging and safe application.
The encoder uses NitroFS FAT IDs and a bounded linear block comparison, never
a suffix array or quadratic sequence matcher. A pinned third-party BPS applier
must reconstruct the complete target before any distribution is published.
"""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zlib


ROOT = Path(__file__).resolve().parents[1]
BASE_SHA256 = "39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99"
DEFAULT_SOURCE = "roms/pokemon-black2-us.nds"
DEFAULT_TARGET = "build/black2-hidden-unova.nds"
BLOCK_SIZE = 4096
MAX_ROM_SIZE = 1024 * 1024 * 1024
MAX_FAT_FILES = 65536  # NitroFS file IDs are 16-bit; bound Python object allocation.
ACTION_NAMES = ("SourceRead", "TargetRead", "SourceCopy", "TargetCopy")


class PackageError(ValueError):
    pass


def fingerprints(data):
    return {"size_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "crc32": f"{zlib.crc32(data):08x}"}


def file_fingerprints(path):
    digest, crc, size = hashlib.sha256(), 0, 0
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            crc = zlib.crc32(chunk, crc)
            size += len(chunk)
    return {"size_bytes": size, "sha256": digest.hexdigest(), "crc32": f"{crc:08x}"}


def snapshot(path, limit=MAX_ROM_SIZE):
    """Read exactly once; reject detectable writes/replacements during that read."""
    path = Path(path)
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        if before.st_size > limit:
            raise PackageError(f"Input exceeds {limit} bytes: {path}")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    current = path.stat()
    signature = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    if signature(before) != signature(after) or signature(after) != signature(current):
        raise PackageError(f"Input changed while being snapshotted; retry after the build: {path}")
    if len(data) != before.st_size:
        raise PackageError(f"Incomplete input snapshot: {path}")
    return data


def input_path(value, root=ROOT):
    path = Path(value)
    return path if path.is_absolute() else root / path


def build_path(value, protected=(), root=ROOT):
    """Reject aliases, symlinks and every output outside the real build tree."""
    root = root.resolve()
    path = Path(os.path.abspath(input_path(value, root)))
    build = root / "build"
    if path == build or build not in path.parents:
        raise PackageError("Outputs must be below this repository's build/ directory")
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise PackageError(f"Refusing a symlink in output path: {part}")
    for original in protected:
        original = Path(original)
        if path.resolve() == original.resolve() or (
                path.exists() and original.exists() and os.path.samefile(path, original)):
            raise PackageError("Output must not overwrite a source, target, patch or manifest input")
    return path


def encode_number(value):
    if value < 0:
        raise PackageError("BPS unsigned integer cannot be negative")
    result = bytearray()
    while True:
        digit = value & 127
        value >>= 7
        if not value:
            result.append(digit | 128)
            return result
        result.append(digit)
        value -= 1


def fat_entries(rom):
    if len(rom) < 0x200:
        raise PackageError("NDS header is truncated")
    offset, length = struct.unpack_from("<II", rom, 0x48)
    if offset < 0x200 or not length or length % 8 or offset + length > len(rom):
        raise PackageError("NDS FAT bounds are invalid")
    if length // 8 > MAX_FAT_FILES:
        raise PackageError("NDS FAT contains too many file IDs")
    result = [struct.unpack_from("<II", rom, at) for at in range(offset, offset + length, 8)]
    end = 0
    for start, stop in sorted(result):
        if stop < start or stop > len(rom) or (stop > start and start < end):
            raise PackageError("NDS FAT files overlap or extend beyond the snapshot")
        if stop > start:
            end = stop
    return result


def comparison_spans(source, target, nds):
    """Yield target start/end and a corresponding source offset (same FAT ID)."""
    if not nds:
        yield 0, len(target), 0
        return
    old_files, new_files = fat_entries(source), fat_entries(target)
    cursor = 0
    for start, stop, file_id in sorted((a, b, i) for i, (a, b) in enumerate(new_files) if b > a):
        if cursor < start:
            yield cursor, start, cursor
        if file_id < len(old_files):
            old_start, old_stop = old_files[file_id]
            common = min(stop - start, old_stop - old_start)
            if common:
                yield start, start + common, old_start
            if start + common < stop:
                yield start + common, stop, start + common
        else:
            yield start, stop, start
        cursor = stop
    if cursor < len(target):
        yield cursor, len(target), cursor


def make_patch(source, target, nds=True):
    """O(source + target) time, with 4 KiB comparisons and coalesced commands."""
    patch = bytearray(b"BPS1")
    for value in (len(source), len(target), 0):
        patch.extend(encode_number(value))
    stats = {name: {"commands": 0, "bytes": 0} for name in ACTION_NAMES}
    pending = None
    relative = 0
    # Repacked NDS padding may switch from FF to 00 across hundreds of MiB.
    # Reuse a verified page from the base as a bounded SourceCopy dictionary.
    # Only two linear searches are needed; no suffix array or per-byte index.
    padding_sources = {value: source.find(bytes([value]) * BLOCK_SIZE) for value in (0, 255)}

    def flush(run):
        nonlocal relative
        if run is None:
            return
        at, end, original = run
        length = end - at
        action = 1 if original is None else (0 if original == at else 2)
        patch.extend(encode_number(((length - 1) << 2) | action))
        if action == 1:
            patch.extend(memoryview(target)[at:end])
        elif action == 2:
            delta = original - relative
            patch.extend(encode_number((abs(delta) << 1) | (delta < 0)))
            relative = original + length
        stats[ACTION_NAMES[action]]["commands"] += 1
        stats[ACTION_NAMES[action]]["bytes"] += length

    for start, stop, original in comparison_spans(source, target, nds):
        for at in range(start, stop, BLOCK_SIZE):
            end = min(at + BLOCK_SIZE, stop)
            src = original + at - start
            equal = src + end - at <= len(source) and source[src:src + end - at] == target[at:end]
            candidate = src if equal else None
            if candidate is None:
                chunk = target[at:end]
                value = chunk[0]
                if value in padding_sources and padding_sources[value] >= 0 and chunk.count(value) == len(chunk):
                    candidate = padding_sources[value]
            if pending is not None and pending[1] == at and (
                    (pending[2] is None and candidate is None) or
                    (candidate is not None and pending[2] is not None and
                     pending[2] + at - pending[0] == candidate)):
                pending = (pending[0], end, pending[2])
            else:
                flush(pending)
                pending = (at, end, candidate)
    flush(pending)
    patch.extend(struct.pack("<II", zlib.crc32(source), zlib.crc32(target)))
    patch.extend(struct.pack("<I", zlib.crc32(patch)))
    return bytes(patch), stats


def validate_patch(source, patch, max_target=MAX_ROM_SIZE):
    """Validate CRCs and all BPS command bounds before invoking an applier.

    This does not prove the target checksum or SHA: the independent applier and
    full-output hash do that. TargetCopy overlap is legal under the BPS spec.
    """
    if len(patch) < 19 or patch[:4] != b"BPS1":
        raise PackageError("Truncated patch or invalid BPS1 signature")
    source_crc, target_crc, patch_crc = struct.unpack_from("<III", patch, len(patch) - 12)
    if zlib.crc32(memoryview(patch)[:-4]) != patch_crc:
        raise PackageError("Patch CRC32 mismatch")
    if zlib.crc32(source) != source_crc:
        raise PackageError("Source CRC32 mismatch (wrong base ROM)")
    position, limit = 4, len(patch) - 12

    def number():
        nonlocal position
        value, shift = 0, 1
        for _ in range(10):
            if position >= limit:
                raise PackageError("Truncated BPS integer")
            digit = patch[position]
            position += 1
            value += (digit & 127) * shift
            if value > (1 << 64) - 1:
                raise PackageError("BPS integer exceeds 64 bits")
            if digit & 128:
                return value
            shift <<= 7
            value += shift
        raise PackageError("BPS integer is too long")

    source_size, target_size, metadata_size = number(), number(), number()
    if source_size != len(source):
        raise PackageError("BPS source size mismatch (wrong base ROM)")
    if target_size > max_target:
        raise PackageError("BPS target exceeds the allowed size")
    if metadata_size > limit - position:
        raise PackageError("Truncated BPS metadata")
    position += metadata_size
    output, source_relative, target_relative = 0, 0, 0
    while position < limit:
        command = number()
        action, length = command & 3, (command >> 2) + 1
        if length > target_size - output:
            raise PackageError("BPS command exceeds declared target size")
        if action == 0:
            if output + length > len(source):
                raise PackageError("SourceRead exceeds source bounds")
        elif action == 1:
            if length > limit - position:
                raise PackageError("Truncated TargetRead data")
            position += length
        else:
            encoded = number()
            delta = -(encoded >> 1) if encoded & 1 else encoded >> 1
            if action == 2:
                source_relative += delta
                if source_relative < 0 or source_relative + length > len(source):
                    raise PackageError("SourceCopy exceeds source bounds")
                source_relative += length
            else:
                target_relative += delta
                if target_relative < 0 or target_relative >= output:
                    raise PackageError("TargetCopy reads unwritten target bytes")
                target_relative += length
        output += length
    if position != limit or output != target_size:
        raise PackageError("BPS commands do not produce the declared target size")
    return {"source_size": source_size, "target_size": target_size,
            "source_crc32": f"{source_crc:08x}", "target_crc32": f"{target_crc:08x}",
            "patch_footer_crc32": f"{patch_crc:08x}"}


def provenance(root=ROOT):
    return json.loads((root / "tools/patcher-provenance.json").read_text())


def patcher_paths(root=ROOT):
    pin = provenance(root)
    cache = root / ".cache" / "bps-patcher" / pin["commit"]
    for part in (cache, *cache.parents):
        if part == root:
            break
        if part.is_symlink():
            raise PackageError(f"Refusing a symlink in patcher cache: {part}")
    extension = ".dylib" if sys.platform == "darwin" else ".so"
    return pin, cache, cache / ("libbps" + extension)


def checked_patcher_sources(pin, cache):
    for name, expected in pin["files"].items():
        path = cache / name
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise PackageError(f"Missing or altered pinned patcher source: {path}; run setup-patcher")


def setup_patcher(root=ROOT):
    """Fetch only hash-pinned public patcher sources; compile with existing C++."""
    pin, cache, library = patcher_paths(root)
    compiler = shutil.which("clang++") or shutil.which("c++")
    if not compiler:
        raise PackageError("An existing C++ compiler is required; no packages will be installed")
    cache.mkdir(parents=True, exist_ok=True)
    for name, expected in pin["files"].items():
        path = cache / name
        if path.is_symlink():
            raise PackageError(f"Refusing symlinked patcher source: {path}")
        if not path.exists():
            print(f"Fetching pinned patcher source: {name}", file=sys.stderr)
            with urllib.request.urlopen(pin["raw_base"] + name, timeout=60) as response:
                data = response.read(10 * 1024 * 1024 + 1)
            if hashlib.sha256(data).hexdigest() != expected:
                raise PackageError(f"Downloaded patcher source hash mismatch: {name}")
            with path.open("xb") as stream:
                stream.write(data)
    checked_patcher_sources(pin, cache)
    with tempfile.TemporaryDirectory(prefix=".compile-", dir=cache) as temp:
        built = Path(temp) / library.name
        flags = ["-dynamiclib"] if sys.platform == "darwin" else ["-shared", "-fPIC"]
        command = [compiler, *flags, "-O2", "libbps.cpp", "crc32.cpp", "-o", str(built)]
        subprocess.run(command, cwd=cache, check=True, capture_output=True, text=True, timeout=120)
        receipt = {"commit": pin["commit"], "source_files": pin["files"],
                   "library_sha256": file_fingerprints(built)["sha256"],
                   "compiler": subprocess.run([compiler, "--version"], check=True,
                                              capture_output=True, text=True, timeout=20).stdout.strip(),
                   "flags": [*flags, "-O2", "libbps.cpp", "crc32.cpp"]}
        os.replace(built, library)
        receipt_path = cache / "build-receipt.json"
        if receipt_path.is_symlink():
            raise PackageError("Refusing symlinked patcher receipt")
        receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return library


class Memory(ctypes.Structure):
    _fields_ = [("ptr", ctypes.c_void_p), ("length", ctypes.c_size_t)]


def load_patcher(root=ROOT):
    pin, cache, library = patcher_paths(root)
    checked_patcher_sources(pin, cache)
    receipt_path = cache / "build-receipt.json"
    if library.is_symlink() or receipt_path.is_symlink() or not library.is_file() or not receipt_path.is_file():
        raise PackageError("Pinned BPS applier is not built; run: python3 scripts/package-rom.py setup-patcher")
    receipt = json.loads(receipt_path.read_text())
    if (receipt.get("commit") != pin["commit"] or receipt.get("source_files") != pin["files"] or
            receipt.get("library_sha256") != file_fingerprints(library)["sha256"]):
        raise PackageError("Patcher build receipt mismatch; run setup-patcher to rebuild from pinned sources")
    lib = ctypes.CDLL(str(library))
    lib.bps_apply.argtypes = [Memory, Memory, ctypes.POINTER(Memory), ctypes.c_void_p, ctypes.c_bool]
    lib.bps_apply.restype = ctypes.c_int
    lib.bps_free.argtypes = [Memory]
    lib.bps_free.restype = None
    return lib


def _native_apply(source, patch, lib, parsed, sink):
    """Only call inside the isolated worker: archived libbps has unchecked malloc."""
    output = Memory()
    # c_char_p references immutable Python bytes without a 512 MiB copy. Keep both
    # byte strings alive until bps_apply returns; libbps treats its inputs as const.
    patch_mem = Memory(ctypes.cast(ctypes.c_char_p(patch), ctypes.c_void_p), len(patch))
    source_mem = Memory(ctypes.cast(ctypes.c_char_p(source), ctypes.c_void_p), len(source))
    code = lib.bps_apply(patch_mem, source_mem, ctypes.byref(output), None, False)
    if code != 0:
        raise PackageError(f"Independent Flips application failed (code {code}); no output accepted")
    try:
        if output.length != parsed["target_size"]:
            raise PackageError("Independent applier returned the wrong target size")
        digest, crc = hashlib.sha256(), 0
        for start in range(0, output.length, 1024 * 1024):
            length = min(1024 * 1024, output.length - start)
            chunk = (ctypes.c_ubyte * length).from_address(output.ptr + start)
            digest.update(chunk)
            crc = zlib.crc32(chunk, crc)
            if sink is not None:
                sink.write(chunk)
        result = {"size_bytes": output.length, "sha256": digest.hexdigest(), "crc32": f"{crc:08x}"}
        if result["crc32"] != parsed["target_crc32"]:
            raise PackageError("Reconstructed target CRC32 mismatch")
        if sink is not None:
            sink.flush()
        return result
    finally:
        lib.bps_free(output)


def independent_apply(source, patch, lib, sink=None):
    """Isolate native failures; fork shares immutable snapshots without copying.

    macOS/Linux only. File sinks share a descriptor across fork; an in-memory
    sink cannot receive child writes and is intentionally rejected.
    """
    parsed = validate_patch(source, patch)
    if not hasattr(os, "fork"):
        raise PackageError("Isolated BPS verification requires macOS or Linux (POSIX fork)")
    if sink is not None:
        try:
            sink.fileno()
        except (AttributeError, OSError) as error:
            raise PackageError("Independent application requires a file-backed output sink") from error
        sink.flush()
    read_fd, write_fd = os.pipe()
    try:
        pid = os.fork()
    except BaseException:
        os.close(read_fd)
        os.close(write_fd)
        raise
    if pid == 0:
        os.close(read_fd)
        try:
            message = {"result": _native_apply(source, patch, lib, parsed, sink)}
        except BaseException as error:
            message = {"error": str(error)[:4000]}
        try:
            os.write(write_fd, json.dumps(message).encode("utf-8"))
        finally:
            os.close(write_fd)
            os._exit(0)
    os.close(write_fd)
    try:
        with os.fdopen(read_fd, "rb") as pipe:
            message = pipe.read()
    finally:
        _, status = os.waitpid(pid, 0)
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0 or not message:
        raise PackageError(f"Independent Flips worker terminated unsuccessfully (wait status {status}); no output accepted")
    decoded = json.loads(message)
    if "error" in decoded:
        raise PackageError(decoded["error"])
    return decoded["result"]


def checked_source(path):
    source = snapshot(path)
    details = fingerprints(source)
    if details["sha256"] != BASE_SHA256:
        raise PackageError(f"Wrong base ROM SHA256: expected {BASE_SHA256}, got {details['sha256']}")
    return source, details


def instructions(manifest):
    patch = manifest["patch"]["file"]
    return f"""Black 2 Hidden Unova - BPS patch application

Package status: {manifest['status'].upper()}
{manifest['status_note']}

This package contains a standard BPS1 patch, not a ROM. Use your own copy of
the source ROM. Do not apply it to a previously modified ROM.

Required source: Pokemon Black 2 US, game code IREO
Source size: {manifest['source']['size_bytes']} bytes
Source SHA256: {manifest['source']['sha256']}
Source CRC32: {manifest['source']['crc32']}
Patch file: {patch}
Patch SHA256: {manifest['patch']['sha256']}
Patch CRC32 (whole file): {manifest['patch']['crc32']}
Expected patched ROM SHA256: {manifest['target']['sha256']}
Expected patched ROM CRC32: {manifest['target']['crc32']}

Using this repository on macOS or Linux (from its root):
1. Run once: python3 scripts/package-rom.py setup-patcher
   This downloads only pinned public patcher source and compiles it with an
   existing C++ compiler in .cache/. It installs no system software.
2. Put this package in a directory under build/distribution/.
3. Run (replace PACKAGE_DIRECTORY with that directory):
   python3 scripts/package-rom.py apply --patch PACKAGE_DIRECTORY/{patch} --manifest PACKAGE_DIRECTORY/manifest.json --output build/black2-hidden-unova-patched.nds
   The source defaults to roms/pokemon-black2-us.nds; --source can select
   another copy. Output must be a new path under build/. Existing files and
   all source/target inputs are protected from overwrite.
4. The command verifies source and patch hashes, all three BPS footer CRCs,
   and the complete reconstructed ROM SHA256 before accepting the output.

Other standard BPS tools (for example Floating IPS or Rom Patcher JS used
locally) can apply this patch. Select the required original ROM, then this
.bps file, and save to a NEW .nds file. Keep checksum checks enabled. Verify
the complete output SHA256 above; do not overwrite the source ROM.

The manifest records a snapshot of one input build. A later rebuild may have
a different hash. Patch round-trip verification proves byte equality only;
it is not evidence of gameplay, save compatibility or hardware testing.
"""


def package_rom(source_path, target_path, output_dir=None, status="development", root=ROOT):
    source_path, target_path = input_path(source_path, root), input_path(target_path, root)
    if source_path.resolve() == target_path.resolve() or os.path.samefile(source_path, target_path):
        raise PackageError("Source and target must be different files")
    if status not in ("development", "candidate", "release"):
        raise PackageError("Invalid package status")
    if output_dir is not None:
        destination = build_path(output_dir, (source_path, target_path), root)
        if destination.exists():
            raise PackageError(f"Output directory already exists; choose a new build/ path: {destination}")
    lib = load_patcher(root)
    print("Reading the pinned source and one immutable target snapshot...", file=sys.stderr)
    source, source_info = checked_source(source_path)
    target = snapshot(target_path)
    target_info = fingerprints(target)
    if len(target) != 512 * 1024 * 1024 or target[12:16] != b"IREO":
        raise PackageError("Expected a 512 MiB Pokemon Black 2 US (IREO) target build")
    print(f"Target snapshot SHA256: {target_info['sha256']}", file=sys.stderr)
    if output_dir is None:
        destination = build_path(f"build/distribution/{status}-{target_info['sha256'][:16]}",
                                 (source_path, target_path), root)
    if destination.exists():
        raise PackageError(f"Output directory already exists; choose a new build/ path: {destination}")
    print("Encoding FAT-aware BPS and independently reconstructing the full target...", file=sys.stderr)
    patch, stats = make_patch(source, target)
    del target  # Fingerprints suffice now; leave 512 MiB more available to the applier.
    patch_info, footer = fingerprints(patch), validate_patch(source, patch)
    verified = independent_apply(source, patch, lib)
    if verified != target_info:
        raise PackageError("Independent reconstructed output does not match the target snapshot SHA256/CRC/size")
    notes = {
        "development": "DEVELOPMENT snapshot for packaging checks only; not a final release or gameplay certification.",
        "candidate": "Candidate snapshot; release readiness and gameplay verification are outside this packager.",
        "release": "Release label explicitly selected by the operator; packaging verifies bytes, not release readiness.",
    }
    patch_name = f"black2-hidden-unova-{status}.bps"
    pin = provenance(root)
    manifest = {
        "schema_version": 1, "format": "BPS1", "status": status, "status_note": notes[status],
        "source": {"file": source_path.name, **source_info},
        "target": {"file": target_path.name, **target_info},
        "patch": {"file": patch_name, **patch_info,
                  "footer_crc32": footer["patch_footer_crc32"],
                  "footer_crc32_scope": "All patch bytes except its final four-byte CRC field"},
        "encoder": {"algorithm": "nds-fat-linear-v1", "block_size": BLOCK_SIZE,
                    "script_sha256": file_fingerprints(root / "scripts/package-rom.py")["sha256"],
                    "actions": stats, "specification": pin["specification"]},
        "verification": {"method": "Independent Flips libbps bps_apply in isolated worker; full output streamed into SHA256 and CRC32",
                         "applier_source": pin["source"], "applier_commit": pin["commit"],
                         "applier_provenance_sha256": file_fingerprints(root / "tools/patcher-provenance.json")["sha256"],
                         "reconstructed_target": verified, "matches_target_snapshot": True,
                         "snapshot": "Inputs read once into immutable memory; concurrent changes during each read rejected",
                         "gameplay_or_hardware_verified": False},
    }
    # Stage the small distribution only after all checks. Renaming the directory
    # publishes patch/manifest/instructions together. Never replace prior output.
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".package-", dir=destination.parent) as staging:
        staged = Path(staging) / "package"
        staged.mkdir()
        (staged / patch_name).write_bytes(patch)
        (staged / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        (staged / "APPLY.txt").write_text(instructions(manifest))
        if destination.exists() or destination.is_symlink():
            raise PackageError("Output directory appeared while packaging; refusing overwrite")
        os.rename(staged, destination)
    return destination, manifest


def apply_package(source_path, patch_path, manifest_path, output_path, root=ROOT):
    source_path, patch_path, manifest_path = [input_path(p, root) for p in (source_path, patch_path, manifest_path)]
    protected = (source_path, patch_path, manifest_path, root / DEFAULT_SOURCE, root / DEFAULT_TARGET)
    destination = build_path(output_path, protected, root)
    if destination.exists():
        raise PackageError("Refusing to overwrite an existing output file")
    manifest = json.loads(snapshot(manifest_path, 1024 * 1024))
    if manifest.get("format") != "BPS1" or manifest.get("schema_version") != 1:
        raise PackageError("Unsupported package manifest")
    source, source_info = checked_source(source_path)
    patch = snapshot(patch_path)
    for data_info, name in ((source_info, "source"), (fingerprints(patch), "patch")):
        if any(manifest[name].get(k) != value for k, value in data_info.items()):
            raise PackageError(f"{name.capitalize()} SHA256/CRC32/size differs from manifest")
    validate_patch(source, patch)
    lib = load_patcher(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".apply-", dir=destination.parent) as staging:
        staged = Path(staging) / "output.nds"
        with staged.open("xb") as stream:
            result = independent_apply(source, patch, lib, stream)
        if any(manifest["target"].get(k) != value for k, value in result.items()):
            raise PackageError("Reconstructed target SHA256/CRC32/size differs from manifest")
        # Hard-link publication is atomic and fails if destination already exists.
        os.link(staged, destination)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup-patcher", help="Fetch hash-pinned public Flips sources and compile in .cache/")
    package = commands.add_parser("package", help="Package and independently verify one built ROM snapshot")
    package.add_argument("--source", default=DEFAULT_SOURCE)
    package.add_argument("--target", default=DEFAULT_TARGET)
    package.add_argument("--output-dir", help="New directory under build/; default uses status and target SHA")
    package.add_argument("--status", choices=("development", "candidate", "release"), default="development",
                         help="Release is an explicit operator label, not a readiness check (default: development)")
    apply = commands.add_parser("apply", help="Safely apply a package and validate full-output SHA256")
    apply.add_argument("--source", default=DEFAULT_SOURCE)
    apply.add_argument("--patch", required=True)
    apply.add_argument("--manifest", required=True)
    apply.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "setup-patcher":
            print(setup_patcher())
        elif args.command == "package":
            destination, manifest = package_rom(args.source, args.target, args.output_dir, args.status)
            print(json.dumps({"directory": str(destination), "status": manifest["status"],
                              "source": manifest["source"], "target_snapshot": manifest["target"],
                              "patch": manifest["patch"], "independent_roundtrip": True}, indent=2))
        else:
            print(json.dumps(apply_package(args.source, args.patch, args.manifest, args.output), indent=2))
    except (PackageError, OSError, KeyError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
