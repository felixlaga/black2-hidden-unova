/** Real native assets and serialized world data, entirely in memory.
 * Run: vendor/pokeweb-serverless/node_modules/.bin/vite-node tests/house-doors.test.ts
 * Visual lane fixtures come from the reviewed native facade projections in
 * build/review-full-world-v5/native-anchors/houses; this is not emulator proof.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, readU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { buildModelPrimitives, extractGameFreakContainer, mapBuildingMember, parseAreaHeader, parseChunkBuildings, parseMapMatrix, parseVMapTerrain, readNitroModelNames, readNitroResources } from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { decompileBw2Script } from '../vendor/pokeweb-serverless/src/pokeweb/bw2ScriptCompiler';
import { applyCampaignDefinitions } from '../scripts/rom/campaign';
import { applyWorld, WORLD_FIRST_ZONE, WORLD_PATHS } from '../scripts/rom/world';
import { nativePropDoor, townLayout, TOWN_DETAILS, type PropBounds } from '../scripts/rom/world-content';
import { type Point, type Rect } from '../scripts/rom/world-geometry';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const source = readFileSync('roms/pokemon-black2-us.nds');
const baseHash = '39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99';
assert.equal(hash(source), baseHash, 'Visual contracts apply to the inspected native revision');
const rom = new NintendoDSRom(source, { fileData: 'view' });
const area = parseAreaHeader(rom.getFileByName('a/0/1/3'), 34);
assert.equal(area.buildingsId, 8);
const buildingBytes = rom.getFileByName('a/2/2/5'), textureBytes = rom.getFileByName('a/1/7/4');
const bundle = extractGameFreakContainer(new NARC(buildingBytes).files[area.buildingsId]);
const textures = readNitroResources(new NARC(textureBytes).files[area.buildingsId]);
const bounds: PropBounds = new Map();
const nativeModels = new Map<number, ReturnType<typeof buildModelPrimitives>>();
for (let i = 0; i < bundle.files.length / 2; i++) {
  const model = bundle.files[i + bundle.files.length / 2], uid = readU16(bundle.files[i], 0);
  const resource = readNitroResources(model);
  const primitives = buildModelPrimitives({ models: resource.models, textures: [...resource.textures, ...textures.textures], palettes: [...resource.palettes, ...textures.palettes] }, []);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of primitives) for (let k = 0; k < p.positions.length; k++) {
    min[k % 3] = Math.min(min[k % 3], p.positions[k]);
    max[k % 3] = Math.max(max[k % 3], p.positions[k]);
  }
  bounds.set(uid, { name: readNitroModelNames(model).join(','), min, max });
  nativeModels.set(uid, primitives);
}

// Independent reviewed lane offsets, not a fixture made from nativePropDoor.
// UID39/52 retain the existing loading/market threshold; UID50 is a vessel's
// boarding approach. Only the three auditor-confirmed mismatches change.
const reviewed: Record<number, { name: string; dx: number; dz: number }> = {
  39: { name: 'd5_whouse_01', dx: 0, dz: 5 },
  40: { name: 'd5_whouse_02', dx: -2, dz: 5 },
  44: { name: 'c5_house_01', dx: 0, dz: 2 },
  47: { name: 'c5_lhouse_01', dx: 0, dz: 5 },
  49: { name: 'c5_house_02', dx: 0, dz: 3 },
  50: { name: 'c5_fvessel_01', dx: 0, dz: 4 },
  52: { name: 'c5_market_01', dx: 0, dz: 5 },
  112: { name: 'thouse_01', dx: 0, dz: 2 },
  122: { name: 'r6_labo_01', dx: 0, dz: 3 },
  327: { name: 'c5_rbuild_01', dx: 0, dz: 3 },
};
for (const [uid, expected] of Object.entries(reviewed)) {
  assert.equal(bounds.get(Number(uid))?.name, expected.name);
  assert.ok(nativeModels.get(Number(uid))!.every(p => p.material.texture), `${uid}: original detailed textures must resolve`);
}
assert.deepEqual(bounds.get(40), { name: 'd5_whouse_02', min: [-51.5, 4, -58], max: [53, 79.109375, 58] });
assert.deepEqual(bounds.get(122), { name: 'r6_labo_01', min: [-53, 4, -25], max: [53, 66.05078125, 38.5] });
assert.deepEqual(bounds.get(44), { name: 'c5_house_01', min: [-37, 4, -28], max: [37, 57.02734375, 24] });
const layouts = TOWN_DETAILS.map((d, i) => townLayout(i, d[0], bounds));
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + r.w && p.z >= r.z && p.z < r.z + r.h;
for (const [i, layout] of layouts.entries()) {
  assert.equal(new Set(layout.props.slice(0, 4).map(p => p.uid)).size, 4, `${layout.label}: four distinct native structures`);
  for (const p of layout.props) {
    const native = bounds.get(p.uid)!;
    const left = Math.floor((16 * p.x + 8 + native.min[0]) / 16), top = Math.floor((16 * p.z + 8 + native.min[2]) / 16);
    assert.deepEqual(p.footprint, { x: left, z: top, w: Math.ceil((16 * p.x + 8 + native.max[0]) / 16) - left, h: Math.ceil((16 * p.z + 8 + native.max[2]) / 16) - top });
  }
  for (const [j, p] of layout.props.slice(0, 2).entries()) {
    const expected = reviewed[p.uid];
    assert.ok(expected, `${layout.label}: unreviewed entrance asset ${p.uid}`);
    const door = nativePropDoor(p), street = { x: door.x, z: door.z + 1 };
    assert.deepEqual(door, { x: p.x + expected.dx, z: p.z + expected.dz });
    for (const other of layout.props) for (const point of [door, street]) assert.ok(!contains(other.footprint, point), `${i}/${j}: entrance or return under prop ${other.uid}`);
    assert.ok(contains(p.footprint, { x: door.x, z: door.z - 1 }), `${i}/${j}: door adjacent to its own building`);
  }
}
assert.equal(new Set(layouts.map(l => JSON.stringify([l.tiles, l.props, l.landmarks, l.palette]))).size, 24);
assert.deepEqual(layouts[4].props.slice(0, 4).map(p => p.uid), [327, 122, 112, 45]);
assert.deepEqual(layouts[17].props.slice(0, 4).map(p => p.uid), [327, 44, 49, 48]);
assert.deepEqual(nativePropDoor(layouts[1].props[1]), { x: 21, z: 14 });
assert.deepEqual(nativePropDoor(layouts[4].props[1]), { x: 23, z: 12 });
assert.deepEqual(nativePropDoor(layouts[17].props[1]), { x: 23, z: 9 });
for (const uid of [328, 24, 65535]) assert.throws(() => nativePropDoor({ ...layouts[4].props[1], uid }), /no reviewed entrance/);
assert.throws(() => nativePropDoor({ ...layouts[1].props[1], footprint: { x: 23, z: 9, w: 1, h: 5 } }), /misses its footprint/);

// Compile the actual integrated builder; merely reimplementing its intended
// trigger coordinates here would miss a forgotten nativePropDoor call.
const campaign = applyCampaignDefinitions(rom);
const report: any = applyWorld(rom, { campaign });
assert.equal(report.counts.interiors, 48);
const archives = Object.fromEntries(Object.entries(WORLD_PATHS).map(([key, path]) => [key, new NARC(rom.getFileByName(path))]));
const key = (p: Point) => `${p.x},${p.z}`;
const neighbors = (p: Point) => [{ x: p.x - 1, z: p.z }, { x: p.x + 1, z: p.z }, { x: p.x, z: p.z - 1 }, { x: p.x, z: p.z + 1 }];
const warp = (body: string) => body?.match(/map_change_warp ([\da-fx]+), ([\da-fx]+), ([\da-fx]+), ([\da-fx]+)/)?.slice(1).map(Number);
function zone(headerId: number) {
  const header = archives.headers.files[0].subarray(headerId * 48, (headerId + 1) * 48);
  const matrix = parseMapMatrix(archives.matrix.files[readU16(header, 4)]);
  const chunks = matrix.chunkIds.map(mapId => {
    const files = extractGameFreakContainer(archives.maps.files[mapId]).files;
    return { mapId, terrain: parseVMapTerrain(files[1], mapId), props: parseChunkBuildings(files[mapBuildingMember(files)], [], mapId) };
  });
  const event = archives.events.files[readU16(header, 22)];
  assert.equal(readU32(event, 0), 4 + event[4] * 20 + event[5] * 36 + event[6] * 20 + event[7] * 22);
  const npcs = Array.from({ length: event[5] }, (_, i) => {
    const at = 8 + event[4] * 20 + i * 36;
    return { x: readU16(event, at + 28), z: readU16(event, at + 30) };
  });
  const triggers = Array.from({ length: event[7] }, (_, i) => {
    const at = 8 + event[4] * 20 + event[5] * 36 + event[6] * 20 + i * 22;
    return { x: readU16(event, at + 10), z: readU16(event, at + 12), w: readU16(event, at + 14), h: readU16(event, at + 16), entry: readU16(event, at), condition: [2, 4, 6, 8, 18, 20].map(offset => readU16(event, at + offset)) };
  });
  const compiled = decompileBw2Script(archives.scripts.files[readU16(header, 6)]);
  assert.ok(compiled.roundTripVerified);
  const entries = new Map(compiled.source.split(/(?=^script :)/m).filter(s => s.startsWith('script :')).map(s => [Number(s.match(/entry: (\d+)/)![1]), s.trim()]));
  const occupied = new Set(npcs.map(key));
  const atTrigger = (p: Point) => triggers.filter(t => contains(t, p));
  const walk = (p: Point) => {
    if (p.x < 0 || p.z < 0 || p.x >= matrix.width * 32 || p.z >= matrix.height * 32) return false;
    const tile = chunks[Math.floor(p.z / 32) * matrix.width + Math.floor(p.x / 32)].terrain.tiles[p.z % 32 * 32 + p.x % 32];
    return !(tile.flags & 3) && !(tile.tileClass >= 61 && tile.tileClass <= 68);
  };
  const visit = (start: Point) => {
    const seen = new Set<string>(), queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i];
      if (seen.has(key(p)) || !walk(p) || occupied.has(key(p)) || atTrigger(p).length) continue;
      seen.add(key(p)); queue.push(...neighbors(p));
    }
    return seen;
  };
  return { headerId, chunks, matrix, npcs, occupied, triggers, entries, walk, visit, atTrigger, landing: { x: readU32(header, 36), z: readU32(header, 44) } };
}

let entrances = 0, approachChecks = 0, actorChecks = 0;
const townHashes = new Set<string>();
for (const [i, layout] of layouts.entries()) {
  const town = zone(WORLD_FIRST_ZONE + i), visited = town.visit(town.landing);
  townHashes.add(town.chunks.map(c => hash(archives.maps.files[c.mapId])).join(':'));
  assert.equal(town.occupied.size, town.npcs.length, `${layout.label}: duplicate NPC occupancy`);
  for (const npc of town.npcs) {
    assert.ok(town.walk(npc), `${layout.label}: NPC blocked by new building`);
    assert.equal(town.atTrigger(npc).length, 0, `${layout.label}: NPC on trigger`);
    assert.ok(neighbors(npc).some(p => visited.has(key(p))), `${layout.label}: NPC has no reachable interaction tile`);
    actorChecks++;
  }
  for (const p of layout.props) {
    for (let z = p.footprint.z; z < p.footprint.z + p.footprint.h; z++) for (let x = p.footprint.x; x < p.footprint.x + p.footprint.w; x++) assert.ok(!town.walk({ x, z }), `${layout.label}: native footprint collision erased`);
    const chunk = town.chunks[Math.floor(p.z / 32) * town.matrix.width + Math.floor(p.x / 32)];
    const actual = chunk.props.filter(a => a.x === (p.x % 32) * 16 + 8 - 256 && a.z === 256 - ((p.z % 32) * 16 + 8));
    assert.equal(actual.length, 1);
    assert.deepEqual([actual[0].modelUid, actual[0].rotationY, actual[0].y], [p.uid, 0, 0], `${layout.label}: serialized native prop contract`);
  }
  for (const [j, prop] of layout.props.slice(0, 2).entries()) {
    const id = `interior.settlement.${TOWN_DETAILS[i][0]}.${j}`;
    const binding = report.interiors.find((r: any) => r.id === id);
    assert.ok(binding, id);
    const room = zone(binding.headerId), door = nativePropDoor(prop), street = { x: door.x, z: door.z + 1 };
    const inbound = town.triggers.filter(t => warp(town.entries.get(t.entry)!)?.[0] === binding.headerId);
    assert.equal(inbound.length, 1, `${id}: exactly one exterior entrance`);
    assert.deepEqual(inbound[0], { ...door, w: 1, h: 1, entry: inbound[0].entry, condition: [0, 0, 0, 0, 0, 0] });
    assert.deepEqual(warp(town.entries.get(inbound[0].entry)!), [binding.headerId, 6, 8, 0]);
    assert.doesNotMatch(town.entries.get(inbound[0].entry)!, /badge|flag|if |jump |work_/);
    const outbound = room.triggers.filter(t => warp(room.entries.get(t.entry)!)?.[0] === town.headerId);
    assert.equal(outbound.length, 1);
    assert.deepEqual(outbound[0], { x: 5, z: 9, w: 3, h: 1, entry: 1, condition: [0, 0, 0, 0, 0, 0] });
    assert.deepEqual(warp(room.entries.get(outbound[0].entry)!), [town.headerId, street.x, street.z, 0]);
    assert.doesNotMatch(room.entries.get(outbound[0].entry)!, /badge|flag|if |jump |work_/);
    assert.deepEqual([binding.townHeaderId, binding.propUid, binding.entry, binding.returnEntry], [town.headerId, prop.uid, inbound[0].entry, outbound[0].entry]);
    assert.deepEqual([binding.door, binding.street, binding.landing, binding.exit], [door, street, room.landing, { x: 5, z: 9, w: 3, h: 1 }], `${id}: runtime harness report matches serialized bytes`);
    for (const p of [door, street]) {
      assert.ok(town.walk(p), `${id}: blocked entrance/return`);
      assert.ok(!town.occupied.has(key(p)), `${id}: occupied entrance/return`);
    }
    assert.equal(town.atTrigger(door).length, 1);
    assert.equal(town.atTrigger(street).length, 0, `${id}: return must not immediately warp`);
    assert.ok(visited.has(key(street)), `${id}: street approach avoids every NPC/auto-warp`);
    assert.ok(neighbors(door).some(p => visited.has(key(p))), `${id}: adjacent approach`);
    assert.ok(town.visit(street).has(key(town.landing)), `${id}: return reaches main street without another warp`);
    approachChecks += 2;
    const roomVisited = room.visit(room.landing);
    assert.deepEqual(room.landing, { x: 6, z: 8 });
    assert.equal(room.atTrigger(room.landing).length, 0);
    assert.ok(neighbors({ x: 6, z: 9 }).some(p => roomVisited.has(key(p))), `${id}: interior exit approach`);
    for (const x of [5, 6, 7]) {
      assert.ok(room.walk({ x, z: 9 }));
      assert.ok(!room.occupied.has(`${x},9`));
    }
    for (const npc of room.npcs) {
      assert.ok(room.walk(npc));
      assert.ok(neighbors(npc).some(p => roomVisited.has(key(p))), `${id}: interior actor approach`);
      actorChecks++;
    }
    if (i === 1 && j === 1) assert.equal(town.atTrigger({ x: 23, z: 14 }).length, 0, 'Old Sootbell loading-bay trigger removed');
    entrances++;
  }
}
assert.equal(entrances, 48);
assert.equal(townHashes.size, 24, 'Every compiled town remains visually distinct');
assert.equal(hash(source), baseHash);
assert.equal(hash(rom.data), baseHash);
assert.equal(rom.getFileByName('a/2/2/5'), buildingBytes, 'Native building bundle remains untouched');
assert.equal(rom.getFileByName('a/1/7/4'), textureBytes, 'Native building textures remain untouched');
console.log(JSON.stringify({ passed: true, entrances, twoWayApproachChecks: approachChecks, actorApproachChecks: actorChecks, distinctTowns: townHashes.size, nativeAssets: Object.keys(reviewed).length, romExported: false, emulatorValidated: false }));
