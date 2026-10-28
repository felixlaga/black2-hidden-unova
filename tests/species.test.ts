import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { NintendoDSRom } from '../vendor/pokeweb-serverless/src/nds/rom';
import { NARC } from '../vendor/pokeweb-serverless/src/nds/narc';
import { readU16, writeU16, writeU32 } from '../vendor/pokeweb-serverless/src/nds/binary';
import { materializeGen5MatrixFile } from '../vendor/pokeweb-serverless/src/pokeweb/gen5MatrixModel';
import { extractGameFreakContainer, packGameFreakContainer } from '../vendor/pokeweb-serverless/src/pokeweb/map3dModel';
import { applySpecies, SPECIES_PATHS, SUPPLEMENTAL_SECRET_VISITORS, type SpeciesWorldReport, type SpeciesHabitat, type SpeciesStaticBinding } from '../scripts/rom/species';
import expansion from '../content/expansion.json';
import story from '../content/story.json';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const source=readFileSync('roms/pokemon-black2-us.nds');
const expected='39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99';
assert.equal(digest(source),expected,'Tests require pinned IREO revision0 base');
const rom=new NintendoDSRom(source,{fileData:'view'});
const originalFiles=[...rom.files];
const originalEvolution=new NARC(new Uint8Array(rom.getFileByName(SPECIES_PATHS.evolutions)));
const report=applySpecies(rom);
assert.equal(digest(source),expected,'Borrowed Buffer input must not be edited');
assert.equal(digest(rom.data),expected,'ROM source comparison bytes must stay immutable');
assert.equal(report.soloEvolutions.length,22);
assert.deepEqual(report.changedFiles.map(f=>f.path),[SPECIES_PATHS.evolutions]);
assert.equal(report.coverage.boundOfflineCatalogue,0,'Unintegrated design is never acquisition evidence');
assert.equal(report.coverage.missing.length,649);
assert.equal(report.staticEncounters.verified.length,0);
assert.equal(report.coverage.preChampionCertified,false);
for(let id=0;id<rom.files.length;id++) if(id!==rom.fileId(SPECIES_PATHS.evolutions)) assert.equal(rom.files[id],originalFiles[id],`Unowned file ${id} must retain original object`);
assert.notEqual(rom.files[rom.fileId(SPECIES_PATHS.evolutions)].buffer,source.buffer);
const patchedEvolutions=new NARC(new Uint8Array(rom.getFileByName(SPECIES_PATHS.evolutions)));
assert.equal(patchedEvolutions.files.length,709);
for(let id=0;id<709;id++) {
  const before=originalEvolution.files[id],after=patchedEvolutions.files[id];
  assert.equal(after.length,before.length);
  for(let offset=0;offset+6<=before.length;offset+=6) if(readU16(before,offset)!==0) assert.deepEqual(after.slice(offset,offset+6),before.slice(offset,offset+6),`Native evolution ${id}:${offset/6} must be retained`);
  if(!report.soloEvolutions.some(e=>e.source===id)) assert.deepEqual(after,before);
}
// These are engine-selection predicates, not an emulator simulation. Test branch
// shadowing: Slowking must be available before the earlier ordinary Slowbro slot.
function soloTarget(species:number,level:number,male=true){
  const bytes=patchedEvolutions.files[species];
  for(let i=0;i<7;i++) { const method=readU16(bytes,i*6),threshold=readU16(bytes,i*6+2); if(level>=threshold&&(method===4||(method===23&&male)||(method===24&&!male))) return readU16(bytes,i*6+4); }
  return null;
}
assert.equal(soloTarget(79,31),null);assert.equal(soloTarget(79,32),199);assert.equal(soloTarget(79,37),80);
assert.equal(soloTarget(366,35,true),367);assert.equal(soloTarget(366,35,false),368);
assert.equal(soloTarget(64,36),null);assert.equal(soloTarget(64,37),65);
assert.equal(soloTarget(588,37),589);assert.equal(soloTarget(616,37),617);
assert.equal(applySpecies(rom).changedFiles.length,0,'Reapplying is byte-idempotent');

/** Synthetic appended headers/scripts exercise the module contract against actual
 * pinned base data. No maps/events are installed here; this is NOT a playable world. */
function syntheticWorld(): SpeciesWorldReport {
  const headerArchive=new NARC(new Uint8Array(rom.getFileByName('a/0/1/2')));
  const scriptArchive=new NARC(new Uint8Array(rom.getFileByName('a/0/5/6')));
  const matrices=new NARC(new Uint8Array(rom.getFileByName('a/0/0/9')));
  const maps=new NARC(new Uint8Array(rom.getFileByName('a/0/0/8')));
  // Synthetic terrain permission fixture using a real map container/model. It
  // intentionally does not assert visual correspondence or playable connectivity.
  const donor=extractGameFreakContainer(maps.files[54]);
  const terrain=new Uint8Array(4+32*32*8);writeU16(terrain,0,32);writeU16(terrain,2,32);
  for(let tile=0;tile<1024;tile++) { writeU16(terrain,4+tile*8+2,3);writeU16(terrain,4+tile*8+4,tile===0?63:4);writeU16(terrain,4+tile*8+6,tile===0?22:36); }
  const mapId=maps.files.length;maps.files.push(packGameFreakContainer('WB',[donor.files[0],terrain,donor.files[2]]));
  const headers=new Uint8Array((615+68+141)*48);
  headers.set(headerArchive.files[0]);
  const biomes=['meadow','woodland','wetland','coast','quarry','cavern','workshop','highland','frost','ruins'];
  const habitats: SpeciesHabitat[]=Array.from({length:68},(_,i)=> {
    const headerId=615+i,encounterId=135+i,theme=biomes[i%10];
    headers.set(headerArchive.files[0].subarray(331*48,332*48),headerId*48);
    headers[headerId*48+20]=encounterId;
    const matrixId=matrices.files.length;matrices.files.push(materializeGen5MatrixFile({width:1,height:1,matrix_flags:1,footer_length:0,map_0:mapId,header_0:headerId},new Uint8Array()));
    writeU16(headers,headerId*48+4,matrixId);
    return {headerId,encounterId,mapId,areaId:`synthetic.${theme}.${i}`,theme,minLevel:i<30?12:45,maxLevel:i<30?18:49,encounterTiles:[{x:3,z:3}],surfTiles:['coast','wetland'].includes(theme)?[{x:0,z:0}]:[]};
  });
  const visitors=[
    ...expansion.hidden_areas.map(a=>({species:a.encounter.national_dex_id,level:a.encounter.level})),
    ...story.secret_quests.map(q=>({species:q.national_dex_id,level:q.proposed_level})),
    ...SUPPLEMENTAL_SECRET_VISITORS,
  ];
  assert.equal(visitors.length,141);
  const staticEncounters: SpeciesStaticBinding[]=visitors.map((v,i)=> {
    const headerId=615+68+i,scriptId=scriptArchive.files.length;
    // One entry, native relative pointer and terminator; CallWildBattleEx + End.
    const script=new Uint8Array(18);writeU32(script,0,2);writeU16(script,4,0xfd13);
    writeU16(script,6,0x297);writeU16(script,8,v.species);writeU16(script,10,v.level);writeU16(script,12,0);writeU16(script,14,0x101);writeU16(script,16,2);
    scriptArchive.files.push(script);
    headers.set(headerArchive.files[0].subarray(331*48,332*48),headerId*48);writeU16(headers,headerId*48+6,scriptId);headers[headerId*48+20]=255;
    return {headerId,scriptId,entry:1,species:v.species,level:v.level,flagId:3000+i,entrance:{synthetic:true,reachable:false}};
  });
  headerArchive.files[0]=headers;
  rom.files[rom.fileId('a/0/1/2')]=new Uint8Array(headerArchive.save());
  rom.files[rom.fileId('a/0/5/6')]=new Uint8Array(scriptArchive.save());
  rom.files[rom.fileId('a/0/0/9')]=new Uint8Array(matrices.save());
  rom.files[rom.fileId('a/0/0/8')]=new Uint8Array(maps.save());
  return {habitats,staticEncounters};
}
const world=syntheticWorld();
const beforeFailure=[...rom.files];
const bad=structuredClone(world);bad.habitats![0].encounterId=134;
assert.throws(()=>applySpecies(rom,bad),/Invalid\/duplicate/);
assert.deepEqual(rom.files,beforeFailure,'Invalid contract must fail before any caller mutation');
const fakeTerrain=structuredClone(world);fakeTerrain.habitats![0].mapId=0;
assert.throws(()=>applySpecies(rom,fakeTerrain),/does not belong/,'Reported tiles must be linked through the actual header/matrix/map');
const afterWorldFiles=[...rom.files];
const full=applySpecies(rom,world);
assert.equal(full.habitats.installed.length,68);
assert.deepEqual(full.habitats.unplaced,[],'All ordinary family roots need a themed source');
assert.equal(full.staticEncounters.verified.length,141);
assert.equal(full.staticEncounters.rejected.length,0);
assert.equal(full.coverage.boundOfflineCatalogue,649);
assert.deepEqual(full.coverage.missing,[]);
assert.equal(full.coverage.preChampionCertified,false,'Even complete synthetic source tables do not prove reachability');
assert.equal(full.coverage.emulatorValidated,false);
assert.equal(full.encounterFiles,203);
for(let id=0;id<rom.files.length;id++) if(id!==rom.fileId(SPECIES_PATHS.encounters)) assert.equal(rom.files[id],afterWorldFiles[id],`Unowned world file ${id} changed`);
const beforeEncounters=new NARC(new Uint8Array(originalFiles[rom.fileId(SPECIES_PATHS.encounters)]));
const afterEncounters=new NARC(new Uint8Array(rom.getFileByName(SPECIES_PATHS.encounters)));
for(let id=0;id<135;id++)assert.deepEqual(afterEncounters.files[id],beforeEncounters.files[id],`Native habitat ${id} changed`);
for(let id=135;id<203;id++)assert.equal(afterEncounters.files[id].length,232,'One record supplies all seasons');
for(const h of full.habitats.installed) {
  assert.ok(h.landSpecies.length<=12);assert.ok(h.surfSpecies.length<=5);
  assert.ok(!h.surfSpecies.length||h.surfTiles>0);
}
const clamperl=full.acquisition[365];assert.ok(clamperl.sources.some(s=>s.kind==='wild'&&s.group==='surf'));
const slowpoke=full.acquisition[78];assert.ok(slowpoke.sources.some(s=>s.kind==='wild'&&s.maxLevel<32));
assert.equal(applySpecies(rom,world).changedFiles.length,0);
const missingBinding=structuredClone(world);missingBinding.staticEncounters=missingBinding.staticEncounters!.filter(s=>s.species!==494);
const absent=applySpecies(rom,missingBinding);assert.ok(absent.coverage.missing.some(s=>s.species===494),'Unreported scripted source must not count');
const mismatched=structuredClone(world);mismatched.staticEncounters!.find(s=>s.species===494)!.level++;
const rejected=applySpecies(rom,mismatched);assert.ok(rejected.staticEncounters.rejected.some(s=>s.species===494));assert.ok(rejected.coverage.missing.some(s=>s.species===494));
assert.equal(digest(rom.data),expected);
assert.equal(digest(readFileSync('roms/pokemon-black2-us.nds')),expected);
mkdirSync('build/research-species',{recursive:true});
writeFileSync('build/research-species/synthetic-contract-report.json',JSON.stringify(full,null,2));
console.log('Species: pinned-ROM ownership, 22 solo evolution alternatives, all original habitats, 68 synthetic habitat bindings, 141 synthetic static bindings, 649-source graph, missing/rejected binding and idempotence checks passed. No campaign/emulator reachability claim.');
