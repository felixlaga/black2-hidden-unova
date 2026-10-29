/** Focused real-ROM regression. No ROM export, emulator input, or save writes.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/native-access-placement.test.ts
 * Terrain connectivity is a bounded predicate, not native bridge simulation.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { parseMapMatrix, parseVMapTerrain, extractGameFreakContainer, buildModelPrimitives, readNitroResources } from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { replacementRules } from '../vendor/pokeweb-serverless/src/pokeweb/seasonalMatrixModel';
import { gen5ScriptCommandOffsets } from '../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptCommands';
import { applyWorld, WORLD_PATHS } from '../scripts/rom/world';

const started = Date.now(), hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const sourcePath = 'roms/pokemon-black2-us.nds', source = readFileSync(sourcePath), sourceHash = hash(source);
assert.equal(sourceHash, '39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99');
const rom = new NintendoDSRom(source, { fileData: 'view' });
const archive = (path: string) => new NARC(new Uint8Array(rom.getFileByName(path))).files;
const before = Object.fromEntries(Object.entries(WORLD_PATHS).map(([key, path]) => [key, archive(path)]));
const seasonBefore = rom.getFileByName('a/0/1/0').slice();
// Exercise the actual production allocation function, without unrelated build modules.
const world: any = applyWorld(rom);
const after = Object.fromEntries(Object.entries(WORLD_PATHS).map(([key, path]) => [key, archive(path)]));
const binding = world.entrances.find((e: any) => e.headerId === 495);
assert(binding);
assert.deepEqual([binding.x, binding.z, binding.height], [42, 4, 0]);
assert.deepEqual(binding.returnLanding, { x: 42, z: 5 });
const header = after.headers[0].subarray(495 * 48, 496 * 48);
assert.equal(readU16(header, 22), binding.eventId);
assert.equal(readU16(header, 6), binding.scriptId);
const nativeEvent = before.events[binding.eventId], emitted = after.events[binding.eventId];
const row = 8 + emitted[4] * 20 + binding.npcIndex * 36;
assert.equal(binding.npcIndex, nativeEvent[5]);
assert.equal(readU16(emitted, row), 23);
assert.equal(readU16(emitted, row + 10), binding.entry);
assert.deepEqual([readU16(emitted, row + 28), readU16(emitted, row + 30), readU32(emitted, row + 32)], [42, 4, 0]);
// Inspect the emitted reciprocal entry, not just the report's coordinates.
const destinationHeader = after.headers[0].subarray(binding.targetHeaderId * 48, (binding.targetHeaderId + 1) * 48);
assert.equal(readU16(destinationHeader, 6), binding.returnScriptId);
const destinationEvent = after.events[readU16(destinationHeader, 22)];
const triggerStart = 8 + destinationEvent[4] * 20 + destinationEvent[5] * 36 + destinationEvent[6] * 20;
const returnTriggers = Array.from({ length: destinationEvent[7] }, (_, i) => destinationEvent.subarray(triggerStart + i * 22, triggerStart + (i + 1) * 22))
  .filter(t => readU16(t, 0) === binding.returnEntry);
assert.equal(returnTriggers.length, 1, 'actual destination event binds the reciprocal entry');
assert.deepEqual([10, 12, 14, 16].map(o => readU16(returnTriggers[0], o)), [15, 29, 1, 1]);
const returnBytes = after.scripts[binding.returnScriptId];
const returnOps = gen5ScriptCommandOffsets(returnBytes, 'BW2', { entryIndices: [binding.returnEntry - 1] });
const returnWarps = returnOps.filter(o => readU16(returnBytes, o) === 0xc2);
assert.equal(returnWarps.length, 1);
assert.deepEqual([2, 4, 6, 8].map(o => readU16(returnBytes, returnWarps[0] + o)), [495, 42, 5, 0]);
assert(!returnOps.some(o => [0x1f, 0xd7, 0x10].includes(readU16(returnBytes, o))), 'reciprocal entry stays unconditional');

// Every pre-existing event row and trailing byte survives all five entrance appends.
let nativeRows = 0, appendedRows = 0;
for (let id = 0; id < before.events.length; id++) {
  const a = before.events[id], b = after.events[id];
  if (a.length < 8) { assert.deepEqual(b, a, `native empty event ${id}`); continue; }
  assert.equal(b[4], a[4]); assert.equal(b[6], a[6]); assert.equal(b[7], a[7]);
  const insert = 8 + a[4] * 20 + a[5] * 36, added = b[5] - a[5];
  assert(added >= 0 && added <= 1, `unexpected append count in event ${id}`);
  assert.deepEqual(b.subarray(4, 5), a.subarray(4, 5));
  assert.deepEqual(b.subarray(6, insert), a.subarray(6, insert), `native furniture/NPC rows ${id}`);
  assert.deepEqual(b.subarray(insert + added * 36), a.subarray(insert), `native warp/trigger/padding ${id}`);
  if (!added) assert.deepEqual(b, a, `untouched event ${id}`);
  else assert.equal(readU32(b, 0), 4 + b[4] * 20 + b[5] * 36 + b[6] * 20 + b[7] * 22);
  nativeRows += a[4] + a[5] + a[6] + a[7]; appendedRows += added;
}
assert.equal(appendedRows, 5);
assert.deepEqual(after.headers[0].subarray(0, before.headers[0].length), before.headers[0]);
for (const kind of ['maps', 'matrix']) for (let i = 0; i < before[kind].length; i++) assert.deepEqual(after[kind][i], before[kind][i], `native ${kind} ${i}`);
assert.deepEqual(rom.getFileByName('a/0/1/0'), seasonBefore);
const rules = replacementRules(new NARC(seasonBefore).files[0]).filter(r => r.matrixId === 293);
assert.deepEqual(rules, [{ matrixId: 293, patchType: 1, condition: 0, values: [293, 293, 292, 292, 0, 65535] }]);

type Point = [number, number];
const key = ([x, z]: Point) => `${x},${z}`;
const occupied = new Set<string>();
for (let i = 0; i < emitted[5]; i++) {
  const at = 8 + emitted[4] * 20 + i * 36;
  occupied.add(key([readU16(emitted, at + 28), readU16(emitted, at + 30)]));
}
const evidence: any[] = [];
for (const matrixId of [293, 292]) {
  const matrix = parseMapMatrix(after.matrix[matrixId]);
  const cache = new Map<number, ReturnType<typeof parseVMapTerrain>>();
  const tile = ([x, z]: Point) => {
    if (x < 0 || z < 0 || x >= matrix.width * 32 || z >= matrix.height * 32) return undefined;
    const id = matrix.chunkIds[Math.floor(z / 32) * matrix.width + Math.floor(x / 32)];
    if (id < 0) return undefined;
    if (!cache.has(id)) cache.set(id, parseVMapTerrain(extractGameFreakContainer(after.maps[id]).files[1]));
    return cache.get(id)!.tiles[(z % 32) * 32 + x % 32];
  };
  const open = (p: Point) => { const t = tile(p); return !!t && !(t.flags & 3); };
  const flood = (start: Point, blockers: Set<string>) => {
    assert(open(start) && !blockers.has(key(start)), 'component seed must itself be walkable and unoccupied');
    const seen = new Set([key(start)]), queue: Point[] = [start];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      for (const q of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as Point[]) {
        if (!seen.has(key(q)) && !blockers.has(key(q)) && open(q)) { seen.add(key(q)); queue.push(q); }
      }
    }
    return seen;
  };
  // Ground corridor near the main arrival, not the elevated warp center itself.
  const arrival: Point = [88, 20], approach: Point = [42, 5];
  const terrainOnly = flood(arrival, new Set());
  assert(!terrainOnly.has('25,20'), 'old placement must fail this explicitly bounded component predicate');
  assert(terrainOnly.has('42,4'));
  // All serialized native actors are treated as occupied, even those hidden by flags.
  const component = flood(arrival, occupied);
  assert(component.has('49,7'), 'connect to known observed east-bank corridor');
  assert(component.has(key(approach)), 'approach reachable after new actor occupancy');
  assert(!component.has('42,4'), 'actor blocks its own tile');
  const retreat = flood(approach, occupied);
  assert(retreat.has(key(arrival)), 'reciprocal landing can retreat to the main arrival');
  assert(retreat.has('42,6') && retreat.has('42,7'));
  // Independent mesh-plane sampling of actor, return and final approach, both seasons.
  const id = matrix.chunkIds[1], model = extractGameFreakContainer(after.maps[id]).files[0];
  const primitives = buildModelPrimitives(readNitroResources(model), []);
  const heights = (point: Point) => {
    const x = (point[0] % 32) * 16 + 8 - 256, z = (point[1] % 32) * 16 + 8 - 256, hits: number[] = [];
    for (const p of primitives) for (let i = 0; i < p.indices.length; i += 3) {
      const v = p.positions, a = p.indices[i] * 3, b = p.indices[i + 1] * 3, c = p.indices[i + 2] * 3;
      const d = (v[b + 2] - v[c + 2]) * (v[a] - v[c]) + (v[c] - v[b]) * (v[a + 2] - v[c + 2]);
      if (Math.abs(d) < 1e-8) continue;
      const u = ((v[b + 2] - v[c + 2]) * (x - v[c]) + (v[c] - v[b]) * (z - v[c + 2])) / d;
      const w = ((v[c + 2] - v[a + 2]) * (x - v[c]) + (v[a] - v[c]) * (z - v[c + 2])) / d;
      if (u >= -1e-7 && w >= -1e-7 && u + w <= 1 + 1e-7) hits.push(u * v[a + 1] + w * v[b + 1] + (1 - u - w) * v[c + 1]);
    }
    assert(hits.length, 'mesh must cover tested tile');
    assert(hits.every(y => Math.abs(y) < 1e-6), 'tested tile has only ground Y0 surfaces');
  };
  for (const point of [[42, 4], [42, 5], [42, 6], [42, 7]] as Point[]) {
    const t = tile(point)!; assert(open(point)); assert.equal(t.slope, 0); assert.equal(t.tileClass, 22); heights(point);
  }
  evidence.push({ matrixId, approachMapId: id, componentTilesWithAllActorsOccupied: component.size, oldPlacementRejected: true, approachAndRetreatConnected: true, finalApproachMeshY: 0 });
}
assert.equal(hash(source), sourceHash); assert.equal(hash(rom.data), sourceHash);
assert.equal(hash(readFileSync(sourcePath)), sourceHash);
const result = { pass: true, elapsedMs: Date.now() - started, realRomSha256: sourceHash, emittedActorAndReciprocalVerified: true, nativeRowsPreserved: nativeRows, nativeAppends: appendedRows, evidence, romExported: false, runtimeVerified: false, limits: 'Four-neighbor native terrain predicate with all serialized actors occupied; not dynamic bridge, season-transition, script-trigger or emulator proof.' };
mkdirSync('build/playthrough/support', { recursive: true });
writeFileSync('build/playthrough/support/native-access-placement-test.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
