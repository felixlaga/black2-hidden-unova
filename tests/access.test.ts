/** Real-ROM access migration verification. No ROM is exported or saved.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/access.test.ts */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32, writeU16 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptEntries, gen5ScriptCommandSize, gen5ScriptCommandOffsets } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { parseFieldScriptRuntime } from '../vendor/pokeweb-serverless/src/pokeweb/gen5TrainerRuntime';
import { decodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { applyTrainers, TRAINER_BASE_SHA256 } from '../scripts/rom/trainers';
import { applyCampaignDefinitions, ORIGINAL_GYM_ACE_LEVELS, compileCampaignBody } from '../scripts/rom/campaign';
import { applyStory } from '../scripts/rom/story';
import { applyAccess, prepareCampaignAccess, NATIVE_ACCESS, ACCESS_PATHS, CAMPAIGN_ACCESS_FLAG } from '../scripts/rom/access';
import { compareTextArchives } from '../scripts/dialogue-guard';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const bytes = readFileSync('roms/pokemon-black2-us.nds'); assert.equal(sha(bytes), TRAINER_BASE_SHA256);
const base = new NintendoDSRom(bytes, { fileData: 'view' }), rom = new NintendoDSRom(bytes, { fileData: 'view' });
const nativeScripts = new NARC(new Uint8Array(base.getFileByName(ACCESS_PATHS.scripts)));
const trainers = applyTrainers(rom, { profile: 'full-campaign', gymAceLevels: ORIGINAL_GYM_ACE_LEVELS });
const campaign = applyCampaignDefinitions(rom);
const campaignBefore = JSON.parse(JSON.stringify(campaign));
const preparation = prepareCampaignAccess(campaign);
const town = campaign.towns['settlement.dawnbridge'];
assert.equal(preparation.migrationCommands.length, 30);
assert.equal(sha(Uint8Array.from(town.compiledBytes)), town.compiledSha256);
assert.equal(compileCampaignBody(town.body).sha256, town.compiledSha256);
assert.equal(town.texts.length, campaignBefore.towns['settlement.dawnbridge'].texts.length + 2);
for (const [id, value] of Object.entries(campaignBefore.towns)) if (id !== 'settlement.dawnbridge') assert.deepEqual(campaign.towns[id], value);
assert.deepEqual(campaign.gyms, campaignBefore.gyms); assert.deepEqual(campaign.mentors, campaignBefore.mentors);
assert.throws(() => prepareCampaignAccess(campaign), /already prepared/);
// Story's native scopes compose before access; mentor geometry is covered by the
// separate story/world tests, so no fabricated field placement is claimed here.
const storyReport = applyStory(rom, undefined, trainers, { progression20: campaign.progression20, mentors: [] });
const beforeFiles = [...rom.files], beforeScripts = new NARC(new Uint8Array(rom.getFileByName(ACCESS_PATHS.scripts)));
const beforeStory = new Uint8Array(rom.getFileByName(ACCESS_PATHS.story));
const report = applyAccess(rom);
const scripts = new NARC(new Uint8Array(rom.getFileByName(ACCESS_PATHS.scripts)));
assert.equal(report.nativeBarrierReads.length, 15);
assert.equal(report.nativeBarrierReads.reduce((n, p) => n + p.reads.length, 0), 24);
assert.equal(report.approvedDialogueChanges.length, 3);
assert.equal(report.initializer.guardedCommands, 30);
const changedMembers = new Set([...report.nativeBarrierReads.map(p => p.member), 1242]);
for (let member = 0; member < scripts.files.length; member++) if (!changedMembers.has(member)) assert.deepEqual(scripts.files[member], beforeScripts.files[member], `unowned script member ${member}`);
for (const patch of NATIVE_ACCESS.patches) {
  const expected = new Uint8Array(beforeScripts.files[patch.member]);
  for (const read of patch.reads) writeU16(expected, read.offset + 2, CAMPAIGN_ACCESS_FLAG);
  assert.deepEqual(scripts.files[patch.member], expected, 'only audited u16 operands change');
}
assert.deepEqual(scripts.files[66], nativeScripts.files[66], 'Casteliacone was incorrectly labelled Royal Unova in initial candidates');
for (const offset of [286, 333]) assert.equal(readU16(scripts.files[124], offset + 2), 0x960, 'Cheren story check preserved');
for (let id = 0; id < rom.files.length; id++) if (!report.changedFiles.some(f => f.fileId === id)) assert.equal(rom.files[id], beforeFiles[id]);
for (const file of report.changedFiles) assert.notEqual(rom.files[file.fileId].buffer, bytes.buffer);
assert.equal(sha(rom.data), TRAINER_BASE_SHA256); assert.equal(sha(bytes), TRAINER_BASE_SHA256);
const diff = compareTextArchives(beforeStory, rom.getFileByName(ACCESS_PATHS.story), report.approvedDialogueChanges);
assert.deepEqual(diff.differences, []); assert.deepEqual(diff.unusedApprovals, []); assert.equal(diff.approvedDifferences.length, 3);
const combinedDiff = compareTextArchives(base.getFileByName(ACCESS_PATHS.story), rom.getFileByName(ACCESS_PATHS.story), [...storyReport.approvedDialogueChanges, ...report.approvedDialogueChanges]);
assert.deepEqual(combinedDiff.differences, []); assert.deepEqual(combinedDiff.unusedApprovals, []);

/** Bounded interpreter of emitted guard/migration opcodes and native initializer
 * effects. Battle results are inputs, not emulated battles. Unknown ops fail. */
function execute(code: Uint8Array, options: { start?: number; flags?: number[]; works?: Record<number, number>; wins?: number[]; badges?: number } = {}) {
  const flags = new Set(options.flags ?? []), works = new Map(Object.entries(options.works ?? {}).map(([k, v]) => [Number(k), v]));
  const effects: { opcode: number; operands: number[] }[] = [], messages: number[] = [], battles: number[] = [], stack: number[] = [];
  let pc = options.start ?? gen5ScriptEntries(code)[0], cmp = 0, won = 0;
  const compare = (id: number, a: number, b: number) => [a < b, a === b, a > b, a <= b, a >= b, a !== b, a === 1 || b === 1, a === 1 && b === 1][id];
  const pop = () => { assert(stack.length > 0, 'stack underflow'); return stack.pop()!; };
  const effect = (opcode: number, operands: number[]) => effects.push({ opcode, operands });
  for (let n = 0; n < 5000; n++) {
    const op = readU16(code, pc), size = gen5ScriptCommandSize(op, 'BW2'); assert(size > 0, `unknown opcode${op}`);
    const a = readU16(code, pc + 2), b = readU16(code, pc + 4); let next = pc + size;
    switch (op) {
      case 2: case 5: assert.equal(stack.length, 0); return { flags, works, effects, messages, battles };
      case 8: stack.push(a); break;
      case 9: stack.push(works.get(a) ?? 0); break;
      case 0x10: stack.push(Number(flags.has(a))); break;
      case 0x11: { const right = pop(), left = pop(); stack.push(Number(compare(a, left, right))); break; }
      case 0x19: cmp = (works.get(a) ?? 0) - b; break;
      case 0x1e: next += readU32(code, pc + 2) | 0; break;
      case 0x1f: { const mode = code[pc + 2]; if (mode === 255 ? pop() !== 1 : compare(mode, cmp, 0)) next += readU32(code, pc + 3) | 0; break; }
      case 0x23: flags.add(a); effect(op, [a]); break;
      case 0x24: flags.delete(a); effect(op, [a]); break;
      case 0x28: works.set(a, b); effect(op, [a, b]); break;
      case 0xda: effect(op, [a, b, readU16(code, pc + 6)]); break;
      case 0x262: effect(op, [a, b]); break;
      case 0xe4: effect(op, [a]); break;
      case 0xd7: works.set(a, options.badges ?? 8); break;
      case 0x85: battles.push(a); won = options.wins?.[battles.length - 1] ?? 0; break;
      case 0x8d: works.set(a, won); break;
      case 0x8e: assert.equal(won, 1); break;
      case 0x8c: break; // Even if native loss returned, no migration may follow.
      case 0x3d: messages.push(b); break;
      case 0x2e: case 0x2f: case 0x30: case 0x32: case 0x3e: case 0x74: case 0xa6: case 0x104: break;
      default: throw new Error(`unsupported access test opcode 0x${op.toString(16)} at ${pc}`);
    }
    assert(next >= 6 && next < code.length); pc = next;
  }
  throw new Error('execution budget exhausted');
}
const bodyBytes = Uint8Array.from(town.compiledBytes), prerequisites = town.requiredFlags;
for (const nativeStage of [0, 1, 2, 3]) {
  const blocked = execute(bodyBytes, { works: { 0x4072: nativeStage }, flags: prerequisites, wins: [1, 1] });
  assert.deepEqual(blocked.battles, []); assert.deepEqual(blocked.effects, []);
}
for (const wins of [[0, 0], [0, 1], [1, 0]]) {
  const lost = execute(bodyBytes, { works: { 0x4072: 4 }, flags: prerequisites, wins });
  assert.deepEqual(lost.effects, [], 'losing either fight must never open native access');
}
for (const missing of prerequisites) assert.deepEqual(execute(bodyBytes, { works: { 0x4072: 4 }, flags: prerequisites.filter(f => f !== missing), wins: [1, 1] }).effects, []);
assert.deepEqual(execute(bodyBytes, { works: { 0x4072: 4 }, flags: prerequisites, badges: 7, wins: [1, 1] }).effects, []);
const victory = execute(bodyBytes, { works: { 0x4072: 4 }, flags: prerequisites, wins: [1, 1] });
assert.deepEqual(victory.battles, town.trainerIds);
assert.deepEqual(victory.effects, [{ opcode: 0x23, operands: [CAMPAIGN_ACCESS_FLAG] }, ...NATIVE_ACCESS.migrations.map(m => ({ opcode: m.opcode, operands: m.operands }))]);
assert(!victory.flags.has(0x960));
for (const w of [0x40c4, 0x40e1, 0x411c, 0x4098, 0x4123]) assert.equal(victory.works.get(w), 1);
const persisted = { flags: JSON.parse(JSON.stringify([...victory.flags])), works: JSON.parse(JSON.stringify(Object.fromEntries(victory.works))) };
assert.deepEqual(execute(bodyBytes, persisted).effects, [], 'repeat interaction must not rerun migration');
const oldSave = execute(bodyBytes, { works: { 0x4072: 4, 0x4098: 3, 0x4123: 8 }, flags: prerequisites, wins: [1, 1] });
assert.equal(oldSave.works.get(0x4098), 3); assert.equal(oldSave.works.get(0x4123), 8);
// The first *true* ending keeps its native behavior when access was not migrated.
const originalInit = execute(nativeScripts.files[1242], { start: NATIVE_ACCESS.initializer.offset });
const patchedInit = execute(scripts.files[1242], { start: report.initializer.helperOffset });
assert.deepEqual(patchedInit.effects, originalInit.effects); assert.deepEqual(patchedInit.flags, originalInit.flags); assert.deepEqual(patchedInit.works, originalInit.works);
// After pre-N exploration, it must set real HOF exactly once and preserve quest
// progress. Only the selected migration effects disappear from the native helper.
const later = execute(scripts.files[1242], { start: report.initializer.helperOffset, flags: [...victory.flags, 0x395], works: { 0x4098: 3, 0x4123: 8 } });
assert(later.flags.has(0x960)); assert(later.flags.has(0x395)); assert.equal(later.works.get(0x4098), 3); assert.equal(later.works.get(0x4123), 8);
const migrated = new Set(NATIVE_ACCESS.migrations.map(m => JSON.stringify({ opcode: m.opcode, operands: m.operands })));
assert.deepEqual(later.effects, originalInit.effects.filter(e => !migrated.has(JSON.stringify(e))));
assert.equal(later.effects.filter(e => e.opcode === 0x23 && e.operands[0] === 0x960).length, 1);
// Confirm native dispatch, event visibility, and item names independently from
// the supplied ROM rather than treating descriptive manifest text as proof.
const overlay = base.loadArm9Overlays([12]).get(12)!;
const runtime = parseFieldScriptRuntime(overlay.data, overlay.ramAddress, nativeScripts.files, 615);
for (const [global, member, entry] of [[2200, 1232, 1], [2201, 1232, 2], [10657, 1277, 3], [10740, 1281, 6]]) {
  if (global >= 10000) {
    const range = runtime.globals.find(r => r.start <= global && r.end >= global)!;
    assert.equal(range.fileId, member); assert.equal(global - range.start + 1, entry);
  } else {
    // Vendored runtime scan stops at the opaque member1241; verify the actual
    // native five-u16 Day Care dispatch row directly, including its text bank.
    const signature = [2200, 2224, 1232, 3, 616], matches: number[] = [];
    for (let at = 0; at + 10 <= overlay.data.length; at += 2) if (signature.every((v, i) => readU16(overlay.data, at + i * 2) === v)) matches.push(at);
    assert.equal(matches.length, 1); assert.equal(global - 2200 + 1, entry);
  }
}
assert.equal(runtime.zoneOverlays[192], 55); assert.equal(runtime.zoneOverlays[479], 61);
const events = new NARC(new Uint8Array(base.getFileByName('a/1/2/6')));
for (const [member, npc, entry] of [[573, 0, 7], [477, 0, 2200], [479, 0, 2201], [379, 0, 10740], [241, 8, 10657]]) {
  const ev = events.files[member], at = 8 + ev[4] * 20 + npc * 36;
  assert.equal(readU16(ev, at + 8), 0); assert.equal(readU16(ev, at + 10), entry);
}
const items = decodeGen5TextBank(new NARC(new Uint8Array(base.getFileByName('a/0/0/2'))).files[64]);
for (const [id, name] of [[447, 'Super Rod'], [466, 'Gracidea'], [628, 'DNA Splicers'], [638, 'Reveal Glass']] as const) assert.equal(items[id][1], name);
for (const [member, overlayId] of [[792, undefined], [1232, undefined], [78, undefined], [104, undefined], [1281, 61], [16, 65], [752, undefined]] as const) {
  const offsets = gen5ScriptCommandOffsets(nativeScripts.files[member], 'BW2', { overlayId });
  assert(!offsets.some(at => [0x10, 0x25].includes(readU16(nativeScripts.files[member], at)) && readU16(nativeScripts.files[member], at + 2) === 0x960), `unexpected HOF gate in audited member${member}`);
}
// Reject drift before committing any archive; preserve source Buffer ownership.
const reject = new NintendoDSRom(bytes, { fileData: 'view' }); const bad = new NARC(new Uint8Array(reject.getFileByName(ACCESS_PATHS.scripts)));
bad.files[396][44] ^= 1; reject.files[reject.fileId(ACCESS_PATHS.scripts)] = bad.save(); const refs = [...reject.files];
assert.throws(() => applyAccess(reject), /unexpected native script 396/); reject.files.forEach((f, i) => assert.equal(f, refs[i]));
assert.equal(sha(bytes), TRAINER_BASE_SHA256); assert.equal(sha(readFileSync('roms/pokemon-black2-us.nds')), TRAINER_BASE_SHA256);
mkdirSync('build/research-access-implementation', { recursive: true });
writeFileSync('build/research-access-implementation/report.json', JSON.stringify({ preparation, access: report }, null, 2));
const verification = { passed: true, nativeReadsMigrated: 24, nativeScriptMembersWithReadChanges: 15, nativeMigrationCommands: 30, approvedDialogueChanges: 3, sourceAndUnownedBytesPreserved: true, originalEndingFallbackEquivalent: true, preNProgressSurvivesTrueEnding: true, migrationRequiresGhetsisAndBothRegionalVictories: true, nativeDispatchAndItemBindingsChecked: true, allAccessReachabilityVerified: false, emulatorValidated: false, romFilesWritten: false };
writeFileSync('build/research-access-implementation/verification.json', JSON.stringify(verification, null, 2));
console.log(JSON.stringify(verification, null, 2));
