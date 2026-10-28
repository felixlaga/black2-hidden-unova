/** Pinned-ROM, in-memory regression. No world build, ROM export, or evidence files.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/dialogue-layout.test.ts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { decodeGen5TextBank, encodeGen5TextBank } from '../vendor/pokeweb-serverless/src/pokeweb/text';
import { layoutBw2Dialogue } from '../vendor/pokeweb-serverless/src/pokeweb/bw2DialoguePreview';
import { applyCampaignDefinitions } from '../scripts/rom/campaign';
import { compareTextArchives } from '../scripts/dialogue-guard';
import { AUTHORED_DIALOGUE_VARIABLES, formatAddedDialogue, formatAuthoredDialogue, readDialogueFont, type TextApproval } from '../scripts/rom/dialogue';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const BASE_SHA256 = '39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99';
const sourcePath = new URL('../roms/pokemon-black2-us.nds', import.meta.url);
const sourceBuffer = readFileSync(sourcePath);
assert.equal(sha(sourceBuffer), BASE_SHA256);
const baseROM = new NintendoDSRom(sourceBuffer, { fileData: 'view' });
const baseFileRefs = [...baseROM.files];
const paths = { story: 'a/0/0/3', messages: 'a/0/0/2' } as const;
type Archive = keyof typeof paths;
const beforeText = new Map(Object.entries(paths).map(([name, path]) => [name, new Uint8Array(baseROM.getFileByName(path))]));
const beforeHashes = new Map([...beforeText].map(([name, bytes]) => [name, sha(bytes)]));
const original = Object.fromEntries(Object.entries(paths).map(([name]) => [name, new NARC(beforeText.get(name)!)])) as Record<Archive, NARC>;
function forkROM(): NintendoDSRom {
  return Object.assign(Object.create(NintendoDSRom.prototype), baseROM, { files: [...baseROM.files] });
}
const font = readDialogueFont(baseROM);
// Obtain the actual 128 authored messages and battle dialogue without building
// the world. The campaign allocator only changes this private in-memory fork.
const campaignROM = forkROM();
const campaign = applyCampaignDefinitions(campaignROM);
const campaignTexts = [...Object.values(campaign.gyms), ...Object.values(campaign.towns), ...campaign.mentors].flatMap(part => part.texts);
const plainWidth = (text: string) => [...text].reduce((sum, char) => {
  const glyph = font.glyphs.get(char.charCodeAt(0));
  assert(glyph, `Unmapped test glyph ${char}`);
  return sum + glyph.advance;
}, 0);

function archive(rom: NintendoDSRom, name: Archive) {
  return new NARC(new Uint8Array(rom.getFileByName(paths[name])));
}
function install(rom: NintendoDSRom, name: Archive, narc: NARC) {
  rom.files[rom.fileId(paths[name])] = new Uint8Array(narc.save());
}
function append(narc: NARC, bank: number, texts: string[]) {
  const entries = bank < narc.files.length ? decodeGen5TextBank(narc.files[bank]) : [];
  assert(bank <= narc.files.length);
  assert(entries.every((entry, i) => entry[0] === `0_${i}`), 'Fixture requires a single unflagged section');
  const start = entries.length;
  texts.forEach((text, i) => entries.push([`0_${start + i}`, text, 0]));
  narc.files[bank] = encodeGen5TextBank(entries);
  return texts.map((_, i) => `0_${start + i}`);
}
function replace(narc: NARC, bank: number, id: string, text: string) {
  const entries = decodeGen5TextBank(narc.files[bank]);
  const entry = entries.find(entry => entry[0] === id);
  assert(entry, `${bank}:${id} exists`);
  entry[1] = text;
  narc.files[bank] = encodeGen5TextBank(entries);
}
function entryText(narc: NARC, bank: number, id: string) {
  const entry = decodeGen5TextBank(narc.files[bank]).find(entry => entry[0] === id);
  assert(entry, `${bank}:${id} exists`);
  return entry[1];
}
const prose = (text: string) => text.replace(/\\[nrf]|\r\n?|\n/g, ' ').replace(/\s+/g, ' ').trim();
const playerToken = 'VAR(259, 0)';
// Independent width oracle: sum native advances on already delimited rows.
// This does not implement greedy wrapping or call the formatter's width helper.
// The literal 91 is the seven-character player-name bound (7 * 13), not seven Ws.
function measuredRows(text: string) {
  return text.split(/\\[rf](?:\\n)?|\\n|\r\n?|\n/).map(row => {
    const parts = row.split(playerToken);
    assert(parts.every(part => !part.includes('VAR(') && !part.includes('\\')), 'Unexpected control in measured fixture');
    return parts.reduce((width, part) => width + plainWidth(part), 91 * (parts.length - 1));
  });
}
function assertFits(text: string, label: string) {
  assert(measuredRows(text).every(width => width <= 232), `${label}: native row exceeds 232px`);
  const layout = layoutBw2Dialogue(text, font, AUTHORED_DIALOGUE_VARIABLES);
  assert.deepEqual(layout.warnings, [], label);
  assert(layout.pages.every(page => page.glyphs.every(glyph => glyph.y === 0 || glyph.y === 16)), `${label}: third row is offscreen`);
  assert.equal(formatAuthoredDialogue(text, font), text, `${label}: formatting is idempotent`);
}
function guard(rom: NintendoDSRom, name: Archive, approvals: TextApproval[]) {
  return compareTextArchives(beforeText.get(name)!, rom.getFileByName(paths[name]), approvals.filter(a => a.archive === name));
}
// Same acceptance condition as applyExpansion's final preservation gate. This
// exercises formatter + guard composition, without claiming a full build test.
function assertGuardPasses(rom: NintendoDSRom, approvals: TextApproval[]) {
  for (const name of Object.keys(paths) as Archive[]) {
    const result = guard(rom, name, approvals);
    assert.deepEqual(result.differences, [], `${name}: original text changed`);
    assert.deepEqual(result.unusedApprovals, [], `${name}: stale approval`);
  }
}

assert.equal(font.maxAdvance, 13);
assert.equal(plainWidth('W'), 6);
assert.equal(plainWidth('i'), 3);
assert.deepEqual(AUTHORED_DIALOGUE_VARIABLES, { 0: { length: 7, label: 'English player name' } });
const boundary = `${'W'.repeat(19)} ${'W'.repeat(19)}`;
assert.equal(plainWidth(boundary), 232);
assert.equal(formatAuthoredDialogue(boundary, font), boundary, 'Exactly 232px fits');
assert.equal(formatAuthoredDialogue(`${boundary} i`, font), `${boundary}\\ni`, '239px must wrap');
assert.equal(formatAuthoredDialogue('i'.repeat(60), font), 'i'.repeat(60), 'Character count alone is not a width limit');
assert.throws(() => formatAuthoredDialogue('W'.repeat(39), font), /word exceeds the native width/);
const fittingControls = 'A short first row.\\nA short second row.\\f\\nA scrolling row.\\r\\nA new page.';
assert.equal(formatAuthoredDialogue(fittingControls, font), fittingControls, 'Valid authored controls remain exact');
const hazel = campaignTexts[1];
assert.equal(hazel, 'Hazel: We keep these roads open together. Let us see what you and your partners have learned!');
assert.equal(plainWidth(hazel), 519);
assert.equal(formatAuthoredDialogue(hazel, font), 'Hazel: We keep these roads open together.\\nLet us see what you and your partners\\r\\nhave learned!');
assert(formatAuthoredDialogue(`${hazel}\\r\\nSTOP.`, font).endsWith('\\r\\nSTOP.'), 'Explicit paragraph boundary survives reflow');
const nameStress = `${'W'.repeat(24)} ${playerToken}.`;
assert.equal(measuredRows(nameStress)[0], 244);
const nameFormatted = formatAuthoredDialogue(nameStress, font);
assert.equal(nameFormatted, `${'W'.repeat(24)}\\n${playerToken}.`, 'Reserve the whole 91px name, keeping its punctuation attached');
const nameRoundtrip = decodeGen5TextBank(encodeGen5TextBank([['0_0', nameFormatted, 0]]))[0][1];
assert.equal(nameRoundtrip, nameFormatted);
assert.deepEqual(nameRoundtrip.match(/VAR\([^)]*\)/g), [playerToken]);
const nameLayout = layoutBw2Dialogue(nameRoundtrip, font, AUTHORED_DIALOGUE_VARIABLES);
assert.deepEqual(nameLayout.variables, [{ slot: 0, length: 7, label: 'English player name' }]);
assert.equal(nameLayout.pages[0].glyphs.filter(glyph => glyph.placeholder).length, 7);
assert.deepEqual(nameLayout.pages[0].widths, [144, 96]);
assertFits(nameRoundtrip, 'Player name roundtrip');
assert.throws(() => formatAuthoredDialogue('Hello VAR(259, 1).', font), /Unbounded authored dialogue variable 1/);
assert.throws(() => formatAuthoredDialogue('Hello VAR(768).', font), /Unsupported authored dialogue/);

const content = JSON.parse(readFileSync(new URL('../content/castelia-arc.json', import.meta.url), 'utf8')) as {
  championTextChanges: (TextApproval & { after: string })[];
  stages: { textBankId: number; pages: string[]; repeatText: string; blockedText: string }[];
};
const rom = forkROM();
// Use the real allocator's battle additions, but none of its trainer-file edits.
rom.files[rom.fileId(paths.messages)] = new Uint8Array(campaignROM.getFileByName(paths.messages));
const story = archive(rom, 'story'), messages = archive(rom, 'messages');
const appendedBank = story.files.length;
append(story, appendedBank, [...campaignTexts, nameStress]);
const stage = content.stages[0];
const stageTexts = [...stage.pages, stage.repeatText, stage.blockedText];
const stageIds = append(story, stage.textBankId, stageTexts);
const approvals: TextApproval[] = content.championTextChanges.map(({ after, ...approval }) => {
  assert.equal(approval.archive, 'story');
  assert.equal(sha(entryText(original.story, approval.bank, approval.entry)), approval.before_sha256);
  assert.equal(sha(after), approval.after_sha256);
  replace(story, approval.bank, approval.entry, after);
  return approval;
});
assert.equal(approvals.length, 15);
const excludedBank = messages.files.length;
append(messages, excludedBank, [hazel]);
install(rom, 'story', story);
install(rom, 'messages', messages);
const inputFiles = [...rom.files];
const inputArchives = { story: archive(rom, 'story'), messages: archive(rom, 'messages') };
const approvalsSnapshot = structuredClone(approvals);
assert.equal(campaignTexts.length, 128);
const overflowBefore = campaignTexts.filter(text => plainWidth(text) > 232).length;
assert.equal(overflowBefore, 100, 'Pinned authored campaign baseline must reproduce the original bug');

const report = formatAddedDialogue(rom, beforeText, approvals);
assert.equal(report.nativeLineWidth, 232);
assert.deepEqual(approvals, approvalsSnapshot, 'Caller approvals must not be rewritten in place');
const after = { story: archive(rom, 'story'), messages: archive(rom, 'messages') };
const finalCampaign = decodeGen5TextBank(after.story.files[appendedBank]);
assert.equal(finalCampaign.length, 129);
for (const [i, text] of campaignTexts.entries()) {
  const formatted = finalCampaign[i][1];
  assert.equal(finalCampaign[i][0], `0_${i}`);
  assert.equal(prose(formatted), text, `Campaign prose ${i} is unchanged`);
  assertFits(formatted, `Campaign ${i}`);
  if (plainWidth(text) <= 232) assert.equal(formatted, text, 'Fitting original authored text is exact');
}
const overflowAfter = finalCampaign.slice(0, 128).filter(entry => measuredRows(entry[1]).some(width => width > 232)).length;
assert.equal(overflowAfter, 0);
assert.equal(report.changes.filter(change => change.archive === 'story' && change.bank === appendedBank).length, 101);
assert.equal(finalCampaign[128][1], nameFormatted);
for (const [i, id] of stageIds.entries()) {
  const formatted = entryText(after.story, stage.textBankId, id);
  assert.equal(prose(formatted), prose(stageTexts[i]));
  assertFits(formatted, `Existing story bank ${stage.textBankId}:${id}`);
}
const originalBattleCount = decodeGen5TextBank(original.messages.files[381]).length;
const battleAdditions = decodeGen5TextBank(after.messages.files[381]).slice(originalBattleCount);
const unformattedBattle = decodeGen5TextBank(inputArchives.messages.files[381]).slice(originalBattleCount);
assert.equal(battleAdditions.length, 56);
assert(unformattedBattle.some(entry => measuredRows(entry[1]).some(width => width > 232)), 'Real battle additions exercise reflow');
battleAdditions.forEach((entry, i) => {
  assert.equal(prose(entry[1]), prose(unformattedBattle[i][1]));
  assertFits(entry[1], `Battle ${entry[0]}`);
});
assert.deepEqual(after.messages.files[excludedBank], inputArchives.messages.files[excludedBank], 'Non-dialogue message banks are outside formatter scope');
assert.equal(entryText(after.messages, excludedBank, '0_0'), hazel);

// Check originals independently of the preservation guard and its report count.
// Entry IDs retain compressed/format flags; exact decoded strings retain every
// space and control. Encryption seeds are deliberately not compared.
for (const name of Object.keys(paths) as Archive[]) {
  const allowed = new Set(approvals.filter(a => a.archive === name).map(a => `${a.bank}:${a.entry}`));
  original[name].files.forEach((bytes, bank) => {
    const actual = new Map(decodeGen5TextBank(after[name].files[bank]).map(entry => [entry[0], entry[1]]));
    for (const [id, text] of decodeGen5TextBank(bytes)) {
      assert(actual.has(id), `${name}:${bank}:${id} retained including flags`);
      if (!allowed.has(`${bank}:${id}`)) assert.equal(actual.get(id), text, `${name}:${bank}:${id} preserved exactly`);
    }
  });
  const touched = new Set(report.changes.filter(change => change.archive === name).map(change => change.bank));
  inputArchives[name].files.forEach((bytes, bank) => {
    if (!touched.has(bank)) assert.deepEqual(after[name].files[bank], bytes, `Untouched ${name} bank ${bank}`);
  });
}
let updatedApprovals = 0;
for (const [i, approval] of report.approvedDialogueChanges.entries()) {
  const text = entryText(after[approval.archive], approval.bank, approval.entry);
  assert.deepEqual(approval, { ...approvals[i], after_sha256: sha(text) }, 'Only the exact replacement hash may change');
  assert.equal(prose(text), prose(content.championTextChanges[i].after));
  assertFits(text, `Approved ${approval.bank}:${approval.entry}`);
  if (approval.after_sha256 !== approvals[i].after_sha256) updatedApprovals++;
}
assert.equal(updatedApprovals, 0, 'The 15 currently approved story rewrites already fit and stay exact');
assert.deepEqual(report.approvedDialogueChanges, approvals);
for (const id of ['0_2', '0_3']) {
  assert.equal(entryText(after.story, 164, id), `Come, ${playerToken}.\\nYour partners are waiting.\\r`, 'Fitting approved player-name dialogue stays exact');
}
assertGuardPasses(rom, report.approvedDialogueChanges);
assert.equal(guard(rom, 'story', report.approvedDialogueChanges).approvedDifferences.length, 15);
const ownedFiles = new Set(Object.values(paths).map(path => rom.fileId(path)));
assert.deepEqual(new Set(report.changedFiles.map(file => file.fileId)), ownedFiles);
rom.files.forEach((bytes, id) => {
  if (ownedFiles.has(id)) assert.notEqual(bytes.buffer, sourceBuffer.buffer);
  else assert.equal(bytes, inputFiles[id], `Unowned NitroFS file ${id}`);
});
const stableFiles = [...rom.files];
const second = formatAddedDialogue(rom, beforeText, report.approvedDialogueChanges);
assert.deepEqual(second.changes, []);
assert.deepEqual(second.changedFiles, []);
assert.deepEqual(second.approvedDialogueChanges, report.approvedDialogueChanges);
rom.files.forEach((bytes, id) => assert.equal(bytes, stableFiles[id], `Second pass file ${id}`));

// The actual approved Champion lines already fit. Use those same words in one
// long paragraph and explicitly approve that fixture to exercise hash renewal.
// This is a test approval, not an alteration of the production content policy.
const nativeRewrite = content.championTextChanges.find(change => change.bank === 163 && change.entry === '0_2')!;
assert(nativeRewrite);
const rewrite = { ...nativeRewrite, after: prose(nativeRewrite.after), after_sha256: sha(prose(nativeRewrite.after)),
  reason: `${nativeRewrite.reason} (in-memory single-paragraph regression fixture)` };
assert.notEqual(formatAuthoredDialogue(rewrite.after, font), rewrite.after);
const { after: rewriteText, ...exactApproval } = rewrite;
const approvedROM = forkROM(), approvedStory = archive(approvedROM, 'story');
replace(approvedStory, rewrite.bank, rewrite.entry, rewriteText);
install(approvedROM, 'story', approvedStory);
const exactInputs = [structuredClone(exactApproval)];
const approvedResult = formatAddedDialogue(approvedROM, beforeText, exactInputs);
const approvedText = entryText(archive(approvedROM, 'story'), rewrite.bank, rewrite.entry);
assert.equal(prose(approvedText), rewriteText);
assertFits(approvedText, 'Reflowed exact-approval fixture');
assert.deepEqual(exactInputs, [exactApproval], 'A matched caller approval is not mutated');
assert.deepEqual(approvedResult.approvedDialogueChanges, [{ ...exactApproval, after_sha256: sha(approvedText) }]);
assert.notEqual(sha(approvedText), exactApproval.after_sha256);
assert.equal(approvedResult.changes.length, 1);
assert.equal(approvedResult.changes[0].approvedRewrite, true);
assertGuardPasses(approvedROM, approvedResult.approvedDialogueChanges);
assert.throws(() => assertGuardPasses(approvedROM, [exactApproval]), /original text changed/, 'Pre-format hashes cannot approve formatted replacements');
// Stale before and after hashes are separate failure modes. Neither authorizes
// reflow of an existing entry, even if the replacement is otherwise formatable.
for (const field of ['before_sha256', 'after_sha256'] as const) {
  const rejected = forkROM(), narc = archive(rejected, 'story');
  replace(narc, rewrite.bank, rewrite.entry, rewriteText);
  install(rejected, 'story', narc);
  const stale = [{ ...exactApproval, [field]: sha(`stale ${field}`) }];
  const snapshot = structuredClone(stale), refs = [...rejected.files];
  const result = formatAddedDialogue(rejected, beforeText, stale);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.approvedDialogueChanges, snapshot);
  assert.deepEqual(stale, snapshot);
  rejected.files.forEach((bytes, id) => assert.equal(bytes, refs[id]));
  assert.equal(entryText(archive(rejected, 'story'), rewrite.bank, rewrite.entry), rewriteText);
  const checked = guard(rejected, 'story', result.approvedDialogueChanges);
  assert.deepEqual(checked.differences, [{ bank: rewrite.bank, entry: rewrite.entry, reason: 'original text changed' }]);
  assert.deepEqual(checked.unusedApprovals, [`${rewrite.bank}:${rewrite.entry}`]);
  assert.deepEqual(checked.approvedDifferences, []);
  assert.throws(() => assertGuardPasses(rejected, result.approvedDialogueChanges), /original text changed/);
}
// An approval left over after reverting its rewrite must also fail the build
// predicate, even though there are no changed original strings to report.
const reverted = forkROM();
const revertedReport = formatAddedDialogue(reverted, beforeText, [exactApproval]);
assert.deepEqual(guard(reverted, 'story', revertedReport.approvedDialogueChanges).differences, []);
assert.deepEqual(guard(reverted, 'story', revertedReport.approvedDialogueChanges).unusedApprovals, ['163:0_2']);
assert.throws(() => assertGuardPasses(reverted, revertedReport.approvedDialogueChanges), /stale approval/);

const unrelated = forkROM();
const unrelatedStory = archive(unrelated, 'story'), unrelatedMessages = archive(unrelated, 'messages');
replace(unrelatedStory, rewrite.bank, rewrite.entry, rewriteText);
const storyVictim = decodeGen5TextBank(unrelatedStory.files[stage.textBankId])[0];
const messageVictim = decodeGen5TextBank(unrelatedMessages.files[381])[0];
const unrelatedEdit = `${hazel} An unrelated edit.`;
replace(unrelatedStory, stage.textBankId, storyVictim[0], unrelatedEdit);
replace(unrelatedMessages, 381, messageVictim[0], unrelatedEdit);
install(unrelated, 'story', unrelatedStory);
install(unrelated, 'messages', unrelatedMessages);
const unrelatedReport = formatAddedDialogue(unrelated, beforeText, [exactApproval]);
assert.equal(unrelatedReport.changes.length, 1, 'Only the precisely approved rewrite is formatted');
for (const [name, bank, id] of [['story', stage.textBankId, storyVictim[0]], ['messages', 381, messageVictim[0]]] as const) {
  assert.equal(entryText(archive(unrelated, name), bank, id), unrelatedEdit, 'Unauthorized original edit remains visible to the guard');
  const result = guard(unrelated, name, unrelatedReport.approvedDialogueChanges);
  assert.deepEqual(result.differences, [{ bank, entry: id, reason: 'original text changed' }]);
  assert.deepEqual(result.unusedApprovals, []);
}
assert.throws(() => assertGuardPasses(unrelated, unrelatedReport.approvedDialogueChanges), /original text changed/);

// Story is processed first. A failure later in battle dialogue must not commit
// its staged reflow or mutate the caller's already-matched story approval.
for (const [badText, error] of [
  ['W'.repeat(39), /word exceeds the native width/],
  ['Hello VAR(259, 1).', /Unbounded authored dialogue variable 1/],
  ['Hello VAR(768).', /Unsupported authored dialogue/],
] as const) {
  const rejected = forkROM(), story = archive(rejected, 'story'), messages = archive(rejected, 'messages');
  replace(story, rewrite.bank, rewrite.entry, rewriteText);
  append(story, story.files.length, [hazel]);
  append(messages, 381, [hazel, badText]);
  install(rejected, 'story', story);
  install(rejected, 'messages', messages);
  const refs = [...rejected.files], inputs = [structuredClone(exactApproval)];
  const snapshots = Object.values(paths).map(path => sha(rejected.getFileByName(path)));
  assert.throws(() => formatAddedDialogue(rejected, beforeText, inputs), error);
  rejected.files.forEach((bytes, id) => assert.equal(bytes, refs[id], `Failure must not commit file ${id}`));
  assert.deepEqual(Object.values(paths).map(path => sha(rejected.getFileByName(path))), snapshots);
  assert.deepEqual(inputs, [exactApproval]);
}
for (const [name, bytes] of beforeText) assert.equal(sha(bytes), beforeHashes.get(name), `${name} baseline unchanged`);
baseROM.files.forEach((bytes, id) => assert.equal(bytes, baseFileRefs[id], `Base file ${id} unchanged`));
assert.equal(sha(sourceBuffer), BASE_SHA256, 'Source Buffer unchanged despite fileData:view');
assert.equal(sha(baseROM.data), BASE_SHA256, 'Base ROM data unchanged');
assert.equal(sha(readFileSync(sourcePath)), BASE_SHA256, 'On-disk ROM unchanged');
console.log(`Dialogue layout: PASS; native campaign overflow ${overflowBefore}/128 -> ${overflowAfter}/128; 56 battle additions, 15 exact story approvals, seven-character player token, original preservation, stale/unrelated rejection, and atomic failures. In-memory only; no ROM export or emulator claim.`);
