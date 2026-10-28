/** Offline fixture verification only; no emulator, progression or balance claim.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/qa-save.test.ts
 * All generated files live in one unique build/ directory, removed in finally.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQaSave, validateQaSaveChecksums, writeQaSave, type QaSaveOptions } from '../scripts/qa-save';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE = join(ROOT, 'vendor/pokeweb-serverless/src/assets/testbattle/test.sav');
const RUNNER = join(ROOT, 'vendor/pokeweb-serverless/node_modules/vite-node/vite-node.mjs');
const SCRIPT = join(ROOT, 'scripts/qa-save.ts');
const HALF = 0x26000, TABLE = 0x25f00, TABLE_LENGTH = 0x94, TABLE_CRC = 0x25fa2;
// These are the native BW2 contract offsets, not imports from the implementation.
const BLOCKS = {
  flags: { offset: 0x1ff00, length: 0x4e0, checksum: 0x203e2, index: 45 },
  caught: { offset: 0x21400, length: 0x4dc, checksum: 0x218de, index: 54 },
  badges: { offset: 0x21100, length: 0xf0, checksum: 0x211f2, index: 52 },
  party: { offset: 0x18e00, length: 0x534, checksum: 0x19336, index: 26 },
  repel: { offset: 0x21900, length: 0x34, checksum: 0x21936, index: 55 },
} as const;
type Block = keyof typeof BLOCKS;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const u16 = (bytes: Uint8Array, at: number) => bytes[at] + bytes[at + 1] * 256;
const u32 = (bytes: Uint8Array, at: number) => u16(bytes, at) + u16(bytes, at + 2) * 65536;
const put16 = (bytes: Uint8Array, at: number, value: number) => { bytes[at] = value & 255; bytes[at + 1] = value >>> 8; };
const halves = (bytes: Uint8Array) => bytes.length === HALF ? [0] : [0, HALF];

// Bit-serial CRC-16/CCITT-FALSE reference, with known-answer vectors below.
// No vendor CRC, flag, dex or party parser is used as the test oracle.
function crc16(bytes: Uint8Array): number {
  let value = 0xffff;
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) {
    const feedback = ((value >>> 15) ^ (byte >>> bit)) & 1;
    value = (value * 2) & 0xffff;
    if (feedback) value ^= 0x1021;
  }
  return value;
}
function equalBytes(actual: Uint8Array, expected: Uint8Array, label: string) {
  assert.equal(actual.length, expected.length, `${label}: byte length`);
  const at = actual.findIndex((byte, index) => byte !== expected[index]);
  assert.equal(at, -1, `${label}: first mismatch at 0x${at.toString(16)} (${actual[at]} versus ${expected[at]})`);
}
function selected(options: QaSaveOptions): Block[] {
  const blocks: Block[] = [];
  if (options.setFlags?.length || options.clearFlags?.length) blocks.push('flags');
  if (options.setCaught?.length || options.clearCaught?.length) blocks.push('caught');
  if (options.badges !== undefined) blocks.push('badges');
  if (options.party) blocks.push('party');
  if (options.clearRepel) blocks.push('repel');
  return blocks;
}
function refreshTable(bytes: Uint8Array, half: number) {
  put16(bytes, half + TABLE_CRC, crc16(bytes.subarray(half + TABLE, half + TABLE + TABLE_LENGTH)));
}
function refresh(bytes: Uint8Array, blocks: Block[]) {
  for (const half of halves(bytes)) {
    for (const name of blocks) {
      const block = BLOCKS[name], value = crc16(bytes.subarray(half + block.offset, half + block.offset + block.length));
      put16(bytes, half + block.checksum, value);
      put16(bytes, half + TABLE + block.index * 2, value);
    }
    refreshTable(bytes, half);
  }
}
function checkChecksums(bytes: Uint8Array, blocks: Block[]) {
  for (const half of halves(bytes)) {
    for (const name of blocks) {
      const block = BLOCKS[name], expected = crc16(bytes.subarray(half + block.offset, half + block.offset + block.length));
      assert.equal(u16(bytes, half + block.checksum), expected, `${name}: local CRC, half ${half}`);
      assert.equal(u16(bytes, half + TABLE + block.index * 2), expected, `${name}: table duplicate, half ${half}`);
    }
    assert.equal(u16(bytes, half + TABLE_CRC), crc16(bytes.subarray(half + TABLE, half + TABLE + TABLE_LENGTH)), `table CRC, half ${half}`);
  }
}
function expectedBytes(input: Uint8Array, options: QaSaveOptions) {
  assert.equal(options.party, undefined, 'party has its own decoding oracle');
  const expected = new Uint8Array(input);
  for (const half of halves(expected)) {
    for (const [ids, base, first, setting] of [
      [options.setFlags, 0x1ff00 + 862, 0, true], [options.clearFlags, 0x1ff00 + 862, 0, false],
      [options.setCaught, 0x21400 + 8, 1, true], [options.clearCaught, 0x21400 + 8, 1, false],
    ] as const) for (const id of ids ?? []) {
      const bit = id - first, at = half + base + Math.floor(bit / 8), mask = 2 ** (bit % 8);
      expected[at] = setting ? expected[at] | mask : expected[at] & (255 - mask);
    }
    if (options.badges !== undefined) expected[half + 0x21104] = 2 ** options.badges - 1;
    if (options.clearRepel) { expected[half + 0x2192d] = 0; expected[half + 0x2192e] = 0; }
  }
  refresh(expected, selected(options));
  return expected;
}
function checkReport(input: Uint8Array, output: Uint8Array, report: ReturnType<typeof createQaSave>['report']) {
  assert.equal(report.fixtureOnly, true);
  assert.equal(report.balanceEvidence, false);
  assert.equal(report.inputSha256, sha(input));
  assert.equal(report.outputSha256, sha(output));
  assert.deepEqual(report.halves, halves(input));
  const covered = new Uint8Array(input.length);
  let changes = 0;
  for (let at = 0; at < input.length; at++) if (input[at] !== output[at]) changes++;
  assert.equal(report.changedBytes, changes, 'report counts actual changed bytes');
  assert(Array.isArray(report.diffScopes));
  for (const scope of report.diffScopes) {
    assert.equal(typeof scope.scope, 'string'); assert(scope.scope.length > 0);
    assert(Number.isInteger(scope.offset) && scope.offset >= 0);
    assert(Number.isInteger(scope.length) && scope.length > 0 && scope.offset + scope.length <= input.length);
    let count = 0;
    for (let at = scope.offset; at < scope.offset + scope.length; at++) {
      covered[at] = 1;
      if (input[at] !== output[at]) count++;
    }
    assert.equal(scope.changedBytes, count, `scope ${scope.scope} counts actual changes`);
  }
  for (let at = 0; at < input.length; at++) if (input[at] !== output[at]) assert.equal(covered[at], 1, `unreported change at 0x${at.toString(16)}`);
}
function checkEdit(input: Uint8Array, options: QaSaveOptions) {
  const before = new Uint8Array(input), beforeOptions = structuredClone(options);
  const { save, report } = createQaSave(input, options);
  assert(save instanceof Uint8Array);
  equalBytes(input, before, 'caller input remains unchanged');
  assert.deepEqual(options, beforeOptions, 'options remain unchanged');
  equalBytes(save, expectedBytes(before, options), 'only requested bytes and required CRCs change');
  checkChecksums(save, selected(options));
  validateQaSaveChecksums(save, options);
  checkReport(before, save, report);
  return { save, report };
}

// Decode the Gen 4/5 storage layout using lexicographic physical block orders
// and BigInt LCG arithmetic, independently from the vendor's swap tables.
function permutations(values: number[]): number[][] {
  return values.length ? values.flatMap((v, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [v, ...rest])) : [[]];
}
const PHYSICAL_BLOCKS = permutations([0, 1, 2, 3]);
function decodePk5(encrypted: Uint8Array) {
  assert.equal(encrypted.length, 220);
  const physical = new Uint8Array(encrypted), pid = u32(physical, 0);
  for (const [start, end, seed] of [[8, 136, u16(physical, 6)], [136, 220, pid]]) {
    let state = BigInt(seed);
    for (let at = start; at < end; at += 2) {
      state = (state * 0x41c64e6dn + 0x6073n) & 0xffffffffn;
      put16(physical, at, u16(physical, at) ^ Number(state >> 16n));
    }
  }
  const decoded = new Uint8Array(physical), order = PHYSICAL_BLOCKS[((pid >>> 13) & 31) % 24];
  order.forEach((canonicalBlock, physicalBlock) => decoded.set(physical.subarray(8 + physicalBlock * 32, 40 + physicalBlock * 32), 8 + canonicalBlock * 32));
  let sum = 0;
  for (let at = 8; at < 136; at += 2) sum = (sum + u16(decoded, at)) & 0xffff;
  assert.equal(u16(decoded, 6), sum, 'independent decrypted PK5 checksum');
  return decoded;
}
function checkParty(input: Uint8Array, party: NonNullable<QaSaveOptions['party']>) {
  const before = new Uint8Array(input), options = { party }, { save, report } = createQaSave(input, options);
  equalBytes(input, before, 'party preset preserves input');
  const allowed = new Uint8Array(input.length), allow = (at: number, length: number) => allowed.fill(1, at, at + length);
  for (const half of halves(save)) {
    assert.equal(u32(save, half + 0x18e04), 1, 'exactly one party member');
    const mon = decodePk5(save.subarray(half + 0x18e08, half + 0x18e08 + 220));
    assert.equal(u16(mon, 8), 151); assert.equal(mon[0x8c], 100);
    for (let at = 0x8e; at <= 0x9a; at += 2) assert.equal(u16(mon, at), 999, `HP/stat at ${at}`);
    const moves = [94, 58, 396, party === 'mew-surf-smoke' ? 57 : 85], basePp = [10, 10, 20, 15];
    moves.forEach((move, slot) => {
      assert.equal(u16(mon, 0x28 + slot * 2), move);
      const ups = mon[0x34 + slot], pp = mon[0x30 + slot];
      assert(ups >= 0 && ups <= 3, 'valid PP Ups');
      assert(pp > 0 && pp <= Math.floor(basePp[slot] * (5 + ups) / 5), `valid PP for move ${move}`);
    });
    // The remaining five records are owned by replacement of the party, but
    // its capacity, surrounding data, footer and unrelated blocks are not.
    allow(half + 0x18e04, 4 + 6 * 220);
    allow(half + 0x19336, 2); allow(half + TABLE + 26 * 2, 2); allow(half + TABLE_CRC, 2);
  }
  for (let at = 0; at < input.length; at++) if (!allowed[at]) assert.equal(save[at], before[at], `party changed unowned byte 0x${at.toString(16)}`);
  checkChecksums(save, ['party']); validateQaSaveChecksums(save, options); checkReport(before, save, report);
  return save;
}

const fixture = readFileSync(FIXTURE), fixtureHash = sha(fixture);
const seeded = new Uint8Array(fixture);
for (const half of halves(seeded)) {
  // Distinct half contents expose accidental primary-half copying. Neighbors
  // and unused high bits remain nonzero so boundary masks cannot pass by luck.
  seeded.fill(half ? 0x5a : 0xa5, half + 0x1ff00 + 862, half + 0x1ff00 + 862 + 383);
  seeded.fill(half ? 0xa5 : 0x5a, half + 0x21408, half + 0x21408 + 82);
  seeded.set([0xa1, 0xb2, 0xc3], half + 0x21105);
  seeded.set([half ? 0xd2 : 0xc1, half ? 200 : 99, half ? 3 : 2, 0xe7], half + 0x2192c);
}
refresh(seeded, ['flags', 'caught', 'badges', 'repel']);
const temp = mkdtempSync(join(ROOT, 'build/qa-save-test-'));
const tempRelative = relative(ROOT, temp), failures: string[] = [];
let passed = 0, sequence = 0;
const fresh = (name: string) => join(temp, `${++sequence}-${name}`);
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`ok - ${name}`); }
  catch (error) { failures.push(name); console.error(`not ok - ${name}\n${error instanceof Error ? error.stack : String(error)}`); }
}
function diskSnapshot(directory = temp): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), info = lstatSync(path);
    if (info.isSymbolicLink()) found[relative(temp, path)] = `symlink:${readlinkSync(path)}`;
    else if (info.isDirectory()) Object.assign(found, diskSnapshot(path));
    else found[relative(temp, path)] = sha(readFileSync(path));
  }
  return found;
}
async function rejectWrite(request: unknown, pattern?: RegExp) {
  const before = diskSnapshot();
  let failure: unknown;
  try { await writeQaSave(request as Parameters<typeof writeQaSave>[0]); } catch (error) { failure = error; }
  assert(failure instanceof Error, 'write request must reject');
  if (pattern) assert.match(failure.message, pattern);
  assert.deepEqual(diskSnapshot(), before, 'rejected request must not create files or modify existing ones');
}
function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [RUNNER, '--script', SCRIPT, ...args], {
    cwd: temp, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error); assert.equal(result.signal, null, 'CLI did not terminate normally');
  return result;
}

try {
  await test('independent CRC reference vectors and all native fixture blocks', () => {
    for (const [bytes, crc] of [[[], 0xffff], [[0, 0], 0x1d0f], [[255, 255], 0], [Array.from(Buffer.from('123456789')), 0x29b1]] as const) assert.equal(crc16(Uint8Array.from(bytes)), crc);
    checkChecksums(fixture, Object.keys(BLOCKS) as Block[]);
    assert.equal(crc16(fixture.subarray(0x1ff00, 0x203e0)), 0x6a2b, 'real bundled eventwork CRC');
    for (const half of halves(fixture)) for (let slot = 0; slot < u32(fixture, half + 0x18e04); slot++) {
      const mon = decodePk5(fixture.subarray(half + 0x18e08 + slot * 220, half + 0x18e08 + (slot + 1) * 220));
      assert(u16(mon, 8) >= 1 && u16(mon, 8) <= 649, 'independent decoder reads real bundled party');
    }
  });
  await test('all accepted raw sizes, both halves, unchanged input and complete diff reports', () => {
    for (const length of [0x26000, 0x4c000, 0x80000]) {
      const input = seeded.slice(0, length);
      checkEdit(input, {});
      checkEdit(input, { setFlags: [0, 7, 8, 0xbf3], clearFlags: [1, 0xbf2], setCaught: [1, 8, 9, 649], clearCaught: [2, 648], badges: 3, clearRepel: true });
    }
  });
  await test('flag edge bits, byte boundaries and neighboring work/padding are preserved', () => {
    for (const id of [0, 1, 7, 8, 15, 16, 0x7ff, 0x800, 0xbef, 0xbf0, 0xbf2, 0xbf3]) {
      checkEdit(seeded, { setFlags: [id] }); checkEdit(seeded, { clearFlags: [id] });
    }
    const ids = Array.from({ length: 0xbf4 }, (_, id) => id);
    const all = checkEdit(seeded, { setFlags: ids }).save;
    checkEdit(all, { clearFlags: ids });
  });
  await test('caught IDs use species minus one, including first/last and neighboring seen bits', () => {
    for (const id of [1, 2, 7, 8, 9, 16, 17, 151, 494, 647, 648, 649]) {
      checkEdit(seeded, { setCaught: [id] }); checkEdit(seeded, { clearCaught: [id] });
    }
    const ids = Array.from({ length: 649 }, (_, index) => index + 1);
    checkEdit(checkEdit(seeded, { setCaught: ids }).save, { clearCaught: ids });
  });
  await test('badge counts 0..8 change only one byte and required checksums', () => {
    for (let badges = 0; badges <= 8; badges++) checkEdit(seeded, { badges });
  });
  await test('clearRepel clears only active steps/type, preserves swarm and neighbors, and is idempotent', () => {
    const output = checkEdit(seeded, { clearRepel: true }).save;
    for (const half of halves(output)) {
      assert.equal(output[half + 0x2192d], 0); assert.equal(output[half + 0x2192e], 0);
      assert.equal(output[half + 0x2192c], seeded[half + 0x2192c]);
      assert.equal(output[half + 0x2192f], 0xe7);
    }
    assert.equal(checkEdit(output, { clearRepel: true }).report.changedBytes, 0);
    assert.equal(checkEdit(seeded, { clearRepel: false }).report.changedBytes, 0);
  });
  await test('duplicate IDs, frozen options and repeated edits remain deterministic', () => {
    const options: QaSaveOptions = { setFlags: [8, 0, 8], clearFlags: [7, 7], setCaught: [649, 1, 649], clearCaught: [2, 2], badges: 8 };
    for (const value of Object.values(options)) if (Array.isArray(value)) Object.freeze(value);
    Object.freeze(options);
    const first = checkEdit(seeded, options);
    equalBytes(checkEdit(seeded, options).save, first.save, 'same request gives same bytes');
    assert.equal(checkEdit(first.save, options).report.changedBytes, 0);
  });
  await test('Buffer and nonzero-offset Uint8Array views never mutate caller backing storage', () => {
    checkEdit(Buffer.from(seeded), { setFlags: [0, 1], badges: 0, clearRepel: true });
    const backing = new Uint8Array(seeded.length + 37).fill(0x63);
    backing.set(seeded, 13); const before = new Uint8Array(backing);
    checkEdit(backing.subarray(13, 13 + seeded.length), { setCaught: [1, 649], badges: 4 });
    equalBytes(backing, before, 'whole input backing storage preserved');
  });
  for (const party of ['mew-smoke', 'mew-surf-smoke'] as const) await test(`${party}: independently decrypted Mew, moves, stats, PP and both CRC layers`, () => {
    for (const length of [0x26000, 0x4c000, 0x80000]) checkParty(seeded.slice(0, length), party);
  });
  await test('combined party and native edits compose without losing either checksum update', () => {
    const options = { setFlags: [0, 0xbf3], clearCaught: [1, 649], badges: 0, clearRepel: true };
    const native = checkEdit(seeded, options).save;
    const expected = checkParty(native, 'mew-surf-smoke');
    const before = sha(seeded), combined = createQaSave(seeded, { ...options, party: 'mew-surf-smoke' });
    equalBytes(combined.save, expected, 'combined edit order'); assert.equal(sha(seeded), before);
    checkChecksums(combined.save, Object.keys(BLOCKS) as Block[]); checkReport(seeded, combined.save, combined.report);
  });
  for (const [block, options] of [
    ['flags', { setFlags: [0] }], ['caught', { setCaught: [1] }], ['badges', { badges: 0 }],
    ['party', { party: 'mew-smoke' }], ['repel', { clearRepel: true }],
  ] as [Block, QaSaveOptions][]) await test(`${block}: reject payload, local CRC, duplicate CRC and table CRC corruption in either half`, () => {
    const b = BLOCKS[block];
    for (const half of halves(seeded)) for (const damage of ['payload', 'local', 'duplicate', 'table', 'table-crc', 'local-only-repaired', 'duplicate-only-repaired']) {
      const bad = new Uint8Array(seeded);
      if (damage === 'payload') bad[half + b.offset] ^= 1;
      if (damage === 'local') bad[half + b.checksum] ^= 1;
      if (damage === 'duplicate') { bad[half + TABLE + b.index * 2] ^= 1; refreshTable(bad, half); }
      if (damage === 'table') bad[half + TABLE] ^= 1;
      if (damage === 'table-crc') bad[half + TABLE_CRC] ^= 1;
      if (damage.endsWith('-repaired')) {
        bad[half + b.offset] ^= 1;
        const checksum = crc16(bad.subarray(half + b.offset, half + b.offset + b.length));
        put16(bad, half + (damage === 'local-only-repaired' ? b.checksum : TABLE + b.index * 2), checksum);
        refreshTable(bad, half);
      }
      const before = sha(bad);
      assert.throws(() => validateQaSaveChecksums(bad, options), /checksum/i, `${damage}, half ${half}`);
      assert.throws(() => createQaSave(bad, options), /checksum/i, `${damage}, half ${half}: must not repair invalid input`);
      assert.equal(sha(bad), before, 'checksum rejection preserves input');
    }
    const after = createQaSave(seeded, options).save;
    after[HALF + b.offset] ^= 1;
    assert.throws(() => validateQaSaveChecksums(after, options), /checksum/i, 'reject corruption after editing too');
  });
  await test('checksum table is validated even without selected edits', () => {
    for (const half of halves(fixture)) {
      const bad = new Uint8Array(fixture); bad[half + TABLE_CRC] ^= 1;
      assert.throws(() => validateQaSaveChecksums(bad, {}), /checksum/i);
      assert.throws(() => createQaSave(bad, {}), /checksum/i);
    }
  });
  await test('party preset refuses a bad per-PK5 checksum even when save-block CRCs are valid', () => {
    for (const half of halves(fixture)) {
      const bad = new Uint8Array(fixture); bad[half + 0x18e08 + 8] ^= 1;
      refresh(bad, ['party']); checkChecksums(bad, ['party']);
      const before = sha(bad);
      assert.throws(() => createQaSave(bad, { party: 'mew-smoke' }), /checksum/i);
      assert.equal(sha(bad), before);
    }
  });
  await test('truncation, appended DSV/footer and non-byte inputs are rejected', () => {
    for (const length of [0, 1, 0x25fff, 0x26001, 0x4bfff, 0x4c001, 0x7ffff, 0x80001, 0x8007a]) {
      const bad = new Uint8Array(length); bad.set(fixture.subarray(0, Math.min(length, fixture.length)));
      assert.throws(() => createQaSave(bad, {}), /raw|size|length|truncat|DSV/i);
      assert.throws(() => validateQaSaveChecksums(bad, {}));
    }
    const dsv = Buffer.concat([fixture, Buffer.from('|-DESMUME SAVE-|')]);
    assert.throws(() => createQaSave(dsv, {}));
    for (const bad of [null, undefined, [], {}, fixture.buffer]) assert.throws(() => createQaSave(bad as Uint8Array, {}));
  });
  await test('invalid options, conflicting edits and unknown/work-value keys fail without mutation', () => {
    const invalid: unknown[] = [null, [], 'options', 5, { setFlags: [0], clearFlags: [0] }, { setCaught: [649], clearCaught: [649] },
      { works: { 0x4000: 1 } }, { workValues: [] }, { setWork: [1] }, { unknown: true }, { setFlags: [1], output: 'ignored.sav' }];
    for (const [key, min, max] of [['setFlags', 0, 0xbf3], ['clearFlags', 0, 0xbf3], ['setCaught', 1, 649], ['clearCaught', 1, 649]] as const) {
      for (const value of [null, 1, '1', {}, [min - 1], [max + 1], [1.5], [NaN], [Infinity], ['1'], [null], [true], [undefined]]) invalid.push({ [key]: value });
    }
    for (const badges of [-1, 9, 0.5, NaN, Infinity, '8', null, true]) invalid.push({ badges });
    for (const party of ['', 'mew', 'Mew-smoke', null, 1, {}]) invalid.push({ party });
    for (const clearRepel of [0, 1, 'true', null, [], {}]) invalid.push({ clearRepel });
    const before = sha(seeded);
    for (const options of invalid) {
      assert.throws(() => createQaSave(seeded, options as QaSaveOptions), `invalid options: ${JSON.stringify(options)}`);
      assert.equal(sha(seeded), before);
    }
  });
  await test('sparse option arrays are invalid rather than silently editing flag zero', () => {
    for (const key of ['setFlags', 'clearFlags', 'setCaught', 'clearCaught']) {
      const before = sha(seeded);
      assert.throws(() => createQaSave(seeded, { [key]: new Array(1) }), `sparse ${key}`);
      assert.equal(sha(seeded), before);
    }
  });

  const inputPath = join(temp, 'input.sav'); writeFileSync(inputPath, seeded);
  await test('writer default input, default JSON report and paths relative to project rather than cwd', async () => {
    const output = `${tempRelative}/nested/default.sav`, oldCwd = process.cwd();
    let report: Awaited<ReturnType<typeof writeQaSave>>;
    try { process.chdir(temp); report = await writeQaSave({ output, badges: 0 }); }
    finally { process.chdir(oldCwd); }
    const bytes = readFileSync(join(ROOT, output));
    equalBytes(bytes, expectedBytes(fixture, { badges: 0 }), 'default fixture output');
    assert.deepEqual(JSON.parse(readFileSync(join(ROOT, `${output}.report.json`), 'utf8')), report!);
    checkReport(fixture, bytes, report!);
  });
  await test('writer accepts an existing build save and explicit new report', async () => {
    const output = fresh('explicit.sav'), reportPath = fresh('explicit.json');
    const options = { clearRepel: true, setFlags: [0, 0xbf3], clearCaught: [1, 649], badges: 4 };
    const report = await writeQaSave({ input: relative(ROOT, inputPath), output, report: relative(ROOT, reportPath), ...options });
    const bytes = readFileSync(output);
    equalBytes(bytes, expectedBytes(seeded, options), 'explicit build input output');
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
    checkReport(seeded, bytes, report); equalBytes(readFileSync(inputPath), seeded, 'disk input remains unchanged');
  });
  await test('writer rejects overwrites, existing destinations and hardlink aliases without partial writes', async () => {
    await rejectWrite({ input: inputPath, output: inputPath, badges: 0 }, /overwrite/i);
    const existing = fresh('existing.sav'); writeFileSync(existing, 'existing save sentinel');
    await rejectWrite({ output: existing, badges: 0 }, /overwrite|exist/i);
    const report = fresh('existing.json'); writeFileSync(report, 'existing report sentinel');
    await rejectWrite({ output: fresh('report-exists.sav'), report, badges: 0 }, /overwrite|exist/i);
    const hardOutput = fresh('hardlink.sav'), hardReport = fresh('hardlink.json');
    linkSync(inputPath, hardOutput); linkSync(inputPath, hardReport);
    await rejectWrite({ input: inputPath, output: hardOutput, badges: 0 }, /overwrite|exist/i);
    await rejectWrite({ input: inputPath, output: fresh('hard-report.sav'), report: hardReport, badges: 0 }, /overwrite|exist/i);
  });
  await test('writer rejects traversal, escaping paths, invalid extensions and unknown request keys', async () => {
    mkdirSync(join(temp, 'nested'), { recursive: true });
    await rejectWrite({ output: `${tempRelative}/nested/../traversal.sav` }, /unsafe|travers|path/i);
    await rejectWrite({ input: `${tempRelative}/nested/../input.sav`, output: fresh('input-traversal.sav') }, /unsafe|travers|path/i);
    await rejectWrite({ output: fresh('report-traversal.sav'), report: `${tempRelative}/nested/../report.json` }, /unsafe|travers|path/i);
    // An existing regular-file ancestor prevents even a broken implementation
    // from creating an out-of-scope file during these negative tests.
    await rejectWrite({ output: join(ROOT, 'package.json', `${basename(temp)}.sav`) }, /build|subpath|unsafe/i);
    await rejectWrite({ output: fresh('outside-report.sav'), report: join(ROOT, 'package.json', 'report.json') }, /build|subpath|unsafe/i);
    await rejectWrite({ input: join(ROOT, 'package.json', 'input.sav'), output: fresh('outside-input.sav') }, /build|subpath|unsafe/i);
    for (const output of [fresh('bad.dsv'), fresh('bad.json'), '', null, 4]) await rejectWrite({ output });
    await rejectWrite({ output: fresh('bad-report.sav'), report: fresh('bad-report.sav') });
    await rejectWrite({ output: fresh('unknown.sav'), workValues: { 0x4000: 1 } }, /unsupported|unknown/i);
    await rejectWrite({ input: fresh('missing.sav'), output: fresh('missing-input.sav') });
    const directoryInput = fresh('directory.sav'); mkdirSync(directoryInput);
    await rejectWrite({ input: directoryInput, output: fresh('directory-input.sav') });
  });
  await test('writer rejects file, ancestor and dangling symlinks for input, output and report', async () => {
    const realDir = join(temp, 'real-directory'), linkDir = join(temp, 'linked-directory');
    mkdirSync(realDir); writeFileSync(join(realDir, 'input.sav'), seeded); symlinkSync(realDir, linkDir, 'dir');
    const inputLink = fresh('input-link.sav'); symlinkSync(inputPath, inputLink);
    await rejectWrite({ input: inputLink, output: fresh('symlink-input.sav') }, /symlink|real/i);
    await rejectWrite({ input: join(linkDir, 'input.sav'), output: fresh('symlink-parent-input.sav') }, /symlink/i);
    await rejectWrite({ output: join(linkDir, 'output.sav') }, /symlink/i);
    await rejectWrite({ output: fresh('symlink-parent-report.sav'), report: join(linkDir, 'report.json') }, /symlink/i);
    for (const dangling of [false, true]) {
      const outputLink = fresh('output-link.sav'), reportLink = fresh('report-link.json');
      symlinkSync(dangling ? fresh('absent-output.sav') : inputPath, outputLink);
      symlinkSync(dangling ? fresh('absent-report.json') : inputPath, reportLink);
      await rejectWrite({ output: outputLink }, /symlink/i);
      await rejectWrite({ output: fresh('symlink-report.sav'), report: reportLink }, /symlink/i);
    }
    const bundledLink = fresh('bundled-link.sav'); symlinkSync(FIXTURE, bundledLink);
    await rejectWrite({ input: bundledLink, output: fresh('bundled-link-output.sav') }, /symlink|real/i);
  });
  await test('invalid CRC or options at writer boundary leaves no output or report', async () => {
    const badInput = fresh('corrupt.sav'), bad = new Uint8Array(seeded); bad[HALF + 0x2192d] ^= 1; writeFileSync(badInput, bad);
    await rejectWrite({ input: badInput, output: fresh('corrupt-output.sav'), clearRepel: true }, /checksum/i);
    await rejectWrite({ input: inputPath, output: fresh('bad-options.sav'), badges: 9 });
  });
  await test('CLI --script parses decimal/hex lists, explicit paths and valueless --clear-repel', () => {
    const output = fresh('cli.sav'), reportPath = fresh('cli.json');
    const result = runCli(['--input', relative(ROOT, inputPath), '--output', relative(ROOT, output), '--report', relative(ROOT, reportPath),
      '--set-flags', '0,0x7,8,0xBF3', '--clear-flags', '1,0xBF2', '--set-caught', '1,0x9,649', '--clear-caught', '2,0x288', '--badges', '0', '--clear-repel']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const options = { setFlags: [0, 7, 8, 0xbf3], clearFlags: [1, 0xbf2], setCaught: [1, 9, 649], clearCaught: [2, 648], badges: 0, clearRepel: true };
    const bytes = readFileSync(output), report = JSON.parse(readFileSync(reportPath, 'utf8'));
    equalBytes(bytes, expectedBytes(seeded, options), 'CLI list parsing'); checkReport(seeded, bytes, report);
    assert.deepEqual(JSON.parse(result.stdout), report);
  });
  await test('CLI JSON config and party enums produce verified save and report', () => {
    const output = fresh('config.sav'), config = fresh('config.json');
    const options: QaSaveOptions = { clearRepel: true, badges: 2, party: 'mew-surf-smoke' };
    writeFileSync(config, JSON.stringify({ input: relative(ROOT, inputPath), output: relative(ROOT, output), ...options }));
    const result = runCli(['--config', relative(ROOT, config)]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    equalBytes(readFileSync(output), createQaSave(seeded, options).save, 'config is applied');
    checkReport(seeded, readFileSync(output), JSON.parse(readFileSync(`${output}.report.json`, 'utf8')));
    const second = fresh('cli-party.sav'), preset = runCli(['--output', relative(ROOT, second), '--party', 'mew-smoke']);
    assert.equal(preset.status, 0, preset.stderr || preset.stdout);
    equalBytes(readFileSync(second), checkParty(fixture, 'mew-smoke'), 'CLI party and default fixture');
  });
  await test('CLI rejects malformed/unknown arguments and existing outputs without writing files', () => {
    for (const tail of [['--set-flags', '1,,2'], ['--set-flags', '1.5'], ['--set-caught', '12junk'], ['--badges', '-1'],
      ['--set-work', '1'], ['--party', 'unknown'], ['--clear-repel', 'true'], ['--badges'], ['--clear-repel', '--clear-repel']]) {
      const before = diskSnapshot(), result = runCli(['--output', relative(ROOT, fresh('invalid-cli.sav')), ...tail]);
      assert.notEqual(result.status, 0, `CLI accepted ${tail.join(' ')}`);
      assert.deepEqual(diskSnapshot(), before, 'CLI rejection writes no files');
    }
    const before = diskSnapshot(), result = runCli(['--input', relative(ROOT, inputPath), '--output', relative(ROOT, inputPath), '--badges', '0']);
    assert.notEqual(result.status, 0); assert.deepEqual(diskSnapshot(), before);
  });
  await test('bundled source hash and build input bytes are unchanged after every API and CLI check', () => {
    assert.equal(sha(fixture), fixtureHash, 'in-memory original fixture hash');
    assert.equal(sha(readFileSync(FIXTURE)), fixtureHash, 'bundled source file hash');
    equalBytes(readFileSync(inputPath), seeded, 'build input contents');
  });
} finally {
  rmSync(temp, { recursive: true, force: true });
  assert.equal(existsSync(temp), false, 'unique test directory is cleaned');
}
console.log(JSON.stringify({ passed, failed: failures.length, failures, fixtureOnly: true, balanceEvidence: false, emulatorValidated: false, temporaryFilesCleaned: true }));
if (failures.length) process.exitCode = 1;
