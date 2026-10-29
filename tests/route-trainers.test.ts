/** Real-ROM, in-memory checks. No ROM/save copies or build artifacts are written.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/route-trainers.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { compileBw2Script, decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptCommandOffsets, gen5ScriptCommandSize } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { applyTrainers, TRAINER_PATHS, TRAINER_BASE_SHA256 } from '../scripts/rom/trainers';
import { applyCampaignDefinitions, compileCampaignBody, ORIGINAL_GYM_ACE_LEVELS } from '../scripts/rom/campaign';
import { applyRouteTrainerDefinitions, rebaseRouteTrainerBody, ROUTE_TRAINER_SPECS, ROUTE_TRAINER_FLAG_BASE, ROUTE_TRAINER_FLAG_CEILING } from '../scripts/rom/route-trainers';
import geography from '../content/world-map.json';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const source = readFileSync('roms/pokemon-black2-us.nds');
assert.equal(hash(source), TRAINER_BASE_SHA256);
const rom = new NintendoDSRom(source, { fileData: 'view' });
applyTrainers(rom, { profile: 'full-campaign', gymAceLevels: ORIGINAL_GYM_ACE_LEVELS });
const campaign = applyCampaignDefinitions(rom);
const originalFiles = [...rom.files];
const report = applyRouteTrainerDefinitions(rom, campaign);
assert.equal(report.initialTrainerCount, 842);
assert.equal(report.allocatedTrainerCount, 36);
assert.equal(report.finalTrainerCount, 878);
assert.equal(report.allocator.highestAllocatedTrainerFlag, 0x95D);
assert.equal(report.allocator.trainerFlagCeilingExclusive, 0x960);
assert.equal(report.allocator.remainingSafeTrainerRecords, 2);
assert.deepEqual(report.routeBindings.map(b => b.trainerId), Array.from({ length: 36 }, (_, i) => 842 + i));
assert.deepEqual(new Set(report.routeBindings.map(b => b.routeId)), new Set(geography.routes.filter(r => !r.is_base_entry).map(r => r.id)));
assert.deepEqual(new Set(report.skippedNativeApproaches), new Set(geography.routes.filter(r => r.is_base_entry).map(r => r.id)));
assert.equal(report.skippedNativeApproaches.length, 4);
assert.equal(new Set(report.routeBindings.map(b => b.name)).size, 36);
assert.equal(new Set(report.routeBindings.map(b => b.trainerClassId)).size, 17);
assert.equal(report.integration.worldActorsBound, false);

// All existing records (including the twenty-Gym campaign, mentors and N) remain
// byte-identical. Only five explicitly owned trainer archive buffers may change.
const owned = new Set(Object.values(TRAINER_PATHS).map(path => rom.fileId(path)));
for (let id = 0; id < rom.files.length; id++) if (!owned.has(id)) assert.equal(rom.files[id], originalFiles[id], `Unowned file ${id}`);
for (const path of [TRAINER_PATHS.data, TRAINER_PATHS.parties]) {
  const before = new NARC(originalFiles[rom.fileId(path)]), after = new NARC(rom.getFileByName(path));
  assert.equal(after.files.length, 878);
  for (let i = 0; i < 842; i++) assert.deepEqual(after.files[i], before.files[i], `${path} existing trainer ${i}`);
}
for (const path of [TRAINER_PATHS.textTable, TRAINER_PATHS.textOffsets]) {
  const before = new NARC(originalFiles[rom.fileId(path)]), after = new NARC(rom.getFileByName(path));
  assert.equal(after.files.length, before.files.length);
  for (let i = 0; i < before.files.length; i++) assert.deepEqual(after.files[i].subarray(0, before.files[i].length), before.files[i], `${path} native prefix`);
}
const beforeMessages = new NARC(originalFiles[rom.fileId(TRAINER_PATHS.messages)]), messages = new NARC(rom.getFileByName(TRAINER_PATHS.messages));
assert.equal(messages.files.length, beforeMessages.files.length);
for (let i = 0; i < messages.files.length; i++) {
  if (![381, 382].includes(i)) assert.deepEqual(messages.files[i], beforeMessages.files[i], `Unowned text bank ${i}`);
  else {
    const before = decodeGen5TextBank(beforeMessages.files[i]), after = decodeGen5TextBank(messages.files[i]);
    assert.deepEqual(after.slice(0, before.length), before, `Existing message entries ${i}`);
    assert.equal(after.length, before.length + 36);
  }
}
assert.equal(hash(source), TRAINER_BASE_SHA256);
assert.equal(hash(rom.data), TRAINER_BASE_SHA256);

const td = new NARC(rom.getFileByName(TRAINER_PATHS.data)), parties = new NARC(rom.getFileByName(TRAINER_PATHS.parties));
const personal = new NARC(rom.getFileByName('a/0/1/6')), moves = new NARC(rom.getFileByName('a/0/2/1'));
const speciesNames = decodeGen5TextBank(messages.files[90]).map(e => e[1]), moveNames = decodeGen5TextBank(messages.files[403]).map(e => e[1]), itemNames = decodeGen5TextBank(messages.files[64]).map(e => e[1]);
const names = decodeGen5TextBank(messages.files[382]), textTable = new NARC(rom.getFileByName(TRAINER_PATHS.textTable)).files[0], textOffsets = new NARC(rom.getFileByName(TRAINER_PATHS.textOffsets)).files[0];
let pokemonCount = 0, heldItems = 0;
for (const binding of report.routeBindings) {
  const record = td.files[binding.trainerId], party = parties.files[binding.trainerId], types = new Set<number>();
  assert.equal(record[0], 3); assert.equal(record[1], binding.trainerClassId); assert.equal(record[2], 0);
  assert.ok(record[3] >= 2 && record[3] <= 4); assert.equal(record[3], binding.team.length);
  assert.equal(readU32(record, 12), 3, 'Ordinary effectiveness/evaluate AI, no partner/double/expert flags');
  assert.equal(party.length, record[3] * 18);
  assert.equal(names[binding.trainerId][1], binding.name);
  assert.deepEqual([...record.subarray(4, 12)], Array(8).fill(0), 'No bag healing items');
  const quoteOffset = readU16(textOffsets, binding.trainerId * 2);
  assert.equal(readU16(textTable, quoteOffset), binding.trainerId); assert.equal(readU16(textTable, quoteOffset + 2), 1);
  const anchor = campaign.progression20.find(g => g.id === binding.levelAnchor.gymId)!;
  assert.equal(binding.level, anchor.aceLevel - binding.levelAnchor.belowGymAce);
  assert.ok(binding.level < anchor.aceLevel);
  const entryGym = campaign.progression20.find(g => g.kind === 'original' && g.badgeIndex === binding.earliestAccess.originalBadges - 1)!;
  assert.equal(binding.earliestAccess.originalGymId, entryGym.id);
  assert.ok(binding.level <= entryGym.aceLevel + 3, `${binding.routeId}: nearby future Gyms must not overlevel first access`);
  assert.equal(binding.earliestAccess.routeRequiresAdditionalGymFlags, false);
  assert.ok(binding.earliestAccess.originalBadges >= 2, 'The only post-Cheren route is the deliberately empty native approach');
  assert.ok(binding.level < Math.min(...campaign.mentors.find(m => m.id === 'n.final_practice')!.levels));
  for (let i = 0; i < record[3]; i++) {
    pokemonCount++;
    const at = i * 18, species = readU16(party, at + 4), item = readU16(party, at + 8), moveIds = [10, 12, 14, 16].map(o => readU16(party, at + o));
    assert.ok(species >= 1 && species <= 649); assert.equal(norm(speciesNames[species]), norm(binding.team[i].species as string));
    assert.equal(party[at + 2], binding.levels[i]); assert.ok(party[at + 2] >= binding.level - 2 && party[at + 2] <= binding.level);
    assert.ok(party[at] <= 128, 'Moderate ordinary IV difficulty');
    const nativeTypes = [personal.files[species][6], personal.files[species][7]];
    nativeTypes.forEach(type => { assert.ok(type <= 16); types.add(type); });
    for (const id of moveIds) if (id) { assert.ok(id <= 559 && moves.files[id]); assert.ok(moveNames[id]); }
    assert.ok(moveIds.some(id => id && moves.files[id][2] > 0 && moves.files[id][3] > 0), `${binding.routeId} ${speciesNames[species]} needs a damaging move`);
    assert.ok(moveIds.some(id => id && moves.files[id][2] > 0 && moves.files[id][3] > 0 && nativeTypes.includes(moves.files[id][0])), `${binding.routeId} ${speciesNames[species]} needs damaging STAB`);
    if (binding.team[i].moves) assert.deepEqual(moveIds.map(id => norm(moveNames[id])), binding.team[i].moves!.map(norm));
    if (binding.team[i].held_item) { heldItems++; assert.equal(norm(itemNames[item]), norm(binding.team[i].held_item!)); }
    else assert.equal(item, 0);
  }
  assert.ok(types.size >= 2, `${binding.routeId} needs a varied themed party`);
}
assert.ok(heldItems >= 8 && heldItems < 18, 'Selected berries, not items on every Pokemon');

/** Focused compiled-bytecode interpreter, not a DS runtime substitute. The
 * verified native 0x95 writes trainer+0x5F0; battle startup has no invented
 * automatic write. This catches a missing write as well as a pre-victory write.
 */
function execute(bytes: Uint8Array, { win = 1, flags = [] as number[] } = {}) {
  const saved = new Set(flags), battles: number[] = [], writes: number[] = [], shown: number[] = [], stack: number[] = [], work = new Map<number, number>();
  let at = readU32(bytes, 0) + 4, comparison = 0, loss = false, battleEnded = false;
  const compare = (kind: number, left: number, right: number) => [left < right, left === right, left > right, left <= right, left >= right, left !== right][kind];
  for (let steps = 0; steps < 250; steps++) {
    const op = readU16(bytes, at), a = readU16(bytes, at + 2), b = readU16(bytes, at + 4), size = gen5ScriptCommandSize(op, 'BW2');
    assert.ok(size > 0); let next = at + size;
    switch (op) {
      case 0x02: return { flags: saved, battles, writes, messages: shown, loss, battleEnded };
      case 0x08: stack.push(a); break;
      case 0x10: stack.push(Number(saved.has(a))); break;
      case 0x11: { const right = stack.pop()!, left = stack.pop()!; stack.push(Number(compare(a, left, right))); break; }
      case 0x19: comparison = (work.get(a) ?? 0) - b; break;
      case 0x1f: { const condition = bytes[at + 2], jump = condition === 255 ? stack.pop() !== 1 : compare(condition, comparison, 0); if (jump) next += readU32(bytes, at + 3) | 0; break; }
      case 0x1e: next += readU32(bytes, at + 2) | 0; break;
      case 0x85: battles.push(a); break;
      case 0x8d: work.set(a, win); break;
      case 0x8c: loss = true; break; // Keep executing: even a returning loss handler must not reach win dialogue.
      case 0x8e: assert.equal(win, 1); battleEnded = true; break;
      case 0x95:
        assert.equal(win, 1); assert.equal(battleEnded, true); assert.equal(a, battles.at(-1));
        assert.ok(ROUTE_TRAINER_FLAG_BASE + a < ROUTE_TRAINER_FLAG_CEILING);
        saved.add(ROUTE_TRAINER_FLAG_BASE + a); writes.push(ROUTE_TRAINER_FLAG_BASE + a); break;
      case 0x3d: shown.push(b); break;
      case 0x2e: case 0x2f: case 0x30: case 0x32: case 0x3e: case 0x74: case 0xa6: break;
      default: throw new Error(`Unexpected route script opcode ${op.toString(16)}`);
    }
    assert.ok(next >= 6 && next < bytes.length); at = next;
  }
  throw new Error('Route battle body did not terminate');
}

for (const binding of report.routeBindings) {
  const bytes = Uint8Array.from(binding.compiledBytes), round = decompileBw2Script(bytes);
  assert.equal(hash(bytes), binding.compiledSha256); assert.ok(round.roundTripVerified && round.editable);
  const offsets = gen5ScriptCommandOffsets(bytes, 'BW2'), opcodes = offsets.map(at => readU16(bytes, at));
  assert.equal(opcodes.filter(op => op === 0x85).length, 1);
  assert.equal(opcodes.filter(op => op === 0x95).length, 1);
  assert.ok(!opcodes.some(op => [0x23, 0x24, 0x27, 0x28, 0x96, 0x104].includes(op)), 'No raw flag writes, trainer resets or free healing');
  const won = execute(bytes); assert.deepEqual(won.battles, [binding.trainerId]); assert.deepEqual(won.messages, [0, 1]); assert.equal(won.battleEnded, true); assert.equal(won.loss, false);
  assert.deepEqual([...won.flags], [binding.defeatedFlagId]);
  assert.deepEqual(won.writes, [binding.defeatedFlagId]);
  const repeat = execute(bytes, { flags: [...won.flags] }); assert.deepEqual(repeat.battles, []); assert.deepEqual(repeat.messages, [2]);
  const lost = execute(bytes, { win: 0 }); assert.deepEqual(lost.battles, [binding.trainerId]); assert.equal(lost.loss, true); assert.equal(lost.battleEnded, false); assert.deepEqual(lost.messages, [0]); assert.equal(lost.flags.size, 0);
  assert.deepEqual(lost.writes, []); assert.deepEqual(repeat.writes, []);
  assert.deepEqual(execute(bytes, { flags: [...lost.flags] }).battles, [binding.trainerId], 'A loss can retry');
  assert.deepEqual(execute(bytes, { flags: [binding.defeatedFlagId - 1, binding.defeatedFlagId + 1] }).battles, [binding.trainerId], 'A neighbor trainer flag must not suppress this battle');
  assert.ok(binding.defeatedFlagId < ROUTE_TRAINER_FLAG_CEILING);
  const rebased = compileCampaignBody(rebaseRouteTrainerBody(binding.body, 500)).bytes;
  assert.deepEqual(execute(rebased).messages, [500, 501]); assert.deepEqual(execute(rebased, { flags: [binding.defeatedFlagId] }).messages, [502]);
  assert.deepEqual(execute(rebased).battles, [binding.trainerId]);
  assert.equal(binding.placement.npcVisibilityFlag, 0); assert.equal(binding.placement.trainerSightRange, 0); assert.equal(binding.repeatable, false);
}
for (const bad of [-1, 1.5, 65534, NaN]) assert.throws(() => rebaseRouteTrainerBody(report.routeBindings[0].body, bad), /message base/);
// Labels remain distinct even if a caller compiles every actor in one bank.
const combined = compileBw2Script('preserve_layout\n' + report.routeBindings.map((b, i) => `script :route_${i}, entry: ${i + 1} do\n${rebaseRouteTrainerBody(b.body, i * 3)}\nend\n`).join(''));
assert.equal(decompileBw2Script(combined.bytes).roundTripVerified, true);

// Fail closed before committing any mutation on repeated allocation, wrong
// campaign stage, ceiling collision or an invalid final-team item (late failure).
const clone = (files: Uint8Array[]) => { const copy = Object.assign(Object.create(NintendoDSRom.prototype), rom) as NintendoDSRom; copy.files = [...files]; return copy; };
function unchangedOnFailure(candidate: NintendoDSRom, expected: RegExp, c = campaign) {
  const refs = [...candidate.files]; assert.throws(() => applyRouteTrainerDefinitions(candidate, c), expected);
  candidate.files.forEach((bytes, i) => assert.equal(bytes, refs[i], `Failure mutated file ${i}`));
}
unchangedOnFailure(rom, /native system flags/);
unchangedOnFailure(clone(originalFiles), /exactly 842/, { ...campaign, finalTrainerCount: 841 });
const badNativeHelper = clone(originalFiles), helperScripts = new NARC(new Uint8Array(badNativeHelper.getFileByName('a/0/5/6')));
helperScripts.files[1239][0xE99] = 0x96; // A reset is not the native win-only setter.
badNativeHelper.files[badNativeHelper.fileId('a/0/5/6')] = helperScripts.save();
unchangedOnFailure(badNativeHelper, /ordinary trainer helper differs/);
const overflow = clone(originalFiles), crowded = new NARC(new Uint8Array(overflow.getFileByName(TRAINER_PATHS.data)));
while (crowded.files.length < 845) crowded.files.push(new Uint8Array(20));
overflow.files[overflow.fileId(TRAINER_PATHS.data)] = crowded.save();
unchangedOnFailure(overflow, /native system flags/);
const last = ROUTE_TRAINER_SPECS.at(-1)!.partners.at(-1)!, held = last.held_item;
try { last.held_item = 'Not a native item'; unchangedOnFailure(clone(originalFiles), /absent item/); }
finally { last.held_item = held; }
assert.equal(hash(source), TRAINER_BASE_SHA256);
assert.equal(hash(readFileSync('roms/pokemon-black2-us.nds')), TRAINER_BASE_SHA256);
console.log(`Route trainers: 36 internal-route allocations, ${pokemonCount} Pokemon, 17 native class/sprite pairs; IDs842..877, flags0x93A..0x95D, two spare safe records. Compiled win/loss/retry/repeat branches, native moves/types/items, all842 existing records/text and source ownership preserved. No ROM export, build writes, emulator or full-campaign balance claim.`);
