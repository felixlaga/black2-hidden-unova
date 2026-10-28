#!/usr/bin/env python3
"""Run an isolated DeSmuME libretro core for repeatable ROM smoke tests.

Requires the official arm64 core in .cache/emulator and Pillow. All saves,
states, screenshots, and logs remain under the caller's output directory.
This is an emulator test tool, not evidence of physical console compatibility.
"""
import argparse
import ctypes as C
import hashlib
import json
import struct
from pathlib import Path
import time
from PIL import Image


class Variable(C.Structure):
    _fields_ = [("key", C.c_char_p), ("value", C.c_char_p)]


class GameInfo(C.Structure):
    _fields_ = [("path", C.c_char_p), ("data", C.c_void_p), ("size", C.c_size_t), ("meta", C.c_char_p)]


KEYS = {"b": 0, "y": 1, "select": 2, "start": 3, "up": 4, "down": 5,
        "left": 6, "right": 7, "a": 8, "x": 9, "l": 10, "r": 11}


class Emulator:
    def __init__(self, core, directory):
        self.lib = C.CDLL(str(core))
        self.directory = str(directory.resolve()).encode()
        self.options = {b"desmume_cpu_mode": b"interpreter", b"desmume_gfx_multisampling": b"disabled",
                        b"desmume_pointer_type": b"touch", b"desmume_pointer_mouse": b"enabled",
                        b"desmume_gfx_highres_interpolate_color": b"disabled", b"desmume_internal_resolution": b"256x192"}
        self.buttons = set()
        self.touch = None
        self.pixel_format = 0
        self.last_video = None
        self.video_calls = 0
        self.frame = 0
        self.callbacks = []
        self.log_callback = C.CFUNCTYPE(None, C.c_int, C.c_char_p)(lambda level, message: None)
        self.callbacks.append(self.log_callback)

        def env(command, data):
            command &= 0xFFFF
            if command in (9, 31):
                C.cast(data, C.POINTER(C.c_char_p))[0] = self.directory
                return True
            if command == 27:
                C.cast(data, C.POINTER(C.c_void_p))[0] = C.cast(self.log_callback, C.c_void_p).value
                return True
            if command == 10:
                self.pixel_format = C.cast(data, C.POINTER(C.c_uint))[0]
                return self.pixel_format in (0, 1, 2)
            if command == 16:
                variables = C.cast(data, C.POINTER(Variable))
                index = 0
                while variables[index].key:
                    row = variables[index]
                    if row.key not in self.options and row.value:
                        self.options[row.key] = row.value.split(b"; ", 1)[-1].split(b"|", 1)[0]
                    index += 1
                return True
            if command == 15:
                row = C.cast(data, C.POINTER(Variable)).contents
                row.value = self.options.get(row.key)
                return row.value is not None
            if command in (17, 3):
                C.cast(data, C.POINTER(C.c_bool))[0] = command == 3
                return True
            if command in (39, 52):
                C.cast(data, C.POINTER(C.c_uint))[0] = 0
                return True
            if command in (8, 11, 18, 35, 36):
                return True
            return False

        def video(data, width, height, pitch):
            if data and data != C.c_void_p(-1).value:
                self.last_video = (data, width, height, pitch)
                self.video_calls += 1

        def input_state(port, device, index, identifier):
            if port == 0 and device == 1:
                return int(identifier in self.buttons)
            if port == 0 and device == 6 and self.touch:
                if identifier == 0:
                    return int(self.touch[0] / 255 * 65534 - 32767)
                if identifier == 1:
                    return int((self.touch[1] + 192) / 383 * 65534 - 32767)
                if identifier == 2:
                    return 1
            return 0

        specifications = [
            ("environment", C.CFUNCTYPE(C.c_bool, C.c_uint, C.c_void_p), env),
            ("video_refresh", C.CFUNCTYPE(None, C.c_void_p, C.c_uint, C.c_uint, C.c_size_t), video),
            ("audio_sample", C.CFUNCTYPE(None, C.c_int16, C.c_int16), lambda left, right: None),
            ("audio_sample_batch", C.CFUNCTYPE(C.c_size_t, C.c_void_p, C.c_size_t), lambda data, frames: frames),
            ("input_poll", C.CFUNCTYPE(None), lambda: None),
            ("input_state", C.CFUNCTYPE(C.c_int16, C.c_uint, C.c_uint, C.c_uint, C.c_uint), input_state),
        ]
        for name, signature, implementation in specifications:
            callback = signature(implementation)
            self.callbacks.append(callback)
            setter = getattr(self.lib, "retro_set_" + name)
            setter.argtypes = [signature]
            setter(callback)
        self.lib.retro_load_game.argtypes = [C.POINTER(GameInfo)]
        self.lib.retro_load_game.restype = C.c_bool
        self.lib.retro_serialize_size.restype = C.c_size_t
        self.lib.retro_serialize.argtypes = [C.c_void_p, C.c_size_t]
        self.lib.retro_serialize.restype = C.c_bool
        self.lib.retro_unserialize.argtypes = [C.c_void_p, C.c_size_t]
        self.lib.retro_unserialize.restype = C.c_bool
        self.lib.retro_get_memory_size.argtypes = [C.c_uint]
        self.lib.retro_get_memory_size.restype = C.c_size_t
        self.lib.retro_get_memory_data.argtypes = [C.c_uint]
        self.lib.retro_get_memory_data.restype = C.c_void_p
        self.lib.retro_init()

    def load(self, rom, save=None, state=None):
        self.game_path = str(rom.resolve()).encode()
        self.battery = Path(self.directory.decode()) / (rom.stem + ".dsv")
        if save:
            source = save.read_bytes()
            if len(source) != 524288:
                raise ValueError("Black 2 fixture needs a raw 512 KiB save")
            footer = b"|<--Snip above here to create a raw sav by excluding this DeSmuME savedata footer:"
            trailer = struct.pack("<6I", len(source), len(source), 6, 3, len(source), 0)
            self.battery.write_bytes(source + footer + trailer + b"|-DESMUME SAVE-|")
        self.game = GameInfo(self.game_path, None, 0, None)
        if not self.lib.retro_load_game(C.byref(self.game)):
            raise RuntimeError("Core rejected ROM")
        if state:
            source = state.read_bytes()
            if not self.lib.retro_unserialize(source, len(source)):
                raise RuntimeError("Core rejected savestate")

    def run(self, frames, buttons=(), touch=None):
        self.buttons = {KEYS[key] for key in buttons}
        self.touch = touch
        for _ in range(frames):
            self.lib.retro_run()
            self.frame += 1
        self.buttons = set()
        self.touch = None

    def screenshot(self, path):
        if not self.last_video:
            raise RuntimeError("Core produced no video")
        pointer, width, height, pitch = self.last_video
        pixels = C.string_at(pointer, pitch * height)
        if self.pixel_format == 1:
            image = Image.frombytes("RGB", (width, height), pixels, "raw", "BGRX", pitch)
        else:
            import numpy as np
            values = np.frombuffer(pixels, dtype="<u2").reshape(height, pitch // 2)[:, :width]
            shift = 6 if self.pixel_format == 2 else 5
            channels = np.stack((((values >> (shift+5)) & 31)*255//31,
                                 ((values >> 5) & ((1 << shift)-1))*255//((1 << shift)-1),
                                 (values & 31)*255//31), axis=2).astype("uint8")
            image = Image.fromarray(channels)
        image.save(path)
        return {"width": width, "height": height, "colors": len(image.getcolors(width*height) or [])}

    def persist(self, directory):
        size = self.lib.retro_serialize_size()
        buffer = C.create_string_buffer(size)
        if not self.lib.retro_serialize(buffer, size):
            raise RuntimeError("Core could not serialize")
        (directory / "latest.state").write_bytes(buffer.raw)
        if self.battery.exists():
            (directory / "latest.sav").write_bytes(self.battery.read_bytes()[:524288])
        size = self.lib.retro_get_memory_size(2)
        pointer = self.lib.retro_get_memory_data(2)
        if size and pointer:
            (directory / "latest.ram").write_bytes(C.string_at(pointer, size))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--actions", type=Path)
    parser.add_argument("--frames", type=int, default=600)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--save", type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    core = Path(__file__).resolve().parents[1] / ".cache/emulator/desmume_libretro.dylib"
    emu = Emulator(core, args.out)
    start = time.monotonic()
    emu.load(args.rom, args.save, args.state)
    actions = json.loads(args.actions.read_text()) if args.actions else [{"frames": args.frames}]
    captures = []
    for index, action in enumerate(actions):
        emu.run(action["frames"], action.get("buttons", []), action.get("touch"))
        if action.get("capture", True):
            path = args.out / f"frame-{index:03d}.png"
            captures.append({"file": path.name, "frame": emu.frame, **emu.screenshot(path)})
    emu.persist(args.out)
    digest = hashlib.sha256()
    with args.rom.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    rom_hash = digest.hexdigest()
    report = {"romSha256": rom_hash, "coreSha256": hashlib.sha256(core.read_bytes()).hexdigest(),
              "frames": emu.frame, "wallSeconds": round(time.monotonic()-start, 2),
              "videoCalls": emu.video_calls, "captures": captures, "physicalHardwareTested": False}
    (args.out / "report.json").write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report, indent=2), flush=True)
    emu.lib.retro_unload_game()
    emu.lib.retro_deinit()


if __name__ == "__main__":
    main()
