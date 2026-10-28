/** Isolated US Black 2 QA saves, never ROM edits or progression/balance evidence.
 * vendor/pokeweb-serverless/node_modules/.bin/vite-node --script scripts/qa-save.ts \
 *   --output build/qa/entrance.sav --badges 0 \
 *   --set-flags 0xA83,0xA0C --clear-caught 494,647,491 --clear-repel
 * Or --config build/qa/request.json with the same camelCase keys as QaSaveRequest.
 * Example JSON: {"output":"build/qa/grass.sav","clearCaught":[494,647,491],
 *   "setFlags":[2691,2572],"badges":0,"clearRepel":true,"party":"mew-surf-smoke"}
 * Caught IDs above are Victini, Keldeo, Darkrai. Badges means the first N badges.
 * Paths resolve from this project, not the caller's working directory. Outputs
 * must be NEW build/ files; existing saves/reports are never overwritten.
 * Layout verified against native IREO research supplied by the project and:
 * https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Saves/Access/SaveBlockAccessor5B2W2.cs
 * https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Saves/Substructures/PokeDex/Zukan5.cs
 * https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Saves/Substructures/Gen5/EventWork5.cs
 * https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Saves/Substructures/Gen5/Misc5.cs
 * https://raw.githubusercontent.com/kwsch/PKHeX/master/PKHeX.Core/Saves/Substructures/Gen5/Encount5.cs
 */
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readU16, readU32, writeU16, writeU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { getTestBattleConfig, refreshTestBattleSaveBlockChecksum } from '../vendor/pokeweb-serverless/src/pokeweb/testBattle';
import { decryptPk5Party, encryptPk5Party, refreshTestBattlePartyChecksums } from '../vendor/pokeweb-serverless/src/pokeweb/testBattleTeam';

export type QaSaveOptions = {
  setFlags?: number[]; clearFlags?: number[];
  setCaught?: number[]; clearCaught?: number[];
  badges?: number;
  clearRepel?: boolean;
  party?: 'mew-smoke' | 'mew-surf-smoke';
};
export type QaSaveRequest = QaSaveOptions & { input?: string; output: string; report?: string };
const ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const BUILD = resolve(ROOT, 'build');
export const DEFAULT_QA_SAVE = resolve(ROOT, 'vendor/pokeweb-serverless/src/assets/testbattle/test.sav');
const HALF = 0x26000, TABLE = 0x25f00, TABLE_LENGTH = 0x94, TABLE_CRC = 0x25fa2;
const FLAG_OFFSET = 862; // 431 native u16 work values; NOT vendor's BW-only 636.
// Native IREO's confirmed persistent range. Do not infer trainer IDs from the
// vendor's 1420 base: native trainer flags begin at 1520. Callers pass flag IDs.
const LAST_FLAG = 0xbf3;
const BLOCKS = {
  flags: { offset: 0x1ff00, length: 0x4e0, checksum: 0x203e2, index: 45 },
  caught: { offset: 0x21400, length: 0x4dc, checksum: 0x218de, index: 54 },
  badges: { offset: 0x21100, length: 0xf0, checksum: 0x211f2, index: 52 },
  party: { offset: 0x18e00, length: 0x534, checksum: 0x19336, index: 26 },
  repel: { offset: 0x21900, length: 0x34, checksum: 0x21936, index: 55 },
} as const;
type BlockName = keyof typeof BLOCKS;
const OPTION_KEYS = ['setFlags', 'clearFlags', 'setCaught', 'clearCaught', 'badges', 'party', 'clearRepel'];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`QA save: ${message}`);
}
function object(value: unknown, keys: string[]) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected an options object');
  for (const key of Object.keys(value)) check(keys.includes(key), `unsupported option ${key}`);
}
function normalize(options: QaSaveOptions) {
  object(options, OPTION_KEYS);
  const list = (key: 'setFlags' | 'clearFlags' | 'setCaught' | 'clearCaught', min: number, max: number) => {
    const value = options[key];
    if (value === undefined) return [];
    check(Array.isArray(value) && value.every(n => Number.isInteger(n) && n >= min && n <= max), `${key} requires integer IDs ${min}..${max}`);
    return [...new Set(value)].sort((a, b) => a - b);
  };
  const setFlags = list('setFlags', 0, LAST_FLAG), clearFlags = list('clearFlags', 0, LAST_FLAG);
  const setCaught = list('setCaught', 1, 649), clearCaught = list('clearCaught', 1, 649);
  check(!setFlags.some(n => clearFlags.includes(n)), 'cannot set and clear the same flag');
  check(!setCaught.some(n => clearCaught.includes(n)), 'cannot set and clear the same caught species');
  check(options.badges === undefined || (Number.isInteger(options.badges) && options.badges >= 0 && options.badges <= 8), 'badges must be an integer count 0..8');
  check(options.party === undefined || ['mew-smoke', 'mew-surf-smoke'].includes(options.party), 'unsupported party preset');
  check(options.clearRepel === undefined || typeof options.clearRepel === 'boolean', 'clearRepel must be boolean');
  return { setFlags, clearFlags, setCaught, clearCaught, ...(options.badges === undefined ? {} : { badges: options.badges }),
    ...(options.party === undefined ? {} : { party: options.party }),
    ...(options.clearRepel === undefined ? {} : { clearRepel: options.clearRepel }) };
}
function halves(save: Uint8Array) {
  check(save instanceof Uint8Array && [HALF, HALF * 2, 0x80000].includes(save.length), 'expected a raw BW2 save of 0x26000, 0x4c000 or 0x80000 bytes (no truncated halves or DSV footer)');
  return save.length === HALF ? [0] : [0, HALF];
}
function selected(options: ReturnType<typeof normalize>): BlockName[] {
  return [
    ...(options.setFlags.length || options.clearFlags.length ? ['flags' as const] : []),
    ...(options.setCaught.length || options.clearCaught.length ? ['caught' as const] : []),
    ...(options.badges === undefined ? [] : ['badges' as const]),
    ...(options.party ? ['party' as const] : []),
    ...(options.clearRepel ? ['repel' as const] : []),
  ];
}
// Independent validation; the vendor checksum writer is never used to repair
// or normalize an invalid input before these comparisons have succeeded.
function crc16(bytes: Uint8Array) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function validateQaSaveChecksums(save: Uint8Array, options: QaSaveOptions = {}) {
  const blocks = selected(normalize(options));
  for (const half of halves(save)) {
    check(crc16(save.subarray(half + TABLE, half + TABLE + TABLE_LENGTH)) === readU16(save, half + TABLE_CRC), `checksum table invalid in half 0x${half.toString(16)}`);
    for (const name of blocks) {
      const b = BLOCKS[name], expected = crc16(save.subarray(half + b.offset, half + b.offset + b.length));
      check(readU16(save, half + b.checksum) === expected, `${name} block checksum invalid in half 0x${half.toString(16)}`);
      check(readU16(save, half + TABLE + b.index * 2) === expected, `${name} duplicate checksum invalid in half 0x${half.toString(16)}`);
    }
  }
}
function pkChecksum(mon: Uint8Array) {
  let sum = 0;
  for (let at = 8; at < 136; at += 2) sum = (sum + readU16(mon, at)) & 0xffff;
  return sum;
}
function smokeParty(out: Uint8Array, half: number, surf: boolean) {
  const party = half + BLOCKS.party.offset, slot = party + 8;
  check(readU32(out, party + 4) >= 1 && readU32(out, party + 4) <= 6, 'party preset needs an existing 1..6-member party');
  const mon = decryptPk5Party(new Uint8Array(out.subarray(slot, slot + 220)));
  check(pkChecksum(mon) === readU16(mon, 6), 'first party Pokemon checksum invalid');
  check(readU16(mon, 8) >= 1 && readU16(mon, 8) <= 649, 'first party slot is not a Pokemon');
  writeU16(mon, 4, 0); // sanity
  writeU16(mon, 8, 151); writeU16(mon, 10, 0);
  writeU32(mon, 0x10, 1059860); mon[0x14] = 255; mon[0x15] = 28; // Mew / Synchronize
  mon.fill(0, 0x18, 0x1e); // EVs; boosted party stats below are intentionally synthetic.
  writeU32(mon, 0x38, 0x3fffffff); // 31 IVs, not an egg, not nicknamed
  mon[0x40] = 4; mon[0x41] = 0; mon[0x42] = 0; // genderless, base form, Hardy, no hidden/extended ability
  mon.fill(0, 0x48, 0x5e);
  [...'Mew'].forEach((char, i) => writeU16(mon, 0x48 + i * 2, char.charCodeAt(0)));
  writeU16(mon, 0x4e, 0xffff);
  const moves = [94, 58, 396, surf ? 57 : 85], pp = [10, 10, 20, 15];
  moves.forEach((move, i) => { writeU16(mon, 0x28 + i * 2, move); mon[0x30 + i] = pp[i]; mon[0x34 + i] = 0; });
  writeU32(mon, 0x88, 0); mon[0x8c] = 100;
  writeU16(mon, 0x8e, 999);
  for (let i = 0; i < 6; i++) writeU16(mon, 0x90 + i * 2, 999);
  const encrypted = encryptPk5Party(mon), decoded = decryptPk5Party(encrypted);
  check(pkChecksum(decoded) === readU16(decoded, 6) && readU16(decoded, 8) === 151, 'party encryption roundtrip failed');
  writeU32(out, party + 4, 1);
  out.set(encrypted, slot); out.fill(0, slot + 220, party + 8 + 6 * 220);
  refreshTestBattlePartyChecksums(out, half);
}

export function createQaSave(input: Uint8Array, options: QaSaveOptions = {}) {
  const edits = normalize(options), saveHalves = halves(input), blocks = selected(edits);
  validateQaSaveChecksums(input, edits);
  const out = new Uint8Array(input), allowed = new Map<number, string>();
  const allow = (offset: number, length: number, scope: string) => { for (let i = 0; i < length; i++) allowed.set(offset + i, scope); };
  const config = getTestBattleConfig('BW2');
  check(config.saveLayout.saveHalfOffset === HALF && config.saveLayout.checksumBlockOffset === TABLE &&
    config.saveLayout.checksumBlockLength === TABLE_LENGTH && config.saveLayout.checksumBlockChecksumOffset === TABLE_CRC, 'vendor checksum layout changed');
  for (const half of saveHalves) {
    const bit = (base: number, index: number, value: boolean, scope: string) => {
      const offset = half + base + (index >>> 3), mask = 1 << (index & 7);
      out[offset] = value ? out[offset] | mask : out[offset] & ~mask;
      allow(offset, 1, scope);
    };
    edits.setFlags.forEach(flag => bit(BLOCKS.flags.offset + FLAG_OFFSET, flag, true, 'event-flags'));
    edits.clearFlags.forEach(flag => bit(BLOCKS.flags.offset + FLAG_OFFSET, flag, false, 'event-flags'));
    edits.setCaught.forEach(species => bit(BLOCKS.caught.offset + 8, species - 1, true, 'dex-caught'));
    edits.clearCaught.forEach(species => bit(BLOCKS.caught.offset + 8, species - 1, false, 'dex-caught'));
    if (edits.badges !== undefined) { out[half + BLOCKS.badges.offset + 4] = (1 << edits.badges) - 1; allow(half + BLOCKS.badges.offset + 4, 1, 'badge-mask'); }
    if (edits.clearRepel) {
      // Encount5B2W2 identifies +2C as SwarmSeed. SaveBlockAccessor5B2W2's
      // block-55 annotation documents +2D repel steps and +2E repel type.
      out[half + BLOCKS.repel.offset + 0x2d] = 0;
      out[half + BLOCKS.repel.offset + 0x2e] = 0;
      allow(half + BLOCKS.repel.offset + 0x2d, 2, 'repel-steps-and-type');
    }
    if (edits.party) { smokeParty(out, half, edits.party === 'mew-surf-smoke'); allow(half + BLOCKS.party.offset + 4, 4 + 6 * 220, 'party-smoke-only'); }
    for (const name of blocks) {
      const b = BLOCKS[name];
      if (name !== 'party') refreshTestBattleSaveBlockChecksum(out, config.saveLayout, half, b.offset, b.length, b.checksum, b.index);
      allow(half + b.checksum, 2, `${name}-block-checksum`);
      allow(half + TABLE + b.index * 2, 2, `${name}-table-checksum`);
    }
    if (blocks.length) allow(half + TABLE_CRC, 2, 'checksum-table-crc');
  }
  validateQaSaveChecksums(out, edits);
  const diffScopes: { scope: string; offset: number; length: number; changedBytes: number }[] = [];
  let changedBytes = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== input[i]) {
    const scope = allowed.get(i); check(scope, `unexpected change outside requested scopes at 0x${i.toString(16)}`);
    changedBytes++;
    const last = diffScopes.at(-1);
    if (last && last.scope === scope && last.offset + last.length === i) { last.length++; last.changedBytes++; }
    else diffScopes.push({ scope, offset: i, length: 1, changedBytes: 1 });
  }
  return { save: out, report: { fixtureOnly: true as const, balanceEvidence: false as const, romModified: false as const,
    inputSha256: sha(input), outputSha256: sha(out), halves: saveHalves, edits, selectedBlocks: blocks,
    checksumsValidatedBeforeAndAfter: true, changedBytes, diffScopes,
    limitations: ['Raw save fixture only; no native runtime or progression claim.', 'Party presets use synthetic 999 stats; not balance evidence.', 'Work-value edits are unsupported.'] } };
}

function stat(path: string) {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function buildPath(value: string, extension: string) {
  check(typeof value === 'string' && value.length > 0 && !value.includes('\0') && !value.split(/[\\/]/).includes('..'), 'unsafe build path');
  const path = resolve(ROOT, value), rel = relative(BUILD, path);
  check(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'output/input must be a build/ subpath');
  check(extname(path) === extension, `expected ${extension} path`);
  let cursor = BUILD;
  for (const part of ['', ...rel.split(sep)]) {
    cursor = part ? resolve(cursor, part) : cursor;
    const info = stat(cursor);
    check(!info?.isSymbolicLink(), 'symlinks are not allowed in build paths');
    if (info && cursor !== path) check(info.isDirectory(), 'build parent must be a directory');
  }
  return path;
}
export function writeQaSave(request: QaSaveRequest) {
  object(request, [...OPTION_KEYS, 'input', 'output', 'report']);
  const { input: requestedInput = DEFAULT_QA_SAVE, output: requestedOutput, report: requestedReport, ...options } = request;
  normalize(options);
  check(typeof requestedInput === 'string', 'input must be a path');
  const inputPath = resolve(ROOT, requestedInput);
  if (inputPath !== DEFAULT_QA_SAVE) buildPath(requestedInput, '.sav');
  check(stat(inputPath)?.isFile() && !stat(inputPath)?.isSymbolicLink() && realpathSync(inputPath) === inputPath, 'input must be a real bundled or build/ raw save file');
  const outputPath = buildPath(requestedOutput, '.sav');
  const reportPath = buildPath(requestedReport ?? `${outputPath}.report.json`, '.json');
  for (const path of [outputPath, reportPath]) {
    check(path !== inputPath, 'never overwrite input');
    check(!stat(path), `refusing to overwrite existing output: ${relative(ROOT, path)}`);
  }
  const input = readFileSync(inputPath), { save, report } = createQaSave(input, options);
  const result = { ...report, input: relative(ROOT, inputPath), output: relative(ROOT, outputPath), report: relative(ROOT, reportPath) };
  const opened: { path: string; fd: number }[] = [];
  try {
    for (const path of [outputPath, reportPath]) {
      mkdirSync(dirname(path), { recursive: true });
      buildPath(path, extname(path));
      opened.push({ path, fd: openSync(path, 'wx', 0o600) });
    }
    writeFileSync(opened[0].fd, save);
    writeFileSync(opened[1].fd, `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    for (const file of opened) { closeSync(file.fd); unlinkSync(file.path); }
    throw error;
  }
  for (const file of opened) closeSync(file.fd);
  return result;
}

export function runQaSaveCli(args: string[]) {
  const keys: Record<string, string> = { '--input': 'input', '--output': 'output', '--report': 'report', '--set-flags': 'setFlags',
    '--clear-flags': 'clearFlags', '--set-caught': 'setCaught', '--clear-caught': 'clearCaught', '--badges': 'badges', '--party': 'party' };
  const number = (value: string) => { check(/^(?:0x[\da-f]+|\d+)$/i.test(value), `invalid integer ${value}`); return Number(value); };
  let request: Record<string, unknown> = {};
  if (args[0] === '--config') {
    check(args.length === 2, '--config takes one JSON path and cannot be mixed with overrides');
    request = JSON.parse(readFileSync(resolve(ROOT, args[1]), 'utf8'));
  } else {
    check(args.length > 0, 'supply --output build/name.sav and options, or --config file.json');
    for (let i = 0; i < args.length;) {
      if (args[i] === '--clear-repel') {
        check(!('clearRepel' in request), 'duplicate CLI option --clear-repel');
        request.clearRepel = true; i++; continue;
      }
      const key = keys[args[i]], value = args[i + 1];
      check(key && !(key in request), `unknown or duplicate CLI option ${args[i]}`);
      check(value !== undefined && !value.startsWith('--'), `missing value for ${args[i]}`);
      request[key] = ['setFlags', 'clearFlags', 'setCaught', 'clearCaught'].includes(key) ? value.split(',').map(number) : key === 'badges' ? number(value) : value;
      i += 2;
    }
  }
  return writeQaSave(request as QaSaveRequest);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runQaSaveCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
