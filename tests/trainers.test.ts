/** Real-ROM binary verification; no full ROM save, emulator, or hardware claims.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/trainers.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { NintendoDSRom } from "../vendor/pokeweb-serverless/src/nds/rom";
import { NARC } from "../vendor/pokeweb-serverless/src/nds/narc";
import { readU16, readU32 } from "../vendor/pokeweb-serverless/src/nds/binary";
import { decompressCode } from "../vendor/pokeweb-serverless/src/nds/codeCompression";
import { decodeGen5TextBank } from "../vendor/pokeweb-serverless/src/pokeweb/text";
import { loadProjectFromRomBytes } from "../vendor/pokeweb-serverless/src/pokeweb/loader";
import { createNarcStore, decodeRecord } from "../vendor/pokeweb-serverless/src/pokeweb/projectStore";
import { refreshProjectSessionIndexes } from "../vendor/pokeweb-serverless/src/pokeweb/projectSession";
import { getTrainerRecord } from "../vendor/pokeweb-serverless/src/pokeweb/trainerModel";
import { gen5ScriptCommandOffsets } from "../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands";
import { compareTextArchives } from "../scripts/dialogue-guard";
import { applyTrainers, appendTrainer, TRAINER_BASE_SHA256, TRAINER_PATHS, LEAGUE_BINDINGS, GYM_BINDINGS, CHAMPION_STORY_BINDINGS, REQUIRED_CHAMPION_STORY_TEXT_CHANGES } from "../scripts/rom/trainers";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
// Use Node Buffer just like the central builder, catching borrowed Buffer.slice()
// writes as well as normal Uint8Array aliasing.
const bytes = readFileSync(new URL("../roms/pokemon-black2-us.nds", import.meta.url));
assert.equal(sha(bytes), TRAINER_BASE_SHA256);
const base = new NintendoDSRom(bytes, { fileData: "view" });
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const originalFiles = [...rom.files];
const baseData = new NARC(new Uint8Array(base.getFileByName(TRAINER_PATHS.data)));
const baseParties = new NARC(new Uint8Array(base.getFileByName(TRAINER_PATHS.parties)));
const config = JSON.parse(readFileSync(new URL("../config/difficulty.json", import.meta.url), "utf8"));
const report = applyTrainers(rom);
const data = new NARC(rom.getFileByName(TRAINER_PATHS.data));
const parties = new NARC(rom.getFileByName(TRAINER_PATHS.parties));
const messages = new NARC(rom.getFileByName(TRAINER_PATHS.messages));
assert.equal(report.profile, "interim");
assert.equal(report.ordinary.length, 137);
assert.equal(report.gyms.length, 16);
assert.equal(report.league.length, 20);
assert.equal(report.approvedDialogueChanges.length, 21);
assert.equal(data.files.length, 814);
assert.equal(parties.files.length, 814);
assert.deepEqual(report.changedFiles.map(f => f.path).sort(), ["a/0/0/2", "a/0/9/1", "a/0/9/2"]);
const modifiedIds = new Set(report.changedFiles.map(f => f.fileId));
for (let i = 0; i < rom.files.length; i++) {
  if (modifiedIds.has(i)) assert.notEqual(rom.files[i].buffer, bytes.buffer, "changed files must own their memory");
  else assert.equal(rom.files[i], originalFiles[i], `unexpected NitroFS write ${i}`);
}
assert.equal(sha(bytes), TRAINER_BASE_SHA256, "borrowed base bytes must remain untouched");
const partyIds = new Set([...report.ordinary, ...report.gyms, ...report.league, report.alder].map(x => x.trainerId));
const metadataIds = new Set([...report.gyms, ...report.league, report.alder].map(x => x.trainerId));
for (let id = 0; id < 814; id++) {
  if (!metadataIds.has(id)) assert.deepEqual(data.files[id], baseData.files[id], `unowned metadata ${id}`);
  if (!partyIds.has(id)) assert.deepEqual(parties.files[id], baseParties.files[id], `unowned party ${id}`);
}
for (const row of report.ordinary) {
  const template = data.files[row.trainerId][0], stride = 8 + (template & 1 ? 8 : 0) + (template & 2 ? 2 : 0);
  const expected = new Uint8Array(baseParties.files[row.trainerId]);
  row.beforeLevels.forEach((level, i) => { expected[i * stride + 2] = Math.min(100, level + Math.min(4, Math.max(1, Math.ceil(level * 0.08)))); });
  assert.deepEqual(parties.files[row.trainerId], expected, `ordinary party changes beyond level ${row.trainerId}`);
}
const diff = compareTextArchives(base.getFileByName(TRAINER_PATHS.messages), rom.getFileByName(TRAINER_PATHS.messages), report.approvedDialogueChanges);
assert.deepEqual(diff.differences, []);
assert.deepEqual(diff.unusedApprovals, []);
assert.equal(diff.approvedDifferences.length, 21);
assert.deepEqual(rom.getFileByName("a/0/0/3"), base.getFileByName("a/0/0/3"));
assert.deepEqual(rom.getFileByName("a/0/7/1"), base.getFileByName("a/0/7/1"), "preserve all Iris/native art");
const names = decodeGen5TextBank(messages.files[382]), classes = decodeGen5TextBank(messages.files[383]);
for (const id of [341, 536, 776, 781]) { assert.equal(names[id][1], "N"); assert.equal(data.files[id][1], 40); }
assert.equal(classes[40][1], "Champion");
assert.equal(classes[193][1], "Champion");
const arm9 = decompressCode(base.arm9);
assert.equal(arm9[0x8e394 + 40 * 4], 40, "N class selects native N graphic");
assert.equal(arm9[0x8e394 + 193 * 4], 155);
assert.equal(arm9[0x8e394 + 198 * 4], 155, "other Iris class shares the original graphic");
// Independent vendored trainer parser reads freshly serialized NARC members.
const project = await loadProjectFromRomBytes(bytes, "base.nds", { selectedNarcs: ["trdata", "trpok", "personal"] });
function reloadTrainerArchives(source: NintendoDSRom) {
  project.narcs.trdata = createNarcStore("trdata", TRAINER_PATHS.data, source.fileId(TRAINER_PATHS.data), new NARC(source.getFileByName(TRAINER_PATHS.data)));
  project.narcs.trpok = createNarcStore("trpok", TRAINER_PATHS.parties, source.fileId(TRAINER_PATHS.parties), new NARC(source.getFileByName(TRAINER_PATHS.parties)));
  refreshProjectSessionIndexes(project);
}
reloadTrainerArchives(rom);
for (const boss of report.league) {
  const raw = decodeRecord(project, "trpok", boss.trainerId).raw!;
  const configBoss = config.league.roster.find((x: { id: string }) => x.id === boss.boss);
  const record = getTrainerRecord(project, boss.trainerId, { includeTexts: false });
  assert.equal(record.raw.num_pokemon, 6);
  assert.equal(record.raw.template, 3);
  assert.equal(record.raw.item_1, 23); assert.equal(record.raw.item_2, 23); assert.equal(record.raw.item_3, 0); assert.equal(record.raw.item_4, 0);
  assert.equal(record.raw.ai & ~0x30f, 0, "avoid indiscriminate AI flags");
  for (let i = 0; i < 6; i++) {
    const planned = configBoss.team[i];
    assert.equal(raw[`species_id_${i}`], planned.national_dex_id);
    assert.equal(raw[`level_${i}`], boss.levels[i]);
    assert.equal(raw[`ivs_${i}`], 255); assert.equal(raw[`padding_${i}`], 0);
    const abilitySlot = raw[`ability_${i}`] >> 4;
    assert(abilitySlot >= 1 && abilitySlot <= 3);
    const personal = decodeRecord(project, "personal", planned.national_dex_id).raw!;
    assert.equal(norm(project.texts.banks.abilities![personal[`ability_${abilitySlot}`]]), norm(planned.ability));
    assert.equal(norm(project.texts.banks.items![raw[`item_id_${i}`]]), norm(planned.held_item));
    for (let m = 0; m < 4; m++) assert.equal(norm(project.texts.banks.moves![raw[`move_${m + 1}_${i}`]]), norm(planned.moves[m]));
  }
  if (boss.mode === "first" || boss.mode === "challenge") assert(Math.max(...boss.levels) <= 62, "interim first clear cannot require the unbuilt twenty-Gym curve");
}
for (const boss of report.gyms) {
  const metadata = decodeRecord(project, "trdata", boss.trainerId).raw!;
  assert.equal(metadata.num_pokemon, baseData.files[boss.trainerId][3] + 1);
  assert.equal(new Set(boss.species).size, boss.species.length);
  assert.equal(metadata.ai, 39);
}
// Native script evidence, including overlay-aware Champion command walking.
const scripts = new NARC(base.getFileByName("a/0/5/6"));
for (const binding of LEAGUE_BINDINGS) {
  const offsets = gen5ScriptCommandOffsets(scripts.files[binding.script], "BW2", binding.id === "n" ? { overlayId: 52 } : {});
  const ids = offsets.filter(o => readU16(scripts.files[binding.script], o) === 0x85).map(o => readU16(scripts.files[binding.script], o + 2));
  for (const id of [binding.first, binding.challenge, binding.rematch, binding.challengeRematch]) assert(ids.includes(id), `missing native League call ${id}`);
}
for (const binding of [CHAMPION_STORY_BINDINGS.overworld, CHAMPION_STORY_BINDINGS.hallOfFame]) {
  const member = new NARC(base.getFileByName(binding.path)).files[binding.member];
  assert.equal(sha(member), binding.beforeSha256);
  const offset = "offset" in binding ? binding.offset : binding.operandOffset;
  assert.equal(readU16(member, offset), 298);
}
const story = new NARC(base.getFileByName("a/0/0/3"));
for (const change of REQUIRED_CHAMPION_STORY_TEXT_CHANGES) {
  const before = decodeGen5TextBank(story.files[change.bank]).find(e => e[0] === change.entry)![1];
  assert.equal(sha(before), change.before_sha256); assert.equal(sha(change.after), change.after_sha256);
}
// Full-campaign is explicit; its serialized teams must match final config levels.
const full = new NintendoDSRom(bytes, { fileData: "view" });
const finalReport = applyTrainers(full, { profile: "full-campaign", gymAceLevels: { Cheren: 18 } });
for (const row of finalReport.league) {
  const boss = config.league.roster.find((x: { id: string }) => x.id === row.boss);
  if (row.mode === "first" || row.mode === "challenge") assert.deepEqual(row.levels, boss.team.map((p: { level: number }) => p.level));
  else { const [low, high] = config.league.rematch_targets[row.boss === "n" ? "champion" : "elite_four"]; assert.equal(Math.min(...row.levels), low); assert.equal(Math.max(...row.levels), high); }
}
assert.equal(Math.max(...finalReport.gyms.find(x => x.name === "Cheren")!.levels), 18);
assert.deepEqual(finalReport.alder.levels, [82, 82, 83, 83, 83, 85]);
// Reject repeated/scaled input before modifying any buffer; wrong config is atomic.
const beforeRetry = [...rom.files];
assert.throws(() => applyTrainers(rom), /already modified/);
assert(rom.files.every((file, i) => file === beforeRetry[i]));
const invalid = new NintendoDSRom(bytes, { fileData: "view" }), invalidBefore = [...invalid.files];
assert.throws(() => applyTrainers(invalid, { gymAceLevels: { Cheren: 0 } }), /Gym ace target/);
assert(invalid.files.every((file, i) => file === invalidBefore[i]));
// New Gym / Plasma allocation after the main patch; no guessed ID ranges.
const allocation = appendTrainer(rom, { name: "Aster", trainerClassId: 115, team: [{ species: "Audino", level: 24, ability: "Regenerator", held_item: "Sitrus Berry", moves: ["Secret Power", "Attract", "Refresh", "DoubleSlap"] }], bagItems: ["Super Potion"], battleText: { 1: "That was a fine battle!", 19: "We still have one chance!" } });
assert.equal(allocation.trainerId, 814);
const next = appendTrainer(rom, { name: "Plasma Scout", trainerClassId: 187, team: [{ species: "Watchog", level: 25 }] });
assert.equal(next.trainerId, 815);
reloadTrainerArchives(rom);
assert.equal(decodeRecord(project, "trdata", 814).raw!.class, 115);
assert.equal(decodeRecord(project, "trpok", 814).raw!.species_id_0, 531);
assert.equal(decodeRecord(project, "trpok", 815).raw!.species_id_0, 505);
const appendedMessages = new NARC(rom.getFileByName(TRAINER_PATHS.messages));
assert.equal(decodeGen5TextBank(appendedMessages.files[382])[814][1], "Aster");
const textOffsets = new NARC(rom.getFileByName(TRAINER_PATHS.textOffsets)).files[0];
const textTable = new NARC(rom.getFileByName(TRAINER_PATHS.textTable)).files[0];
for (const id of [814, 815]) assert.equal(readU16(textTable, readU16(textOffsets, id * 2)), id);
const appendDiff = compareTextArchives(base.getFileByName(TRAINER_PATHS.messages), rom.getFileByName(TRAINER_PATHS.messages), report.approvedDialogueChanges);
assert.deepEqual(appendDiff.differences, []); assert.deepEqual(appendDiff.unusedApprovals, []); assert.equal(appendDiff.addedEntries, 5);
const beforeInvalidAppend = [...rom.files];
assert.throws(() => appendTrainer(rom, { name: "Invalid", trainerClassId: 115, team: [{ species: "Pikachu", level: 20, ability: "Levitate" }] }), /not an ability/);
assert(rom.files.every((file, i) => file === beforeInvalidAppend[i]));
assert.equal(sha(bytes), TRAINER_BASE_SHA256);
const summary = { baseSha256: TRAINER_BASE_SHA256, passed: true, ordinary: report.ordinary.length, gymRecords: report.gyms.length, leagueRecords: report.league.length, untouchedTrainerParties: 814 - partyIds.size, approvedOriginalTextChanges: report.approvedDialogueChanges.length, allocatedTrainerIds: [814, 815], verifiedProfiles: ["interim", "full-campaign"], emulatorValidated: false, wholeRomSaved: false };
mkdirSync(new URL("../build/research-trainers/", import.meta.url), { recursive: true });
writeFileSync(new URL("../build/research-trainers/verification.json", import.meta.url), JSON.stringify(summary, null, 2));
writeFileSync(new URL("../build/research-trainers/report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
