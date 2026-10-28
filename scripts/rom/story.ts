import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32, writeU16, writeU32 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptEntries } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { decodeGen5TextBank, encodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { CHAMPION_STORY_BINDINGS, GYM_BINDINGS } from './trainers';
import { rebaseCampaignBody } from './campaign';

export const STORY_PATHS = { scripts: 'a/0/5/6', events: 'a/1/2/6', story: 'a/0/0/3' } as const;
export const CasteliaSewerClueFlag = 0xA39;
export const CASTELIA_SEWER_CLUE_FLAG = CasteliaSewerClueFlag;
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(`Story: ${reason}`); }
export type ProgressionStep = { order: number; kind: 'original' | 'additional'; id: string; leader: string; aceLevel: number; badgeIndex?: number; flagId?: number; requiredBadges: number; requiredFlags: number[] };
export type StoryMentor = { id: string; semanticKey: string; townId: string; settlementId: string; name: 'N' | 'Alder'; spriteId: number; trainerId: number; body: string; texts: string[]; requiredBadges: number; requiredFlags: number[]; repeatable: true; optional: true };
export type StoryCampaign = { progression20: ProgressionStep[]; mentors?: StoryMentor[] };
export type StoryNpcSpot = { townId?: string; settlementId?: string; semanticKey?: string; name?: string; role?: string; npcIndex: number; actorId?: number; scriptId: number; eventId: number; textBankId: number; zone?: number; headerId?: number };
type WorldStoryReport = { storyNpcSpots?: StoryNpcSpot[]; campaign?: StoryCampaign; [key: string]: unknown };
type TrainerStoryReport = { profile?: string; gyms?: { trainerId: number; levels: number[] }[]; [key: string]: unknown };
export const ORIGINAL_GYM_SCRIPT_BINDINGS = [
  { name: 'Elesa', trainerId: 153, zone: 63, scriptId: 126, textBankId: 73, entry: 1, sha256: 'a5a60d2d0dfbb9ea090f5a93669c49f4474dd283ab89d568537e1b48603df413' },
  { name: 'Clay', trainerId: 158, zone: 97, scriptId: 194, textBankId: 108, entry: 1, sha256: 'b88df17497736706ef306309bb2768d95d7d2881eb97d724396dfd302283f8b2' },
  { name: 'Skyla', trainerId: 155, zone: 108, scriptId: 216, textBankId: 127, entry: 1, sha256: '694b111f35fb3e09d77611236c2c839271d54b579d5c56163392c0e1a8b7d170' },
  { name: 'Drayden', trainerId: 159, zone: 121, scriptId: 242, textBankId: 140, entry: 12, sha256: '69c32118044171dc20d140843d62f6a9492a0ec514a76c8f8511a9f8cc01353e' },
  { name: 'Marlon', trainerId: 160, zone: 473, scriptId: 946, textBankId: 190, entry: 1, sha256: '27bd84c543b056861f8c520030b613502ddb6cf6890b1af2c98888c73d3f8e4c' },
  { name: 'Burgh', trainerId: 154, zone: 488, scriptId: 976, textBankId: 36, entry: 3, sha256: 'aa826a36b725c45bfd80a5f0aea5820ca8e3925c2c173e57c5c720dc55e921f7' },
  { name: 'Roxie', trainerId: 157, zone: 502, scriptId: 1004, textBankId: 182, entry: 3, sha256: 'd6f69cb81976fb9c4023e423fe2aaab79a03ede7784e2b297b62cc3bd0edd850' },
] as const;

type AppendOptions = { originalEntry?: number; redirectEntry?: boolean; overlayId?: number };
/** Add one public entry without recompiling or moving anything within the native
 * payload. Relative branches, movement references and raw data all shift by 4.
 * The optional tail jump resumes the unmodified native entry body. */
export function appendStoryEntry(original: Uint8Array, body: string, options: AppendOptions = {}) {
  const entries = gen5ScriptEntries(original);
  check(entries.length > 0, 'not an executable field script');
  const oldTableEnd = entries.length * 4 + 2;
  const source = `preserve_layout\ncondition_encoding :stack\nscript :story_wrapper, entry: 1 do\n${body}\nend\n` +
    (options.originalEntry ? 'block :native_original do\n  halt\nend\n' : '');
  const compiled = compileBw2Script(source);
  check(compiled.entries.length === 1, 'wrapper must have exactly one entry');
  const start = compiled.entries[0].offset;
  const end = options.originalEntry ? compiled.codeBlocks!.find(b => b.name === 'native_original')!.offset : compiled.bytes.length;
  const appendedOffset = original.length + 4 + (original.length % 2);
  const bytes = new Uint8Array(appendedOffset + end - start);
  for (let i = 0; i < entries.length; i++) writeU32(bytes, i * 4, entries[i] + 4 - (i * 4 + 4));
  writeU32(bytes, entries.length * 4, appendedOffset - (entries.length * 4 + 4));
  writeU16(bytes, entries.length * 4 + 4, 0xFD13);
  bytes.set(original.subarray(oldTableEnd), oldTableEnd + 4);
  bytes.set(compiled.bytes.subarray(start, end), appendedOffset);
  let nativeOffset: number | undefined;
  if (options.originalEntry) {
    check(options.originalEntry >= 1 && options.originalEntry <= entries.length, 'invalid native continuation entry');
    nativeOffset = entries[options.originalEntry - 1] + 4;
    const tails = compiled.relocations.filter(r => r.target === 'native_original');
    check(tails.length > 0, 'wrapper does not resume native entry');
    for (const tail of tails) {
      const at = appendedOffset + tail.operandOffset - start;
      writeU32(bytes, at, (nativeOffset - (at + 4)) >>> 0);
    }
    if (options.redirectEntry) writeU32(bytes, (options.originalEntry - 1) * 4, appendedOffset - options.originalEntry * 4);
  }
  const round = decompileBw2Script(bytes, options.overlayId === undefined ? {} : { overlayId: options.overlayId });
  check(round.editable && round.roundTripVerified, `appended script did not roundtrip: ${round.warnings.join('; ')}`);
  return { bytes, entry: entries.length + 1, appendedOffset, nativeOffset, originalTableEnd: oldTableEnd, originalLength: original.length, source, roundTripVerified: true };
}

/** Only generated talk operands are relocated; numbers in battle/flag commands
 * and prose are untouched. The campaign helper has the same contract. */
export function rebaseStoryMentorBody(body: string, textBase: number, textCount: number) {
  check(Number.isInteger(textBase) && textBase >= 0, 'invalid mentor text base');
  let count = 0;
  const rebased = body.replace(/^(\s*talk message:\s*)(\d+)(\s*)$/gm, (_line, prefix, id, suffix) => {
    const relative = Number(id); check(relative < textCount, `mentor message ${relative} exceeds its text list`); count++;
    return `${prefix}${relative + textBase}${suffix}`;
  });
  check(count > 0, 'mentor body contains no generated talk commands');
  const campaignRebased = rebaseCampaignBody(body, textBase);
  check(campaignRebased === rebased, 'unexpected campaign talk formatting');
  return campaignRebased;
}

function npcOffset(event: Uint8Array, index: number) {
  check(index >= 0 && index < event[5], `NPC index ${index} is not allocated`);
  return 8 + event[4] * 20 + index * 36;
}
function appendTexts(story: NARC, bank: number, texts: string[]) {
  const rows = decodeGen5TextBank(story.files[bank]);
  check(rows.every((r, i) => r[0] === `0_${i}`), `bank ${bank} has unsupported multi-section/flagged entries`);
  const base = rows.length;
  texts.forEach((s, i) => rows.push([`0_${base + i}`, s, 0]));
  story.files[bank] = encodeGen5TextBank(rows);
  const round = decodeGen5TextBank(story.files[bank]);
  check(round.length === rows.length && round.every((r, i) => r[0] === rows[i][0] && r[1] === rows[i][1]), `text roundtrip ${bank}`);
  return base;
}
function guardBody(flags: number[], message: number) {
  return '  lock\n' + flags.map(flag => `  if (flag_set?(${flag}) == 0)\n    msg_system ${message}, 0\n    wait_last\n    msg_system_close\n    finish_interaction\n  end\n`).join('') + '  unlock\n  jump :native_original';
}

/** Apply after trainers and world. Pass campaign.progression20 and .mentors as
 * the fourth argument (or worldReport.campaign). No ROM serialization or saving.
 * Native Gym/League gates are installed only with a complete 20-Gym campaign. */
export function applyStory(rom: NintendoDSRom, worldReport?: WorldStoryReport, trainerReport?: TrainerStoryReport, campaignInput?: StoryCampaign) {
  check(rom.idCode === 'IREO' && rom.data[0x1e] === 0, 'requires US Black 2 revision 0');
  const content = JSON.parse(readFileSync(new URL('../../content/castelia-arc.json', import.meta.url), 'utf8'));
  const campaign = campaignInput ?? worldReport?.campaign;
  const archives = Object.fromEntries(Object.entries(STORY_PATHS).map(([k, p]) => [k, new NARC(new Uint8Array(rom.getFileByName(p)))])) as Record<keyof typeof STORY_PATHS, NARC>;
  const { scripts, events, story } = archives;
  const memberChanges: { archive: string; member: number; beforeSha256: string; afterSha256: string }[] = [];
  const memberBefore = new Map<string, string>();
  const touch = (archive: keyof typeof STORY_PATHS, member: number, pinned?: string) => {
    const key = `${archive}:${member}`, actual = sha(archives[archive].files[member]);
    if (pinned) check(actual === pinned, `unexpected native ${key}: ${actual}`);
    if (!memberBefore.has(key)) memberBefore.set(key, actual);
  };
  const stages = content.stages.map((stage: any) => {
    touch('scripts', stage.scriptId, stage.sourceHashes.script);
    touch('events', stage.eventId, stage.sourceHashes.event);
    touch('story', stage.textBankId, stage.sourceHashes.text);
    const at = npcOffset(events.files[stage.eventId], stage.npcIndex);
    check(readU16(events.files[stage.eventId], at) === stage.actorId && readU16(events.files[stage.eventId], at + 2) === stage.spriteId && readU16(events.files[stage.eventId], at + 10) === stage.originalEntry, `native NPC changed: ${stage.title}`);
    const messageBase = appendTexts(story, stage.textBankId, [...stage.pages, stage.repeatText, stage.blockedText]);
    let body = '  lock\n';
    for (const flag of stage.requiredFlags) body += `  if (flag_set?(${flag}) == 0)\n    talk message: ${messageBase + stage.pages.length + 1}\n    unlock\n    jump :native_original\n  end\n`;
    body += `  if (flag_set?(${stage.flagId}) == 0)\n` + stage.pages.map((_: string, i: number) => `    talk message: ${messageBase + i}\n`).join('') + `    set_flag ${stage.flagId}\n  else\n    talk message: ${messageBase + stage.pages.length}\n  end\n  unlock\n  jump :native_original`;
    const added = appendStoryEntry(scripts.files[stage.scriptId], body, { originalEntry: stage.originalEntry, overlayId: stage.overlayId ?? undefined });
    scripts.files[stage.scriptId] = added.bytes;
    writeU16(events.files[stage.eventId], at + 10, added.entry);
    return { id: stage.id, title: stage.title, zone: stage.zone, scriptId: stage.scriptId, eventId: stage.eventId, npcIndex: stage.npcIndex, textBankId: stage.textBankId, flagId: stage.flagId, requiredFlags: stage.requiredFlags, originalEntry: stage.originalEntry, entry: added.entry, appendedOffset: added.appendedOffset, nativeOffset: added.nativeOffset, originalTableEnd: added.originalTableEnd, originalLength: added.originalLength, messageBase, pageCount: stage.pages.length, overlayId: stage.overlayId };
  });
  const approvedDialogueChanges = content.championTextChanges.map((change: any) => {
    touch('story', change.bank);
    const rows = decodeGen5TextBank(story.files[change.bank]);
    const row = rows.find(r => r[0] === change.entry);
    check(row && sha(row[1]) === change.before_sha256 && sha(change.after) === change.after_sha256, `dialogue hash mismatch ${change.bank}:${change.entry}`);
    row[1] = change.after;
    story.files[change.bank] = encodeGen5TextBank(rows);
    check(decodeGen5TextBank(story.files[change.bank]).find(r => r[0] === change.entry)![1] === change.after, 'Champion text roundtrip');
    const { after, ...approval } = change;
    return approval;
  });
  const ow = CHAMPION_STORY_BINDINGS.overworld, hall = CHAMPION_STORY_BINDINGS.hallOfFame;
  touch('events', ow.member, ow.beforeSha256);
  check(readU16(events.files[ow.member], ow.offset) === ow.before, 'Champion NPC sprite');
  writeU16(events.files[ow.member], ow.offset, ow.after);
  touch('scripts', hall.member, hall.beforeSha256);
  check(readU16(scripts.files[hall.member], hall.commandOffset) === hall.opcode && readU16(scripts.files[hall.member], hall.operandOffset) === hall.before, 'Hall of Fame ActorNew sprite');
  writeU16(scripts.files[hall.member], hall.operandOffset, hall.after);
  const gymGates: any[] = [], leagueGates: any[] = [], mentorPlacements: any[] = [];
  const limitations: string[] = ['Binary roundtrips and branch checks are not emulator or hardware validation.'];
  if (campaign) {
    const progression = campaign.progression20;
    check(Array.isArray(progression) && progression.length === 20 && progression.filter(p => p.kind === 'original').length === 8 && progression.filter(p => p.kind === 'additional').length === 12, 'campaign must contain eight native and twelve additional Gyms');
    const flags = progression.filter(p => p.kind === 'additional').map(p => p.flagId!);
    check(new Set(flags).size === 12 && flags.every(f => Number.isInteger(f) && f >= 0xA00 && f < 0xB00), 'invalid additional Gym flags');
    if (trainerReport?.gyms) for (const step of progression.filter(p => p.kind === 'original')) {
      const binding = GYM_BINDINGS.find(g => g.name === step.leader);
      check(binding, `unknown original Gym ${step.leader}`);
      for (const trainerId of [binding.first, binding.challenge]) {
        const team = trainerReport.gyms.find(g => g.trainerId === trainerId);
        check(team && Math.max(...team.levels) === step.aceLevel, `${step.leader} trainer ${trainerId} levels do not match campaign ace ${step.aceLevel}; pass ORIGINAL_GYM_ACE_LEVELS to applyTrainers`);
      }
    }
    for (const binding of ORIGINAL_GYM_SCRIPT_BINDINGS) {
      const step = progression.find(p => p.kind === 'original' && p.leader.toLowerCase() === binding.name.toLowerCase());
      check(step, `missing ${binding.name} progression`);
      check(step.requiredFlags.every(f => flags.includes(f)), `unknown ${binding.name} prerequisite`);
      if (!step.requiredFlags.length) continue;
      touch('scripts', binding.scriptId, binding.sha256); touch('story', binding.textBankId);
      const leaders = step.requiredFlags.map(f => progression.find(p => p.flagId === f)!.leader).join(' and ');
      const messageBase = appendTexts(story, binding.textBankId, [`Before this Gym challenge, earn\\nthe regional emblem from ${leaders}.\\r\\nFollow the connected towns, help\\ntheir people, and return together.`]);
      const added = appendStoryEntry(scripts.files[binding.scriptId], guardBody(step.requiredFlags, messageBase), { originalEntry: binding.entry, redirectEntry: true });
      scripts.files[binding.scriptId] = added.bytes;
      gymGates.push({ ...binding, requiredFlags: step.requiredFlags, aceLevel: step.aceLevel, messageBase, wrapperEntry: added.entry, appendedOffset: added.appendedOffset, nativeOffset: added.nativeOffset, originalLength: added.originalLength, originalTableEnd: added.originalTableEnd });
    }
    for (const binding of [{ scriptId: 272, textBankId: 155, entry: 6, overlayId: undefined }, { scriptId: 288, textBankId: 163, entry: 2, overlayId: 52 }]) {
      touch('scripts', binding.scriptId, binding.scriptId === 288 ? CHAMPION_STORY_BINDINGS.championScript.beforeSha256 : content.leagueEntranceScriptSha256);
      touch('story', binding.textBankId);
      const messageBase = appendTexts(story, binding.textBankId, ['The League recognizes all twenty\\nGyms of Unova. Earn the twelve\\f\\nregional emblems as well as your\\f\\neight Gym Badges, then return.']);
      const added = appendStoryEntry(scripts.files[binding.scriptId], guardBody(flags, messageBase), { originalEntry: binding.entry, redirectEntry: true, overlayId: binding.overlayId });
      scripts.files[binding.scriptId] = added.bytes;
      leagueGates.push({ ...binding, requiredFlags: flags, messageBase, wrapperEntry: added.entry, appendedOffset: added.appendedOffset, nativeOffset: added.nativeOffset, originalLength: added.originalLength, originalTableEnd: added.originalTableEnd });
    }
    const occupiedMentorSlots = new Set<string>();
    for (const mentor of campaign.mentors ?? []) {
      const spot = worldReport?.storyNpcSpots?.find(s => s.semanticKey === mentor.semanticKey || ((s.townId === mentor.townId || s.settlementId === mentor.settlementId) && (s.name ?? s.role) === mentor.name));
      check(spot, `missing world NPC slot for ${mentor.semanticKey}`);
      for (const field of ['scriptId', 'eventId', 'textBankId', 'npcIndex'] as const) check(Number.isInteger(spot[field]) && spot[field] >= 0, `${mentor.semanticKey} requires an allocated ${field}`);
      const slot = `${spot.eventId}:${spot.npcIndex}`;
      check(!occupiedMentorSlots.has(slot), `mentor NPC slot ${slot} is reused`);
      occupiedMentorSlots.add(slot);
      check(mentor.spriteId === (mentor.name === 'N' ? 103 : 97), `incorrect ${mentor.name} field sprite`);
      check(mentor.repeatable && mentor.optional, 'mentor battles must remain optional and repeatable');
      touch('scripts', spot.scriptId); touch('events', spot.eventId); touch('story', spot.textBankId);
      const messageBase = appendTexts(story, spot.textBankId, mentor.texts);
      const body = rebaseStoryMentorBody(mentor.body, messageBase, mentor.texts.length);
      const standalone = compileBw2Script(`preserve_layout\ncondition_encoding :stack\nscript :mentor, entry: 1 do\n${body}\nend\n`);
      check(!standalone.instructions.some(i => i.opcode === 0x23 || i.opcode === 0x24), 'mentor changes a persistent flag');
      const added = appendStoryEntry(scripts.files[spot.scriptId], body);
      scripts.files[spot.scriptId] = added.bytes;
      const at = npcOffset(events.files[spot.eventId], spot.npcIndex);
      if (spot.actorId !== undefined) check(readU16(events.files[spot.eventId], at) === spot.actorId, 'mentor NPC actor binding');
      writeU16(events.files[spot.eventId], at + 2, mentor.spriteId);
      writeU16(events.files[spot.eventId], at + 10, added.entry);
      mentorPlacements.push({ id: mentor.id, semanticKey: mentor.semanticKey, townId: mentor.townId, name: mentor.name, trainerId: mentor.trainerId, ...spot, entry: added.entry, messageBase, textCount: mentor.texts.length, optional: true, repeatable: true });
    }
    if (!(campaign.mentors?.length)) limitations.push('No campaign mentor bodies supplied; no new-town mentor events installed.');
  } else {
    check(trainerReport?.profile !== 'full-campaign', 'full-campaign trainer levels require progression20 for Gym and League gates');
    limitations.push('No progression20 supplied: native Gym and League gates remain unchanged for an interim build.');
  }
  for (const [key, beforeSha256] of memberBefore) {
    const [archive, id] = key.split(':'); const member = Number(id);
    memberChanges.push({ archive, member, beforeSha256, afterSha256: sha(archives[archive as keyof typeof STORY_PATHS].files[member]) });
  }
  // Commit only after every source pin, compilation and text roundtrip succeeds.
  const changedFiles = Object.entries(STORY_PATHS).map(([k, path]) => {
    const fileId = rom.fileId(path), beforeSha256 = sha(rom.files[fileId]);
    const bytes = new Uint8Array(archives[k as keyof typeof STORY_PATHS].save());
    return { path, fileId, beforeSha256, afterSha256: sha(bytes), bytes: bytes.length, owned: bytes };
  });
  for (const f of changedFiles) rom.files[f.fileId] = f.owned;
  return { changedFiles: changedFiles.map(({ owned, ...f }) => f), memberChanges, approvedDialogueChanges, stages, casteliaSewerClueFlag: CasteliaSewerClueFlag, champion: { overworld: ow, hallOfFame: hall, trainerIds: [341, 536, 776, 781], nativeIrisEncountersPreserved: true }, gymGates, leagueGates, mentorPlacements, campaignIntegrated: Boolean(campaign), progression20: campaign?.progression20 ?? [], limitations };
}
