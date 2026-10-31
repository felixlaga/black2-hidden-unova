"""Bounded input-only running, for a caller-approved visible field in header 108.

The caller must explicitly approve the known visible field before calling. This
helper checks position only; it makes no claim about scene or encounter safety.
"""
from copy import deepcopy

SCALE = 65536
MAX_FRAMES = 600
MAX_TILES = 64
STALL_FRAMES = 32
STEP_FRAMES = 96
CHAIN_KEYS = {'beacon', 'gameSystem', 'field', 'fieldPlayer', 'playerLink', 'actor'}


def validate_run_path(spec):
    """Validate the entire request before any input; raise ValueError on failure."""
    if (type(spec) is not dict or not {'start', 'waypoints'} <= spec.keys()
            or not spec.keys() <= {'start', 'waypoints', 'maxFrames'}):
        raise ValueError('expected start, waypoints, and optional maxFrames')
    budget = spec.get('maxFrames', MAX_FRAMES)
    if type(budget) is not int or not 1 <= budget <= MAX_FRAMES:
        raise ValueError('maxFrames must be an integer in 1..600')
    points = spec['waypoints']
    if type(points) is not list or not 1 <= len(points) <= MAX_TILES:
        raise ValueError('waypoints must contain 1..64 points')
    previous = None
    distance = 0
    for point in [spec['start'], *points]:
        if (type(point) is not dict or set(point) != {'header', 'x', 'z'}
                or any(type(point[k]) is not int for k in point)
                or point['header'] != 108
                or any(not -32768 <= point[k] <= 32767 for k in ('x', 'z'))):
            raise ValueError('points require header 108 and signed 16-bit integer x/z')
        if previous is not None:
            dx, dz = point['x'] - previous['x'], point['z'] - previous['z']
            if dx and dz:
                raise ValueError('every leg must be axis aligned, including the first')
            distance += abs(dx) + abs(dz)
        previous = point
    if not 1 <= distance <= MAX_TILES:
        raise ValueError('path must travel 1..64 tiles')
    return deepcopy(spec)


def run_path(emu, spec, run_input, read_position):
    """Run an approved path with logged single-frame inputs and read-only snapshots.

    run_input has the runner callback signature. Its returned snapshot is ignored:
    read_position(emu) is called after every action. No emulator methods are used.
    """
    spec = validate_run_path(spec)
    budget = spec.get('maxFrames', MAX_FRAMES)
    frames = reached = steps = 0
    current = deepcopy(read_position(emu))
    chain = None

    def finish(reason):
        return {'status': 'reached' if reason == 'reached' else 'stopped',
                'reason': reason, 'frames': frames, 'steps': steps,
                'reachedWaypoints': reached,
                'remainingWaypoints': deepcopy(spec['waypoints'][reached:]),
                'position': current, 'maxFrames': budget}

    def field_problem(p):
        if type(p) is not dict or p.get('valid') is not True:
            return 'invalid_field'
        if p.get('header') != 108 or p.get('verifiedHeader') != 108:
            return 'header_changed'
        c = p.get('chain')
        if (type(c) is not dict or set(c) != CHAIN_KEYS
                or any(type(v) is not int or v % 4 or not 0x02000000 <= v < 0x02400000 for v in c.values())):
            return 'invalid_chain'
        if chain is not None and c != chain:
            return 'field_changed'
        for part, keys in (('raw', {'x', 'y', 'z'}), ('actor', {'x', 'z'})):
            value = p.get(part)
            if type(value) is not dict or set(value) != keys or any(type(v) is not int for v in value.values()):
                return 'invalid_position'
        if any(not -(2**31) <= v < 2**31 for v in p['raw'].values()):
            return 'invalid_position'
        if any(not -32768 <= v <= 32767 for v in p['actor'].values()):
            return 'invalid_position'
        if any(type(p.get(k)) is not int or p[k] != p['raw'][k] // SCALE for k in ('x', 'z')):
            return 'invalid_position'
        return None

    problem = field_problem(current)
    if problem:
        return finish(problem)
    chain = deepcopy(current['chain'])
    start = spec['start']
    if any(current['actor'][k] != start[k] or current['raw'][k] != start[k] * SCALE + SCALE // 2 for k in ('x', 'z')):
        return finish('start_mismatch_or_unsettled')
    for waypoint in spec['waypoints']:
        while any(current['actor'][k] != waypoint[k] for k in ('x', 'z')):
            origin = deepcopy(current)
            axis = 'x' if current['actor']['x'] != waypoint['x'] else 'z'
            sign = 1 if waypoint[axis] > current['actor'][axis] else -1
            direction = {('x', 1): 'right', ('x', -1): 'left', ('z', 1): 'down', ('z', -1): 'up'}[axis, sign]
            target = dict(origin['actor'])
            target[axis] += sign
            target_raw = {k: target[k] * SCALE + SCALE // 2 for k in ('x', 'z')}
            committed = False
            stalled = 0
            steps += 1
            for step_frame in range(STEP_FRAMES):
                if frames >= budget:
                    return finish('frame_limit')
                previous = current
                run_input(1, [] if committed else ['b', direction], source='runPath',
                          phase='settle' if committed else 'press', waypointIndex=reached, step=steps)
                frames += 1
                current = deepcopy(read_position(emu))
                problem = field_problem(current)
                if problem:
                    return finish(problem)
                if current['actor'] not in (origin['actor'], target):
                    return finish('unexpected_movement')
                for k in ('x', 'z'):
                    low, high = sorted((origin['raw'][k], target_raw[k]))
                    if not low <= current['raw'][k] <= high:
                        return finish('unexpected_movement')
                if (sign * (current['raw'][axis] - previous['raw'][axis]) < 0
                        or sign * (current['actor'][axis] - previous['actor'][axis]) < 0):
                    return finish('unexpected_movement')
                committed = committed or current['actor'] == target
                if committed and all(current['raw'][k] == target_raw[k] for k in ('x', 'z')):
                    break
                stationary = (all(current['raw'][k] == previous['raw'][k] for k in ('x', 'z'))
                              and current['actor'] == previous['actor'])
                stalled = stalled + 1 if stationary else 0
                if stalled >= STALL_FRAMES:
                    return finish('obstacle_or_no_control')
            else:
                return finish('step_limit')
        reached += 1
    return finish('reached')
