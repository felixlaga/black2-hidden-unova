import { createHash } from 'node:crypto';
import { NintendoDSRom } from '../../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16 } from '../../vendor/pokeweb-serverless/src/nds/binary';
import { decodeGen5TextBank } from '../../vendor/pokeweb-serverless/src/pokeweb/text';
import { scanGen5ScriptPokemonCommands } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5ScriptPokemonScanner';
import { parseGen5MatrixFile } from '../../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import { extractGameFreakContainer, parseVMapTerrain } from '../../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import expansion from '../../content/expansion.json';
import story from '../../content/story.json';

export const SPECIES_PATHS = { encounters: 'a/1/2/7', evolutions: 'a/0/1/9' } as const;
export const BASE_ENCOUNTER_COUNT = 135;
export const SPECIES_HABITAT_END = 203;
const SEASON_BYTES = 232;
const GROUPS = ['grass', 'darkGrass', 'rustling', 'surf', 'rippleSurf', 'fishing', 'rippleFishing'] as const;
const GROUP_COUNTS = [12, 12, 12, 5, 5, 5, 5];
const GROUP_OFFSETS = [8, 56, 104, 152, 172, 192, 212];
const GRASS_CHANCES = [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1];
const WATER_CHANCES = [60, 30, 5, 4, 1];
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export type SpeciesHabitat = {
  headerId: number;
  areaId: string;
  mapId: number;
  theme: string;
  minLevel: number;
  maxLevel: number;
  encounterId: number;
  encounterTiles: unknown[] | number;
  surfTiles?: unknown[] | number;
  [key: string]: unknown;
};
export type SpeciesStaticBinding = {
  headerId: number;
  scriptId: number;
  /** Native event/compiler entry number (one-based); not scanner entryIndex. */
  entry: number;
  species: number;
  level: number;
  flagId?: number | null;
  captureState?: unknown;
  entrance: unknown;
  [key: string]: unknown;
};
export type SpeciesWorldReport = {
  habitats?: SpeciesHabitat[];
  staticEncounters?: SpeciesStaticBinding[];
  [key: string]: unknown;
};
type Biome = 'meadow' | 'woodland' | 'wetland' | 'coast' | 'quarry' | 'cavern' | 'workshop' | 'highland' | 'frost' | 'ruins';
type Evolution = { source: number; slot: number; method: number; param: number; target: number };
type WildSource = {
  kind: 'wild'; species: number; encounterId: number; headers: number[];
  group: string; seasons: number[]; minLevel: number; maxLevel: number;
  probabilityPercent: number; expansion: boolean;
};
type StaticSource = { kind: 'static'; species: number; headerId: number; scriptId: number; entry: number; level: number; flagId: number | null; captureState: unknown; entrance: unknown };
type AcquisitionSource = WildSource | StaticSource;

/** Supplementary visitors share existing secret rooms; these are requests, never evidence. */
export const SUPPLEMENTAL_SECRET_VISITORS = [
  [145, 'storm_roost', 60], [146, 'sunlit_steps', 60], [150, 'dawn_vault', 70],
  [243, 'steel_perch', 60], [244, 'hearthstone_vault', 60], [245, 'glass_lake', 60],
  [249, 'deep_bell', 65], [250, 'sunlit_steps', 65], [377, 'pine_bastion', 60],
  [378, 'powder_vault', 60], [379, 'dawn_vault', 60], [380, 'skyprint_observatory', 60],
  [381, 'skyprint_observatory', 60], [382, 'deep_bell', 65], [383, 'hearthstone_vault', 65],
  [384, 'storm_roost', 70], [385, 'starlit_porch', 60], [386, 'moon_lens', 65],
  [480, 'frostscript_gallery', 60], [481, 'mirrorbough_grove', 60], [482, 'silent_lookout', 60],
  [483, 'moon_lens', 65], [484, 'glass_lake', 65], [485, 'hearthstone_vault', 60],
  [486, 'pine_bastion', 70], [487, 'night_orchard', 65], [488, 'mirrorbough_grove', 60],
  [489, 'river_crown', 45], [490, 'river_crown', 60], [492, 'root_beacon', 60],
  [493, 'unwritten_spring', 70], [638, 'steel_perch', 55], [639, 'basalt_wing', 55],
  [640, 'root_beacon', 55], [641, 'skyprint_observatory', 60], [642, 'storm_roost', 60],
  [643, 'sunlit_steps', 65], [644, 'dawn_vault', 65], [645, 'silent_lookout', 60],
  [646, 'winterseed_refuge', 65], [648, 'lastwatch_shelter', 60], [649, 'dawn_vault', 65],
].map(([species, site, level]) => ({ species: species as number, areaId: `area.${site}`, level: level as number, requiredOriginalBadges: 8 }));

const PLANNED_STATIC_SPECIES = new Set<number>([
  ...expansion.hidden_areas.map(area => area.encounter.national_dex_id),
  ...story.secret_quests.map(quest => quest.national_dex_id),
  ...SUPPLEMENTAL_SECRET_VISITORS.map(visitor => visitor.species),
]);
const LEGENDARY_SPECIES = new Set([
  144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251,
  377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
  480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, 494,
  638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
]);

// Hand-authored ecology, not random replacement. The actual source list is derived from
// this ROM's evolution graph. Static visitors keep their authored secret locations.
const BIOME_SPECIES: Record<Biome, number[]> = {
  meadow: [16,19,21,26,29,31,32,34,40,52,56,77,83,84,108,113,115,122,128,161,174,185,192,203,209,234,235,236,241,261,263,276,296,301,307,309,311,312,327,335,360,396,399,403,431,438,439,440,446,463,468,475,495,498,501,504,506,509,519,522,531,538,539,572,573,587,619,626],
  woodland: [10,13,23,43,45,46,48,63,69,71,102,103,114,123,127,163,165,167,177,182,190,204,214,216,265,273,275,287,290,313,314,315,336,352,357,401,407,412,417,420,424,441,465,469,511,512,513,514,515,516,540,543,547,549,570,588,590,595,597,616],
  wetland: [54,60,62,79,134,194,270,272,283,298,339,341,418,422,453,455,535,580,618],
  coast: [72,86,90,91,98,118,120,121,129,138,140,170,211,222,223,226,278,318,320,345,347,363,366,369,370,456,458,550,564,592,594],
  quarry: [27,50,66,74,95,104,111,206,213,299,304,328,331,408,410,449,451,476,524,529,532,551,554,556,557,559,566,631,632],
  cavern: [41,293,302,303,371,443,527,602,604,610,621,633],
  workshop: [58,59,81,88,100,109,135,136,137,218,228,239,240,322,324,316,374,434,436,462,479,568,599,624,636],
  highland: [38,198,337,338,358,430,472,627,629],
  frost: [215,220,225,238,361,459,461,471,473,478,582,613,615],
  ruins: [36,92,96,132,200,201,325,353,355,429,442,517,518,561,562,574,577,605,607,609,622],
};
const AQUATIC = new Set([72,86,90,91,98,116,118,120,121,129,138,140,170,211,222,223,226,318,320,339,341,345,347,349,363,366,369,370,456,458,550,564,592,594]);
const BIOME_FILLERS: Record<Biome, number[]> = {
  meadow: [506,519,504,531], woodland: [540,543,511,263], wetland: [535,54,298,194],
  coast: [278,98,86,580], quarry: [524,27,557,529], cavern: [41,527,524,95],
  workshop: [81,568,109,599], highland: [333,627,629,619], frost: [582,613,225,220], ruins: [562,607,622,605],
};

function readEvolutions(narc: NARC): Evolution[] {
  const result: Evolution[] = [];
  for (let source = 1; source <= 649; source++) {
    const file = narc.files[source];
    if (!file || file.length !== 42) throw new Error(`Species ${source}: expected native seven-slot (42-byte) evolution record`);
    for (let slot = 0; slot < 7; slot++) {
      const method = readU16(file, slot * 6), param = readU16(file, slot * 6 + 2), target = readU16(file, slot * 6 + 4);
      if (method) {
        if (target < 1 || target > 649) throw new Error(`Invalid evolution target ${source} -> ${target}`);
        result.push({ source, slot, method, param, target });
      }
    }
  }
  return result;
}

/** Preserve trade methods; append independent solo routes. Branches retain a choice. */
function addSoloEvolutions(narc: NARC) {
  const before = readEvolutions(narc);
  const changes: Array<{source: number; target: number; slot: number; method: number; level: number; reason: string}> = [];
  for (const edge of before.filter(edge => [5,6,7].includes(edge.method))) {
    let method = 4, level = edge.method === 5 || edge.method === 7 ? 37 : 40;
    let reason = 'Ordinary level-up alternative; original trading method retained.';
    if (edge.source === 79) {
      level = 32;
      reason = 'Slowking at level 32, before Slowbro at 37; cancel until 37 for Slowbro. A low-level Slowpoke source is required.';
    }
    if (edge.source === 112 || edge.source === 233) level = 50;
    if (edge.source === 356) level = 45;
    if (edge.source === 349) level = 37;
    if (edge.source === 366) {
      method = edge.target === 367 ? 23 : 24;
      level = 35;
      reason = `${method === 23 ? 'Male' : 'Female'} Clamperl at level 35; distinct gender predicates avoid shadowing the other branch.`;
    }
    const file = new Uint8Array(narc.files[edge.source]);
    let slot = -1;
    for (let i = 0; i < 7; i++) {
      if (readU16(file,i*6) === method && readU16(file,i*6+2) === level && readU16(file,i*6+4) === edge.target) { slot = i; break; }
    }
    if (slot >= 0) continue;
    for (let i = 0; i < 7; i++) if (readU16(file,i*6) === 0 && readU16(file,i*6+4) === 0) { slot = i; break; }
    if (slot < 0) throw new Error(`No free evolution slot for ${edge.source}`);
    writeU16(file,slot*6,method); writeU16(file,slot*6+2,level); writeU16(file,slot*6+4,edge.target);
    narc.files[edge.source] = file;
    changes.push({source:edge.source,target:edge.target,slot,method,level,reason});
  }
  return changes;
}

// Item supply, breeding, move tutors, date/time, other games and trading are deliberately
// excluded from the coverage proof. Those original methods are still playable unchanged.
const SAFE_METHODS = new Set([1,4,9,10,11,12,13,14,15,23,24]);
const METHOD_REQUIREMENTS: Record<number, string> = {
  1: 'Raise friendship offline, then gain a level.', 4: 'Gain a level at or above the stated threshold.',
  9: 'Level with Attack greater than Defense.', 10: 'Level with Attack equal to Defense.',
  11: 'Level with Attack lower than Defense.', 12: 'Catch another Wurmple if its fixed personality selects the other branch.',
  13: 'Catch another Wurmple if its fixed personality selects the other branch.',
  14: 'Level Nincada to 20.', 15: 'Level Nincada to 20 with an empty party slot and an ordinary Poke Ball in the bag.',
  23: 'Level a male specimen.', 24: 'Level a female specimen.',
};
function closure(seeds: Iterable<number>, evolutions: Evolution[]) {
  const available = new Set(seeds);
  const via = new Map<number, Evolution>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of evolutions) if (SAFE_METHODS.has(edge.method) && available.has(edge.source) && !available.has(edge.target)) {
      available.add(edge.target); via.set(edge.target,edge); changed = true;
    }
  }
  return {available,via};
}

function biomeForSpecies(species: number): Biome {
  const match = (Object.entries(BIOME_SPECIES) as Array<[Biome,number[]]>).find(([,ids]) => ids.includes(species));
  if (!match) throw new Error(`Species ${species} has no curated ecology; extend BIOME_SPECIES instead of randomly assigning it`);
  return match[0];
}

function habitatBiomes(h: SpeciesHabitat): Biome[] {
  const words = `${h.theme} ${h.areaId}`.toLowerCase();
  const matches = (Object.keys(BIOME_SPECIES) as Biome[]).filter(biome => words.includes(biome));
  if (/bramble|clover|apple|heather|southworks|greenbelt|flower|orchard/.test(words)) matches.push('meadow','woodland');
  if (/soot|copper|kiln|rivet|mill|sewer/.test(words)) matches.push('workshop');
  if (/sand|ochre|flint|quarry|desert|copper_cut/.test(words)) matches.push('quarry','cavern');
  if (/reed|lock|rain|westbasin|willow|basin/.test(words)) matches.push('wetland','woodland');
  if (/thread|wind|cloud|pine|highmarch|escarpment/.test(words)) matches.push('highland','woodland');
  if (/frost|slate|snow|winter|cold/.test(words)) matches.push('frost','cavern');
  if (/salt|pearl|tide|gull|east|coast|ferry|sea|harbou?r/.test(words)) matches.push('coast','wetland');
  if (/stillwater|dawn|ruin|ancient|shrine|sanctuary/.test(words)) matches.push('ruins','highland');
  return [...new Set(matches.length ? matches : ['meadow' as Biome])];
}

function countTiles(value: unknown[] | number | undefined) { return Array.isArray(value) ? value.length : typeof value === 'number' ? value : 0; }
function validateHabitats(headers: Uint8Array, habitats: SpeciesHabitat[]) {
  const ids = new Set<number>();
  if (habitats.length && habitats.length !== 68) throw new Error('Supply all 68 reserved habitats together (encounters 135..202)');
  for (const h of habitats) {
    if (!Number.isInteger(h.headerId) || h.headerId < 615 || (h.headerId+1)*48 > headers.length) throw new Error(`Invalid appended habitat header ${h.headerId}`);
    if (!Number.isInteger(h.encounterId) || h.encounterId < 135 || h.encounterId >= 203 || ids.has(h.encounterId)) throw new Error(`Invalid/duplicate reserved encounter ID ${h.encounterId}`);
    if (headers[h.headerId*48+20] !== h.encounterId) throw new Error(`Header ${h.headerId} does not bind encounter ${h.encounterId}`);
    if (!countTiles(h.encounterTiles)) throw new Error(`Habitat ${h.areaId} has no asserted encounter terrain`);
    if (!Number.isInteger(h.minLevel) || !Number.isInteger(h.maxLevel) || h.minLevel<2 || h.maxLevel<h.minLevel || h.maxLevel>70) throw new Error(`Invalid habitat levels for ${h.areaId}`);
    ids.add(h.encounterId);
  }
}

/** Independently follow header -> matrix -> chunk permissions. Reported encounter
 * tiles alone cannot establish that the engine will ever select the added tables. */
function inspectNativeHabitatTerrain(rom: NintendoDSRom, headers: Uint8Array, habitats: SpeciesHabitat[]) {
  if (!habitats.length) return [];
  const matrices=new NARC(rom.getFileByName('a/0/0/9'));
  const maps=new NARC(rom.getFileByName('a/0/0/8'));
  return habitats.map(h=> {
    const matrixId=readU16(headers,h.headerId*48+4);
    if (!matrices.files[matrixId]) throw new Error(`Habitat ${h.areaId} references absent matrix ${matrixId}`);
    const matrix=parseGen5MatrixFile(matrices.files[matrixId]);
    const chunks: Array<{mapId:number;grassTiles:number;surfTiles:number}> = [];
    for(let cell=0;cell<matrix.width*matrix.height;cell++) {
      if (matrix.matrix_flags===1 && matrix[`header_${cell}`]!==h.headerId) continue;
      const mapId=matrix[`map_${cell}`];
      if(mapId===0xffffffff) continue;
      if(!maps.files[mapId]) throw new Error(`Habitat ${h.areaId} references absent map ${mapId}`);
      const chunk=extractGameFreakContainer(maps.files[mapId]);
      if(!chunk.files[1]) throw new Error(`Habitat map ${mapId} lacks native collision permissions`);
      const terrain=parseVMapTerrain(chunk.files[1],mapId);
      const grassTiles=terrain.tiles.filter(t=>t.tileClass===4 && (t.flags&4)!==0 && (t.flags&1)===0).length;
      const surfTiles=terrain.tiles.filter(t=>t.tileClass>=61 && t.tileClass<=68 && (t.flags&6)===6 && (t.flags&1)===0).length;
      chunks.push({mapId,grassTiles,surfTiles});
    }
    if(!chunks.some(c=>c.mapId===h.mapId)) throw new Error(`Habitat ${h.areaId}: supplied map ${h.mapId} does not belong to its native matrix/header`);
    const grassTiles=chunks.reduce((n,c)=>n+c.grassTiles,0),surfTiles=chunks.reduce((n,c)=>n+c.surfTiles,0);
    if(!grassTiles) throw new Error(`Habitat ${h.areaId} has no native unblocked grass encounter tiles`);
    if(countTiles(h.surfTiles)&&!surfTiles) throw new Error(`Habitat ${h.areaId} asserts Surf but native water encounter tiles are absent`);
    return {headerId:h.headerId,encounterId:h.encounterId,matrixId,chunks,grassTiles,surfTiles,walkFromEntranceCertified:false};
  });
}

function validateStaticSources(rom: NintendoDSRom, headers: Uint8Array, bindings: SpeciesStaticBinding[]) {
  const scripts = new NARC(rom.getFileByName('a/0/5/6'));
  const sources: StaticSource[] = [], rejected: Array<{species:number;reason:string}> = [];
  for (const binding of bindings) {
    const {headerId,scriptId,entry,species,level,flagId,entrance,captureState} = binding;
    if (![headerId,scriptId,entry,species,level].every(Number.isInteger) || (flagId!=null&&!Number.isInteger(flagId)) || entry<1 || species<1 || species>649 || level<1 || level>100) {
      rejected.push({species,reason:'Malformed static binding'}); continue;
    }
    if (headerId<615 || (headerId+1)*48>headers.length || readU16(headers,headerId*48+6)!==scriptId || !scripts.files[scriptId]) {
      rejected.push({species,reason:'Appended header/script binding absent from actual ROM'}); continue;
    }
    const matches = scanGen5ScriptPokemonCommands(scripts.files[scriptId],'BW2').commands.filter(c =>
      c.entryIndex===entry-1 && ['wild_battle','wild_battle_ex'].includes(c.type) && c.fields.species?.value===species && c.fields.level?.value===level);
    if (matches.length !== 1) { rejected.push({species,reason:'Expected unique wild-battle command not found in bound script entry'}); continue; }
    sources.push({kind:'static',species,headerId,scriptId,entry,level,flagId:flagId??null,captureState:captureState??null,entrance:entrance??null});
  }
  return {sources,rejected};
}

function minimumLevel(species: number, personal: NARC, evolutions: Evolution[]): number {
  if (species === 79) return 10; // Keep an actual route to level-32 Slowking.
  const bst = Array.from(personal.files[species].subarray(0,6)).reduce((a,b)=>a+b,0);
  if (bst >= 520) return 40;
  if (bst >= 480) return 32;
  const incoming = evolutions.filter(e=>e.target===species);
  if (incoming.length && incoming.every(e=>!SAFE_METHODS.has(e.method))) return 28;
  return 2;
}

/** A new land table has 12 native slots and a water table has five. Species repeat in
 * remaining slots to keep each site's common residents common; there is no random seed. */
function makeEncounter(land: number[], water: number[], h: SpeciesHabitat) {
  const bytes = new Uint8Array(SEASON_BYTES);
  bytes[0] = 5;
  if (water.length) bytes[3] = 10;
  for (const [group, ids] of [[0,land],[3,water]] as const) {
    if (!ids.length) continue;
    for (let slot=0; slot<GROUP_COUNTS[group]; slot++) {
      const species = ids[slot % ids.length], offset = GROUP_OFFSETS[group]+slot*4;
      writeU16(bytes,offset,species);
      const min = species===79 ? Math.min(24,h.minLevel) : h.minLevel;
      const max = species===79 ? Math.min(28,h.maxLevel) : h.maxLevel;
      bytes[offset+2]=min; bytes[offset+3]=max;
    }
  }
  return bytes;
}

function installHabitats(encounters: NARC, habitats: SpeciesHabitat[], evolutions: Evolution[], personal: NARC) {
  const planned = closure(PLANNED_STATIC_SPECIES,evolutions).available;
  const incoming = new Set(evolutions.filter(e=>SAFE_METHODS.has(e.method)).map(e=>e.target));
  // One authored Clamperl capture cannot supply both gender branches without breeding.
  // Its coastal repeatable source allows both branches before the original daycare opens.
  const required = Array.from({length:649},(_,i)=>i+1).filter(species => species===366 || (!planned.has(species) && !incoming.has(species)));
  const habitatsSorted = [...habitats].sort((a,b)=>a.encounterId-b.encounterId);
  const pools = new Map(habitatsSorted.map(h=>[h.encounterId,{land:[] as number[],water:[] as number[],biomes:habitatBiomes(h)}]));
  const unplaced: Array<{species:number;reason:string;biome:Biome}> = [];
  // Hardest restrictions first prevents ordinary meadow inhabitants consuming rare water/late slots.
  const ordered = required.sort((a,b)=>Number(AQUATIC.has(b))-Number(AQUATIC.has(a)) || minimumLevel(b,personal,evolutions)-minimumLevel(a,personal,evolutions) || a-b);
  for (const species of ordered) {
    if (LEGENDARY_SPECIES.has(species)) throw new Error(`Legendary ${species} must be a secret battle, never a random habitat`);
    const biome = biomeForSpecies(species), aquatic=AQUATIC.has(species), level=minimumLevel(species,personal,evolutions);
    const candidates = habitatsSorted.filter(h=> {
      const pool=pools.get(h.encounterId)!;
      return pool.biomes.includes(biome) && h.minLevel>=level && (species!==79 || h.minLevel<=30)
        && (aquatic ? countTiles(h.surfTiles)>0 && pool.water.length<5 : pool.land.length<10);
    }).sort((a,b)=> {
      const aa=pools.get(a.encounterId)!,bb=pools.get(b.encounterId)!;
      return (aquatic?aa.water.length-bb.water.length:aa.land.length-bb.land.length) || a.minLevel-b.minLevel || a.encounterId-b.encounterId;
    });
    if (!candidates.length) {
      unplaced.push({species,biome,reason:aquatic?'No matching native surf habitat with spare slots':'No matching level/terrain habitat with spare slots'}); continue;
    }
    const pool=pools.get(candidates[0].encounterId)!;
    (aquatic?pool.water:pool.land).push(species);
  }
  const installed = habitatsSorted.map(h=> {
    const pool=pools.get(h.encounterId)!;
    const filler = pool.biomes.flatMap(b=>BIOME_FILLERS[b]).filter(id=>!AQUATIC.has(id) && !LEGENDARY_SPECIES.has(id));
    const land=[...pool.land];
    for (const id of filler) { if (land.length>=Math.max(4,pool.land.length)) break; if(!land.includes(id)) land.push(id); }
    if (!land.length) throw new Error(`No coherent land species for ${h.areaId}`);
    const water=[...pool.water];
    if (countTiles(h.surfTiles) && !water.length) water.push(pool.biomes.includes('coast')?592:550);
    encounters.files[h.encounterId]=makeEncounter(land,water,h);
    return {headerId:h.headerId,areaId:h.areaId,mapId:h.mapId,encounterId:h.encounterId,biomes:pool.biomes,minLevel:h.minLevel,maxLevel:h.maxLevel,landSpecies:land,surfSpecies:water,encounterTiles:countTiles(h.encounterTiles),surfTiles:countTiles(h.surfTiles)};
  });
  for (let i=135;i<encounters.files.length;i++) if (!encounters.files[i]) throw new Error(`Reserved encounter ${i} missing; provide a contiguous world habitat allocation`);
  return {requiredDirectSpecies:required,installed,unplaced};
}

function readWildSources(encounters: NARC, headers: Uint8Array): WildSource[] {
  const sources: WildSource[]=[];
  for (let encounterId=0;encounterId<encounters.files.length;encounterId++) {
    const bytes=encounters.files[encounterId];
    if (bytes.length!==232 && bytes.length!==928) throw new Error(`Invalid encounter ${encounterId} length ${bytes.length}`);
    const headerIds: number[]=[];
    for(let h=0;h<headers.length/48;h++) if(headers[h*48+20]===encounterId) headerIds.push(h);
    for (let season=0;season<4;season++) {
      const base=bytes.length===232?0:season*232;
      for(let group=0;group<7;group++) {
        if (!bytes[base+group]) continue;
        const bySpecies=new Map<number,{min:number;max:number;chance:number}>();
        for(let slot=0;slot<GROUP_COUNTS[group];slot++) {
          const offset=base+GROUP_OFFSETS[group]+slot*4,species=readU16(bytes,offset)&1023;
          if (species<1 || species>649 || bytes[offset+2]<1 || bytes[offset+3]>100 || bytes[offset+3]<bytes[offset+2]) throw new Error(`Invalid active slot encounter=${encounterId}, season=${season}, group=${group}, slot=${slot}`);
          const row=bySpecies.get(species)??{min:100,max:0,chance:0};
          row.min=Math.min(row.min,bytes[offset+2]);row.max=Math.max(row.max,bytes[offset+3]);row.chance+=(group<3?GRASS_CHANCES:WATER_CHANCES)[slot];bySpecies.set(species,row);
        }
        for(const [species,row] of bySpecies) {
          const match=sources.find(s=>s.encounterId===encounterId && s.group===GROUPS[group] && s.species===species && s.minLevel===row.min && s.maxLevel===row.max && s.probabilityPercent===row.chance);
          if(match) match.seasons.push(season);
          else sources.push({kind:'wild',species,encounterId,headers:headerIds,group:GROUPS[group],seasons:[season],minLevel:row.min,maxLevel:row.max,probabilityPercent:row.chance,expansion:encounterId>=135});
        }
      }
    }
  }
  return sources;
}

/** Apply after applyWorld; mutate owned NitroFS bytes only. Never export or save a ROM.
 * A complete source catalogue is NOT a certificate of collision, script-gate or emulator reachability. */
export function applySpecies(rom: NintendoDSRom, world: SpeciesWorldReport = {}) {
  if (rom.idCode!=='IREO' || rom.data[0x1e]!==0) throw new Error('Species patch requires US Black 2 IREO revision 0');
  const encounterBytes=rom.getFileByName(SPECIES_PATHS.encounters),evolutionBytes=rom.getFileByName(SPECIES_PATHS.evolutions);
  const encounters=new NARC(new Uint8Array(encounterBytes)),evolutions=new NARC(new Uint8Array(evolutionBytes));
  if (encounters.files.length!==135 && encounters.files.length!==203) throw new Error(`Unexpected encounter allocation ${encounters.files.length}`);
  const nativeHashes=encounters.files.slice(0,135).map(sha256);
  const headers=new NARC(rom.getFileByName('a/0/1/2')).files[0];
  if (!headers || headers.length%48) throw new Error('Invalid BW2 header table');
  const habitats=world.habitats??[],bindings=world.staticEncounters??[];
  validateHabitats(headers,habitats);
  const nativeHabitatTerrain=inspectNativeHabitatTerrain(rom,headers,habitats);
  const soloEvolutions=addSoloEvolutions(evolutions);
  const edges=readEvolutions(evolutions);
  const personal=new NARC(rom.getFileByName('a/0/1/6'));
  const habitatReport=installHabitats(encounters,habitats,edges,personal);
  const staticReport=validateStaticSources(rom,headers,bindings);
  const wild=readWildSources(encounters,headers);
  const allSources: AcquisitionSource[]=[...wild,...staticReport.sources];
  // This independent expansion route avoids relying on vanilla postgame areas, rod,
  // daycare, fossils, finite evolution stones or a particular starter choice.
  const offlineSources=allSources.filter(s=>s.kind==='static' || (s.expansion && s.headers.length>0 && s.seasons.length===4 && ['grass','surf'].includes(s.group)));
  const coverage=closure(offlineSources.map(s=>s.species),edges);
  const tableCoverage=closure(allSources.map(s=>s.species),edges);
  const messages=new NARC(rom.getFileByName('a/0/0/2'));
  const names=decodeGen5TextBank(messages.files[90]).map(entry=>entry[1]);
  const acquisition=Array.from({length:649},(_,i)=> {
    const species=i+1,edge=coverage.via.get(species);
    return {species,name:names[species],offlineSourceBound:coverage.available.has(species),preChampionCertified:false,
      sources:offlineSources.filter(s=>s.species===species),
      ...(edge?{evolution:{from:edge.source,method:edge.method,parameter:edge.param,requirements:METHOD_REQUIREMENTS[edge.method],slot:edge.slot}}:{}),
      nativeSources:wild.filter(s=>s.species===species&&!s.expansion),
      plannedSecretOnly:PLANNED_STATIC_SPECIES.has(species)&&!staticReport.sources.some(s=>s.species===species),
    };
  });
  if (nativeHashes.some((hash,i)=>hash!==sha256(encounters.files[i]))) throw new Error('Native encounter table changed');
  const serialized=[{path:SPECIES_PATHS.encounters,before:encounterBytes,after:habitats.length?encounters.save():encounterBytes},{path:SPECIES_PATHS.evolutions,before:evolutionBytes,after:soloEvolutions.length?evolutions.save():evolutionBytes}];
  // Round-trip validation before committing any edits to the caller's object.
  for(const file of serialized) new NARC(file.after);
  const changedFiles=serialized.filter(file=>sha256(file.before)!==sha256(file.after)).map(file=>({path:file.path,fileId:rom.fileId(file.path),beforeSha256:sha256(file.before),afterSha256:sha256(file.after),beforeBytes:file.before.length,afterBytes:file.after.length}));
  for(const file of serialized) if(changedFiles.some(change=>change.path===file.path)) rom.files[rom.fileId(file.path)]=new Uint8Array(file.after);
  const missing=acquisition.filter(row=>!row.offlineSourceBound).map(row=>({species:row.species,name:row.name,plannedSecretOnly:row.plannedSecretOnly}));
  return {
    module:'species',changedFiles,baseEncounterFilesPreserved:135,encounterFiles:encounters.files.length,
    evolutionRecords:evolutions.files.length,soloEvolutions,habitats:habitatReport,nativeHabitatTerrain,
    staticEncounters:{verified:staticReport.sources,rejected:staticReport.rejected,planned:141},
    coverage:{species:649,boundOfflineCatalogue:coverage.available.size,anyTableIgnoringGates:tableCoverage.available.size,
      all649OfflineSourcesBound:coverage.available.size===649,preChampionCertified:false,emulatorValidated:false,missing},
    acquisition,
    limitations:[
      'Header, encounter and wild-battle operands are verified against actual ROM bytes. Full campaign prerequisites, warps, event dispatch, capture retries and post-loss flags require independent world/script and emulator validation.',
      'All new ordinary encounters use one season-independent record. Native seasonal tables remain unchanged; no new source relies on fishing, breeding, online features, dates, trade items or stone supply.',
      'Surf sources require a usable Surf Pokemon and the pre-Champion Surf acquisition path. Surf collision and shore accessibility are asserted by the world report, not certified here.',
      'Friendship, gender, Tyrogue stat branches, Wurmple personality branches and Shedinja empty-party/Poke-Ball conditions remain native offline mechanics. Cancel Slowking at level 32 to retain the Slowbro branch at level 37.',
      'Content JSON and planned secret requests never count as integrated acquisition sources. Unbound static species and their descendants remain in missing.',
    ],
  };
}
