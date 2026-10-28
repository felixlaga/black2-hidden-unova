/** Pinned real-ROM tests; no ROM export or disk fixtures.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/epilogue.test.ts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32, writeU16, writeU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { gen5ScriptEntries, gen5ScriptCommandOffsets, gen5ScriptCommandSize } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { compileBw2Script, decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { decodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { applyTrainers, TRAINER_BASE_SHA256 } from '../scripts/rom/trainers';
import { applyCampaignDefinitions, ORIGINAL_GYM_ACE_LEVELS } from '../scripts/rom/campaign';
import { applyWorld, type WorldReport } from '../scripts/rom/world';
import { applyStory } from '../scripts/rom/story';
import { prepareCampaignAccess, applyAccess, NATIVE_ACCESS } from '../scripts/rom/access';
import { applyEpilogue, EPILOGUE_PATHS, EPILOGUE_HOF_FLAG, EPILOGUE_VISIT_FLAGS, EPILOGUE_ELDER_SPRITE } from '../scripts/rom/epilogue';
import { compareTextArchives } from '../scripts/dialogue-guard';
import { formatAddedDialogue } from '../scripts/rom/dialogue';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(new URL('../roms/pokemon-black2-us.nds', import.meta.url));
assert.equal(sha(source), TRAINER_BASE_SHA256);
const original = new NintendoDSRom(source, { fileData: 'view' });
const rom = new NintendoDSRom(source, { fileData: 'view' });
const trainers = applyTrainers(rom, { profile: 'full-campaign', gymAceLevels: ORIGINAL_GYM_ACE_LEVELS });
const campaign = applyCampaignDefinitions(rom);
prepareCampaignAccess(campaign);
const world: any = applyWorld(rom, { campaign });
applyStory(rom, world, trainers, campaign as Parameters<typeof applyStory>[3]);
applyAccess(rom);
const beforeFiles = [...rom.files];
const before = Object.fromEntries(Object.entries(EPILOGUE_PATHS).map(([key, path]) => [key, new NARC(new Uint8Array(rom.getFileByName(path)))]));
const report = applyEpilogue(rom, world);
const after = Object.fromEntries(Object.entries(EPILOGUE_PATHS).map(([key, path]) => [key, new NARC(new Uint8Array(rom.getFileByName(path)))]));
assert.equal(report.bindings.length, 6);
assert.deepEqual(report.bindings.map(b => b.flagId), [...EPILOGUE_VISIT_FLAGS]);
assert.equal(report.hofFlag, 0x960);
assert.equal(report.sprite.fallback, true); assert.equal(report.sprite.id, EPILOGUE_ELDER_SPRITE);
assert.equal(report.bindings.filter(b => b.closureNpc).length, 1);
assert.equal(report.bindings.find(b => b.closureNpc)?.name, 'Rood');
assert.equal(report.stateAudit.nativeTables.length, 7);
assert.equal(report.stateAudit.savedFlagOffset, 862); assert.equal(report.stateAudit.savedFlagBytes, 383);
assert.equal(report.stateAudit.trainerLast, 0x939);
assert.equal(report.stateAudit.oddOffsetsAlsoAudited, true);
assert.deepEqual(report.stateAudit.availableOriginalCandidates, [...EPILOGUE_VISIT_FLAGS]);
for (const flag of EPILOGUE_VISIT_FLAGS) {
  assert(flag >= 0xA42 && flag <= 0xA55);
  assert(!report.stateAudit.nativeTables.some(table => table.values.includes(flag)));
  assert(!report.stateAudit.excludedDynamicRanges.some(range => flag >= range.start && flag <= range.end));
  for (const path of [EPILOGUE_PATHS.scripts, EPILOGUE_PATHS.events]) for (const bytes of new NARC(new Uint8Array(original.getFileByName(path))).files) for (let at = 0; at + 1 < bytes.length; at++) assert.notEqual(readU16(bytes, at), flag);
}

// Source bytes, unrelated NitroFS files, all native members, existing staged
// actor/trigger rows and script payload bytes must survive.
assert.equal(sha(source), TRAINER_BASE_SHA256); assert.equal(sha(rom.data), TRAINER_BASE_SHA256);
const changedIds = new Set(report.changedFiles.map(file => file.fileId));
for (let id = 0; id < rom.files.length; id++) {
  if (changedIds.has(id)) assert.notEqual(rom.files[id].buffer, source.buffer);
  else assert.equal(rom.files[id], beforeFiles[id], 'unowned NitroFS file ' + id);
}
for (const [key, archive] of Object.entries(before)) {
  assert.equal(after[key].files.length, archive.files.length);
  const changed = new Set(report.memberChanges.filter(c => c.archive === key).map(c => c.member));
  const nativeCount = new NARC(new Uint8Array(original.getFileByName(EPILOGUE_PATHS[key as keyof typeof EPILOGUE_PATHS]))).files.length;
  for (let id = 0; id < archive.files.length; id++) {
    if (id < nativeCount || !changed.has(id)) assert.deepEqual(after[key].files[id], archive.files[id], 'preserved ' + key + ':' + id);
  }
}
assert.deepEqual(after.scripts.files[NATIVE_ACCESS.initializer.member], before.scripts.files[NATIVE_ACCESS.initializer.member], 'actual native HOF initializer stays untouched');
assert.deepEqual(compareTextArchives(beforeFiles[rom.fileId(EPILOGUE_PATHS.story)], rom.getFileByName(EPILOGUE_PATHS.story)).differences, []);
for (const binding of report.bindings) {
  const oldScript = before.scripts.files[binding.scriptId], script = after.scripts.files[binding.scriptId];
  assert.deepEqual(script.subarray(binding.originalTableEnd + 4, binding.originalLength + 4), oldScript.subarray(binding.originalTableEnd), 'staged script payload is byte-for-byte preserved');
  gen5ScriptEntries(oldScript).forEach((target, i) => assert.equal(gen5ScriptEntries(script)[i], target + 4));
  const round = decompileBw2Script(script); assert(round.editable && round.roundTripVerified);
  assert.deepEqual(compileBw2Script(round.source).bytes, script);
  const commandOffsets = gen5ScriptCommandOffsets(script, 'BW2', { entryIndices: [binding.entry - 1] }), commandSet = new Set(commandOffsets);
  assert(commandSet.has(binding.appendedOffset));
  const writes = commandOffsets.filter(at => readU16(script, at) === 0x23);
  assert.equal(writes.length, 1); assert.equal(readU16(script, writes[0] + 2), binding.flagId);
  for (const at of commandOffsets) {
    const opcode = readU16(script, at), size = gen5ScriptCommandSize(opcode, 'BW2');
    assert(at >= binding.appendedOffset, 'new branches must never enter an existing script');
    assert([2, 8, 0x10, 0x11, 0x1e, 0x1f, 0x23, 0x2e, 0x2f, 0x30, 0x32, 0x36, 0x3d, 0x3e, 0x74, 0xa6].includes(opcode), 'unexpected effect ' + opcode);
    if ([0x1e, 0x1f].includes(opcode)) assert(commandSet.has(at + size + (readU32(script, at + size - 4) | 0)), 'branch must land on an instruction boundary');
  }
  const oldEvent = before.events.files[binding.eventId], event = after.events.files[binding.eventId];
  assert.equal(event[5], oldEvent[5] + 1); assert.equal(readU32(event, 0), event.length - 4);
  const restored = new Uint8Array(oldEvent.length);
  restored.set(event.subarray(0, binding.originalNpcEnd)); restored.set(event.subarray(binding.originalNpcEnd + 36), binding.originalNpcEnd);
  restored[5]--; writeU32(restored, 0, oldEvent.length - 4); assert.deepEqual(restored, oldEvent, 'all original event rows preserved');
  const at = binding.originalNpcEnd;
  assert.equal(readU16(event, at), binding.actorId); assert.equal(readU16(event, at + 2), EPILOGUE_ELDER_SPRITE);
  assert.equal(readU16(event, at + 8), 0, 'actor visible before HOF'); assert.equal(readU16(event, at + 10), binding.entry);
  assert.equal(readU16(event, at + 28), binding.x); assert.equal(readU16(event, at + 30), binding.z);
  assert.notDeepEqual({ x: binding.x, z: binding.z }, { x: 8, z: 7 });
  assert(binding.placement.existingActorsAndExitReachable && binding.placement.approachTiles.length > 0);
  assert(!binding.placement.occupantsBefore.some(n => n.x === binding.x && n.z === binding.z));
  const oldText = decodeGen5TextBank(before.story.files[binding.textBankId]), text = decodeGen5TextBank(after.story.files[binding.textBankId]);
  assert.deepEqual(text.slice(0, oldText.length), oldText); assert.equal(text.length, oldText.length + binding.textCount);
  assert(binding.optional); assert.deepEqual(binding.rewards, []);
}

// Focused bytecode executor: unknown opcodes fail. This does not emulate battles,
// the field engine, or save-file loading.
function interact(binding: typeof report.bindings[number], initial: Set<number>) {
  const bytes = after.scripts.files[binding.scriptId], flags = new Set(initial), stack: number[] = [], messages: number[] = [];
  let pc = gen5ScriptEntries(bytes)[binding.entry - 1], locked = false;
  const boundaries = new Set(gen5ScriptCommandOffsets(bytes, 'BW2', { entryIndices: [binding.entry - 1] }));
  const pop = () => { assert(stack.length > 0); return stack.pop()!; };
  for (let step = 0; step < 500; step++) {
    assert(boundaries.has(pc));
    const opcode = readU16(bytes, pc), size = gen5ScriptCommandSize(opcode, 'BW2');
    const first = readU16(bytes, pc + 2), second = readU16(bytes, pc + 4); let next = pc + size;
    switch (opcode) {
      case 2: assert(!locked); assert.equal(stack.length, 0); return { flags, messages };
      case 8: stack.push(first); break;
      case 0x10: stack.push(Number(flags.has(first))); break;
      case 0x11: { const right = pop(), left = pop(); assert.equal(first, 1); stack.push(Number(left === right)); break; }
      case 0x1f: assert.equal(bytes[pc + 2], 255); if (pop() !== 1) next += readU32(bytes, pc + 3) | 0; break;
      case 0x1e: next += readU32(bytes, pc + 2) | 0; break;
      case 0x23: flags.add(first); break;
      case 0x2e: locked = true; break;
      case 0x2f: locked = false; break;
      case 0x3d: assert(locked); messages.push(second); break;
      default: assert([0x30, 0x32, 0x36, 0x3e, 0x74, 0xa6].includes(opcode), 'unmodeled sage opcode ' + opcode);
    }
    pc = next;
  }
  throw new Error('sage script exceeded instruction budget');
}
const winFlags = [0xA41, ...campaign.progression20.flatMap(step => step.flagId === undefined ? [] : [step.flagId]), ...[341, 536, 776, 781].map(id => 0x5F0 + id)];
for (const initial of [new Set<number>(), new Set(winFlags), new Set([...winFlags, ...EPILOGUE_VISIT_FLAGS])]) {
  for (const binding of report.bindings) for (let repeat = 0; repeat < 2; repeat++) {
    const result = interact(binding, initial);
    assert.deepEqual(result.messages, [binding.messages.before]); assert.deepEqual(result.flags, initial, 'pre-HOF never remembers a visit or shows closure, even with battle/access flags');
  }
}
const rood = report.bindings.find(b => b.closureNpc)!;
// Every subset, plus every possible last sage, exercises missing-visit closure.
for (let mask = 0; mask < 64; mask++) {
  const initial = new Set([EPILOGUE_HOF_FLAG, ...EPILOGUE_VISIT_FLAGS.filter((_, i) => mask & (1 << i))]);
  const result = interact(rood, initial), complete = EPILOGUE_VISIT_FLAGS.every(flag => result.flags.has(flag));
  assert.equal(result.messages.at(-1), complete ? rood.messages.closure : rood.messages.search);
  assert.equal(result.messages[0], initial.has(rood.flagId) ? rood.messages.repeat : rood.messages.first);
}
for (const last of report.bindings) {
  let state = new Set([EPILOGUE_HOF_FLAG, 123]);
  const order = [...report.bindings.filter(b => b !== last), last];
  for (const binding of order) {
    const first = interact(binding, state); assert.equal(first.messages[0], binding.messages.first);
    assert.deepEqual(first.flags, new Set([...state, binding.flagId]));
    state = new Set(JSON.parse(JSON.stringify([...first.flags])));
    const repeat = interact(binding, state); assert.equal(repeat.messages[0], binding.messages.repeat); assert.deepEqual(repeat.flags, state);
  }
  assert(EPILOGUE_VISIT_FLAGS.every(flag => state.has(flag)));
  for (let repeat = 0; repeat < 2; repeat++) {
    const closed = interact(rood, state); assert.deepEqual(closed.messages, [rood.messages.repeat, rood.messages.closure]); assert.deepEqual(closed.flags, state);
  }
}

// Rejection is atomic even after earlier rooms have been prepared in memory.
function rejected(mutate: (candidate: NintendoDSRom, report: any) => void, pattern: RegExp) {
  const candidate = new NintendoDSRom(source, { fileData: 'view' }); candidate.files = [...beforeFiles];
  const worldCopy = JSON.parse(JSON.stringify(world)); mutate(candidate, worldCopy);
  const refs = [...candidate.files]; assert.throws(() => applyEpilogue(candidate, worldCopy as WorldReport), pattern);
  candidate.files.forEach((file, i) => assert.equal(file, refs[i], 'failure cannot commit partial archives'));
  assert.equal(sha(source), TRAINER_BASE_SHA256);
}
rejected((candidate) => {
  const events = new NARC(new Uint8Array(candidate.getFileByName(EPILOGUE_PATHS.events))), binding = report.bindings.at(-1)!;
  writeU16(events.files[binding.eventId], 8 + 28, binding.x); writeU16(events.files[binding.eventId], 8 + 30, binding.z);
  candidate.files[candidate.fileId(EPILOGUE_PATHS.events)] = events.save();
}, /occupied sage tile/);
rejected((candidate) => {
  const scripts = new NARC(new Uint8Array(candidate.getFileByName(EPILOGUE_PATHS.scripts)));
  scripts.files.push(compileBw2Script('preserve_layout\nscript :conflict, entry: 1 do\nset_flag ' + EPILOGUE_VISIT_FLAGS[0] + '\nhalt\nend').bytes);
  candidate.files[candidate.fileId(EPILOGUE_PATHS.scripts)] = scripts.save();
}, /visit flag already present in staged/);
rejected((_candidate, report) => { report.links.find((link: any) => link.to === 'interior.settlement.dawnbridge.1').requiredFlags = [EPILOGUE_HOF_FLAG]; }, /entry\/return must already be open/);
rejected((_candidate, report) => { report.areas.find((area: any) => area.id === 'interior.settlement.dawnbridge.1').eventId++; }, /header\/report mismatch/);
rejected((_candidate, report) => { report.areas = report.areas.filter((area: any) => area.id !== 'interior.settlement.dawnbridge.1'); }, /missing or duplicate field office/);
for (const mode of ['missingExit', 'misboundExit', 'missingEntrance', 'misboundEntrance']) rejected((candidate, report) => {
  const area = report.areas.find((a: any) => a.id === 'interior.settlement.dawnbridge.1');
  const link = report.links.find((link: any) => link.to === area.id);
  const target = mode.includes('Entrance') ? report.areas.find((a: any) => a.id === link.from) : area;
  const entry = mode.includes('Entrance') ? link.fromEntry : link.toEntry;
  const events = new NARC(new Uint8Array(candidate.getFileByName(EPILOGUE_PATHS.events))), event = events.files[target.eventId];
  const triggerStart = 8 + event[4] * 20 + event[5] * 36 + event[6] * 20;
  const index = Array.from({length:event[7]}, (_, i) => i).find(i => readU16(event, triggerStart + i * 22) === entry)!;
  assert.notEqual(index, undefined);
  if (mode.startsWith('misbound')) writeU16(event, triggerStart + index * 22, 999);
  else {
    const next = new Uint8Array(event.length - 22), at = triggerStart + index * 22;
    next.set(event.subarray(0, at)); next.set(event.subarray(at + 22), at); next[7]--; writeU32(next, 0, next.length - 4);
    events.files[target.eventId] = next;
  }
  candidate.files[candidate.fileId(EPILOGUE_PATHS.events)] = events.save();
}, /actual office entrance\/exit trigger/);
for (const direction of ['entry', 'exit']) rejected((candidate, report) => {
  const area = report.areas.find((a: any) => a.id === 'interior.settlement.dawnbridge.1'), link = report.links.find((link: any) => link.to === area.id);
  const target = direction === 'entry' ? report.areas.find((a: any) => a.id === link.from) : area;
  const scripts = new NARC(new Uint8Array(candidate.getFileByName(EPILOGUE_PATHS.scripts))), script = scripts.files[target.scriptId];
  const at = gen5ScriptCommandOffsets(script, 'BW2', {entryIndices:[(direction === 'entry' ? link.fromEntry : link.toEntry) - 1]}).find(at => readU16(script, at) === 0xc2)!;
  writeU16(script, at + 4, 0); writeU16(script, at + 6, 0);
  candidate.files[candidate.fileId(EPILOGUE_PATHS.scripts)] = scripts.save();
}, /actual office warp arrival/);
const appliedRefs = [...rom.files]; assert.throws(() => applyEpilogue(rom, world), /visit flag already present/); rom.files.forEach((file, i) => assert.equal(file, appliedRefs[i]));

// Root calls the shared formatter later; the incremental pass must accept the
// epilogue texts while preserving staged lines and executable bytes.
const formatterBefore = new Map([['story', beforeFiles[rom.fileId(EPILOGUE_PATHS.story)]], ['messages', beforeFiles[rom.fileId('a/0/0/2')]]]);
const scriptRefs = rom.files[rom.fileId(EPILOGUE_PATHS.scripts)], eventRefs = rom.files[rom.fileId(EPILOGUE_PATHS.events)];
formatAddedDialogue(rom, formatterBefore, []);
assert.equal(rom.files[rom.fileId(EPILOGUE_PATHS.scripts)], scriptRefs); assert.equal(rom.files[rom.fileId(EPILOGUE_PATHS.events)], eventRefs);
assert.deepEqual(compareTextArchives(beforeFiles[rom.fileId(EPILOGUE_PATHS.story)], rom.getFileByName(EPILOGUE_PATHS.story)).differences, []);
assert.equal(sha(source), TRAINER_BASE_SHA256); assert.equal(sha(readFileSync(new URL('../roms/pokemon-black2-us.nds', import.meta.url))), TRAINER_BASE_SHA256);
console.log(JSON.stringify({ passed: true, bindings: report.bindings.map(({ name, headerId, scriptId, eventId, textBankId, npcIndex, actorId, entry, x, z, flagId }) => ({ name, headerId, scriptId, eventId, textBankId, npcIndex, actorId, entry, x, z, flagId, flagHex: flagId.toString(16) })), closureSubsetsChecked: 64, lastSageOrdersChecked: 6, nativeTablesAudited: 7, sourceBytesPreserved: true, originalAndStagedMembersPreserved: true, actualNativeHofRequired: true, formatterCompatible: true, emulatorValidated: false, romFilesWritten: false }, null, 2));
