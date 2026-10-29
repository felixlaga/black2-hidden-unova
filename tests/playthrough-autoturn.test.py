#!/usr/bin/env python3
"""Retained-image, synthetic-frame loop tests. No emulator/core/ROM is opened."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('autoturn', ROOT/'scripts/playthrough-autoturn.py')
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
BASE = ROOT/'tests/fixtures/autoturn/e820-cold-02'


def retained(name):
    return a.load_image(BASE/name)


def pp(image, count, slot=1):
    """Mutate only count ink, retaining actual menu, slash and total pixels."""
    image = image.copy(); y = 252 if slot <= 2 else 300
    xend = 86 if slot in (1, 3) else 214
    image.paste((24, 24, 24), (xend-16, y, xend, y+11))
    x = xend - sum(len(a.GLYPHS[d][0])+1 for d in str(count))+1
    for digit in str(count):
        for dy, row in enumerate(a.GLYPHS[digit]):
            for dx, bit in enumerate(row):
                if bit == '#': image.putpixel((x+dx, y+dy), (246,246,246))
        x += len(a.GLYPHS[digit][0])+1
    return image


class Tests(unittest.TestCase):
    def setUp(self):
        self.fight, self.moves, self.animation = a.references({})
        # Compose retained lower FIGHT with current upper identity. This is a
        # synthetic same-foe sequence, explicitly not a live battle recording.
        self.same_fight = self.moves.copy()
        self.same_fight.paste(self.fight.crop((0,210,256,384)), (0,210))

    def run_loop(self, sequence, request=None, fail_input=False):
        emu = SimpleNamespace(frame=100)
        index = 0; calls = []
        def frame(_): return sequence[min(index, len(sequence)-1)].copy()
        def advance(count, buttons, touch=None, **context):
            nonlocal index
            self.assertEqual(buttons, [])
            calls.append((count, touch, context))
            emu.frame += count
            if fail_input: raise OSError('mock callback failure')
            index += 1
        with patch.object(a, 'read_frame', side_effect=frame), patch.object(a, 'ocr', return_value='routine animation'):
            result = a.run_auto_battle(emu, request or {'moveSlot':1,'maxTurns':2}, advance)
        self.assertEqual(result['frames'], sum(action['frames'] for action in result['actions']))
        self.assertEqual(result['frames'], sum(call[0] for call in calls))
        self.assertTrue(all(call[1] is None or call[1] in [[128,95], *a.TOUCHES.values()] for call in calls))
        return result, calls

    def test_real_reference_pp_and_names(self):
        a.validate_auto_battle({})
        self.assertEqual(a.text_digest(self.fight,a.ACTIVE),a.text_digest(self.moves,a.ACTIVE))
        for slot, current in enumerate([20,20,8,40],1):
            read = a.read_pp(self.moves,slot)
            self.assertEqual(read['current'],current)
            self.assertEqual(read['method'],'retained_font')

    def test_additional_retained_digit_sources(self):
        sources = [
            ('tests/fixtures/autoturn/cold-02/0117-native-leader-final-flame.png',3,16),
            ('tests/fixtures/autoturn/cold-02/0105-native-leader-next-flame-four.png',3,19),
            ('tests/fixtures/autoturn/cold-02/0105-native-leader-next-flame-four.png',1,35),
            ('tests/fixtures/autoturn/e820-cold-02/0088-required-retry-krokorok-move-check.png',2,14),
            ('tests/fixtures/autoturn/e820-cold-02/0088-required-retry-krokorok-move-check.png',3,25),
        ]
        for path, slot, expected in sources:
            self.assertEqual(a.read_pp(a.load_image(ROOT/path),slot)['current'],expected)

    def test_repeated_two_turns_without_model(self):
        # Each input callback advances to the next retained/synthetic fixture.
        # FIGHT press/release, MOVE press/release, animation, FIGHT again.
        sequence = [self.same_fight, self.same_fight, self.moves,
                    self.moves, self.animation, self.same_fight,
                    self.same_fight, pp(self.moves,19), pp(self.moves,19),
                    self.animation, self.same_fight]
        result,calls = self.run_loop(sequence)
        self.assertEqual(result['turns'],2)
        self.assertEqual(result['reason'],'turn_limit')
        self.assertEqual(sum(c[2]['phase']=='submit_move' for c in calls),2)
        self.assertEqual(sum(c[2]['phase']=='open_fight' for c in calls),2)
        self.assertTrue(any(c[2]['phase']=='battle_animation' for c in calls))
        self.assertTrue(all(c[1] is None for c in calls if c[2]['phase']=='battle_animation'))
        self.assertEqual([e['pp']['current'] for e in result['evidence'] if 'pp' in e],[20,19])

    def test_default_slot_eight_to_seven_automatic(self):
        source=retained('0190-practice-three-second.png')
        self.assertEqual([''.join('#' if min(source.getpixel((x,y)))>200 else ' '
                                  for x in range(34,39)) for y in range(170,180)], a.GLYPHS['7'])
        self.assertEqual([''.join('#' if min(source.getpixel((x,y)))>200 else ' '
                                  for x in range(30,32)) for y in range(170,180)], a.GLYPHS['1'])
        # Older synthetic-party QA screenshot: font pixels only. It supplies
        # no campaign-state, menu authorization, or live-run evidence.
        native=a.load_image(ROOT/'tests/fixtures/autoturn/qa/0284-868-battle-044.png')
        self.assertEqual([''.join('#' if min(native.getpixel((x,y)))>200 else ' '
                                  for x in range(81,86)) for y in range(252,262)], a.GLYPHS['7'])
        self.assertEqual([a.read_pp(native,i)['current'] for i in range(1,5)],[7,10,20,13])
        seven=pp(self.moves,7,slot=3)
        sequence=[self.same_fight,self.same_fight,self.moves,self.moves,self.animation,
                  self.same_fight,self.same_fight,seven,seven,self.animation,self.same_fight]
        result,calls=self.run_loop(sequence,{'moveSlot':3,'maxTurns':2})
        self.assertEqual(result['turns'],2)
        self.assertEqual(result['reason'],'turn_limit')
        self.assertEqual([e['pp']['current'] for e in result['evidence'] if 'pp' in e],[8,7])
        self.assertEqual(sum(c[1]==[58,110] for c in calls),2)

    def test_live_0266_open_transition_requires_ninety_neutral_frames(self):
        transition=retained('0266-autoturn-live-pilot.png')
        # Real retained 0266 remains an unrecognized pressed/opening FIGHT UI.
        self.assertNotEqual(a.digest(transition,a.FIGHT_BOXES),a.digest(self.fight,a.FIGHT_BOXES))
        start=transition.copy();start.paste(self.fight.crop((0,210,256,384)),(0,210))
        menu=transition.copy();menu.paste(self.moves.crop((0,210,256,384)),(0,210))
        emu=SimpleNamespace(frame=0);current=start;calls=[];submissions=0
        def run_input(count,buttons,touch=None,**context):
            nonlocal current,submissions
            phase=context['phase'];calls.append((count,buttons,touch,phase));emu.frame+=count
            if phase=='open_fight':current=transition
            elif phase=='release_fight':
                # Old 12-frame implementation observes actual retained 0266
                # and fails. Only the full proven neutral wait reveals MOVES.
                current=(pp(menu,20-submissions,slot=2) if count>=90 else transition)
            elif phase=='submit_move':submissions+=1;current=self.animation
            elif phase=='release_move':
                self.assertEqual(count,90);current=self.animation
            elif phase=='battle_animation':current=start
        with patch.object(a,'read_frame',side_effect=lambda _:current.copy()),patch.object(a,'ocr',return_value='routine animation'):
            result=a.run_auto_battle(emu,{'moveSlot':2,'maxTurns':2,'maxFrames':5000},run_input)
        self.assertEqual(result['turns'],2);self.assertEqual(result['reason'],'turn_limit')
        self.assertEqual([e['pp']['current'] for e in result['evidence'] if 'pp' in e],[20,19])
        self.assertEqual([c[0] for c in calls if c[3]=='release_fight'],[90,90])
        self.assertEqual([c[0] for c in calls if c[3]=='release_move'],[90,90])
        self.assertTrue(all(buttons==[] and touch is None for _,buttons,touch,phase in calls if phase.startswith('release_')))
        self.assertEqual(result['frames'],sum(c[0] for c in calls))
        self.assertEqual(result['frames'],424)

    def test_pp_zero_no_submission(self):
        result,calls=self.run_loop([pp(self.moves,0)])
        self.assertEqual(result['reason'],'pp_empty'); self.assertEqual(calls,[])

    def test_native_command_fade_after_submission(self):
        fade = self.same_fight.copy()
        native = retained('0278-autoturn-live-pilot-v2.png')
        fade.paste(native.crop((0,210,256,384)), (0,210))
        result, calls = self.run_loop([
            self.moves, self.moves, self.animation, fade, fade,
            self.same_fight, self.same_fight, pp(self.moves,19),
            pp(self.moves,19), self.animation, self.same_fight])
        self.assertEqual(result['turns'],2)
        self.assertEqual(result['reason'],'turn_limit')
        transitions=[c for c in calls if c[2]['phase']=='menu_transition']
        self.assertEqual(len(transitions),2)
        self.assertTrue(all(c[1] is None for c in transitions))

    def test_unknown_choice_after_submission_never_confirmed(self):
        choice=retained('0181-practice-wave-learn.png')
        result,calls=self.run_loop([self.moves,self.moves,choice])
        self.assertEqual(result['turns'],1)
        self.assertEqual(result['reason'],'unrecognized_choice_or_transition')
        transitions=[c for c in calls if c[2]['phase']=='menu_transition']
        self.assertEqual(sum(c[0] for c in transitions),120)
        self.assertTrue(all(c[1] is None for c in transitions))

    def test_unknown_pp_no_submission(self):
        image=self.moves.copy();image.paste((255,0,255),(75,300,86,310))
        result,calls=self.run_loop([image],{'moveSlot':3})
        self.assertEqual(result['reason'],'pp_unreadable'); self.assertEqual(calls,[])

    def test_active_identity_changed(self):
        image=self.moves.copy();image.paste((0,0,0),a.ACTIVE)
        result,calls=self.run_loop([image])
        self.assertEqual(result['reason'],'active_changed');self.assertEqual(calls,[])

    def test_opponent_change_after_submission(self):
        changed=self.same_fight.copy();changed.paste((0,0,0),a.OPPONENT)
        result,_=self.run_loop([self.moves,self.moves,self.animation,changed])
        self.assertEqual(result['turns'],1);self.assertEqual(result['reason'],'opponent_changed')

    def test_new_move_unknown_learn_end_switch(self):
        changed=self.moves.copy();changed.paste((0,0,0),(24,287,95,297))
        for image in [changed,retained('0181-practice-wave-learn.png'),
                      retained('0196-practice-four-learn-check.png'),
                      retained('0175-practice-first-finish.png')]:
            result,calls=self.run_loop([image])
            self.assertEqual(result['reason'],'unrecognized_choice_or_transition');self.assertEqual(calls,[])
        with patch.object(a,'ocr',return_value='for winning!'):
            # run_loop patches OCR; exercise end directly here.
            emu=SimpleNamespace(frame=0)
            with patch.object(a,'read_frame',return_value=retained('0199-practice-four-finish.png')):
                result=a.run_auto_battle(emu,{},lambda *args,**kwargs:self.fail('no input at end'))
            self.assertEqual(result['reason'],'choice_or_battle_end')

    def test_stale_menu_and_frame_limits(self):
        result,_=self.run_loop([self.same_fight],{'maxFrames':500,'maxTurns':2})
        self.assertEqual(result['reason'],'menu_open_timeout')
        result,_=self.run_loop([self.moves],{'moveSlot':1,'maxFrames':500})
        self.assertEqual(result['reason'],'submission_unconfirmed')
        result,_=self.run_loop([self.moves],{'moveSlot':1,'maxFrames':5})
        self.assertEqual(result['frames'],5);self.assertEqual(result['reason'],'frame_limit')

    def test_transition_timeout_animation_limit_and_no_pp_guess(self):
        from PIL import Image
        blank=Image.new('RGB',(256,384))
        result,calls=self.run_loop([blank])
        self.assertEqual(result['reason'],'transition_timeout')
        self.assertTrue(all(c[1] is None for c in calls))
        result,calls=self.run_loop([self.animation],{'maxFrames':15000})
        self.assertEqual(result['reason'],'animation_timeout')
        self.assertTrue(all(c[1] is None for c in calls))
        result,_=self.run_loop([self.moves,self.moves,self.animation,self.same_fight,
                                self.same_fight,self.moves])
        self.assertEqual(result['turns'],1)
        self.assertEqual(result['reason'],'pp_not_decreased')

    def test_partial_callback_accounting(self):
        result,_=self.run_loop([self.moves],fail_input=True)
        self.assertEqual(result['frames'],1);self.assertEqual(result['actions'][0]['frames'],1)
        self.assertIn('mock callback failure',result['reason'])

    def test_validation_before_any_inputs(self):
        for request in [{'maxTurns':13},{'maxFrames':15001},{'moveSlot':True},{'extra':1}]:
            with self.assertRaises(ValueError):a.validate_auto_battle(request)
        with self.assertRaises(ValueError):a.run_auto_battle(None,{'maxTurns':0},lambda *a,**k:self.fail('input'))

    def test_low_hp(self):
        image=self.moves.copy();image.paste((255,0,0),(192,121,220,124))
        result,calls=self.run_loop([image]);self.assertEqual(result['reason'],'low_hp');self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
