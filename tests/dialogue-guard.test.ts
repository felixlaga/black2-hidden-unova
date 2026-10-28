import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { NARC } from "../vendor/pokeweb-serverless/src/nds/narc";
import { encodeGen5TextBank, type Gen5TextEntry } from "../vendor/pokeweb-serverless/src/pokeweb/text";
import { compareTextArchives } from "../scripts/dialogue-guard";

function archive(banks: Gen5TextEntry[][]) {
  const result = new NARC();
  result.files = banks.map(encodeGen5TextBank);
  return result.save();
}
// These are original synthetic lines, not text extracted from a Pokémon ROM.
const base: Gen5TextEntry[][] = [[['0_0', 'The old bell is quiet.', 0], ['0_1', 'Try the path by the pond!', 0]]];
const original = archive(base);
assert.equal(compareTextArchives(original, original).differences.length, 0);
const appended = structuredClone(base);
appended[0].push(['0_2', 'I found a little footprint!', 0]);
appended.push([['0_0', 'This is a new place.', 0]]);
const additions = compareTextArchives(original, archive(appended));
assert.equal(additions.differences.length, 0);
assert.equal(additions.originalEntries, 2);
assert.equal(additions.addedEntries, 2);
const changed = structuredClone(base);
changed[0][0][1] = 'The old bell is loud.';
assert.equal(compareTextArchives(original, archive(changed)).differences[0].reason, 'original text changed');
const removed = structuredClone(base);
removed[0].pop();
assert.equal(compareTextArchives(original, archive(removed)).differences[0].reason, 'original entry or flags removed');
const shifted = structuredClone(base);
shifted[0] = [['0_0', 'A new line inserted at the front.', 0], ['0_1', base[0][0][1], 0], ['0_2', base[0][1][1], 0]];
assert.equal(compareTextArchives(original, archive(shifted)).differences.length, 2);
const flagged = structuredClone(base);
flagged[0][0][0] = '0_0A';
assert.equal(compareTextArchives(original, archive(flagged)).differences[0].reason, 'original entry or flags removed');
assert.equal(compareTextArchives(original, archive([])).differences[0].reason, 'original bank removed');
assert.throws(() => compareTextArchives(original, new Uint8Array([0, 1, 2, 3])));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const approval = {bank:0, entry:'0_0', before_sha256:hash(base[0][0][1]), after_sha256:hash(changed[0][0][1]), reason:'Exact approved story continuity change'};
const approved = compareTextArchives(original, archive(changed), [approval]);
assert.equal(approved.differences.length,0);
assert.equal(approved.approvedDifferences.length,1);
assert.deepEqual(approved.unusedApprovals,[]);
assert.equal(compareTextArchives(original, archive(changed), [{...approval,before_sha256:hash('Wrong original')}]).differences.length,1);
assert.equal(compareTextArchives(original, archive(changed), [{...approval,after_sha256:hash('Different unapproved rewrite')}]).differences.length,1);
assert.equal(compareTextArchives(original, original, [approval]).unusedApprovals.length,1);
assert.throws(()=>compareTextArchives(original, archive(changed),[approval,approval]),/Duplicate/);
assert.throws(()=>compareTextArchives(original, archive(changed),[{...approval,entry:'*'}]),/Invalid/);
console.log('Dialogue guard: synthetic preservation and exact-exception checks passed. No game ROM or hardware tested.');
