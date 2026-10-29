#!/usr/bin/env python3
"""Read-only RAM observation of a QA warp tour; never natural campaign proof."""
import argparse
import ctypes as C
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import sys
import time
from collections import deque

def report_fallback(out, report):
    """Keep a small failure record available when the report disk is unwritable."""
    line = json.dumps({'type': 'world-tour-result-fallback', 'reportPath': str(out / 'result.json'),
                       'pass': False, 'failure': report['failure'],
                       'finalizationErrors': report['finalizationErrors']}) + '\n'
    for stream in (sys.stderr, sys.stdout):
        try:
            stream.write(line)
            stream.flush()
            return
        except BaseException:
            # A broken output stream must not replace the original run error.
            continue

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, default=Path('build/world-tour/tour.json'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    started = time.monotonic()
    records, house_records, puzzle_records, movements = [], [], [], []
    success, failure = False, None
    emulator, core = None, None
    output_ready = loaded = ram_ready = boot_failed = False
    finalization_errors = []
    report = {'pass': False, 'failure': None, 'sourceSha256': None, 'fixtureSha256': None,
              'coreSha256': None, 'visited': 0, 'expected': None, 'records': records,
              'houses': house_records, 'puzzles': puzzle_records, 'finalObservedZone': None,
              'fixtureOnly': True, 'naturalCampaignProof': False, 'ordinarySaveInEveryArea': False,
              'hardwareTested': False, 'finalizationErrors': []}

    def attempt(stage, action):
        try:
            return action()
        except BaseException as error:
            finalization_errors.append(error)
            report['finalizationErrors'].append({'stage': stage, 'type': type(error).__name__,
                                                'message': str(error) or type(error).__name__})

    def update_outcome():
        report['pass'] = success and not finalization_errors
        report['failure'] = failure
        if failure is None and finalization_errors:
            first = report['finalizationErrors'][0]
            report['failure'] = f"Finalization failed: {first['stage']}: {first['message']}"

    try:
        if args.out.exists():
            raise RuntimeError('Use a new output directory for an independent tour')
        args.out.mkdir(parents=True)
        output_ready = True
        fixture = json.loads(args.fixture.read_text())
        report['sourceSha256'] = fixture['sourceSha256']
        report['fixtureSha256'] = fixture.get('romSha256')
        report['expected'] = len(fixture['scenes'])
        rom = args.fixture.with_suffix('.nds')
        if hashlib.sha256(rom.read_bytes()).hexdigest() != fixture['romSha256']:
            raise RuntimeError('Tour ROM hash mismatch')
        core = Path(__file__).resolve().parents[1] / '.cache/emulator/desmume_libretro.dylib'
        from PIL import Image
        spec = importlib.util.spec_from_file_location('emulator_check', Path(__file__).with_name('emulator-check.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        emulator = module.Emulator(core, args.out)
        emulator.load(rom, args.fixture.with_suffix('.sav'))
        loaded = True
        pointer = emulator.lib.retro_get_memory_data(2)
        if emulator.lib.retro_get_memory_size(2) != 0x400000 or not pointer:
            raise RuntimeError('Unexpected DS RAM interface')
        ram_ready = True
        def zone():
            # Guarded IREO map-header cache, read only. It is not a progress edit.
            return struct.unpack('<I', C.string_at(pointer + 0x246820, 4))[0]
        def position():
            current, x, _, z = struct.unpack('<Iiii', C.string_at(pointer + 0x23B444, 16))
            if current != zone():
                raise RuntimeError('Live position disagrees with native header cache')
            return current, x // 65536, z // 65536
        walks = {row['zoneId']: row for row in fixture.get('walkMaps', [])}
        removed_actors = set()
        def work_value(work_id):
            def r32(address):
                if not 0x02000000 <= address <= 0x023ffffc:
                    raise RuntimeError('Native read pointer outside main RAM')
                return struct.unpack('<I', C.string_at(pointer+address-0x02000000,4))[0]
            beacon=r32(0x02141800)
            game=r32(beacon+4)
            storage=r32(r32(game)+0x10)
            directory=r32(storage+0x2c)
            table=r32(directory+0x14)
            block=r32(storage+0x34)+r32(table+45*12+8)
            address=block+2*(work_id-0x4000)
            if not 0x02000000 <= address <= 0x023ffffe:
                raise RuntimeError('Native work read outside main RAM')
            return struct.unpack('<H',C.string_at(pointer+address-0x02000000,2))[0]
        def walk_to(x, z):
            current, sx, sz = position()
            grid = walks[current]
            width, height = grid['width'], grid['height']
            blocked = set(grid['blocked'])
            blocked.update(p['z'] * width + p['x'] for p in grid['npcs'] if (current,p.get('index')) not in removed_actors)
            for t in grid['triggers']:
                blocked.update(zz * width + xx for zz in range(t['z'], t['z']+t['h'])
                               for xx in range(t['x'], t['x']+t['w']))
            start, goal = sz * width + sx, z * width + x
            if goal in blocked:
                raise RuntimeError(f'Walking target is occupied: {current}:{x},{z}')
            queue, previous = deque([start]), {start: None}
            while queue and goal not in previous:
                key = queue.popleft()
                px, pz = key % width, key // width
                for nx, nz in [(px-1,pz),(px+1,pz),(px,pz-1),(px,pz+1)]:
                    target = nz * width + nx
                    if 0 <= nx < width and 0 <= nz < height and target not in blocked and target not in previous:
                        previous[target] = key
                        queue.append(target)
            if goal not in previous:
                raise RuntimeError(f'No ordinary walking path: {current}:{sx},{sz} to {x},{z}')
            route, cursor = [], goal
            while cursor != start:
                route.append(cursor)
                cursor = previous[cursor]
            for target in reversed(route):
                _, px, pz = position()
                nx, nz = target % width, target // width
                direction = {(1,0):'right',(-1,0):'left',(0,1):'down',(0,-1):'up'}[(nx-px,nz-pz)]
                for frames in range(80):
                    emulator.run(1, [direction])
                    observed = position()
                    if observed == (current, nx, nz):
                        break
                    if observed != (current, px, pz):
                        raise RuntimeError(f'Unexpected walk movement: {observed}')
                else:
                    raise RuntimeError(f'Walking stalled: {current}:{px},{pz} {direction}')
                emulator.run(16)
                if position() != (current, nx, nz):
                    raise RuntimeError('Walking overshot one tile')
                movements.append({'zone':current,'from':[px,pz],'to':[nx,nz],'button':direction,'frames':frames+1})
        emulator.run(600)
        for _ in range(5):
            emulator.run(3, ['a']); emulator.run(180)
        emulator.run(600)
        if zone() != fixture['original']['zoneId']:
            boot_failed = True
            raise RuntimeError('QA continue did not reach its original map')
        for index, scene in enumerate(fixture['scenes']):
            emulator.run(15, ['down']); emulator.run(240)
            observed = zone()
            filename = f"{index:03d}-{scene['zoneId']}-{scene['chunk']}.png"
            video = emulator.screenshot(args.out / filename)
            observed_position = position()
            with Image.open(args.out / filename) as rendered:
                upper = rendered.crop((0, 0, rendered.width, rendered.height // 2)).convert('RGB')
                upper_colors = len(upper.getcolors(upper.width * upper.height) or [])
            record = {**scene, 'observedZone': observed, 'observedPosition': list(observed_position),
                      'upperScreenColors': upper_colors, 'screenshot': filename, **video}
            records.append(record)
            (args.out / 'progress.json').write_text(json.dumps(records, indent=2)+'\n')
            expected_position = (scene['zoneId'], scene['tileX'], scene['tileZ'])
            if observed_position != expected_position:
                raise RuntimeError(f"Scene {index}: expected {expected_position}, observed {observed_position}")
            if upper_colors < 20:
                raise RuntimeError(f'Scene {index}: blank or unrendered upper screen')
            if fixture.get('houseTour') and scene['kind'] == 'town' and scene['chunk'] == 0:
                for house in [h for h in fixture['houses'] if h['townHeaderId'] == scene['zoneId']]:
                    walk_to(house['street']['x'], house['street']['z'])
                    before = position()
                    stem = f"house-{house['headerId']}"
                    emulator.screenshot(args.out / (stem+'-door.png'))
                    emulator.run(15, ['up']); emulator.run(240)
                    if position() != (house['headerId'],house['landing']['x'],house['landing']['z']):
                        raise RuntimeError(f'Native house entry failed: {house["id"]}: {position()}')
                    emulator.screenshot(args.out / (stem+'-inside.png'))
                    emulator.run(15, ['down']); emulator.run(240)
                    if position() != before:
                        raise RuntimeError(f'Native house return failed: {house["id"]}: {position()}')
                    emulator.screenshot(args.out / (stem+'-return.png'))
                    house_records.append({'id':house['id'],'headerId':house['headerId'],'door':house['door'],
                      'street':house['street'],'actualEntryAndReturn':True,'screenshots':[stem+s+'.png' for s in ['-door','-inside','-return']]})
                    (args.out / 'houses.json').write_text(json.dumps(house_records,indent=2)+'\n')
                # The QA tour trigger covers the original arrival tile; approach
                # it from the north only after both real doors have been tested.
                walk_to(scene['tileX'],scene['tileZ']-1)
            if fixture.get('verifyPuzzles') and scene['kind'] == 'gym':
                puzzle = next(g for g in fixture['puzzles'] if g['headerId'] == scene['zoneId'])
                walk_to(15,13)
                before = position()
                emulator.run(40,['up']); emulator.run(20)
                if position() != before:
                    raise RuntimeError('Unsolved Gym gate did not block walking')
                emulator.screenshot(args.out / f"gym-{scene['zoneId']}-blocked.png")
                order = puzzle['puzzle']['order']
                # Reject an incorrect start, then explicitly reset PARTIAL
                # progress before solving the entire native puzzle again.
                visits = [order[1], order[0], order[2], *order]
                expected_stages = [0, 1, 0, 1, 2, 3]
                stages = []
                for number,station in enumerate(visits):
                    control = puzzle['controls'][station]
                    walk_to(control['x'],control['z']+1)
                    emulator.run(3,['up']); emulator.run(20)
                    emulator.run(12,['a']); emulator.run(180)
                    message = puzzle['wrong'] if number in [0,2] else puzzle['done'] if number==5 else control['correct']
                    emulator.screenshot(args.out / f"gym-{scene['zoneId']}-response-{number}.png")
                    for _ in range(message['pages']):
                        emulator.run(12,['a']); emulator.run(120)
                    stage = work_value(0x4000)
                    if stage != expected_stages[number] or work_value(0x4001) != scene['zoneId']-775:
                        raise RuntimeError(f"Gym switch state mismatch: {scene['zoneId']} step{number} stage{stage}")
                    stages.append(stage)
                    emulator.screenshot(args.out / f"gym-{scene['zoneId']}-switch-{number}.png")
                    if number == 2:
                        walk_to(15,13)
                        reset_position = position()
                        emulator.run(40,['up']); emulator.run(20)
                        if position() != reset_position:
                            raise RuntimeError('Reset Gym gate did not block walking')
                        emulator.screenshot(args.out / f"gym-{scene['zoneId']}-reset-blocked.png")
                removed_actors.add((scene['zoneId'],puzzle['puzzle']['blockerNpc']))
                walk_to(15,11)
                emulator.screenshot(args.out / f"gym-{scene['zoneId']}-crossed.png")
                puzzle_records.append({'headerId':scene['zoneId'],'wrongThenCorrectStages':stages,
                                       'partialProgressReset':True,'blockedAfterReset':True,
                                       'blockedBefore':True,'crossedAfter':True})
                (args.out / 'puzzles.json').write_text(json.dumps(puzzle_records,indent=2)+'\n')
                walk_to(scene['tileX'],scene['tileZ']-1)
            if (index + 1) % 24 == 0:
                print(json.dumps({'visited': index+1, 'total': len(fixture['scenes'])}), flush=True)
        emulator.run(15, ['down']); emulator.run(240)
        if zone() != fixture['original']['zoneId']:
            raise RuntimeError('Final return to native Unova failed')
        success = True
    except BaseException as error:
        failure = str(error) or type(error).__name__
        raise
    finally:
        # Each artifact is independent: a screenshot or state write must not
        # suppress the result or replace the original bootstrap/tour exception.
        if loaded:
            if boot_failed:
                attempt('boot-failure.png', lambda: emulator.screenshot(args.out / 'boot-failure.png'))
            attempt('final.png', lambda: emulator.screenshot(args.out / 'final.png'))
            attempt('persist', lambda: emulator.persist(args.out))
        if output_ready:
            attempt('walk-actions.json', lambda: (args.out / 'walk-actions.json').write_text(
                json.dumps(movements, indent=2) + '\n'))
        if core is not None:
            report['coreSha256'] = attempt('coreSha256', lambda: hashlib.sha256(core.read_bytes()).hexdigest())
        if ram_ready:
            report['finalObservedZone'] = attempt('finalObservedZone', zone)
        report['visited'] = len(records)
        report['seconds'] = round(time.monotonic() - started, 2)
        update_outcome()
        if output_ready:
            def write_result():
                # Publish only complete JSON; disk-full failures go to the streams.
                temporary = args.out / 'result.json.tmp'
                temporary.write_text(json.dumps(report, indent=2) + '\n')
                temporary.replace(args.out / 'result.json')
            errors_before = len(finalization_errors)
            attempt('result.json', write_result)
            report_written = len(finalization_errors) == errors_before
        else:
            # Never overwrite evidence in an output directory we did not create.
            report_written = False
        if not report_written:
            update_outcome()
            report_fallback(args.out, report)
        if failure is None and finalization_errors:
            raise finalization_errors[0]

if __name__ == '__main__':
    main()
