import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32, writeU32 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank, encodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { gen5ScriptCommandOffsets } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { extractGameFreakContainer, parseVMapTerrain, parseNpcRegistry } from '../../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { parseGen5MatrixFile } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import { appendStoryEntry } from './story';
import { auditWorldQuestState } from './world-state';
import { TRAINER_BASE_SHA256 } from './trainers';
import { WORLD_PATHS, worldNpc, type WorldReport } from './world';

export const EPILOGUE_PATHS = { scripts: WORLD_PATHS.scripts, events: WORLD_PATHS.events, story: WORLD_PATHS.story } as const;
export const EPILOGUE_HOF_FLAG = 0x960;
// Stable save allocation, verified on every application. Never move a remembered
// visit to a different bit just because a future staged build occupies this one.
export const EPILOGUE_VISIT_FLAGS = [0xA43, 0xA45, 0xA47, 0xA49, 0xA4B, 0xA4F] as const;
export const EPILOGUE_ELDER_SPRITE = 28;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function check(value: unknown, reason: string): asserts value { if (!value) throw new Error(`Epilogue: ${reason}`); }
type Point = { x: number; z: number };
type Area = { id: string; name: string; kind: string; headerId: number; eventId: number; scriptId: number; levelScriptId: number; textBankId: number; matrixId: number; mapIds: number[]; landing: Point; requiredOriginalBadges: number };
type Link = { from: string; to: string; requiredFlags: number[]; requiredOriginalBadges: number; fromEntry: number; toEntry: number; returnAlwaysOpen: boolean; pointA: Point; pointB: Point; landingA: Point; landingB: Point };

export const EPILOGUE_SAGES = [
  { id: 'rood', name: 'Rood', townId: 'settlement.bramblewick',
    before: 'Rood: A quiet shelter is worth tending. Please leave room for the visitors and their partners.',
    first: 'Rood: Your victory over N has reached us. He chose his own path to the League. I once served a cause that took Pokemon from people. I cannot undo that by choosing gentler words. Some of us chose to return the Pokemon and care for those left behind. Others chose differently. Their answers are theirs to give.',
    repeat: 'Rood: I remember our talk. Caring for those we hurt is work for ordinary days, too. It does not end with a Champion ceremony.' },
  { id: 'gorm', name: 'Gorm', townId: 'settlement.reedwake',
    before: 'Gorm: The surveyors leave the young reeds standing. There is much to observe from a quiet bank.',
    first: 'Gorm: News of your victory over N reached this office. I used to speak as though age made my judgment certain. It did not. Listening to a person and their Pokemon takes longer than repeating a grand argument. I am trying to allow that time.',
    repeat: 'Gorm: Yes, I remember you. The reeds have grown since our talk. A change worth making need not be announced to everyone.' },
  { id: 'bronius', name: 'Bronius', townId: 'settlement.sandglass_court',
    before: 'Bronius: The collectors measure each jar of water. A small error matters when many people depend on the count.',
    first: 'Bronius: You and your partners have overcome N at the League. When I served Team Plasma, I treated obedience as proof that I was right. The people here ask what I have actually done, and who it helped. That is a harder question. They deserve an answer in deeds.',
    repeat: 'Bronius: I remember your visit. No ledger can cancel a wrong with a sentence. I can still be responsible for the next entry.' },
  { id: 'giallo', name: 'Giallo', townId: 'settlement.threadmill_crossing',
    before: 'Giallo: A torn ribbon still shows which way the wind blows. The couriers keep their old route notes here.',
    first: 'Giallo: You have overcome N at the League, on a journey of your own. We once placed an entire future upon him and called that faith. It left too little room for his choice. I have no right to choose his next road. Or yours.',
    repeat: 'Giallo: Your visit stayed with me. Advice can become another command when the listener is not free to refuse it.' },
  { id: 'zinzolin', name: 'Zinzolin', townId: 'settlement.frostmere_hearth',
    before: 'Zinzolin: The warm stones are pleasant enough. The keeper insists that everyone take a turn tending the vents.',
    first: 'Zinzolin: You defeated N at the League! The world does enjoy upsetting a confident prediction. You have not come expecting an apology on demand, I hope. I still do not share Rood\'s convictions. Yet the people here keep this shelter warm without taking anything from their partners. I have been thinking about that. Do not mistake a question for a promise.',
    repeat: 'Zinzolin: I remember you. Yes, I am still here. Whether that means I have changed is a question I have not settled.' },
  { id: 'ryoku', name: 'Ryoku', townId: 'settlement.dawnbridge',
    before: 'Ryoku: This office records every crossing. The river does not ask whether a traveler has a famous name.',
    first: 'Ryoku: The news of your victory over N traveled faster than I did. I once borrowed old sayings to make my certainty sound wise. A saying cannot answer for the person who acts upon it. I have fewer speeches now. The bridge watch has room for another pair of hands.',
    repeat: 'Ryoku: I remember our conversation. The next traveler needs a safe crossing, not a recital. I will start there.' },
] as const;
const SEARCH_TEXT = 'Rood: If you wish, speak with the others in the field offices: Gorm in Reedwake, Bronius in Sandglass Court, Giallo in Threadmill Crossing, Zinzolin in Frostmere Hearth, and Ryoku in Dawnbridge. Return here afterward. You owe us no journey; these roads and offices were already open to you.';
const CLOSURE_TEXT = 'Rood: You have listened to all six of us. Thank you for returning. Our answers do not agree, and listening does not mean forgiving. There is no prize to claim or door left for us to open. N has his road; you and your partners have yours. Our work continues here.';

/** Audit original literals and the seven verified IREO tables through the
 * world-state backend. A second scan rejects conflicts in the staged campaign.
 * No guessed save offsets, runtime resets, or new storage are introduced. */
export function auditEpilogueState(rom: NintendoDSRom) {
  check(rom.idCode === 'IREO' && rom.data[0x1e] === 0, 'requires US Black 2 revision 0');
  check(sha(rom.data) === TRAINER_BASE_SHA256, 'original source ROM bytes changed');
  const original = new NintendoDSRom(rom.data, { fileData: 'view' });
  const native = auditWorldQuestState(original);
  check(native.nativeTables.length === 7 && native.savedFlagBytes === 383 && native.savedFlagOffset === 862, 'native flag backend changed');
  const trainerLast = native.trainerFlagOffset + new NARC(new Uint8Array(rom.getFileByName('a/0/9/1'))).files.length - 1;
  check(trainerLast < EPILOGUE_HOF_FLAG, 'staged trainer flags overlap system flags');
  const candidates = Array.from({ length: 0xA55 - 0xA42 + 1 }, (_, i) => 0xA42 + i);
  const occupied = new Map<number, string[]>();
  for (const path of [EPILOGUE_PATHS.scripts, EPILOGUE_PATHS.events]) {
    for (const [member, bytes] of new NARC(new Uint8Array(original.getFileByName(path))).files.entries()) {
      // Instructions can start at odd offsets after byte-sized operands. Scan
      // both alignments, not just even words (which miss native flags A50+).
      for (let at = 0; at + 1 < bytes.length; at++) {
        const flag = readU16(bytes, at);
        if (candidates.includes(flag)) occupied.set(flag, [...(occupied.get(flag) ?? []), `${path}:${member}:${at}`]);
      }
    }
  }
  for (const table of native.nativeTables) for (const value of table.values) if (candidates.includes(value)) occupied.set(value, [...(occupied.get(value) ?? []), `native:${table.module}:${table.address.toString(16)}`]);
  const available = candidates.filter(flag => !occupied.has(flag));
  check(available.length >= 6, `only ${available.length} unused flags in A42..A55; six required`);
  check(EPILOGUE_VISIT_FLAGS.every(flag => available.includes(flag)), 'stable visit allocation is occupied; refusing unsafe reallocation');
  for (const path of [EPILOGUE_PATHS.scripts, EPILOGUE_PATHS.events]) {
    for (const [member, bytes] of new NARC(new Uint8Array(rom.getFileByName(path))).files.entries()) {
      for (let at = 0; at + 1 < bytes.length; at++) check(!EPILOGUE_VISIT_FLAGS.includes(readU16(bytes, at) as never), `visit flag already present in staged ${path}:${member}:${at}`);
    }
  }
  return { flags: [...EPILOGUE_VISIT_FLAGS], availableOriginalCandidates: available, rejectedCandidates: [...occupied].map(([flagId, references]) => ({ flagId, references })), savedFlagBytes: native.savedFlagBytes, savedFlagOffset: native.savedFlagOffset, originalTrainerLast: native.trainerLast, trainerLast, excludedDynamicRanges: native.excludedDynamicRanges, nativeTables: native.nativeTables, originalScriptAndEventAlignedWordsAudited: true, stagedScriptAndEventAlignedWordsAudited: true, oddOffsetsAlsoAudited: true, scope: native.scope, emulatorPersistenceValidated: false };
}

function appendTexts(archive: NARC, bank: number, texts: string[]) {
  const rows = decodeGen5TextBank(archive.files[bank]), base = rows.length;
  check(rows.every((row, i) => row[0] === `0_${i}`), `unsupported text sections in ${bank}`);
  const next = [...rows, ...texts.map((text, i): [string, string, number] => [`0_${base + i}`, text, 0])];
  const bytes = encodeGen5TextBank(next), round = decodeGen5TextBank(bytes);
  // The codec derives the encryption key (tuple item 2) for new rows. Existing
  // staged rows must retain theirs, while new rows need identical IDs and prose.
  check(round.length === next.length && round.every((row, i) => row[0] === next[i][0] && row[1] === next[i][1] && (i >= base || row[2] === rows[i][2])), `text roundtrip ${bank}`);
  archive.files[bank] = bytes;
  return base;
}

function sageBody(flagId: number, base: number, closure: boolean) {
  let body = `  lock\n  if (flag_set?(${EPILOGUE_HOF_FLAG}) == 0)\n    talk message: ${base}\n    finish_interaction\n  end\n  if (flag_set?(${flagId}) == 0)\n    talk message: ${base + 1}\n    set_flag ${flagId}\n  else\n    talk message: ${base + 2}\n  end\n`;
  if (closure) {
    for (const flag of EPILOGUE_VISIT_FLAGS) body += `  if (flag_set?(${flag}) == 0)\n    talk message: ${base + 3}\n    finish_interaction\n  end\n`;
    body += `  talk message: ${base + 4}\n`;
  }
  return body + '  finish_interaction';
}

function eventRows(bytes: Uint8Array) {
  check(bytes.length >= 8 && readU32(bytes, 0) === bytes.length - 4, 'unsupported world event length');
  const start = 8 + bytes[4] * 20, end = start + bytes[5] * 36;
  check(end + bytes[6] * 20 + bytes[7] * 22 <= bytes.length, 'truncated world events');
  const occupants = Array.from({ length: bytes[5] }, (_, i) => {
    const at = start + i * 36;
    return { npcIndex: i, actorId: readU16(bytes, at), spriteId: readU16(bytes, at + 2), x: readU16(bytes, at + 28), z: readU16(bytes, at + 30) };
  });
  check(new Set(occupants.map(n => n.actorId)).size === occupants.length, 'duplicate existing actor IDs');
  check(new Set(occupants.map(n => `${n.x},${n.z}`)).size === occupants.length, 'duplicate existing NPC occupants');
  return { start, end, occupants };
}

function verifyLinkTrigger(bytes: Uint8Array, entry: number, point: Point) {
  const { end } = eventRows(bytes);
  const matches = Array.from({ length: bytes[7] }, (_, i) => {
    const at = end + bytes[6] * 20 + i * 22;
    return { triggerIndex: i, entry: readU16(bytes, at), x: readU16(bytes, at + 10), z: readU16(bytes, at + 12), width: readU16(bytes, at + 14), height: readU16(bytes, at + 16) };
  }).filter(trigger => trigger.entry === entry && trigger.x === point.x && trigger.z === point.z && trigger.width > 0 && trigger.height > 0);
  check(matches.length === 1, 'actual office entrance/exit trigger does not match its inspected script entry');
  return matches[0];
}

function verifyPlacement(area: Area, bytes: Uint8Array, point: Point, landing: Point, maps: NARC) {
  const { end, occupants } = eventRows(bytes);
  check(!(point.x === 8 && point.z === 7), 'mythical clue slot must remain free');
  check(!occupants.some(n => n.x === point.x && n.z === point.z), `occupied sage tile in ${area.id}`);
  check(area.mapIds.length === 1, 'field office must use one native room');
  const terrain = parseVMapTerrain(extractGameFreakContainer(maps.files[area.mapIds[0]]).files[1]);
  check(terrain.width === 32 && terrain.height === 32, 'unsupported native room terrain');
  const floor = terrain.tiles[landing.z * 32 + landing.x];
  const open = (p: Point) => p.x >= 0 && p.x < 32 && p.z >= 0 && p.z < 32 && !(terrain.tiles[p.z * 32 + p.x].flags & 3) && terrain.tiles[p.z * 32 + p.x].tileClass === 0 && terrain.tiles[p.z * 32 + p.x].heightType === 0 && terrain.tiles[p.z * 32 + p.x].slope === 0 && terrain.tiles[p.z * 32 + p.x].height === floor.height;
  const around = (p: Point) => [{ x: p.x - 1, z: p.z }, { x: p.x + 1, z: p.z }, { x: p.x, z: p.z - 1 }, { x: p.x, z: p.z + 1 }];
  check(open(point) && open(landing), `blocked or non-flat sage tile/landing in ${area.id}`);
  const occupied = new Set([...occupants, point].map(p => `${p.x},${p.z}`));
  const reachable = new Set<string>(), queue = [landing];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], key = `${p.x},${p.z}`;
    if (reachable.has(key) || occupied.has(key) || !open(p)) continue;
    reachable.add(key); queue.push(...around(p));
  }
  check(reachable.has(`${landing.x},${landing.z}`), 'NPC obstructs room landing');
  for (const p of [...occupants, point]) check(around(p).some(q => reachable.has(`${q.x},${q.z}`)), `inaccessible NPC after sage insertion in ${area.id}`);
  const triggers = Array.from({ length: bytes[7] }, (_, i) => {
    const at = end + bytes[6] * 20 + i * 22;
    return { x: readU16(bytes, at + 10), z: readU16(bytes, at + 12), width: readU16(bytes, at + 14), height: readU16(bytes, at + 16) };
  });
  for (const t of triggers) {
    check(!(point.x >= t.x && point.x < t.x + t.width && point.z >= t.z && point.z < t.z + t.height), 'sage overlaps a room trigger');
    check(Array.from({ length: t.width * t.height }, (_, i) => `${t.x + i % t.width},${t.z + Math.floor(i / t.width)}`).some(key => reachable.has(key)), 'sage blocks an existing room trigger');
  }
  return { occupantsBefore: occupants, floor, reachableTileCountWithActors: reachable.size, approachTiles: around(point).filter(p => reachable.has(`${p.x},${p.z}`)), actualTerrainChecked: true, existingActorsAndExitReachable: true };
}

/** Apply AFTER story/access and BEFORE the final added-dialogue formatter.
 * Only append actors, entries and text in six already allocated field offices.
 * This function never exports a ROM or changes a native game conversation. */
export function applyEpilogue(rom: NintendoDSRom, worldReport: WorldReport) {
  const stateAudit = auditEpilogueState(rom);
  const original = new NintendoDSRom(rom.data, { fileData: 'view' });
  // The native elder sprite is used intentionally. Do not guess six sage skins.
  const registry = parseNpcRegistry(new NARC(new Uint8Array(original.getFileByName('a/0/4/7'))).files[0]);
  check(registry[EPILOGUE_ELDER_SPRITE]?.uid === EPILOGUE_ELDER_SPRITE && registry[EPILOGUE_ELDER_SPRITE]?.spriteControllerType === 2 && registry[EPILOGUE_ELDER_SPRITE]?.resourceIndices[0] === 34, 'native elder walking sprite binding changed');
  const witnesses = new NARC(new Uint8Array(original.getFileByName(EPILOGUE_PATHS.events))).files.flatMap((bytes, member) => Array.from({ length: bytes[5] }, (_, npcIndex) => ({ member, npcIndex, spriteId: readU16(bytes, 8 + bytes[4] * 20 + npcIndex * 36 + 2) }))).filter(n => n.spriteId === EPILOGUE_ELDER_SPRITE);
  check(witnesses.length >= 2, 'elder sprite lacks native field witnesses');
  const areas = worldReport.areas as Area[] | undefined, links = worldReport.links as Link[] | undefined;
  check(worldReport.phase === 'full-native-allocation' && Array.isArray(areas) && Array.isArray(links), 'requires the full staged world report');
  const archives = Object.fromEntries(Object.entries(EPILOGUE_PATHS).map(([key, path]) => [key, new NARC(new Uint8Array(rom.getFileByName(path)))])) as Record<keyof typeof EPILOGUE_PATHS, NARC>;
  const maps = new NARC(new Uint8Array(rom.getFileByName(WORLD_PATHS.maps))), matrices = new NARC(new Uint8Array(rom.getFileByName(WORLD_PATHS.matrix))), headers = new NARC(new Uint8Array(rom.getFileByName(WORLD_PATHS.headers))).files[0];
  const memberChanges: Array<{ archive: string; member: number; beforeSha256: string; afterSha256: string }> = [];
  const claimed = new Set<string>();
  const bindings = EPILOGUE_SAGES.map((sage, i) => {
    const matches = areas.filter(a => a.id === `interior.${sage.townId}.1`);
    check(matches.length === 1, `missing or duplicate field office for ${sage.name}`);
    const area = matches[0], access = links.find(link => link.from === sage.townId && link.to === area.id);
    check(area.kind === 'interior' && area.headerId >= 616 && area.requiredOriginalBadges <= 8, 'sage room must be an existing pre-ending field office');
    check(access && access.requiredFlags.length === 0 && access.requiredOriginalBadges === 0 && access.returnAlwaysOpen, 'field office entry/return must already be open');
    const town = areas.find(a => a.id === sage.townId);
    check(town, 'missing office parent town');
    let actualArrival: Point | undefined;
    for (const [target, entry] of [[town, access.fromEntry], [area, access.toEntry]] as const) {
      const bytes = archives.scripts.files[target.scriptId];
      const commands = gen5ScriptCommandOffsets(bytes, 'BW2', { entryIndices: [entry - 1] });
      // Check the actual room-link entry as well as the report: no postgame flag,
      // badge or variable gate may have been inserted behind its metadata.
      check(commands.length > 0 && commands.every(at => [2, 0x2e, 0x2f, 0x30, 0xc2].includes(readU16(bytes, at))), 'office link is not an unconditional native warp');
      const warps = commands.filter(at => readU16(bytes, at) === 0xc2);
      check(warps.length === 1 && readU16(bytes, warps[0] + 2) === (target === town ? area.headerId : town.headerId), 'office warp destination differs from report');
      const arrival = { x: readU16(bytes, warps[0] + 4), z: readU16(bytes, warps[0] + 6) }, expected = target === town ? access.landingB : access.landingA;
      check(arrival.x === expected.x && arrival.z === expected.z && readU16(bytes, warps[0] + 8) === 0, 'actual office warp arrival differs from report');
      if (target === town) actualArrival = arrival;
    }
    check(actualArrival && actualArrival.x === area.landing.x && actualArrival.z === area.landing.z, 'actual office arrival differs from room landing');
    const h = headers.subarray(area.headerId * 48, (area.headerId + 1) * 48);
    check(h.length === 48 && readU16(h, 4) === area.matrixId && readU16(h, 6) === area.scriptId && readU16(h, 8) === area.levelScriptId && readU16(h, 10) === area.textBankId && readU16(h, 22) === area.eventId, 'field office header/report mismatch');
    const matrix = parseGen5MatrixFile(matrices.files[area.matrixId]);
    check(matrix.width === 1 && matrix.height === 1 && matrix.map_0 === area.mapIds[0], 'field office map/report mismatch');
    const entranceTrigger = verifyLinkTrigger(archives.events.files[town.eventId], access.fromEntry, access.pointA);
    const exitTrigger = verifyLinkTrigger(archives.events.files[area.eventId], access.toEntry, access.pointB);
    for (const [key, id] of [['scripts', area.scriptId], ['events', area.eventId], ['story', area.textBankId]] as const) {
      check(id >= new NARC(new Uint8Array(original.getFileByName(EPILOGUE_PATHS[key]))).files.length, 'refusing to append sages into native game members');
      check(!claimed.has(`${key}:${id}`), 'sage rooms share resources'); claimed.add(`${key}:${id}`);
      memberChanges.push({ archive: key, member: id, beforeSha256: sha(archives[key].files[id]), afterSha256: '' });
    }
    const point = { x: 9, z: 7 }, event = archives.events.files[area.eventId];
    const placement = verifyPlacement(area, event, point, actualArrival, maps), { end, occupants } = eventRows(event);
    const actorId = Array.from({ length: 254 }, (_, n) => n).find(n => !occupants.some(p => p.actorId === n));
    check(actorId !== undefined && event[5] < 255 && event.length + 36 < 0x984, 'native event capacity exhausted');
    const closure = sage.id === 'rood', texts: string[] = [sage.before, sage.first, sage.repeat, ...(closure ? [SEARCH_TEXT, CLOSURE_TEXT] : [])];
    const messageBase = appendTexts(archives.story, area.textBankId, texts), flagId = EPILOGUE_VISIT_FLAGS[i];
    const added = appendStoryEntry(archives.scripts.files[area.scriptId], sageBody(flagId, messageBase, closure));
    archives.scripts.files[area.scriptId] = added.bytes;
    const next = new Uint8Array(event.length + 36);
    next.set(event.subarray(0, end)); next.set(worldNpc(actorId, EPILOGUE_ELDER_SPRITE, added.entry, point), end); next.set(event.subarray(end), end + 36);
    next[5]++; writeU32(next, 0, next.length - 4); archives.events.files[area.eventId] = next;
    check(readU16(next, end + 8) === 0, 'sage must be visible before the ending');
    return { sageId: sage.id, name: sage.name, townId: sage.townId, areaId: area.id, roomName: area.name, headerId: area.headerId, mapIds: area.mapIds, matrixId: area.matrixId, eventId: area.eventId, scriptId: area.scriptId, textBankId: area.textBankId, npcIndex: event[5], actorId, spriteId: EPILOGUE_ELDER_SPRITE, ...point, flagId, visibilityFlag: 0, hofFlag: EPILOGUE_HOF_FLAG, entry: added.entry, messageBase, textCount: texts.length, messages: { before: messageBase, first: messageBase + 1, repeat: messageBase + 2, ...(closure ? { search: messageBase + 3, closure: messageBase + 4 } : {}) }, closureNpc: closure, optional: true, rewards: [], placement, accessVerification: { actualArrival, entranceTrigger, exitTrigger }, originalTableEnd: added.originalTableEnd, originalLength: added.originalLength, appendedOffset: added.appendedOffset, originalNpcEnd: end };
  });
  for (const change of memberChanges) change.afterSha256 = sha(archives[change.archive as keyof typeof EPILOGUE_PATHS].files[change.member]);
  const changedFiles = Object.entries(EPILOGUE_PATHS).map(([key, path]) => {
    const fileId = rom.fileId(path), bytes = new Uint8Array(archives[key as keyof typeof EPILOGUE_PATHS].save());
    return { path, fileId, beforeSha256: sha(rom.files[fileId]), afterSha256: sha(bytes), bytes: bytes.length, owned: bytes };
  });
  // Commit only after every room, flag, text and script has validated.
  for (const file of changedFiles) rom.files[file.fileId] = file.owned;
  return { module: 'optional-sage-epilogue', changedFiles: changedFiles.map(({ owned, ...file }) => file), memberChanges, bindings, stateAudit, hofFlag: EPILOGUE_HOF_FLAG, approvedDialogueChanges: [], optional: true, exclusiveRewards: [], newAreas: [], newSpecies: [], newFacilities: [], sprite: { id: EPILOGUE_ELDER_SPRITE, fallback: true, description: 'Existing ordinary male elder walking sprite for all six sages; individual sage graphics are not asserted.', nativeWitnesses: witnesses.slice(0, 3), controller: registry[EPILOGUE_ELDER_SPRITE].spriteControllerType }, nativeEvidence: { sourceRomUnmodified: true, originalDialogueUnmodified: true, originalScriptBodiesPreserved: true, emulatorValidated: false }, limitations: ['Static native terrain and script checks establish local office access; complete campaign traversal and save/reload persistence require independent emulator validation.'] };
}
