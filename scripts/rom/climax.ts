import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16, writeU32 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptCommandOffsets, gen5ScriptEntries } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { decodeGen5TextBank, encodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { appendStoryEntry } from './story';
import { TRAINER_BASE_SHA256, TRAINER_PATHS } from './trainers';
import type { WorldReport } from './world';
import type { applySpecies, SpeciesStaticBinding } from './species';

export const CLIMAX_PATHS = { scripts: 'a/0/5/6', parties: TRAINER_PATHS.parties, story: 'a/0/0/3' } as const;
export const CLIMAX_LEVELS = { ghetsis: [68, 68, 68, 68, 68, 70], fusedKyurem: 68 } as const;
/** Only native late-story party members. No rematches, PWT or new slots. */
export const FRIGATE_PARTIES = [
  { id:344, name:'Colress', template:3, before:[50,50,50,50,52], after:[67,67,67,67,69], data:'da035962642050f8fa85b9de2ed04c9de5a6a8b86296816be24c777d60d210a0', party:'c54b13fa4e205e0a9e46aa015276bdc83d57ab21dbe016c1114d21b54f243baa' },
  { id:347, name:'Zinzolin (Route 21 boarding)', template:1, before:[48,48,50], after:[66,66,67], data:'380b8cbe3943b987563b227c747527731874e0faa60342a3fcf58bc9eb0bdee0', party:'f68468d1b77f6af7957285c5848529693811899e813f3d8506bc687f6433a873' },
  { id:497, name:'Zinzolin (later Frigate)', template:1, before:[49,49,51], after:[67,67,68], data:'bf79d9735e5ef96c5f631c2d0d0dd1a7dd8aec16b724c84d91eb43a572f61598', party:'1649e125f9471adf373994054ce4bc278927a36e543ab7f52cd018707596aa72' },
  { id:348, name:'Shadow Triad (opening)', template:1, before:[49,49,51], after:[67,67,68], data:'f041b89222588cc157f2d11df7e6d0e018b6e5935ebfb31591f56dda4958c172', party:'b06bd46888d3cfb2423a05dfb89677072399e565d034bcbe3a884fa62dd13b0d' },
  { id:498, name:'Shadow Triad (Accelgor)', template:1, before:[49,49,51], after:[67,67,68], data:'ded018232769fc3c35b299cd37f293a2cd385f6eca630e7100975580711fcf0c', party:'3fabb4efc9293542bbf501fdcafb41b2aac10523fc96be2e48e62a58a3ec3052' },
  { id:499, name:'Shadow Triad (Banette)', template:1, before:[49,49,51], after:[67,67,68], data:'ded018232769fc3c35b299cd37f293a2cd385f6eca630e7100975580711fcf0c', party:'e1150c02c2907c9daeb9d303d9a78b69a204f9db84b9f8a68fe60f66feea06b0' },
  { id:797, name:'Route 21 Grunt alongside Zinzolin', template:0, before:[45,45,45], after:[64,64,64], data:'0752688738dc8cbc2026f99fe50f462856ed54d6a9f86cb884025583189b094b', party:'161f3fcf5f1ff3351c6da27784fe66af4fa11839ff05c0093b82ef050b516d6a' },
] as const;
export const FRIGATE_DISPATCH = [
  { member:1110, hashes:['f488e6ada74f82c1c8b2b2d6469beb457013572968f721584e8ba09f65874d65','051610a9bbb28068e878be42ebe3f26b8c4fae25241f4c6f2ae6af9917642276'], calls:[{offset:0x1b0,opcode:0x85,operands:[344,0,0]}] },
  { member:1112, hashes:['dd1587094cc890e780880130bc87fd1484ed9ccaecf15751d63b4fe0e142dbc5'], calls:[{offset:0x205,opcode:0x86,operands:[794,797,347,0]},{offset:0x228,opcode:0x86,operands:[795,797,347,0]},{offset:0x238,opcode:0x86,operands:[796,797,347,0]}] },
  { member:1114, hashes:['6d47379994936063c15c312c339ee875fcd9d167c1dac5397831e482c31e613d'], calls:[{offset:0x2f2,opcode:0x85,operands:[348,0,0]},{offset:0x3df,opcode:0x85,operands:[498,0,0]},{offset:0x479,opcode:0x85,operands:[499,0,0]}] },
  { member:1122, hashes:['732f83d2a013ad09daf92bd9e6c73bde041ff963d626c6a23939993dc2a38cc2'], calls:[{offset:0x20e,opcode:0x85,operands:[497,0,0]}] },
  { member:1128, hashes:['4f5a5a4d32ba03eea5cc44ece044a896c9acd65c859d82d7077846d0ad14970b'], calls:[{offset:0x2cd,opcode:0x85,operands:[497,0,0]}] },
] as const;
// Pinned US revision-0 sources, plus the generated Dawn Vault before formatting.
// Full-member signatures and decoded command witnesses are both required.
export const CLIMAX_PINS = {
  scripts: {
    1208: '1ffc013d1895d54ca8bda1052ffe2e433f9586c6736a7c7398ebe4d5211fcc4b',
    426: '823cc9051142a3c8dd8ec0fc0fdfc964e3fa508bcc7fa574fa25d092ec68add7',
    556: '167833179a18c6fa9370c599e95adf1c338068617abf0c6271f669a5f51f021e',
    1521: 'ac572734b84db526292b1a41d09465ed0a897c227b06bf6bc9073b932dc9a339',
  },
  ghetsisData: 'aed0b36d31de07d1d4cd6813ef6f2b37e4ef4726705ea1b56ce2521c8e5dd718',
  ghetsisParty: '89f13c172edc6bf40db972922f88a807669b5f0e01c83d0e87d43c3917b098fd',
  dragonText: 'd00baa93ab9a11e23dde195feb69079bf2aa50a441ae6f6776eeffc78e275d22',
  vaultText: 'e4b13fb65c1ba7f78d3cadc03a230e648b5f8c9b6630302f833c929abc037d5e',
  dragonEvents: '1e2032a48d405c9cdc76ca219de6a6b2c3324ff6c74a5aa4f92724beb0ee627b',
  chasmEvents: '9e6cb1f618762a523d3aa1c09e7292824333c83494afd66d7d24e66908fc1d70',
  vaultEvents: '98b04725af5f2dff5eef7d09df40e88774fba87c8abdb2bc07a08058eec3c8e9',
} as const;
// Original native effects, not a new save allocation. The legacy continuation
// copies only these witnessed scalar effects; helper475's camera/N choreography
// requires a preceding wild battle and cannot safely be invoked from a guard.
export const LEGACY_DRAGON_WITNESSES = [
  { member:426, offset:0x5fc, opcode:0x23, operands:[0x1e0] }, // N's tower chapter complete
  { member:426, offset:0x600, opcode:0x23, operands:[0x390] }, // N leaves until native return
  { member:426, offset:0x604, opcode:0x24, operands:[0x3ec] }, // make native Kyurem visible
  { member:426, offset:0x3bc, opcode:0x23, operands:[0x29b] }, // hide tower dragon
  { member:426, offset:0x11b, opcode:0x28, operands:[0x411b,2] },
  { member:426, offset:0x3b8, opcode:0x6c, operands:[0] },
  { member:1208, offset:0xfce, opcode:0x23, operands:[0xf9] }, // native Kyurem captured
] as const;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`Climax: ${message}`); }
function owned(rom: NintendoDSRom, path: string) { return new NARC(new Uint8Array(rom.getFileByName(path))); }
function pin(bytes: Uint8Array | undefined, hash: string, label: string) {
  check(bytes && sha(bytes) === hash, `unexpected ${label} source`);
}
function decoded(bytes: Uint8Array, overlayId?: number) {
  const d = decompileBw2Script(bytes, overlayId === undefined ? {} : { overlayId });
  check(d.editable && d.roundTripVerified, 'script must roundtrip');
  const c = compileBw2Script(d.source);
  check(sha(c.bytes) === sha(bytes), 'script recompile must be byte exact');
  return c;
}
function witness(c: ReturnType<typeof compileBw2Script>, offset: number, opcode: number, operands: number[]) {
  const instruction = c.instructions.find(i => i.offset === offset);
  check(instruction?.opcode === opcode && JSON.stringify(instruction.operands) === JSON.stringify(operands), `command witness at 0x${offset.toString(16)}`);
}
function appendText(archive: NARC, member: number, value: string) {
  const rows = decodeGen5TextBank(archive.files[member]), id = rows.length;
  rows.push([`0_${id}`, value, 0]);
  archive.files[member] = new Uint8Array(encodeGen5TextBank(rows));
  const round = decodeGen5TextBank(archive.files[member]);
  check(round.length === rows.length && round.every((r, i) => r[0] === rows[i][0] && r[1] === rows[i][1]), 'added text roundtrip');
  return id;
}

/** Run after world/species/story/access and before dialogue formatting.
 * Stages owned archive bytes; failure leaves ROM and supplied reports unchanged.
 * Replaces the duplicate supplemental offer with directions to N's native story.
 * No new saved flags, trainer slots, original dialogue edits, or engine patches.
 * The two supplied reports are reconciled only at the successful commit boundary.
 */
export function applyClimax(rom: NintendoDSRom, world: WorldReport, species: ReturnType<typeof applySpecies>) {
  check(rom.idCode === 'IREO' && rom.data[0x1e] === 0 && sha(rom.data) === TRAINER_BASE_SHA256, 'requires pinned US Black 2 revision-0 build input');
  const scripts = owned(rom, CLIMAX_PATHS.scripts), parties = owned(rom, CLIMAX_PATHS.parties), story = owned(rom, CLIMAX_PATHS.story);
  const data = owned(rom, TRAINER_PATHS.data), events = owned(rom, 'a/1/2/6'), headers = owned(rom, 'a/0/1/2').files[0];
  for (const [id, hash] of Object.entries(CLIMAX_PINS.scripts)) pin(scripts.files[Number(id)], hash, `script ${id}`);
  pin(data.files[345], CLIMAX_PINS.ghetsisData, 'Ghetsis trainer');
  pin(parties.files[345], CLIMAX_PINS.ghetsisParty, 'Ghetsis party');
  pin(story.files[272], CLIMAX_PINS.dragonText, 'Dragonspiral text');
  pin(story.files[792], CLIMAX_PINS.vaultText, 'Dawn Vault text');
  pin(events.files[263], CLIMAX_PINS.dragonEvents, 'Dragonspiral events');
  pin(events.files[285], CLIMAX_PINS.chasmEvents, 'Giant Chasm events');
  pin(events.files[732], CLIMAX_PINS.vaultEvents, 'Dawn Vault events');
  for (const [zone, script, text, event] of [[213, 426, 272, 263], [278, 556, 457, 426], [604, 1208, 294, 285], [732, 1521, 792, 732]]) {
    check(readU16(headers, zone * 48 + 6) === script && readU16(headers, zone * 48 + 10) === text && readU16(headers, zone * 48 + 22) === event, `native header binding ${zone}`);
  }
  check(Array.isArray(world.staticEncounters), 'world static bindings required');
  const bindings = world.staticEncounters as SpeciesStaticBinding[];
  const supplemental = bindings.filter(b => b.species === 644);
  const matches = (b: { species: number; headerId: number; scriptId: number; entry: number; level: number }) =>
    b.species === 644 && b.headerId === 732 && b.scriptId === 1521 && b.entry === 5 && b.level === 65;
  check(supplemental.length === 1 && matches(supplemental[0]), 'expected one Dawn Vault Zekrom binding');
  const counts = world.counts as Record<string, number>;
  check(counts?.staticEncounters === bindings.length, 'world count mismatch');
  const row = species.acquisition.find(r => r.species === 644);
  check(row?.sources.length === 1 && row.sources[0].kind === 'static' && matches(row.sources[0]) && row.offlineSourceBound, 'species acquisition report is stale');
  const verified = species.staticEncounters.verified.filter(s => s.species === 644);
  check(verified.length === 1 && matches(verified[0]), 'species static report is stale');

  for (const dispatch of FRIGATE_DISPATCH) {
    check((dispatch.hashes as readonly string[]).includes(sha(scripts.files[dispatch.member])), `unexpected Frigate script ${dispatch.member} source`);
    const c = decoded(scripts.files[dispatch.member], [1122, 1128].includes(dispatch.member) ? 64 : undefined);
    for (const call of dispatch.calls) witness(c, call.offset, call.opcode, [...call.operands]);
    check(!c.instructions.some(i => i.opcode === 0x2af), 'unexpected Frigate difficulty dispatch');
  }
  const frigate = FRIGATE_PARTIES.map(p => {
    pin(data.files[p.id], p.data, `Frigate trainer ${p.id}`);
    pin(parties.files[p.id], p.party, `Frigate party ${p.id}`);
    const stride = p.template === 3 ? 18 : p.template === 1 ? 16 : 8;
    check(data.files[p.id][0] === p.template && data.files[p.id][3] === p.before.length && parties.files[p.id].length === stride * p.before.length, `Frigate party layout ${p.id}`);
    for (const [slot, level] of p.after.entries()) {
      check(readU16(parties.files[p.id], slot * stride + 2) === p.before[slot], `Frigate level witness ${p.id}:${slot}`);
      writeU16(parties.files[p.id], slot * stride + 2, level);
    }
    return { trainerId:p.id, name:p.name, beforeLevels:p.before, afterLevels:p.after, stride, partyBeforeSha256:p.party, partyAfterSha256:sha(parties.files[p.id]) };
  });
  const chasm = decoded(scripts.files[1208], 66), tower = decoded(scripts.files[426], 66), castle = decoded(scripts.files[556]);
  for (const w of LEGACY_DRAGON_WITNESSES) witness(w.member === 426 ? tower : chasm, w.offset, w.opcode, [...w.operands]);
  witness(chasm, 0x8d4, 0x85, [345, 0, 0]);
  witness(chasm, 0xd95, 0x297, [646, 55, 2, 0x8024]);
  witness(chasm, 0xdc0, 0x297, [646, 55, 1, 0x8024]);
  witness(chasm, 0xc0d, 0x28, [0x4072, 4]);
  witness(tower, 0x37a, 0x174, [644, 70, 0x8024]);
  witness(tower, 0xe5, 0xb6, [617, 1, 0x8010]);
  witness(castle, 0x7c1, 0x2a, [0x8000, 617]);
  witness(castle, 0x825, 0x28, [0x411b, 1]);
  // A single native battle call handles initial and retry battles; no script
  // difficulty split. Native 020308C0 loads member345 before 02168730 calls
  // 020185D0 to adjust levels for Easy/Challenge; there is no alternate party.
  check(chasm.instructions.filter(i => i.opcode === 0x85).length === 1 && !chasm.instructions.some(i => i.opcode === 0x2af), 'unexpected Ghetsis dispatch');
  check(data.files[345][0] === 3 && data.files[345][3] === 6 && parties.files[345].length === 108, 'Ghetsis party layout');
  for (const [slot, level] of CLIMAX_LEVELS.ghetsis.entries()) writeU16(parties.files[345], slot * 18 + 2, level);
  for (const at of [0xd95, 0xdc0]) writeU16(scripts.files[1208], at + 4, CLIMAX_LEVELS.fusedKyurem);
  decoded(scripts.files[1208], 66);

  // Keep all native Castle scenes, the Dark Stone gift, and the original tower
  // body. Legacy supplemental captures must still finish N's native chapter:
  // otherwise 1E0 remains clear and both Kyurem and DNA Splicers stay locked.
  // Only a completed Ghetsis plot and exact native stone-handoff stages qualify.
  // Already completed chapters never touch Kyurem visibility again. The F9
  // safeguard also preserves native captures in inconsistent/imported saves.
  const caughtMessage = appendText(story, 272, 'Zekrom has already joined you.\\nIts story is yours to continue.');
  const completionMessage = appendText(story, 272, "Your bond with Zekrom fulfills\\nN's wish. This chapter is complete.\\rReturn to the Giant Chasm.\\nYour journey there can continue.");
  const guards = [];
  for (const entry of [2, 3]) {
    const guardBody = [
      'poke_dex_is_regist 1, 644, 0x8000', 'work_cmp_const 0x8000, 0',
      'jump_if 0x01, :native_original', 'lock',
      'if (flag_set?(0x01e0) == 1)', '  jump :already_caught', 'end',
      'work_cmp_const 0x4072, 4', 'jump_if 0x05, :already_caught',
      'work_cmp_const 0x411b, 1', 'jump_if 0x01, :complete_legacy_chapter',
      'work_cmp_const 0x411b, 2', 'jump_if 0x05, :already_caught',
      'label :complete_legacy_chapter',
      // Entry2 is a floor trigger: its actor need not have been spawned. Entry3
      // is the dragon interaction; only delete a currently unhidden actor there.
      ...(entry === 3 ? ['if (flag_set?(0x029b) == 0)', '  actor_delete 0', 'end'] : []),
      'set_flag 0x029b', 'work_set_const 0x411b, 2', 'set_flag 0x01e0', 'set_flag 0x0390',
      'if (flag_set?(0x00f9) == 0)', '  clear_flag 0x03ec', 'end',
      `msg_system ${completionMessage}, 2`, 'wait_last', 'msg_system_close', 'finish_interaction',
      'label :already_caught', `msg_system ${caughtMessage}, 2`, 'wait_last', 'msg_system_close', 'finish_interaction',
    ].join('\n');
    const added = appendStoryEntry(scripts.files[426], guardBody, { originalEntry: entry, redirectEntry: true, overlayId: 66 });
    scripts.files[426] = added.bytes;
    // A second table entry shifts the first wrapper and native payload by four.
    for (const previous of guards) { previous.appendedOffset += 4; previous.nativeOffset! += 4; }
    guards.push({ entry, appendedOffset: added.appendedOffset, nativeOffset: added.nativeOffset });
  }
  const guideMessage = appendText(story, 792, 'Naturalist: Zekrom travels with N.\\nAfter the Giant Chasm crisis,\\rhelp the Dawnbridge keepers reopen\\nthe roads. Find N at his castle\\rbeyond Victory Road. Take his\\nDark Stone to Dragonspiral Tower.\\rThere is no need to catch Zekrom\\nbefore you challenge the League.');
  const guideCaughtMessage = 11; // Existing pinned Dawn Vault caught response.
  check(decodeGen5TextBank(story.files[792])[guideCaughtMessage][1].replace(/\\[nrf]/g, ' ').replace(/\s+/g, ' ').trim() === 'You have already registered a capture of this species. The refuge remains open.', 'existing caught response');
  const guide = appendStoryEntry(scripts.files[1521], [
    'lock', 'poke_dex_is_regist 1, 644, 0x8000', 'work_cmp_const 0x8000, 1',
    'jump_if 0x01, :guide_caught', `talk message: ${guideMessage}`, 'finish_interaction',
    'label :guide_caught', `talk message: ${guideCaughtMessage}`, 'finish_interaction',
  ].join('\n'));
  writeU32(guide.bytes, (5 - 1) * 4, guide.appendedOffset - 5 * 4);
  scripts.files[1521] = guide.bytes;
  decoded(scripts.files[1521]);
  const reachable = gen5ScriptCommandOffsets(scripts.files[1521], 'BW2');
  check(!reachable.some(at => readU16(scripts.files[1521], at) === 0x174 && readU16(scripts.files[1521], at + 2) === 644), 'retired supplemental battle remains reachable');
  check(gen5ScriptEntries(scripts.files[426])[1] === guards[0].appendedOffset && gen5ScriptEntries(scripts.files[426])[2] === guards[1].appendedOffset, 'tower guard entry binding');

  const nativeSource = {
    kind: 'static' as const, species: 644, headerId: 213, scriptId: 426, entry: 3, level: 70, flagId: null,
    captureState: { type: 'native-pokedex-caught', opcode: 0xdf, mode: 1, species: 644, destinationWork: 0x8000, predicate: 'captured bit clear for a battle; prior captures can finish the native chapter once after Ghetsis and the Castle stone handoff', retries: 'Uncaught native Dragonspiral result, disappearance and respawn rules preserved; legacy completion gives no second capture and retains any held Dark Stone' },
    entrance: { type: 'native-story', castleHeaderId: 278, castleScriptId: 556, stoneItem: 617, releaseEntry: 2, dragonProgressWork: 0x411b, accessFlag: 0xA41, requiresNativeGhetsisCompletion: { work: 0x4072, value: 4 }, preChampionCertified: false },
  };
  const changedFiles = (Object.entries(CLIMAX_PATHS) as [keyof typeof CLIMAX_PATHS, string][]).map(([key, path]) => {
    const archive = { scripts, parties, story }[key], bytes = new Uint8Array(archive.save()), fileId = rom.fileId(path);
    new NARC(bytes);
    return { path, fileId, beforeSha256: sha(rom.files[fileId]), afterSha256: sha(bytes), bytes: bytes.length, owned: bytes };
  });
  // No throwing validation remains beyond this commit boundary.
  for (const file of changedFiles) rom.files[file.fileId] = file.owned;
  world.staticEncounters = bindings.filter(b => b.species !== 644);
  world.counts = { ...counts, staticEncounters: bindings.length - 1 };
  species.staticEncounters.verified = species.staticEncounters.verified.map(s => s.species === 644 ? nativeSource : s);
  row.sources = [nativeSource];
  row.plannedSecretOnly = false;
  return {
    module: 'climax', changedFiles: changedFiles.map(({ owned: _, ...f }) => f), approvedDialogueChanges: [],
    ghetsis: { scriptId: 1208, battleOffset: 0x8d4, trainerId: 345, beforeLevels: [50, 50, 50, 50, 50, 52], afterLevels: CLIMAX_LEVELS.ghetsis, initialAndRetrySameTrainer: true, nativeDifficultyAdjustmentPreserved: true, identityItemsMovesAndAIUnchanged: true },
    frigate: { parties:frigate, dispatch:FRIGATE_DISPATCH, scriptsUnchanged:true, nativeDifficultyAdjustmentPreserved:true, deferredCompanionIds:[794,795,796], companionReason:'Hugh partners are also shared by scripts1106/1126; all their placements require a separate companion audit before global level edits.' },
    fusedKyurem: { scriptId: 1208, patches: [0xd95, 0xdc0].map((offset, i) => ({ offset, form: i === 0 ? 2 : 1, fromLevel: 55, toLevel: CLIMAX_LEVELS.fusedKyurem })), nativeCaptureAndBattleFlagsPreserved: true },
    zekrom: { retiredSource: { headerId: 732, scriptId: 1521, entry: 5, level: 65 }, guide: { headerId: 732, scriptId: 1521, entry: 5, appendedEntry: guide.entry, appendedOffset: guide.appendedOffset, textBankId: 792, messageId: guideMessage, caughtMessageId:guideCaughtMessage }, nativeSource, guards, caughtMessageId: caughtMessage, completionMessageId:completionMessage, legacyContinuation:{ requires:{caughtSpecies:644,chapterFlagClear:0x1e0,nativeGhetsisWork:0x4072,nativeGhetsisValue:4,stoneHandoffWork:0x411b,stoneHandoffStages:[1,2]}, setsFlags:[0x29b,0x1e0,0x390], setsWork:{id:0x411b,value:2}, clearsKyuremHideFlag:0x3ec, unlessNativeKyuremCaughtFlag:0xf9, deletesVisibleActorOnlyAtEntry:3, preservesHeldDarkStone:true, repeatsWriteNoState:true, witnesses:LEGACY_DRAGON_WITNESSES }, nativeCastleScriptUnchanged: true, nativeStoneGiftAndUncaughtBattleFlowPreserved: true, speciesReportReconciled: true },
    allocatedTrainerCount: 0, newSavedFlags: [], originalDialogueEntriesChanged: 0,
    limitations: [
      'Stored base levels only; native Easy/Challenge adjustments remain. No emulator, full-campaign, XP-balance or physical-hardware validation.',
      'Native Zekrom depends on Ghetsis and the A41 road migration; it is optional and never a Ghetsis, crisis or League prerequisite. Actual pre-Champion traversal is not certified here.',
      'A prior Zekrom capture completes the native tower chapter once only after Ghetsis4072=4 and Castle handoff411B=1 or2. Existing1E0 or native Kyurem-captureF9 prevents reopening a caught Kyurem; held Dark Stone and unrelated progress are retained. No physical traversal or legacy-save emulator proof is claimed.',
      'Native ending respawn may redisplay Zekrom when an older supplemental catch lacks native capture markerEA. The caught guard still prevents a second battle; EA is not synthesized.',
      'Original Dragonspiral faint/flee/respawn rules are preserved; this module does not claim immediate same-session retry.',
    ],
  };
}
