#!/usr/bin/env python3
"""Bounded, screenshot-only battle controller; all advances belong to run_input.

validate_auto_battle raises ValueError before caller actions. References describe
UI, not a particular opponent. No RAM, saves, ROMs or direct emulator advances.
"""
import ctypes as C
import hashlib
import io
from pathlib import Path
import re
import shutil
import subprocess
import time

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DEFAULTS = ROOT / 'tests/fixtures/autoturn/templates.json'
ACTIVE = (152, 108, 207, 122)  # search window; text_digest isolates name line
OPPONENT = (19, 28, 74, 40)  # name only, excluding level/gender/HP
PROMPT = (0, 153, 130, 168)
# Exact stable UI regions; PP lives below the move-name strips.
FIGHT_BOXES = ((0, 210, 256, 315), (0, 344, 256, 384))
# Exact retained 0292/0293 command variant, including its selection corners.
FIGHT_VARIANTS = frozenset({'091dcc9158a3b7b45229e76cb089f7a2b80ceba6a5c257f7ffb281c46fcbd019'})
MOVE_BOXES = ((0, 225, 256, 250), (0, 275, 256, 299), (0, 318, 256, 384))
TOUCHES = {1: [58, 55], 2: [190, 55], 3: [58, 110], 4: [190, 110]}
PP_BOXES = {1: (70, 251, 111, 264), 2: (198, 251, 239, 264),
            3: (70, 299, 111, 312), 4: (198, 299, 239, 312)}
# Actual 10px glyphs from retained PP fields. Unknown glyphs fail closed.
GLYPHS = {
 '0': [' ### ','#   #','#   #','#   #','#   #','#   #','#   #','#   #','#   #',' ### '],
 '1': [' #','##',' #',' #',' #',' #',' #',' #',' #',' #'],
 '2': [' ### ','#   #','    #','    #','   # ','  #  ','  #  ',' #   ','#    ','#####'],
 '3': [' ### ','#   #','#   #','    #','  ## ','    #','    #','#   #','#   #',' ### '],
 '4': ['  ## ',' # # ',' # # ',' # # ',' # # ','#  # ','#  # ','#####','   # ','   # '],
 '5': ['#####','#    ','#    ','#    ','#### ','    #','    #','#   #','#   #',' ### '],
 '6': [' ### ','#   #','#    ','#    ','#### ','#   #','#   #','#   #','#   #',' ### '],
 '7': ['#####','    #','    #','   # ','   # ','   # ','  #  ','  #  ','  #  ','  #  '],
 '8': [' ### ','#   #','#   #','#   #',' ### ','#   #','#   #','#   #','#   #',' ### '],
 '9': [' ### ','#   #','#   #','#   #','#   #',' ####','    #','    #','#   #',' ### '],
}


def digest(image, boxes):
    return hashlib.sha256(b''.join(image.crop(b).tobytes() for b in boxes)).hexdigest()


def text_digest(image, box):
    # HUD text shifts vertically by one pixel between retained frames. Normalize
    # only the binary white ink, excluding the changing scene behind the HUD.
    crop = image.crop(box)
    if box == ACTIVE:
        # Native name ink starts at y110..113 and is seven pixels high.
        # The adjacent HP label can start at y119, so bounding the entire
        # window can accidentally append HP ink. Find only the leading name
        # row above y116, then retain all seven rows across the full name area.
        first = next((y for y in range(8) if any(
            min(crop.getpixel((x, y))) > 200 for x in range(crop.width))), None)
        if first is None:
            return 'absent'
        crop = crop.crop((0, first, crop.width, first+7))
    mask = Image.new('L', crop.size)
    mask.putdata([255 if min(pixel) > 200 else 0 for pixel in crop.getdata()])
    bounds = mask.getbbox()
    if not bounds:
        return 'absent'
    crop = mask.crop(bounds)
    return hashlib.sha256(str(crop.size).encode() + crop.tobytes()).hexdigest()


def load_image(path):
    with Image.open(path) as image:
        if image.size != (256, 384):
            raise ValueError('unsupported_reference_size')
        return image.convert('RGB')


def references(request):
    import json
    defaults = json.loads(DEFAULTS.read_text())
    fight = load_image(request.get('mainCommandScreenshot', ROOT / defaults['mainCommandScreenshot']))
    moves = load_image(request.get('moveMenuScreenshot', ROOT / defaults['moveMenuScreenshot']))
    animation = load_image(ROOT / defaults['animationScreenshot'])
    return fight, moves, animation


def validate_auto_battle(request):
    """Raise ValueError for invalid requests; no emulator access and no inputs."""
    if not isinstance(request, dict) or set(request) - {
        'mainCommandScreenshot', 'moveMenuScreenshot', 'moveSlot', 'maxTurns', 'maxFrames'}:
        raise ValueError('invalid_auto_battle_request')
    for key, default, low, high in [('moveSlot', 3, 1, 4), ('maxTurns', 12, 1, 12),
                                    ('maxFrames', 15000, 1, 15000)]:
        value = request.get(key, default)
        if type(value) is not int or not low <= value <= high:
            raise ValueError('invalid_' + key)
    if not shutil.which('tesseract'):
        raise ValueError('tesseract_required')
    try:
        fight, moves, _ = references(request)
        if text_digest(fight, ACTIVE) != text_digest(moves, ACTIVE):
            raise ValueError('active_name_reference_mismatch')
        # Only the retained UI is authorized. Arbitrary images cannot approve a
        # learn/switch menu as FIGHT or as a move menu.
        trusted_fight, trusted_moves, _ = references({})
        if digest(fight, FIGHT_BOXES) != digest(trusted_fight, FIGHT_BOXES):
            raise ValueError('unapproved_command_ui')
        if digest(moves, MOVE_BOXES) != digest(trusted_moves, MOVE_BOXES):
            raise ValueError('unapproved_move_ui')
    except (OSError, KeyError, TypeError) as error:
        raise ValueError('invalid_reference') from error


def read_frame(emu):
    """Copy only the core video callback buffer; never advance the emulator."""
    pointer, width, height, pitch = emu.last_video
    fmt = emu.pixel_format
    bpp = 4 if fmt == 1 else 2
    if not pointer or (width, height) != (256, 384) or fmt not in (0, 1, 2) or not width*bpp <= pitch <= 4096:
        raise ValueError('unsupported_video')
    pixels = C.string_at(pointer, pitch * height)
    if fmt == 1:
        return Image.frombytes('RGB', (width, height), pixels, 'raw', 'BGRX', pitch)
    shift = 6 if fmt == 2 else 5
    rgb = bytearray(width * height * 3)
    for y in range(height):
        for x in range(width):
            offset = y*pitch + x*2
            value = pixels[offset] | pixels[offset+1] << 8
            dest = (y*width+x)*3
            rgb[dest:dest+3] = bytes((((value >> (shift+5)) & 31)*255//31,
                                    ((value >> 5) & ((1 << shift)-1))*255//((1 << shift)-1),
                                    (value & 31)*255//31))
    return Image.frombytes('RGB', (width, height), bytes(rgb))


def ocr(image, psm=7, digits=False):
    buffer = io.BytesIO(); image.save(buffer, format='PNG')
    command = ['tesseract', 'stdin', 'stdout', '--psm', str(psm)]
    if digits:
        command += ['-c', 'tessedit_char_whitelist=0123456789/']
    return subprocess.run(command, input=buffer.getvalue(), capture_output=True,
                          check=True, timeout=2).stdout.decode().strip()


def read_pp(image, slot):
    """Exact retained-font matching; unknown digits stop without inference."""
    x0, y0, x1, y1 = PP_BOXES[slot]
    # Exact font strips: count and total separated by the retained slash.
    y = 252 if slot <= 2 else 300
    strip = image.crop((x0, y, x1, y+11))
    columns = [any(min(strip.getpixel((x, yy))) > 200 for yy in range(11)) for x in range(strip.width)]
    groups = []; x = 0
    while x < strip.width:
        if not columns[x]: x += 1; continue
        end = x+1
        while end < strip.width and columns[end]: end += 1
        rows = [''.join('#' if min(strip.getpixel((xx, yy))) > 200 else ' ' for xx in range(x, end)) for yy in range(10)]
        match = next((d for d, pattern in GLYPHS.items() if rows == pattern), None)
        # slash occupies 11 rows and is uniquely diagonal; don't treat any
        # unknown shape as punctuation.
        slash = ['     ', '    #', '    #', '   # ', '   # ', '  #  ', '  #  ', ' #   ', ' #   ', '#    ', '#    ']
        full = [''.join('#' if min(strip.getpixel((xx, yy))) > 200 else ' ' for xx in range(x, end)) for yy in range(11)]
        groups.append(match if match else '/' if full == slash else '?')
        x = end
    raw = ''.join(groups)
    if re.fullmatch(r'\d{1,2}/\d{1,2}', raw):
        current, total = map(int, raw.split('/'))
        if 0 <= current <= total <= 64 and total > 0:
            return {'current': current, 'total': total, 'method': 'retained_font', 'raw': raw}
    return {'current': None, 'method': 'unreadable', 'raw': raw}


def run_auto_battle(emu, request, run_input):
    """Repeat approved submissions until a bounded stop. turns counts submissions."""
    validate_auto_battle(request)
    fight, moves, animation = references(request)
    slot = request.get('moveSlot', 3)
    max_turns, max_frames = request.get('maxTurns', 12), request.get('maxFrames', 15000)
    started = time.monotonic(); start_frame = emu.frame
    evidence, actions = [], []
    turns = 0; opponent = None; awaiting = False; unknown_frames = 0
    menu_transition_frames = 0
    last_pp = None; opened = False; menu_wait = 0

    def finish(reason):
        return {'status': 'needsDecision', 'needsDecision': True, 'reason': reason,
                'turns': turns, 'frames': emu.frame-start_frame, 'startFrame': start_frame,
                'endFrame': emu.frame, 'actions': actions, 'evidence': evidence,
                'elapsedSeconds': round(time.monotonic()-started, 3),
                'scope': 'move_submissions_not_completed_turns'}

    def advance(count, touch, phase):
        remaining = max_frames - (emu.frame-start_frame)
        count = min(count, remaining)
        if count <= 0: return False
        before = emu.frame
        try:
            run_input(count, [], touch=touch, source='autoBattle', phase=phase)
        finally:
            actions.append({'startFrame': before, 'frames': emu.frame-before,
                            'buttons': [], 'touch': touch, 'phase': phase})
        if emu.frame-before != count: raise ValueError('frame_accounting_mismatch')
        return True

    try:
        while True:
            if time.monotonic()-started >= 58: return finish('runtime_limit')
            if emu.frame-start_frame >= max_frames: return finish('frame_limit')
            image = read_frame(emu)
            if image.size != (256, 384): return finish('unsupported_frame')
            screen = ('fight' if digest(image, FIGHT_BOXES) in (FIGHT_VARIANTS | {digest(fight, FIGHT_BOXES)})
                      else 'moves' if digest(image, MOVE_BOXES) == digest(moves, MOVE_BOXES)
                      else 'animation' if digest(image, [(0, 210, 256, 384)]) == digest(animation, [(0, 210, 256, 384)])
                      else 'unknown_choice_or_transition')
            row = {'frame': emu.frame, 'screen': screen, 'activeNameSha256': text_digest(image, ACTIVE),
                   'opponentNameSha256': text_digest(image, OPPONENT),
                   'promptSha256': text_digest(image, PROMPT)}
            evidence.append(row)
            if screen != 'unknown_choice_or_transition':
                menu_transition_frames = 0
            if screen in ('fight', 'moves'):
                unknown_frames = 0
                if row['activeNameSha256'] != text_digest(moves, ACTIVE): return finish('active_changed')
                if opponent is None: opponent = row['opponentNameSha256']
                if row['opponentNameSha256'] != opponent: return finish('opponent_changed')
                if row['promptSha256'] != text_digest(moves, PROMPT): return finish('unexpected_prompt')
                # Confident red/yellow active HP pixels are sufficient to stop;
                # absence of readable HP is not treated as healthy.
                hp = image.crop((192, 121, 240, 125))
                low_pixels = sum((r > 110 and r > g*1.4 and r > b*1.4) or
                                 (r > 150 and g > 100 and b < 60) for r,g,b in hp.getdata())
                if low_pixels >= 4:
                    return finish('low_hp')
                if screen == 'fight':
                    if awaiting:
                        awaiting = False; opened = False
                    if turns >= max_turns: return finish('turn_limit')
                    if opened:  # held/stale menu; release and observe before retry
                        if not advance(12, None, 'wait_for_moves'): return finish('frame_limit')
                        menu_wait += 12
                        if menu_wait >= 120: return finish('menu_open_timeout')
                        continue
                    advance(1, [128, 95], 'open_fight'); opened = True; menu_wait = 0
                    # Live retained opening is still transitional after 12 frames.
                    # Use the worker's proven neutral settle, never a confirm.
                    advance(90, None, 'release_fight')
                    continue
                if awaiting:
                    # A still-displayed move menu never authorizes a duplicate.
                    if not advance(30, None, 'wait_submission'): return finish('frame_limit')
                    menu_wait += 30
                    if menu_wait >= 180: return finish('submission_unconfirmed')
                    continue
                pp = read_pp(image, slot); row['pp'] = pp
                if pp['current'] is None: return finish('pp_unreadable')
                if pp['current'] < 1: return finish('pp_empty')
                if last_pp is not None and pp['current'] >= last_pp: return finish('pp_not_decreased')
                if turns >= max_turns: return finish('turn_limit')
                last_pp = pp['current']
                if not advance(1, TOUCHES[slot], 'submit_move'): return finish('frame_limit')
                turns += 1; awaiting = True; opened = False; menu_wait = 0
                advance(90, None, 'release_move')
                continue
            if screen == 'unknown_choice_or_transition':
                # A submitted turn can return through a tinted command-menu
                # fade. Wait briefly without confirming any unknown choice.
                # An unfamiliar initial screen still receives no inputs.
                if awaiting or opened:
                    if menu_transition_frames >= 120:
                        return finish('unrecognized_choice_or_transition')
                    advance(30, None, 'menu_transition')
                    menu_transition_frames += 30
                    continue
                # Unrecognized initial menus receive no inputs: catches learn,
                # evolution, switch, party, end/overworld, and altered moves.
                lower = image.crop((0, 210, 256, 384))
                extrema = lower.getextrema()
                if all(high-low <= 8 for low, high in extrema):
                    unknown_frames += 12
                    if unknown_frames > 120: return finish('transition_timeout')
                    advance(12, None, 'blank_transition')
                    continue
                return finish('unrecognized_choice_or_transition')
            # Only retained noninteractive battle lower-screen may wait. Text
            # can end the loop, but can NEVER authorize a button or touch.
            text = ocr(ImageOps.expand(ImageOps.invert(image.crop((0, 146, 256, 188))).resize((768,126)), 10, 255), psm=6)
            row['promptText'] = text
            if re.search(r'learn|forget|replace|evol|switch|send|fainted|winning|won|defeated|give up', text, re.I):
                return finish('choice_or_battle_end')
            unknown_frames += 30
            if unknown_frames > 1800: return finish('animation_timeout')
            if not advance(30, None, 'battle_animation'): return finish('frame_limit')
    except (ValueError, AttributeError, TypeError, subprocess.SubprocessError, OSError) as error:
        return finish('observation_or_input_error:' + str(error))
