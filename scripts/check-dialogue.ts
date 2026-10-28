import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../vendor/pokeweb-serverless/src/nds/rom";
import { compareTextArchives, type ApprovedTextChange } from "./dialogue-guard";

const args = process.argv.slice(2).filter(arg => arg !== "--");
if (!(args.length === 2 || (args.length === 4 && args[2] === "--approved"))) {
  console.error("Usage: npm run check:dialogue -- /absolute/original.nds /absolute/modified.nds [--approved /absolute/exact-changes.json]");
  process.exit(2);
}
try {
  const inputs = args.slice(0, 2).map(path => {
    const bytes = readFileSync(path);
    const rom = new NintendoDSRom(bytes, { fileData: "view" });
    if (rom.idCode !== "IREO") throw new Error(`Expected US English Black 2 (IREO), got ${rom.idCode}. Do not apply a different region's assumptions.`);
    return { bytes, rom, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  const approved: { archive: string; change: ApprovedTextChange }[] = [];
  if (args[3]) {
    const manifest = JSON.parse(readFileSync(args[3], "utf8"));
    if (manifest.original_rom_sha256 !== inputs[0].sha256) throw new Error("Approved changes must be pinned to this exact original ROM SHA-256");
    if (!Array.isArray(manifest.changes)) throw new Error("Approved changes require a changes array");
    for (const change of manifest.changes) {
      if (!["messages", "story"].includes(change.archive)) throw new Error("Unknown text archive in approved changes");
      approved.push({ archive: change.archive, change });
    }
  }
  const archives = [
    { kind: "messages", path: "a/0/0/2" },
    { kind: "story", path: "a/0/0/3" },
  ].map(({ kind, path }) => ({ kind, path, ...compareTextArchives(inputs[0].rom.getFileByName(path), inputs[1].rom.getFileByName(path), approved.filter(item => item.archive === kind).map(item => item.change)) }));
  const passed = archives.every(archive => archive.differences.length === 0 && archive.unusedApprovals.length === 0);
  const allOriginalTextPreserved = archives.every(archive => archive.differences.length === 0 && archive.approvedDifferences.length === 0);
  console.log(JSON.stringify({ originalSha256: inputs[0].sha256, modifiedSha256: inputs[1].sha256, allOriginalTextPreserved, preservesTextExceptExactApprovedChanges: passed, archives, scope: "Decoded original text entries and control tokens at original archive/bank/entry locations; optional exact hash-pinned story changes. Does not prove NPC/script references, font rendering, game behavior, or hardware compatibility.", romFilesWritten: false }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
