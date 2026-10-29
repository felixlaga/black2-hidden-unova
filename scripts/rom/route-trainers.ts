import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { appendTrainer, ORDINARY_ROUTE_BINDINGS, TRAINER_PATHS, type TrainerPokemon } from './trainers';
import { compileCampaignBody, type applyCampaignDefinitions } from './campaign';
import geography from '../../content/world-map.json';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const hex = (n: number) => `0x${n.toString(16).padStart(4, '0')}`;
export const ROUTE_TRAINER_FLAG_BASE = 0x5F0;
export const ROUTE_TRAINER_FLAG_CEILING = 0x960;
const INITIAL_TRAINERS = 842, ROUTE_TRAINER_COUNT = 36;
type Campaign = ReturnType<typeof applyCampaignDefinitions>;
// These are the original-Badge gates actually applied to route entrances by
// world-build. A nearby future extra Gym is not an entrance prerequisite.
const BADGE_GATES: Record<string, number> = { 'gate.first_badge': 1, 'gate.second_badge': 2, 'gate.third_badge': 3, 'gate.fourth_badge': 4, 'gate.fifth_badge': 5, 'gate.sixth_badge': 6, 'gate.seventh_badge': 7, 'gate.eighth_badge': 8, 'gate.late_campaign': 8 };

// Every class/sprite pair has an original ordinary-route NPC as its donor.
// Resolve/check the actual event member and trainer record before allocating.
export const ROUTE_TRAINER_STYLES = {
  youngster: { trainerId: 164, trainerClassId: 2, spriteId: 11 },
  lass: { trainerId: 165, trainerClassId: 3, spriteId: 15 },
  backpacker: { trainerId: 213, trainerClassId: 27, spriteId: 48 },
  backpackerF: { trainerId: 223, trainerClassId: 28, spriteId: 49 },
  baker: { trainerId: 253, trainerClassId: 34, spriteId: 66 },
  artist: { trainerId: 254, trainerClassId: 33, spriteId: 28 },
  fisherman: { trainerId: 210, trainerClassId: 29, spriteId: 63 },
  scientist: { trainerId: 263, trainerClassId: 52, spriteId: 73 },
  scientistF: { trainerId: 264, trainerClassId: 46, spriteId: 74 },
  parasol: { trainerId: 267, trainerClassId: 65, spriteId: 84 },
  ranger: { trainerId: 292, trainerClassId: 24, spriteId: 36 },
  rangerF: { trainerId: 293, trainerClassId: 25, spriteId: 37 },
  hiker: { trainerId: 334, trainerClassId: 74, spriteId: 64 },
  cyclist: { trainerId: 260, trainerClassId: 90, spriteId: 38 },
  battleGirl: { trainerId: 282, trainerClassId: 64, spriteId: 47 },
  ace: { trainerId: 43, trainerClassId: 49, spriteId: 31 },
  aceF: { trainerId: 44, trainerClassId: 50, spriteId: 30 },
} as const;
type Partner = { species: string; moves?: string[]; held_item?: string };
type RouteSpec = {
  routeId: string; name: string; style: keyof typeof ROUTE_TRAINER_STYLES;
  curveGymId: string; belowGymAce: number; theme: string; partners: Partner[];
  intro: string; repeat: string;
};
const p = (species: string, moves?: string[], held_item?: string): Partner => ({ species, ...(moves ? { moves } : {}), ...(held_item ? { held_item } : {}) });
const spec = (route: string, name: string, style: RouteSpec['style'], gym: string, belowGymAce: number, theme: string, partners: Partner[], intro: string, repeat: string): RouteSpec => ({ routeId: `route.${route}`, name, style, curveGymId: `gym.${gym}`, belowGymAce, theme, partners, intro, repeat });

/** One optional, one-time battle per internal route. Levels use the campaign's
 * twenty-Gym curve, with small teams and ordinary AI/IVs below nearby leaders.
 * Branching roads are not a linear Gym sequence; eight-Badge links use late teams.
 * Native level-up moves are retained unless a deliberately authored set is given.
 */
export const ROUTE_TRAINER_SPECS: readonly RouteSpec[] = [
  spec('southworks_loop_1', 'Tansy', 'lass', 'sootbell_yard', 5, 'meadow pollinators', [p('Sewaddle'), p('Deerling', ['Tackle','Double Kick','Leech Seed','Faint Attack'], 'Oran Berry')], 'The bellflowers brought my partners together. Let us show you!', 'We will leave the next row of flowers for the wild visitors.'),
  spec('southworks_loop_2', 'Otis', 'youngster', 'sootbell_yard', 4, 'waterwheel apprentices', [p('Timburr'), p('Buizel', ['Water Gun','Quick Attack','Swift','Growl'])], 'The wheel sets our training pace. Can your team keep up?', 'A steady pace leaves enough energy for the road home.'),
  spec('southworks_loop_3', 'Mabel', 'baker', 'sootbell_yard', 2, 'orchard harvest', [p('Combee', ['Gust','Bug Bite','Sweet Scent','String Shot']), p('Herdier', ['Take Down','Bite','Work Up','Leer'], 'Oran Berry')], 'We carried a whole basket here. Now we are ready for a battle!', 'The small apples travel best. Help yourself at the market.'),
  spec('southworks_loop_4', 'Nessa', 'backpackerF', 'copperbrook', 9, 'heather banks', [p('Nidorina'), p('Skiploom', ['Mega Drain','Bullet Seed','Stun Spore','Leech Seed'])], 'My partners know every bend in Heather Lane. Show us your way!', 'The pale flowers mark the dry ground after rain.'),
  spec('southworks_loop_5', 'Elio', 'youngster', 'sootbell_yard', 2, 'clover meadow', [p('Tranquill'), p('Lombre', ['BubbleBeam','Mega Drain','Fake Out','Nature Power'])], 'A loop is a fine place to practice. Ready for one battle?', 'We can watch the clouds while our partners catch their breath.'),
  spec('southworks_loop_6', 'Pippa', 'lass', 'sootbell_yard', 5, 'basket delivery', [p('Sentret', ['Quick Attack','Fury Swipes','Defense Curl','Helping Hand']), p('Pikachu', ['ThunderShock','Quick Attack','Thunder Wave','Double Team'])], 'Our baskets are empty, but we still have energy for a battle!', 'The next delivery can wait until everyone has rested.'),
  spec('southworks_crossing', 'Flint', 'backpacker', 'sootbell_yard', 1, 'kiln footbridge', [p('Roggenrola'), p('Numel', ['Ember','Magnitude','Rock Throw','Focus Energy'], 'Oran Berry')], 'Warm stone, cool river. My partners enjoy both sides of this bridge!', 'The railing is cooler than the kiln wall. Mind your hands.'),
  spec('westbasin_loop_1', 'Aster', 'rangerF', 'sandglass_court', 3, 'reeds and terraces', [p('Maractus', ['Needle Arm','Giga Drain','Synthesis','Cotton Spore']), p('Palpitoad'), p('Sawsbuck', ['Horn Leech','Take Down','Faint Attack','Leech Seed'])], 'The reeds shelter more than fish. My team will show you!', 'Leave a quiet strip beside the water for the young partners.'),
  spec('westbasin_loop_2', 'Rufus', 'hiker', 'reedwake', 5, 'red clay switchbacks', [p('Boldore'), p('Krokorok'), p('Sandslash', ['Dig','Slash','Rock Tomb','Defense Curl'], 'Sitrus Berry')], 'Slow steps get us up these switchbacks. How does your team climb?', 'The broad corner has the best place to rest.'),
  spec('westbasin_loop_3', 'Dell', 'fisherman', 'reedwake', 4, 'canal keepers', [p('Basculin'), p('Quagsire', ['Surf','Mud Bomb','Slam','Amnesia']), p('Lanturn', ['BubbleBeam','Spark','Confuse Ray','Thunder Wave'])], 'The canal is quiet today. There is time for a friendly battle!', 'We keep the lock open slowly so the smaller fish can pass.'),
  spec('westbasin_loop_4', 'Galen', 'hiker', 'reedwake', 4, 'quarry haulage', [p('Graveler'), p('Gurdurr'), p('Lairon', ['Iron Head','Rock Slide','Take Down','Protect'])], 'A good hauling team needs trust. Let us test ours!', 'Your partners work together as well as any quarry crew.'),
  spec('westbasin_loop_5', 'Iriska', 'parasol', 'reedwake', 4, 'rain collectors', [p('Castform', ['Weather Ball','Rain Dance','Water Pulse','Icy Wind']), p('Pelipper', ['Water Pulse','Air Slash','Roost','Mist']), p('Roselia', ['Giga Drain','Sludge','Stun Spore','Synthesis'], 'Sitrus Berry')], 'The rain has stopped. Our training does not have to!', 'These roofs will save enough water for a dry afternoon.'),
  spec('westbasin_loop_6', 'Basil', 'artist', 'sandglass_court', 2, 'dew basin colors', [p('Sunflora', ['Giga Drain','Petal Dance','Growth','Leech Seed']), p('Masquerain', ['Air Slash','Silver Wind','BubbleBeam','Stun Spore']), p('Kecleon')], 'I came for the colors. My partners came for a battle!', 'Every cloud changes the colors on these terraces.'),
  spec('westbasin_crossing', 'Cato', 'scientist', 'reedwake', 4, 'pottery tunnel minerals', [p('Nosepass', ['Rock Slide','Spark','Thunder Wave','Rest']), p('Claydol', ['Extrasensory','Earth Power','AncientPower','Light Screen']), p('Magneton', ['Discharge','Flash Cannon','Thunder Wave','SonicBoom'])], 'We found an interesting seam. Let us compare our teams before I measure it!', 'A tunnel wall tells its story one layer at a time.'),
  spec('highmarch_loop_1', 'Merrit', 'backpacker', 'frostmere_hearth', 6, 'hearth ridge shelters', [p('Stoutland', ['Return','Crunch','Ice Fang','Work Up']), p('Abomasnow', ['Ice Punch','Wood Hammer','Ice Shard','Ingrain']), p('Camerupt', ['Lava Plume','Earth Power','Rock Slide','Amnesia'], 'Sitrus Berry')], 'We carried fuel to the ridge shelters. Time for a training stop!', 'A warm shelter matters more than arriving first.'),
  spec('highmarch_loop_2', 'Eira', 'parasol', 'slatehaven', 5, 'snowmelt streams', [p('Dewgong', ['Surf','Ice Beam','Aqua Jet','Safeguard']), p('Floatzel'), p('Glaceon', ['Ice Beam','Quick Attack','Shadow Ball','Hail'])], 'Snowmelt changes the road each morning. Can we adapt as quickly as you?', 'The stream is strongest after the sun reaches the ridge.'),
  spec('highmarch_loop_3', 'Reid', 'cyclist', 'threadmill_crossing', 4, 'courier stair', [p('Dodrio', ['Drill Peck','Tri Attack','Quick Attack','Agility']), p('Rapidash', ['Flame Charge','Stomp','Take Down','Will-O-Wisp']), p('Swoobat')], 'The parcels are delivered. My partners saved one burst of speed!', 'Taking a sheltered turn can be quicker than fighting the wind.'),
  spec('highmarch_loop_4', 'Sable', 'scientistF', 'frostmere_hearth', 6, 'cloud shelf observatory', [p('Altaria', ['Dragon Pulse','Air Slash','Safeguard','Cotton Guard']), p('Bronzong', ['Extrasensory','Gyro Ball','Reflect','Hypnosis']), p('Golduck', ['Surf','Zen Headbutt','Ice Beam','Amnesia'])], 'Clouds tell us what is coming. Your team may surprise us!', 'We record the quiet days as carefully as the storms.'),
  spec('highmarch_loop_5', 'Hollis', 'ranger', 'frostmere_hearth', 7, 'pine nursery', [p('Sawsbuck', ['Horn Leech','Return','Jump Kick','Leech Seed']), p('Noctowl', ['Air Slash','Extrasensory','Roost','Reflect']), p('Beartic', ['Icicle Crash','Slash','Aqua Jet','Swagger'])], 'The nursery is resting. We can train here without disturbing it!', 'A marked trail gives the young pines room to grow.'),
  spec('highmarch_loop_6', 'Vera', 'backpackerF', 'slatehaven', 5, 'wind ribbons', [p('Drifblim', ['Shadow Ball','Fly','Stockpile','Baton Pass']), p('Leavanny', ['Leaf Blade','X-Scissor','Slash','Swords Dance']), p('Ampharos', ['Discharge','Power Gem','Signal Beam','Cotton Guard'])], 'The ribbons show a gentle route down. Let us battle before we leave!', 'Your partners kept their footing even when the wind changed.'),
  spec('highmarch_crossing', 'Corbel', 'hiker', 'slatehaven', 2, 'slate passage', [p('Gigalith', ['Rock Slide','Bulldoze','Iron Defense','Stealth Rock']), p('Golbat', ['Air Slash','Poison Fang','Confuse Ray','Roost']), p('Steelix', ['Iron Tail','Dig','Rock Slide','Screech'], 'Sitrus Berry')], 'Every roof starts with stone like this. Our team knows its weight!', 'The wide passage leaves room for everyone to pass safely.'),
  spec('eastreach_loop_1', 'Marlo', 'ranger', 'stillwater_fold', 11, 'springbank survey', [p('Golduck', ['Surf','Psychic','Ice Beam','Amnesia']), p('Sawsbuck', ['Horn Leech','Return','Jump Kick','Leech Seed']), p('Crustle', ['Rock Slide','X-Scissor','Slash','Stealth Rock']), p('Lapras', ['Surf','Ice Beam','Body Slam','Confuse Ray'], 'Sitrus Berry')], 'The spring has four outlets. My four partners each favor one!', 'An unfinished survey leaves a discovery for the next traveler.'),
  spec('eastreach_loop_2', 'Nerissa', 'backpackerF', 'saltlamp_quay', 6, 'pearl causeway', [p('Gastrodon', ['Surf','Earth Power','Recover','Mud Bomb']), p('Lumineon', ['Surf','Silver Wind','Aqua Ring','Gust']), p('Cloyster', ['Icicle Spear','Razor Shell','Spike Cannon','Protect']), p('Pelipper', ['Surf','Air Slash','Roost','Mist'])], 'The tide gave us a clear crossing. How about a battle on dry ground?', 'An empty shell may already be a new home. Best leave it here.'),
  spec('eastreach_loop_3', 'Suri', 'artist', 'saltlamp_quay', 7, 'tidal glass', [p('Starmie', ['Surf','Psychic','Swift','Recover']), p('Magcargo', ['Lava Plume','AncientPower','Earth Power','Amnesia']), p('Octillery', ['BubbleBeam','Aurora Beam','Signal Beam','Focus Energy']), p('Ampharos', ['Discharge','Power Gem','Signal Beam','Thunder Wave'])], 'Sea glass taught me to look at familiar colors again. Show me your team!', 'Even a rough edge changes with enough time and care.'),
  spec('eastreach_loop_4', 'Tobin', 'ace', 'tideglass', 8, 'gull cliff winds', [p('Unfezant', ['Air Slash','Facade','Quick Attack','Roost']), p('Skarmory', ['Steel Wing','Drill Peck','Spikes','Roost']), p('Gligar', ['Acrobatics','Dig','U-turn','Screech']), p('Braviary', ['Fly','Crush Claw','Superpower','Tailwind'])], 'Our team follows the cliff wind. Let us see how yours moves!', 'A steady wing beats a hurried start on this road.'),
  spec('eastreach_loop_5', 'Lyra', 'aceF', 'tideglass', 8, 'dawn terrace watch', [p('Espeon', ['Psychic','Swift','Morning Sun','Light Screen']), p('Bellossom', ['Giga Drain','Petal Dance','Sleep Powder','Synthesis']), p('Xatu', ['Psychic','Air Slash','Wish','Reflect']), p('Arcanine', ['Flamethrower','Crunch','ExtremeSpeed','Roar'], 'Sitrus Berry')], 'First light reaches every terrace. Let us greet it with a battle!', 'Your team gave every partner a chance to shine.'),
  spec('eastreach_loop_6', 'Selby', 'scientist', 'saltlamp_quay', 6, 'harbor lanterns', [p('Lanturn', ['Surf','Discharge','Confuse Ray','Aqua Ring']), p('Volbeat', ['Signal Beam','Zen Headbutt','Moonlight','Tail Glow']), p('Illumise', ['Bug Buzz','Charge Beam','Wish','Charm']), p('Chandelure', ['Flame Burst','Shadow Ball','Will-O-Wisp','Confuse Ray'])], 'One steady lantern can guide a whole crew. Watch our signals!', 'We keep the lamps low around the nesting quay.'),
  spec('eastreach_crossing', 'Barnaby', 'fisherman', 'stillwater_fold', 11, 'tidal cave', [p('Relicanth', ['Waterfall','Rock Slide','Yawn','Amnesia']), p('Whiscash', ['Surf','Earth Power','Zen Headbutt','Amnesia']), p('Carracosta', ['Waterfall','Rock Slide','Aqua Jet','Protect']), p('Eelektross', ['Discharge','Crunch','Flamethrower','Thunder Wave'])], 'The tide tunnel holds a few surprises. So does my team!', 'We watch the water marks before we set out.'),
  spec('orchard_escarpment', 'Jory', 'ranger', 'sandglass_court', 3, 'orchard terrace transition', [p('Sawsbuck', ['Horn Leech','Take Down','Faint Attack','Leech Seed']), p('Sandslash', ['Dig','Slash','Rock Tomb','Defense Curl']), p('Noctowl', ['Air Slash','Extrasensory','Reflect','Roost'])], 'The orchards end where the dry terraces begin. Our team knows both!', 'The last orchard row gives shade to travelers from either side.'),
  spec('copper_cut', 'Rena', 'scientistF', 'sandglass_court', 2, 'copper seam tunnel', [p('Klang', ['Gear Grind','Mirror Shot','Charge Beam','Autotomize']), p('Dugtrio', ['Dig','Slash','Rock Tomb','Sand Tomb']), p('Golbat', ['Air Cutter','Poison Fang','Confuse Ray','Roost'])], 'These seams connect two regions. Our partners helped trace them!', 'The survey marks keep this shortcut safe for the next crew.'),
  spec('rainwind_pass', 'Fenn', 'backpacker', 'threadmill_crossing', 5, 'rain hill ascent', [p('Ludicolo', ['Surf','Giga Drain','Rain Dance','Fake Out']), p('Altaria', ['Dragon Pulse','Fly','Cotton Guard','Sing']), p('Stoutland', ['Return','Crunch','Thunder Fang','Work Up'])], 'Rain below, wind above. We have practiced for both!', 'A dry blanket is worth carrying over this pass.'),
  spec('quarry_courier', 'Keira', 'battleGirl', 'threadmill_crossing', 4, 'quarry courier training', [p('Sawk', ['Brick Break','Rock Slide','Retaliate','Bulk Up']), p('Heracross', ['Brick Break','Megahorn','Aerial Ace','Endure']), p('Mienshao', ['Drain Punch','U-turn','Fake Out','Swift'])], 'Our deliveries train our legs. A battle trains our teamwork!', 'Leave the inside of the switchback clear for heavy carts.'),
  spec('snowmelt_descent', 'Oona', 'rangerF', 'tideglass', 9, 'snowmelt forest', [p('Abomasnow', ['Ice Punch','Wood Hammer','Ice Shard','Ingrain']), p('Sawsbuck', ['Horn Leech','Return','Jump Kick','Leech Seed']), p('Azumarill', ['Waterfall','Aqua Jet','Double-Edge','Aqua Ring']), p('Walrein', ['Surf','Ice Beam','Body Slam','Rest'], 'Sitrus Berry')], 'This water has crossed two regions. Our team has followed it all the way!', 'Every downstream town depends on the banks we leave intact.'),
  spec('cloudcliff_path', 'Albin', 'ace', 'tideglass', 8, 'highland coastal ridge', [p('Altaria', ['Dragon Pulse','Air Slash','Cotton Guard','Safeguard']), p('Emolga', ['Discharge','Acrobatics','Volt Switch','Encore']), p('Crustle', ['Rock Slide','X-Scissor','Slash','Stealth Rock']), p('Mandibuzz', ['Air Slash','Faint Attack','Roost','Tailwind'])], 'The ridge runs all the way to the sea. Ready to test your footing?', 'We will wait for a clear gust before taking the next bend.'),
  spec('coast_packet', 'Mina', 'backpackerF', 'saltlamp_quay', 5, 'coastal packet crew', [p('Pelipper', ['Surf','Air Slash','Roost','Mist']), p('Torkoal', ['Lava Plume','Body Slam','Protect','Iron Defense']), p('Poliwrath', ['Waterfall','Brick Break','Body Slam','Hypnosis']), p('Stunfisk', ['Discharge','Mud Bomb','Muddy Water','Camouflage'])], 'The packet crew has finished loading. We have time for one battle!', 'Both docks are on the timetable. No traveler gets left behind.'),
  spec('lantern_packet', 'Dorian', 'fisherman', 'saltlamp_quay', 6, 'river mouth sea lane', [p('Seaking', ['Waterfall','Megahorn','Aqua Ring','Agility']), p('Lanturn', ['Surf','Discharge','Confuse Ray','Aqua Ring']), p('Kingler', ['Crabhammer','Stomp','X-Scissor','Protect']), p('Mantine', ['Surf','Air Slash','Ice Beam','Aqua Ring'], 'Sitrus Berry')], 'The river meets the sea here. Our team brings a little of each!', 'The lantern keeper waits until every boat has answered.'),
];

export function rebaseRouteTrainerBody(body: string, textBase: number) {
  if (!Number.isInteger(textBase) || textBase < 0 || textBase + 2 > 0xffff) throw new Error('Invalid route trainer message base');
  const rebased = body.replace(/^(\s*talk message: )(\d+)$/gm, (_, prefix, id) => {
    if (Number(id) > 2) throw new Error('Expected local route trainer messages 0..2');
    return `${prefix}${Number(id) + textBase}`;
  });
  compileCampaignBody(rebased);
  return rebased;
}

function makeBody(trainerId: number, routeId: string) {
  const prefix = routeId.replace(/[^a-z0-9]/gi, '_');
  return ['lock', 'face_player', `if flag_set?(${hex(ROUTE_TRAINER_FLAG_BASE + trainerId)})`,
    '  talk message: 2', '  finish_interaction', 'end', 'talk message: 0',
    `call_trainer_battle ${trainerId}, 0, 0`, 'trainer_battle_is_victory 0x8010',
    'work_cmp_const 0x8010, 1', `jump_if 0x01, :${prefix}_won`,
    'call_trainer_lose', 'finish_interaction', `label :${prefix}_won`,
    'call_trainer_battle_end', `trainer_flag_set ${trainerId}`, 'talk message: 1', 'finish_interaction'].join('\n');
}

function verifyNativeContract(rom: NintendoDSRom) {
  const overlay = rom.loadArm9Overlays([12]).get(12)!;
  for (const address of [0x02155038, 0x0215504C, 0x02155060]) {
    const offset = address - overlay.ramAddress;
    if (readU16(overlay.data, offset) !== 0x225F || readU16(overlay.data, offset + 2) !== 0x0112) throw new Error('Native trainer defeated-flag base differs');
  }
  const scripts = new NARC(rom.getFileByName('a/0/5/6'));
  const caller = decompileBw2Script(scripts.files[1004]);
  if (!caller.roundTripVerified || !caller.editable || !caller.source.includes('call_trainer_battle 0x009d, 0x0000, 0x0000') || !caller.source.includes('trainer_battle_is_victory 0x8010') || !caller.source.includes('call_trainer_lose') || !caller.source.includes('call_trainer_battle_end')) throw new Error('Native battle result contract differs');
  // The common ordinary-trainer helpers explicitly set the defeated flag. Do
  // not assume call_trainer_battle or battle_end automatically awards it.
  const helper = scripts.files[1239];
  for (const [offset, opcode] of [[0xE70,0x85],[0xE78,0x8D],[0xE8F,0x8E],[0xE99,0x95],[0x1182,0x85],[0x118A,0x8D],[0x11A1,0x8E],[0x11AB,0x95]]) {
    if (readU16(helper, offset) !== opcode) throw new Error('Native ordinary trainer helper differs');
  }
  // 0x95's handler BL at 0x2155FBE calls 0x215504C; the wrapper adds
  // 0x5F0 and tail-calls ARM9's flag setter (0x20191D8). Pin the actual code,
  // not just the compiler's opcode name. Addresses refer to IREO rev0 RAM.
  const codeChecks = [
    { address: 0x02155FBE, bytes: [0xff,0xf7,0x45,0xf8] },
    { address: 0x0215504C, bytes: [0x5f,0x22,0x12,0x01,0x89,0x18,0x09,0x04,0x01,0x4b,0x09,0x0c,0x18,0x47,0xc0,0x46,0xd9,0x91,0x01,0x02] },
  ];
  for (const check of codeChecks) if (check.bytes.some((byte, i) => overlay.data[check.address - overlay.ramAddress + i] !== byte)) throw new Error('Native trainer_flag_set writer differs');
  return {
    reference: { path: 'a/0/5/6', member: 1004, sha256: hash(scripts.files[1004]) }, flagBase: ROUTE_TRAINER_FLAG_BASE,
    ordinaryHelpers: { path: 'a/0/5/6', member: 1239, sha256: hash(helper), talkFlagWriteOffset: 0xE99, sightFlagWriteOffset: 0x11AB },
    defeatedFlagWriter: { opcode: 0x95, command: 'trainer_flag_set', overlay: 12, handlerAddress: 0x02155FA0, wrapperAddress: 0x0215504C, arm9FlagSetterAddress: 0x020191D8, checkedCode: codeChecks, policy: 'Explicit native trainer flag set only after is_victory==1; no assumed automatic writer, raw flag writes, clears or rematches.' },
  };
}

/** Allocate records only; root must bind every returned actor into its route.
 * Run once after applyCampaignDefinitions, before any world/story placements.
 * Only the five trainer archives are owned. Atomic staging preserves the source
 * buffer, all native records, and the campaign's existing 28 appended trainers.
 */
export function applyRouteTrainerDefinitions(rom: NintendoDSRom, campaign: Campaign) {
  if (rom.idCode !== 'IREO' || rom.data[0x1e] !== 0) throw new Error('Route trainers require US Black 2 revision 0');
  const internal = geography.routes.filter(r => !r.is_base_entry), approaches = geography.routes.filter(r => r.is_base_entry);
  if (internal.length !== ROUTE_TRAINER_COUNT || approaches.length !== 4 || ROUTE_TRAINER_SPECS.length !== internal.length || new Set(ROUTE_TRAINER_SPECS.map(s => s.routeId)).size !== internal.length || internal.some(r => !ROUTE_TRAINER_SPECS.some(s => s.routeId === r.id))) throw new Error('Expected exactly 36 internal routes and four unallocated native approaches; review allocation plan');
  const initialTrainerCount = new NARC(rom.getFileByName(TRAINER_PATHS.data)).files.length;
  const finalTrainerCount = initialTrainerCount + ROUTE_TRAINER_SPECS.length;
  if (ROUTE_TRAINER_FLAG_BASE + finalTrainerCount - 1 >= ROUTE_TRAINER_FLAG_CEILING) throw new Error('Route trainer defeated flags would reach native system flags');
  if (initialTrainerCount !== INITIAL_TRAINERS || campaign?.finalTrainerCount !== initialTrainerCount || campaign.allocatedTrainerCount !== 28) throw new Error('Route trainers require exactly 842 trainers after the 28 campaign allocations; review allocation plan');
  if (campaign.progression20.length !== 20) throw new Error('Route trainers require the twenty-Gym campaign curve');
  const native = verifyNativeContract(rom);
  const events = new NARC(rom.getFileByName('a/1/2/6')), data = new NARC(rom.getFileByName(TRAINER_PATHS.data)), messages = new NARC(rom.getFileByName(TRAINER_PATHS.messages));
  const classes = decodeGen5TextBank(messages.files[383]);
  const nativeAppearances = Object.entries(ROUTE_TRAINER_STYLES).map(([style, donor]) => {
    const binding = ORDINARY_ROUTE_BINDINGS.find(b => b[0] === donor.trainerId)!;
    const event = events.files[binding[1]], offset = 8 + event[4] * 20 + binding[2] * 36;
    if (data.files[donor.trainerId][1] !== donor.trainerClassId || readU16(event, offset + 2) !== donor.spriteId || readU16(event, offset + 10) !== binding[4]) throw new Error(`Native route trainer appearance differs: ${style}`);
    return { style, ...donor, className: classes[donor.trainerClassId][1], eventId: binding[1], npcIndex: binding[2], nativeScriptId: binding[4] };
  });
  const staged = Object.assign(Object.create(NintendoDSRom.prototype), rom) as NintendoDSRom;
  staged.files = [...rom.files];
  const paths = Object.values(TRAINER_PATHS), before = new Map(paths.map(path => [path, hash(rom.getFileByName(path))]));
  const routeBindings = ROUTE_TRAINER_SPECS.map(s => {
    const route = internal.find(r => r.id === s.routeId)!, curve = campaign.progression20.find(g => g.id === s.curveGymId);
    if (!curve) throw new Error(`Missing route level anchor ${s.curveGymId}`);
    const gateBadges = route.forward_requirements.all_of.map(condition => {
      if (!(condition.gate_id in BADGE_GATES)) throw new Error(`Unknown earliest route gate ${condition.gate_id}`);
      return BADGE_GATES[condition.gate_id];
    });
    const originalBadges = Math.max(0, ...gateBadges);
    const entryGym = campaign.progression20.find(g => g.kind === 'original' && g.badgeIndex === originalBadges - 1);
    if (!entryGym) throw new Error(`No original Gym curve for first access to ${s.routeId}`);
    const earliestAccess = { originalBadges, originalGymId: entryGym.id, originalGymAceLevel: entryGym.aceLevel, originalGymPrerequisiteFlags: [...entryGym.requiredFlags], additionalGymIdsRequiredByOriginalGym: campaign.progression20.filter(g => g.kind === 'additional' && entryGym.requiredFlags.includes(g.flagId!)).map(g => g.id), routeRequiresAdditionalGymFlags: false, maximumOrdinaryAceLevel: entryGym.aceLevel + 3 };
    const level = curve.aceLevel - s.belowGymAce, style = ROUTE_TRAINER_STYLES[s.style];
    if (level < 10 || level > 80 || s.partners.length < 2 || s.partners.length > 4) throw new Error(`Unbalanced ordinary route team: ${s.routeId}`);
    if (level > earliestAccess.maximumOrdinaryAceLevel) throw new Error(`Route trainer exceeds earliest-access level budget: ${s.routeId}`);
    const team: TrainerPokemon[] = s.partners.map((partner, i) => ({ ...partner, level: level - Math.min(2, s.partners.length - 1 - i), packed_iv_difficulty_target: level < 35 ? 64 : level < 60 ? 96 : 128 }));
    const texts = [`${s.name}: ${s.intro}`, `${s.name}: That was a good lesson. Safe travels!`, `${s.name}: ${s.repeat}`];
    const allocation = appendTrainer(staged, { name: s.name, trainerClassId: style.trainerClassId, team, ai: ['Prioritize Effectiveness','Evaluate Attacks'], bagItems: [], money: 12, battleType: 0, battleText: { 1: 'That was a good lesson. Safe travels!' } });
    const body = makeBody(allocation.trainerId, s.routeId), compiled = compileCampaignBody(body);
    return { routeId: s.routeId, routeName: route.name, semanticKey: `trainer.${s.routeId}`, name: s.name,
      trainerId: allocation.trainerId, trainerClassId: style.trainerClassId, spriteId: style.spriteId,
      body, texts, level, levels: allocation.levels, team, theme: s.theme,
      defeatedFlagId: ROUTE_TRAINER_FLAG_BASE + allocation.trainerId, repeatable: false as const, optional: true as const,
      levelAnchor: { gymId: curve.id, gymAceLevel: curve.aceLevel, belowGymAce: s.belowGymAce }, earliestAccess,
      compiledBytes: Array.from(compiled.bytes), compiledSha256: compiled.sha256,
      placement: { activation: 'talk' as const, stationary: true, npcVisibilityFlag: 0, trainerSightRange: 0, mustKeepExitsOpen: true },
    };
  });
  const changedFiles = paths.filter(path => before.get(path) !== hash(staged.getFileByName(path))).map(path => ({ path, fileId: rom.fileId(path), beforeSha256: before.get(path)!, afterSha256: hash(staged.getFileByName(path)), bytes: staged.getFileByName(path).length }));
  for (const file of changedFiles) rom.files[file.fileId] = new Uint8Array(staged.files[file.fileId]);
  return { module: 'route-trainers', changedFiles, routeBindings, initialTrainerCount, allocatedTrainerCount: routeBindings.length, finalTrainerCount,
    skippedNativeApproaches: approaches.map(r => r.id), nativeAppearances, nativeBattleContract: native,
    allocator: { trainerDefeatedFlagOffset: ROUTE_TRAINER_FLAG_BASE, highestAllocatedTrainerFlag: ROUTE_TRAINER_FLAG_BASE + finalTrainerCount - 1, trainerFlagCeilingExclusive: ROUTE_TRAINER_FLAG_CEILING, remainingSafeTrainerRecords: ROUTE_TRAINER_FLAG_CEILING - ROUTE_TRAINER_FLAG_BASE - finalTrainerCount },
    integration: { trainerRecordsApplied: true, worldActorsBound: false, emulatorBattleValidated: false },
    limitations: ['Root must place all 36 returned NPCs and append/rebase their three messages before these battles are playable.', 'Stored base levels follow the campaign curve; native difficulty adjustments remain active. Full-playthrough XP balance is unverified.', 'Only a victory executes native trainer_flag_set. No raw state flags or clears. No emulator, cold-save persistence or hardware claim is made.'],
  };
}
