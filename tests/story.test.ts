/** Real pinned-ROM binary tests. This does not save a ROM or claim emulation.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/story.test.ts */
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32, writeU16, writeU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank, encodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { compileBw2Script, decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptEntries, gen5ScriptCommandOffsets, gen5ScriptCommandSize } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { applyTrainers, TRAINER_BASE_SHA256, CHAMPION_STORY_BINDINGS } from '../scripts/rom/trainers';
import { applyStory, STORY_PATHS, CasteliaSewerClueFlag, rebaseStoryMentorBody, type StoryNpcSpot } from '../scripts/rom/story';
import { applyCampaignDefinitions, CAMPAIGN_PROGRESSION, ORIGINAL_GYM_ACE_LEVELS } from '../scripts/rom/campaign';
import { compareTextArchives } from '../scripts/dialogue-guard';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const baseBytes = readFileSync(new URL('../roms/pokemon-black2-us.nds', import.meta.url));
assert.equal(sha(baseBytes), TRAINER_BASE_SHA256);
const base = new NintendoDSRom(baseBytes, { fileData: 'view' });
const rom = new NintendoDSRom(baseBytes, { fileData: 'view' });
const original = Object.fromEntries(Object.entries(STORY_PATHS).map(([key, path]) => [key, new NARC(new Uint8Array(base.getFileByName(path)))]));
// Confirm Alder from two independent native field locations.
assert.equal(readU16(original.events.files[599], 8 + original.events.files[599][4] * 20 + 2), 97);
assert.equal(readU16(original.events.files[601], 8 + original.events.files[601][4] * 20 + 2 * 36 + 2), 97);
const trainers = applyTrainers(rom, { profile: 'full-campaign', gymAceLevels: ORIGINAL_GYM_ACE_LEVELS });
for (const step of CAMPAIGN_PROGRESSION.filter(p => p.kind === 'original')) {
  for (const row of trainers.gyms.filter(g => g.name === step.leader)) assert.equal(Math.max(...row.levels), step.aceLevel);
}
const campaign = applyCampaignDefinitions(rom);
assert.equal(campaign.mentors.length, 8);
// An isolated world-slot fixture appends eight event/script/text members. It
// exercises the actual campaign bodies and trainer IDs, without asserting town
// geometry or field-header dispatch. The central build tests real world slots.
const fixture = Object.fromEntries(Object.entries(STORY_PATHS).map(([k, p]) => [k, new NARC(new Uint8Array(rom.getFileByName(p)))]));
const storyNpcSpots: StoryNpcSpot[] = [];
for (const mentor of campaign.mentors) {
  const scriptId = fixture.scripts.files.length, eventId = fixture.events.files.length, textBankId = fixture.story.files.length;
  fixture.scripts.files.push(compileBw2Script('preserve_layout\nscript :idle, entry: 1 do\nhalt\nend').bytes);
  fixture.story.files.push(encodeGen5TextBank([['0_0', 'Existing town greeting.', 0]]));
  const event = new Uint8Array(8 + 36); writeU32(event, 0, event.length - 4); event[5] = 1;
  writeU16(event, 8, 3); writeU16(event, 10, mentor.spriteId); writeU16(event, 18, 1); writeU16(event, 36, 12); writeU16(event, 38, 20);
  fixture.events.files.push(event);
  storyNpcSpots.push({ townId: mentor.townId, semanticKey: mentor.semanticKey, name: mentor.name, npcIndex: 0, actorId: 3, scriptId, eventId, textBankId });
}
for (const [key, path] of Object.entries(STORY_PATHS)) rom.files[rom.fileId(path)] = new Uint8Array(fixture[key].save());
const filesBefore = [...rom.files];
const beforeStory = new Uint8Array(rom.getFileByName(STORY_PATHS.story));
const report = applyStory(rom, { storyNpcSpots }, trainers, campaign);
assert.equal(report.stages.length, 6); assert.equal(report.gymGates.length, 7); assert.equal(report.leagueGates.length, 2); assert.equal(report.mentorPlacements.length, 8);
assert.equal(report.approvedDialogueChanges.length, 15);
assert.equal(report.casteliaSewerClueFlag, 0xA39);
const after = Object.fromEntries(Object.entries(STORY_PATHS).map(([k, p]) => [k, new NARC(new Uint8Array(rom.getFileByName(p)))]));
// The source Buffer and rom.data must remain pristine, even when views were used.
assert.equal(sha(rom.data), TRAINER_BASE_SHA256); assert.equal(sha(baseBytes), TRAINER_BASE_SHA256);
for (let i = 0; i < rom.files.length; i++) {
  if (report.changedFiles.some(f => f.fileId === i)) assert.notEqual(rom.files[i].buffer, baseBytes.buffer);
  else assert.equal(rom.files[i], filesBefore[i], `unowned NitroFS file ${i}`);
}
for (const [archive, narc] of Object.entries(fixture)) {
  const changes = new Set(report.memberChanges.filter(m => m.archive === archive).map(m => m.member));
  assert.equal(after[archive].files.length, narc.files.length);
  for (let id = 0; id < narc.files.length; id++) if (!changes.has(id)) assert.deepEqual(after[archive].files[id], narc.files[id], `unowned ${archive} member ${id}`);
}
const textDiff = compareTextArchives(beforeStory, rom.getFileByName(STORY_PATHS.story), report.approvedDialogueChanges);
assert.deepEqual(textDiff.differences, []); assert.deepEqual(textDiff.unusedApprovals, []); assert.equal(textDiff.approvedDifferences.length, 15);
const allDiff = compareTextArchives(base.getFileByName(STORY_PATHS.story), rom.getFileByName(STORY_PATHS.story), report.approvedDialogueChanges);
assert.deepEqual(allDiff.differences, []);
const binding = CHAMPION_STORY_BINDINGS;
for (const [archive, id, offset, value] of [['events', 157, 10, 103], ['scripts', 290, 36, 103]] as const) {
  const expected = new Uint8Array(original[archive].files[id]); writeU16(expected, offset, value);
  assert.deepEqual(after[archive].files[id], expected, 'only exact N sprite operand may change');
}
assert.equal(readU16(after.scripts.files[290], 26), 0x69);
for (const [bank, entry] of [[164, 2], [164, 3]]) assert.match(decodeGen5TextBank(after.story.files[bank])[entry][1], /VAR\(259, 0\)/);
for (const stage of report.stages) {
  const old = original.scripts.files[stage.scriptId], next = after.scripts.files[stage.scriptId];
  assert.deepEqual(next.subarray(stage.originalTableEnd + 4, stage.originalLength + 4), old.subarray(stage.originalTableEnd), 'native conversation and movements unchanged');
  const oldEntries = gen5ScriptEntries(old), newEntries = gen5ScriptEntries(next);
  oldEntries.forEach((target, i) => assert.equal(newEntries[i], target + 4, 'existing public entry semantics retained'));
  const oldEvent = original.events.files[stage.eventId], expectedEvent = new Uint8Array(oldEvent);
  writeU16(expectedEvent, 8 + oldEvent[4] * 20 + stage.npcIndex * 36 + 10, stage.entry);
  assert.deepEqual(after.events.files[stage.eventId], expectedEvent, 'only conversation entry changed');
}
for (const gate of [...report.gymGates, ...report.leagueGates]) {
  const old = original.scripts.files[gate.scriptId], next = after.scripts.files[gate.scriptId];
  assert.deepEqual(next.subarray(gate.originalTableEnd + 4, gate.originalLength + 4), old.subarray(gate.originalTableEnd), 'native battle/story path preserved');
  const oldEntries = gen5ScriptEntries(old), newEntries = gen5ScriptEntries(next);
  oldEntries.forEach((target, i) => assert.equal(newEntries[i], i + 1 === gate.entry ? gate.appendedOffset : target + 4));
}
const championCommands = gen5ScriptCommandOffsets(after.scripts.files[288], 'BW2', { overlayId: 52 });
for (const call of binding.championScript.calls) {
  assert(championCommands.includes(call.offset + 4)); assert.equal(readU16(after.scripts.files[288], call.offset + 6), call.trainerId);
}
// Small bytecode executor for NEW wrapper paths only. Stop at the native tail;
// never model game scripts, battle engines or arbitrary opcodes as successful.
function runWrapper(bytes: Uint8Array, entry: number, native: number | undefined, initial: Set<number>) {
  const flags = new Set(initial), stack: number[] = [], messages: number[] = [];
  let pc = gen5ScriptEntries(bytes)[entry - 1], locked = false;
  const pop = () => { assert(stack.length); return stack.pop()!; };
  for (let steps = 0; steps < 500; steps++) {
    if (pc === native) { assert.equal(stack.length, 0); assert.equal(locked, false); return { flags, messages, native: true }; }
    const op = readU16(bytes, pc), size = gen5ScriptCommandSize(op, 'BW2'); assert(size > 0);
    const first = readU16(bytes, pc + 2), second = readU16(bytes, pc + 4); let next = pc + size;
    switch (op) {
      case 2: assert.equal(stack.length, 0); assert.equal(locked, false); return { flags, messages, native: false };
      case 8: stack.push(first); break;
      case 0x10: stack.push(Number(flags.has(first))); break;
      case 0x11: { const right = pop(), left = pop(); assert.equal(first, 1); stack.push(Number(left === right)); break; }
      case 0x1f: assert.equal(bytes[pc + 2], 255); if (pop() !== 1) next += readU32(bytes, pc + 3) | 0; break;
      case 0x1e: next += readU32(bytes, pc + 2) | 0; break;
      case 0x23: flags.add(first); break;
      case 0x2e: locked = true; break;
      case 0x2f: locked = false; break;
      case 0x34: messages.push(first); break;
      case 0x3d: messages.push(second); break;
      default: assert([0x30, 0x32, 0x36, 0x3e, 0x74, 0xa6].includes(op), `unsupported wrapper opcode ${op}`);
    }
    pc = next;
  }
  throw new Error('wrapper exceeded instruction budget');
}
let savedFlags = new Set<number>();
for (const stage of report.stages.slice().reverse()) if (stage.requiredFlags.length) {
  const r = runWrapper(after.scripts.files[stage.scriptId], stage.entry, stage.nativeOffset, savedFlags);
  assert.deepEqual(r.flags, savedFlags); assert.equal(r.native, true); assert.deepEqual(r.messages, [stage.messageBase + stage.pageCount + 1]);
}
for (const stage of report.stages) {
  const first = runWrapper(after.scripts.files[stage.scriptId], stage.entry, stage.nativeOffset, savedFlags);
  assert.equal(first.native, true); assert(first.flags.has(stage.flagId)); assert.equal(first.flags.size, savedFlags.size + 1);
  assert.deepEqual(first.messages, Array.from({ length: stage.pageCount }, (_, i) => stage.messageBase + i));
  // Reconstitute persisted state rather than retaining interpreter state.
  savedFlags = new Set(JSON.parse(JSON.stringify([...first.flags])));
  const repeat = runWrapper(after.scripts.files[stage.scriptId], stage.entry, stage.nativeOffset, savedFlags);
  assert.deepEqual(repeat.flags, savedFlags); assert.deepEqual(repeat.messages, [stage.messageBase + stage.pageCount]);
}
assert(savedFlags.has(CasteliaSewerClueFlag)); assert.equal(savedFlags.size, 6);
for (const gate of [...report.gymGates, ...report.leagueGates]) {
  const bytes = after.scripts.files[gate.scriptId];
  for (const missing of gate.requiredFlags) {
    const flags = new Set<number>(gate.requiredFlags.filter((f: number) => f !== missing));
    const blocked = runWrapper(bytes, gate.entry, gate.nativeOffset, flags);
    assert.equal(blocked.native, false); assert.deepEqual(blocked.flags, flags); assert.deepEqual(blocked.messages, [gate.messageBase]);
  }
  const allowed = runWrapper(bytes, gate.entry, gate.nativeOffset, new Set(gate.requiredFlags)); assert.equal(allowed.native, true); assert.deepEqual(allowed.messages, []);
}
for (const placement of report.mentorPlacements) {
  const mentor = campaign.mentors.find(m => m.id === placement.id)!;
  const bytes = after.scripts.files[placement.scriptId]; const commands = gen5ScriptCommandOffsets(bytes, 'BW2', { entryIndices: [placement.entry - 1] });
  assert(commands.some(at => readU16(bytes, at) === 0x85 && readU16(bytes, at + 2) === mentor.trainerId));
  assert(!commands.some(at => [0x23, 0x24].includes(readU16(bytes, at))));
  assert.equal(readU16(after.events.files[placement.eventId], 10), mentor.spriteId);
  const texts = decodeGen5TextBank(after.story.files[placement.textBankId]); assert.equal(texts[0][1], 'Existing town greeting.');
  for (const at of commands.filter(at => readU16(bytes, at) === 0x3d)) { const id = readU16(bytes, at + 4); assert(id >= placement.messageBase && id < placement.messageBase + placement.textCount); }
  const round = decompileBw2Script(bytes); assert(round.editable && round.roundTripVerified);
}
assert.throws(() => rebaseStoryMentorBody('talk message: 9', 100, 5), /exceeds/);
// Failure must not commit any partial archive. Full difficulty without campaign
// and edited native source pins both fail while rom.files keep identical refs.
for (const kind of ['missingCampaign', 'changedSource']) {
  const reject = new NintendoDSRom(baseBytes, { fileData: 'view' });
  if (kind === 'changedSource') { const arc = new NARC(new Uint8Array(reject.getFileByName(STORY_PATHS.events))); arc.files[47][10] ^= 1; reject.files[reject.fileId(STORY_PATHS.events)] = arc.save(); }
  const refs = [...reject.files];
  assert.throws(() => applyStory(reject, undefined, kind === 'missingCampaign' ? { profile: 'full-campaign' } : undefined), kind === 'missingCampaign' ? /require progression20/ : /unexpected native events:47/);
  reject.files.forEach((f, i) => assert.equal(f, refs[i]));
}
const interim = new NintendoDSRom(baseBytes, { fileData: 'view' }); const interimReport = applyStory(interim);
assert.equal(interimReport.gymGates.length, 0); assert.equal(interimReport.leagueGates.length, 0);
assert.equal(sha(baseBytes), TRAINER_BASE_SHA256); assert.equal(sha(readFileSync(new URL('../roms/pokemon-black2-us.nds', import.meta.url))), TRAINER_BASE_SHA256);
JSON.stringify(report);
mkdirSync('build/research-story-implementation', { recursive: true });
writeFileSync('build/research-story-implementation/report.json', JSON.stringify(report, null, 2));
const verification = { passed: true, baseSha256: sha(baseBytes), stages: report.stages.length, gymGates: report.gymGates.length, leagueGates: report.leagueGates.length, mentors: report.mentorPlacements.length, approvedOriginalDialogueChanges: report.approvedDialogueChanges.length, addedTextEntries: allDiff.addedEntries, sourceBytesUnchanged: true, untouchedMembersPreserved: true, allNativeBodiesPreserved: true, persistedFlagBranchPathsChecked: true, mentorWorldSlots: 'synthetic appended fixture with real campaign bodies and real allocated trainer records', emulatorValidated: false, romFilesWritten: false };
writeFileSync('build/research-story-implementation/verification.json', JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
