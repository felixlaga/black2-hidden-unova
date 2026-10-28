import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { compileBw2Script, decompileBw2Script } from '../../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { gen5ScriptCommandOffsets } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { decodeGen5TextBank, encodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { compileCampaignBody } from './campaign';

export const CAMPAIGN_ACCESS_FLAG = 0xA41;
export const ACCESS_PATHS = { scripts: 'a/0/5/6', story: 'a/0/0/3' } as const;
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(`Access: ${message}`); };
export const NATIVE_ACCESS = JSON.parse(readFileSync(new URL('../../content/native-access.json', import.meta.url), 'utf8')) as {
  schema_version: number; baseSha256: string; accessFlag: number;
  nativeMainPlot: { member: number; beforeSha256: string; work: number; value: number };
  initializer: { member: number; beforeSha256: string; helper: string; offset: number; endOffset: number };
  patches: { member: number; overlayId: number | null; beforeSha256: string; reads: { offset: number; opcode: number; from: number; to: number }[]; reason: string }[];
  migrations: { command: string; reason: string; opcode: number; operands: number[]; witness: { member: number; offset: number }; preserveAdvancedProgress: boolean }[];
  textChanges: { archive: 'story'; bank: number; entry: string; before_sha256: string; after_sha256: string; after: string; reason: string }[];
  audit: unknown[]; limitations: string[];
};
type CampaignTown = { body: string; texts: string[]; flagId: number; compiledSha256: string; compiledBytes: number[]; [key: string]: unknown };
type AccessCampaign = { towns: Record<string, CampaignTown>; [key: string]: unknown };

/** Mutates the compiled campaign definition BEFORE applyWorld copies its body.
 * Does not touch a ROM. Only the final regional victory applies native migration;
 * the true Hall of Fame flag remains reserved for the native ending. */
export function prepareCampaignAccess(campaign: AccessCampaign) {
  const town = campaign.towns['settlement.dawnbridge'];
  check(town && town.flagId === CAMPAIGN_ACCESS_FLAG, 'missing final Dawnbridge crisis');
  check(!town.body.includes('access_native_plot_ready'), 'campaign access already prepared');
  check((town.body.match(/^set_flag 0x0a41$/gm) ?? []).length === 1, 'expected one final-victory A41 write');
  const before = compileCampaignBody(town.body);
  check(before.sha256 === town.compiledSha256 && sha(Uint8Array.from(town.compiledBytes)) === before.sha256, 'campaign compiled body is stale');
  check(town.body.startsWith('lock\n'), 'unsupported final crisis entry');
  const missingTextId = town.texts.length, openedTextId = missingTextId + 1;
  const guard = ['lock', 'work_cmp_const 0x4072, 4', 'jump_if 0x01, :access_native_plot_ready', `talk message: ${missingTextId}`, 'finish_interaction', 'label :access_native_plot_ready'].join('\n');
  const commands = NATIVE_ACCESS.migrations.map((migration, i) => {
    if (!migration.preserveAdvancedProgress) return migration.command;
    // Do not reset an already-progressed side story in an older save.
    const work = migration.operands[0];
    return [`work_cmp_const ${work}, 0`, `jump_if 0x05, :access_preserve_${i}`, migration.command, `label :access_preserve_${i}`].join('\n');
  }).join('\n');
  const body = town.body.replace(/^lock\n/, guard + '\n').replace(/^set_flag 0x0a41$/m, `set_flag 0x0a41\n${commands}\ntalk message: ${openedTextId}`);
  const compiled = compileCampaignBody(body);
  const instructions = compileBw2Script(`preserve_layout\nscript :access, entry: 1 do\n${body}\nend`).instructions;
  check(!instructions.some(i => [0x23, 0x24].includes(i.opcode) && i.operands[0] === 0x960), 'migration must never write Hall of Fame state');
  // Commit the definition only after the complete body recompiles and roundtrips.
  town.body = body;
  town.texts = [...town.texts,
    'N: Ghetsis still holds the heart\\nof this scheme at the Giant Chasm.\\r\\nHelp Hugh stop him first. The keepers\\nwill hold this relay until you return.',
    'Keeper Sela: The crews have answered!\\nThe bridges and freight tunnels\\f\\nare opening again.\\r\\nExplore the roads beyond Castelia,\\nOpelucid and Route 14 before you\\f\\nbring your partners to the League.',
  ];
  town.compiledSha256 = compiled.sha256;
  town.compiledBytes = Array.from(compiled.bytes);
  return { module: 'campaign-access-preparation', changedFiles: [], approvedDialogueChanges: [], townId: 'settlement.dawnbridge', accessFlag: CAMPAIGN_ACCESS_FLAG, requiresNativeMainPlot: NATIVE_ACCESS.nativeMainPlot, beforeSha256: before.sha256, afterSha256: compiled.sha256, migrationCommands: NATIVE_ACCESS.migrations, addedMessageIds: [missingTextId, openedTextId], roundTripVerified: true, trueHallOfFameFlagWritten: false };
}

function patchEndingInitializer(bytes: Uint8Array) {
  const original = decompileBw2Script(bytes), compiled = compileBw2Script(original.source);
  check(original.editable && original.roundTripVerified, 'native ending initializer must roundtrip before editing');
  const helper = compiled.codeBlocks?.find(b => b.name === NATIVE_ACCESS.initializer.helper);
  check(helper?.offset === NATIVE_ACCESS.initializer.offset && helper.endOffset === NATIVE_ACCESS.initializer.endOffset, 'native ending helper binding changed');
  const lines = original.source.split('\n');
  const guardedLines = new Set<number>();
  for (const migration of NATIVE_ACCESS.migrations) {
    const instruction = compiled.instructions.find(i => i.offset === migration.witness.offset);
    check(instruction && instruction.opcode === migration.opcode && JSON.stringify(instruction.operands) === JSON.stringify(migration.operands), `initializer witness mismatch for ${migration.command}`);
    check(instruction.offset >= helper.offset && instruction.offset < helper.endOffset, 'migration witness escaped ending helper');
    guardedLines.add(instruction.line - 1);
  }
  // First true ending still records HOF and performs all non-migrated native
  // effects. Already explored N-Castle/Cynthia/Cave progress must not reset.
  const source = lines.map((line, index) => guardedLines.has(index)
    ? `  if (flag_set?(0x0a41) == 0)\n  ${line}\n  end` : line).join('\n');
  const output = compileBw2Script(source), round = decompileBw2Script(output.bytes);
  check(round.editable && round.roundTripVerified, 'guarded ending initializer failed roundtrip');
  const oldHof = compiled.instructions.filter(i => i.opcode === 0x23 && i.operands[0] === 0x960);
  const newHof = output.instructions.filter(i => i.opcode === 0x23 && i.operands[0] === 0x960);
  check(oldHof.length === 1 && newHof.length === 1, 'native Hall of Fame write must remain exactly once');
  return { bytes: output.bytes, source, helperOffset: output.codeBlocks!.find(b => b.name === NATIVE_ACCESS.initializer.helper)!.offset, guardedCommands: guardedLines.size, nativeHallOfFameWrites: newHof.length };
}

/** Apply AFTER story; changes only pinned native script members and three exact
 * dialogue entries. No ending initializer is invoked and no save is modified. */
export function applyAccess(rom: NintendoDSRom) {
  check(rom.idCode === 'IREO' && rom.data[0x1e] === 0, 'requires US Black2 revision0');
  const scripts = new NARC(new Uint8Array(rom.getFileByName(ACCESS_PATHS.scripts)));
  const story = new NARC(new Uint8Array(rom.getFileByName(ACCESS_PATHS.story)));
  const main = NATIVE_ACCESS.nativeMainPlot, init = NATIVE_ACCESS.initializer;
  check(sha(scripts.files[main.member]) === main.beforeSha256, 'native main Plasma source changed');
  check(sha(scripts.files[init.member]) === init.beforeSha256, 'native ending source changed');
  const mainCompiled = compileBw2Script(decompileBw2Script(scripts.files[main.member], { overlayId: 66 }).source);
  check(mainCompiled.instructions.some(i => i.opcode === 0x28 && i.operands[0] === main.work && i.operands[1] === main.value), 'native Ghetsis completion work witness missing');
  const scriptChanges = NATIVE_ACCESS.patches.map(patch => {
    const member = scripts.files[patch.member];
    check(sha(member) === patch.beforeSha256, `unexpected native script ${patch.member}`);
    const options = patch.overlayId === null ? {} : { overlayId: patch.overlayId };
    const before = decompileBw2Script(member, options);
    check(before.editable && before.roundTripVerified, `native script ${patch.member} failed roundtrip`);
    const offsets = new Set(gen5ScriptCommandOffsets(member, 'BW2', options));
    for (const read of patch.reads) {
      check(read.opcode === 0x10 && read.from === 0x960 && read.to === CAMPAIGN_ACCESS_FLAG, 'unsupported access patch');
      check(offsets.has(read.offset) && readU16(member, read.offset) === read.opcode && readU16(member, read.offset + 2) === read.from, `native flag read ${patch.member}:${read.offset}`);
      writeU16(member, read.offset + 2, read.to);
    }
    const after = decompileBw2Script(member, options);
    check(after.editable && after.roundTripVerified, `patched script ${patch.member} failed roundtrip`);
    return { ...patch, afterSha256: sha(member), roundTripVerified: true };
  });
  const initializer = patchEndingInitializer(scripts.files[init.member]);
  scripts.files[init.member] = initializer.bytes;
  const approvedDialogueChanges = NATIVE_ACCESS.textChanges.map(change => {
    const rows = decodeGen5TextBank(story.files[change.bank]);
    const row = rows.find(r => r[0] === change.entry);
    check(row && sha(row[1]) === change.before_sha256 && sha(change.after) === change.after_sha256, `dialogue hash mismatch ${change.bank}:${change.entry}`);
    row[1] = change.after;
    story.files[change.bank] = encodeGen5TextBank(rows);
    check(decodeGen5TextBank(story.files[change.bank]).find(r => r[0] === change.entry)?.[1] === change.after, 'access dialogue roundtrip');
    const { after, ...approval } = change; return approval;
  });
  const changedFiles = ([['scripts', scripts], ['story', story]] as const).map(([key, archive]) => {
    const path = ACCESS_PATHS[key], fileId = rom.fileId(path), bytes = new Uint8Array(archive.save());
    return { path, fileId, beforeSha256: sha(rom.files[fileId]), afterSha256: sha(bytes), bytes: bytes.length, owned: bytes };
  });
  for (const file of changedFiles) rom.files[file.fileId] = file.owned;
  return { module: 'native-access', changedFiles: changedFiles.map(({ owned, ...f }) => f), approvedDialogueChanges, accessFlag: CAMPAIGN_ACCESS_FLAG, nativeBarrierReads: scriptChanges, initializer: { member: init.member, beforeSha256: init.beforeSha256, afterSha256: sha(initializer.bytes), helperOffset: initializer.helperOffset, guardedCommands: initializer.guardedCommands, nativeHallOfFameWrites: initializer.nativeHallOfFameWrites }, migrationCommands: NATIVE_ACCESS.migrations, audit: NATIVE_ACCESS.audit, trueHallOfFamePreserved: true, allAccessReachabilityVerified: false, limitations: NATIVE_ACCESS.limitations };
}
