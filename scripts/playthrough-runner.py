#!/usr/bin/env python3
"""Input-only, auditable DeSmuME campaign runner. JSON requests on stdin.

Never writes emulated memory. Fresh runs refuse an existing output directory.
Resume accepts only this runner's checkpoint on the same ROM/core hash.
Optional "walk": [{"header": 337, "x": 105, "z": 267}] follows axis-aligned
legs once, after actions/repeat. Walking uses read-only live RAM and directions;
12-frame neutral stability probes, 12-frame presses and 24-frame neutral waits
all count toward 128 attempts / 3000 frames. Invalid field/battle, transitions,
unexpected motion or two stationary attempts stop walking and keep a checkpoint.
Each input timeline event includes before/after positions. Complete records'
replayRequest objects are flat input requests for --replay (no walk/replanning);
export only the completed checkpoint lineage when a resume rolled inputs back.
Position guards cannot prove player control or detect every scripted movement.
"""
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("emulator_check", ROOT / "scripts/emulator-check.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

RAM_BASE = 0x02000000
RAM_SIZE = 4 * 1024 * 1024
WALK_BURST_FRAMES = 12
WALK_SETTLE_FRAMES = 24
WALK_MAX_STEPS = 128
WALK_MAX_FRAMES = 3000
_AUTO_BATTLE = None


def canonicalize_actions(actions):
    """Prepare every explicit action before any input is sent."""
    if not isinstance(actions, list):
        raise ValueError("actions must be a list")
    prepared = []
    for action in actions:
        if not isinstance(action, dict):
            raise ValueError("each action must be a mapping")
        frames = action.get("frames")
        if type(frames) is not int or frames < 0:
            raise ValueError("action frames must be a nonnegative integer")
        copy = dict(action)
        if "buttons" in action:
            if not isinstance(action["buttons"], list):
                raise ValueError("action buttons must be a list")
            buttons = []
            for button in action["buttons"]:
                if not isinstance(button, str) or button.lower() not in module.KEYS:
                    raise ValueError(f"Unknown button: {button!r}")
                buttons.append(button.lower())
            copy["buttons"] = buttons
        touch = action.get("touch")
        if touch is not None and (not isinstance(touch, (list, tuple)) or len(touch) != 2
                                  or any(type(value) is not int for value in touch)
                                  or not 0 <= touch[0] <= 255 or not 0 <= touch[1] <= 191):
            raise ValueError("action touch must be a coordinate pair within the touchscreen")
        prepared.append(copy)
    return prepared


def auto_battle_controller():
    """Load optional input automation once; retain the hash of the loaded code."""
    global _AUTO_BATTLE
    if _AUTO_BATTLE is None:
        path = ROOT / "scripts/playthrough-autoturn.py"
        source = path.read_bytes()
        spec = importlib.util.spec_from_file_location("playthrough_autoturn", path)
        controller = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = controller
        try:
            exec(compile(source, str(path), "exec"), controller.__dict__)
        except BaseException:
            sys.modules.pop(spec.name, None)
            raise
        _AUTO_BATTLE = (controller, hashlib.sha256(source).hexdigest())
    return _AUTO_BATTLE


def read_position(emu):
    """Snapshot RAM without writes; guest pointers are offsets, never host pointers."""
    pointer = emu.lib.retro_get_memory_data(2)
    if not pointer:
        return {"valid": False, "reason": "ram_unavailable"}
    ram = C.string_at(pointer, RAM_SIZE)
    header, raw_x, raw_y, raw_z = struct.unpack_from("<Iiii", ram, 0x23B444)
    verified_header = struct.unpack_from("<H", ram, 0x246820)[0]
    position = {"valid": False, "header": header, "verifiedHeader": verified_header,
                "x": raw_x // 65536, "y": raw_y // 65536, "z": raw_z // 65536,
                "raw": {"x": raw_x, "y": raw_y, "z": raw_z}, "chain": {}}

    def read_guest(address, offset, fmt):
        width = struct.calcsize(fmt)
        if (address % 4 or not RAM_BASE <= address < RAM_BASE + RAM_SIZE
                or not RAM_BASE <= address + offset <= RAM_BASE + RAM_SIZE - width):
            raise ValueError("guest pointer or field outside aligned 4 MiB RAM")
        return struct.unpack_from(fmt, ram, address - RAM_BASE + offset)[0]

    # Every dereference, including the intermediate FieldPlayer+4 pointer, is guarded.
    name = "beacon"
    try:
        beacon = struct.unpack_from("<I", ram, 0x141800)[0]
        position["chain"][name] = beacon
        for name, offset in (("gameSystem", 0), ("field", 0x20),
                             ("fieldPlayer", 0x94), ("playerLink", 4), ("actor", 0x1C)):
            beacon = read_guest(beacon, offset, "<I")
            position["chain"][name] = beacon
        name = "actorCoordinates"
        position["actor"] = {"x": read_guest(beacon, 0x3C, "<h"),
                             "z": read_guest(beacon, 0x40, "<h")}
    except ValueError:
        position.update(reason="battle_or_invalid_field", invalidPointer=name)
        return position
    if header != verified_header:
        position["reason"] = "header_mismatch"
        return position
    position["valid"] = True
    return position


def validate_walk(waypoints):
    """Reject malformed routes before executing any legacy actions in the request."""
    if not isinstance(waypoints, list):
        raise ValueError("walk must be a list of {header:int, x:int, z:int} waypoints")
    for index, waypoint in enumerate(waypoints):
        if (not isinstance(waypoint, dict) or set(waypoint) != {"header", "x", "z"}
                or any(type(waypoint[key]) is not int for key in ("header", "x", "z"))):
            raise ValueError(f"walk[{index}] must contain only integer header, x and z")
        if (not 0 <= waypoint["header"] <= 65535
                or any(not -32768 <= waypoint[key] <= 32767 for key in ("x", "z"))):
            raise ValueError(f"walk[{index}] header/coordinates out of range")
        if index:
            previous = waypoints[index - 1]
            if (previous["header"] == waypoint["header"]
                    and previous["x"] != waypoint["x"] and previous["z"] != waypoint["z"]):
                raise ValueError(f"walk[{index}] is not axis-aligned with the previous waypoint")


def walk_waypoints(emu, waypoints, run_input):
    """Conservatively follow tiles; run_input logs *every* press and neutral frame."""
    start_frame = emu.frame
    current = read_position(emu)
    reached = steps = 0
    stationary_retry = False

    def finish(reason):
        return {"status": "reached" if reason == "reached" else "stopped", "reason": reason,
                "reachedWaypoints": reached, "remainingWaypoints": waypoints[reached:],
                "steps": steps, "frames": emu.frame - start_frame, "position": current,
                "maxSteps": WALK_MAX_STEPS, "maxFrames": WALK_MAX_FRAMES}

    def field_problem(position, origin):
        if "header" in position and position["header"] != origin["header"]:
            return "header_changed"
        if not position["valid"]:
            return position["reason"]
        if position["chain"] != origin["chain"]:
            return "field_changed"
        return None

    def same_place(left, right):
        return left["raw"] == right["raw"] and left["actor"] == right["actor"]

    while reached < len(waypoints):
        if not current["valid"]:
            return finish(current["reason"])
        waypoint = waypoints[reached]
        if current["header"] != waypoint["header"]:
            return finish("waypoint_header_mismatch")
        origin_tile = {key: current[key] for key in ("x", "z")}
        if current["actor"] != origin_tile:
            return finish("unsettled_position")
        dx, dz = waypoint["x"] - current["x"], waypoint["z"] - current["z"]
        if not dx and not dz:
            reached += 1
            stationary_retry = False
            continue
        if dx and dz:
            return finish("non_axis_aligned")
        if steps >= WALK_MAX_STEPS:
            return finish("step_limit")
        # Reserve the complete probe/press/wait attempt before sending any input.
        if emu.frame - start_frame + 2 * WALK_BURST_FRAMES + WALK_SETTLE_FRAMES > WALK_MAX_FRAMES:
            return finish("frame_limit")
        origin = current
        current = run_input(WALK_BURST_FRAMES, [], source="walk", phase="stability",
                            waypointIndex=reached)
        problem = field_problem(current, origin)
        if problem:
            return finish(problem)
        if not same_place(current, origin):
            return finish("uncommanded_movement")
        axis, direction = ("x", "right" if dx > 0 else "left") if dx else (
            "z", "down" if dz > 0 else "up")
        sign = 1 if (dx or dz) > 0 else -1
        target_tile = {**origin_tile, axis: origin_tile[axis] + sign}
        target_raw = {key: origin["raw"][key] for key in ("x", "z")}
        target_raw[axis] += sign * 65536

        def movement_problem(position, previous):
            problem = field_problem(position, origin)
            if problem:
                return problem
            tile = {key: position[key] for key in ("x", "z")}
            if tile not in (origin_tile, target_tile) or position["actor"] not in (origin_tile, target_tile):
                return "unexpected_position"
            for key in ("x", "z"):
                raw = position["raw"][key]
                low, high = sorted((origin["raw"][key], target_raw[key]))
                if not low <= raw <= high:
                    return "unexpected_position"
            if (sign * (position["raw"][axis] - previous["raw"][axis]) < 0
                    or sign * (position["actor"][axis] - previous["actor"][axis]) < 0):
                return "unexpected_position"
            return None

        steps += 1
        current = run_input(WALK_BURST_FRAMES, [direction], source="walk", phase="press",
                            waypointIndex=reached, attempt=steps)
        problem = movement_problem(current, origin)
        if problem:
            return finish(problem)  # emu.run already released buttons; no hidden frames.
        pressed = current
        current = run_input(WALK_SETTLE_FRAMES, [], source="walk", phase="settle",
                            waypointIndex=reached, attempt=steps)
        problem = movement_problem(current, pressed)
        if problem:
            return finish(problem)
        if (current["actor"] == target_tile
                and all(current["raw"][key] == target_raw[key] for key in ("x", "z"))):
            stationary_retry = False
            continue
        if same_place(pressed, origin) and same_place(current, origin):
            if stationary_retry:
                return finish("obstacle_or_no_control")
            stationary_retry = True  # One stationary retry for facing; no partial-motion retries.
            continue
        return finish("unsettled_position")
    return finish("reached")


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_render_resume(manifest, render_cores):
    previous = manifest.get("renderCores", 1)
    if previous != render_cores:
        raise RuntimeError("Render cores changed; resume refused. Cold boot from an ordinary raw save into a new output directory.")


def record_emulator_options(manifest, emu, render_cores):
    requested = str(render_cores)
    queried = emu.queried_options.get(b"desmume_num_cores")
    if queried != requested.encode():
        raise RuntimeError("Render cores query mismatch; gameplay refused")
    manifest.update({"renderCores": render_cores,
                     "requestedCoreOptions": {"desmume_num_cores": requested},
                     "queriedCoreOptions": {"desmume_num_cores": queried.decode()},
                     "runnerSha256": sha(Path(__file__)),
                     "harnessSha256": sha(ROOT / "scripts/emulator-check.py")})
    manifest.setdefault("emulatorLaunches", []).append({
        "atUnix": time.time(), "renderCores": render_cores,
        **{key: manifest[key] for key in ("requestedCoreOptions", "queriedCoreOptions",
                                         "runnerSha256", "harnessSha256")}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rom", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--render-cores", type=int, choices=(1, 2), default=1)
    parser.add_argument("--cold-save", type=Path)
    parser.add_argument("--replay", type=Path, help="Replay JSONL input requests only; no memory or save injection")
    args = parser.parse_args()
    rom = args.rom.resolve()
    out = args.out.resolve()
    core = ROOT / ".cache/emulator/desmume_libretro.dylib"
    digest, core_digest = sha(rom), sha(core)
    if args.resume and args.cold_save:
        parser.error("resume and cold-save are mutually exclusive")
    if args.resume:
        manifest = json.loads((out / "manifest.json").read_text())
        validate_render_resume(manifest, args.render_cores)
        if (manifest["romSha256"], manifest["coreSha256"]) != (digest, core_digest):
            raise RuntimeError("ROM/core changed; resume refused")
        previous = json.loads((out / "latest.json").read_text())
        if sha(out / "latest.state") != previous["stateSha256"]:
            raise RuntimeError("Latest state does not match the completed checkpoint; resume refused")
        frame, sequence = previous["frame"], previous["sequence"]
        for line in (out / "timeline.jsonl").read_text().splitlines():
            sequence = max(sequence, json.loads(line).get("sequence", 0))
    else:
        out.mkdir(parents=True, exist_ok=False)
        frame, sequence = 0, 0
        manifest = {"rom": str(rom), "romSha256": digest, "coreSha256": core_digest,
                    "startedAtUnix": time.time(), "freshGame": not bool(args.cold_save),
                    "initialRawSave": str(args.cold_save) if args.cold_save else None,
                    "initialRawSaveSha256": sha(args.cold_save) if args.cold_save else None,
                    "inputOnly": True, "physicalHardwareTested": False,
                    "command": sys.argv,
                    "inputReplay": str(args.replay) if args.replay else None,
                    "inputReplaySha256": sha(args.replay) if args.replay else None}
        (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    emu = module.Emulator(core, out, options={b"desmume_num_cores": str(args.render_cores).encode()})
    emu.load(rom, args.cold_save, out / "latest.state" if args.resume else None)
    record_emulator_options(manifest, emu, args.render_cores)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    emu.frame = frame
    rom_stat = rom.stat()
    print(json.dumps({"ready": True, "out": str(out), "romSha256": digest,
                      "frame": frame, "sequence": sequence}), flush=True)
    log = (out / "timeline.jsonl").open("a", buffering=1)
    if args.resume:
        log.write(json.dumps({"event": "resume", "fromSequence": previous["sequence"],
                              "nextSequence": sequence + 1, "frame": frame,
                              "stateSha256": previous["stateSha256"],
                              "atUnix": time.time(), "command": sys.argv}) + "\n")
    source = args.replay.open() if args.replay else sys.stdin
    for line in source:
        if not line.strip():
            continue
        request = json.loads(line)
        if request.get("quit"):
            break
        actions = canonicalize_actions(request.get("actions", []))
        repeat = request.get("repeat", 1)
        if type(repeat) is not int or repeat < 0:
            raise ValueError("repeat must be a nonnegative integer")
        if "walk" in request:
            validate_walk(request["walk"])
        controller = None
        if "autoBattle" in request:
            if "walk" in request:
                raise ValueError("autoBattle and walk must use separate requests")
            controller, controller_hash = auto_battle_controller()
            controller.validate_auto_battle(request["autoBattle"])
        if shutil.disk_usage(out).free < 64 * 1024 * 1024:
            raise RuntimeError("Less than 64 MiB free; input refused before advancing the checkpoint")
        sequence += 1
        label = re.sub(r"[^a-zA-Z0-9_-]+", "-", request.get("label", "step"))[:80]
        prefix = f"{sequence:04d}-{label}"
        start = time.monotonic()
        record = {"sequence": sequence, "startFrame": emu.frame, "request": request,
                  "romSha256": digest, "startedAtUnix": time.time()}
        log.write(json.dumps({**record, "event": "begin"}) + "\n")
        captures = []
        replay_actions = []

        def run_input(frames, buttons, touch=None, **context):
            before = read_position(emu)
            start_frame = emu.frame
            try:
                emu.run(frames, buttons, touch)
            finally:
                after = read_position(emu)
                action = {"frames": emu.frame - start_frame, "buttons": list(buttons)}
                if touch is not None:
                    action["touch"] = touch
                replay_actions.append(action)
                log.write(json.dumps({"event": "input", "sequence": sequence,
                                      "startFrame": start_frame, "frame": emu.frame,
                                      **action, "before": before, "after": after, **context,
                                      "request": {"actions": [action]}}) + "\n")
            return after

        for repeat in range(repeat):
            for index, action in enumerate(actions):
                run_input(action["frames"], action.get("buttons", []), action.get("touch"),
                          source="actions", repeat=repeat, actionIndex=index)
                if action.get("capture"):
                    name = f"{prefix}-{repeat:02d}-{index:03d}.png"
                    emu.screenshot(out / name)
                    captures.append(name)
        walk_result = walk_waypoints(emu, request["walk"], run_input) if "walk" in request else None
        auto_result = controller.run_auto_battle(emu, request["autoBattle"], run_input) if controller else None
        final_name = prefix + ".png"
        emu.screenshot(out / final_name)
        captures.append(final_name)
        staging = out / ".checkpoint-staging"
        staging.mkdir(exist_ok=True)
        emu.persist(staging)
        for name in ("latest.state", "latest.sav", "latest.ram"):
            if (staging / name).exists():
                (staging / name).replace(out / name)
        staging.rmdir()
        if request.get("checkpoint"):
            import gzip
            (out / (prefix + ".state.gz")).write_bytes(gzip.compress((out / "latest.state").read_bytes()))
            if (out / "latest.sav").exists():
                (out / (prefix + ".sav")).write_bytes((out / "latest.sav").read_bytes())
        current_stat = rom.stat()
        changed = (current_stat.st_size, current_stat.st_mtime_ns) != (rom_stat.st_size, rom_stat.st_mtime_ns)
        result = {**record, "event": "complete", "frame": emu.frame,
                  "replayRequest": {"label": label, "repeat": 1, "actions": replay_actions},
                  "wallSeconds": round(time.monotonic() - start, 3), "screenshots": captures,
                  "romFileChangedSinceLoad": changed,
                  "stateSha256": sha(out / "latest.state"),
                  "rawSaveSha256": sha(out / "latest.sav") if (out / "latest.sav").exists() else None}
        if walk_result is not None:
            result["walk"] = walk_result
        if auto_result is not None:
            result["autoBattle"] = auto_result
            result["autoBattleControllerSha256"] = controller_hash
        (out / "latest.json").write_text(json.dumps(result, indent=2) + "\n")
        log.write(json.dumps(result) + "\n")
        print(json.dumps(result), flush=True)
    log.close()
    if args.replay:
        source.close()
    emu.lib.retro_unload_game()
    emu.lib.retro_deinit()


if __name__ == "__main__":
    main()
