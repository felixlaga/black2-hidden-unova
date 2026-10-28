import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../vendor/pokeweb-serverless/src/nds/rom";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2).filter(arg => arg !== "--");
const baseline = args.includes("--baseline");
const outIndex = args.indexOf("--out");
const output = resolve(outIndex >= 0 ? args[outIndex + 1] : baseline ? "build/baseline.nds" : "build/black2-hidden-unova.nds");
const basePath = resolve("roms/pokemon-black2-us.nds");
if (output === basePath) throw new Error("The original base ROM cannot be overwritten");
const lock = JSON.parse(readFileSync("toolchain-lock.json", "utf8"));
const source = readFileSync(basePath);
const inputHash = sha256(source);
if (inputHash !== lock.base_rom.sha256) throw new Error("Base ROM SHA-256 differs from the pinned input");
const rom = new NintendoDSRom(source, { fileData: "view" });
if (rom.idCode !== "IREO" || source[0x1e] !== 0) throw new Error("Expected US Black 2 revision 0");
const beforeFiles = rom.files.map(sha256);
const beforeArm9 = sha256(rom.arm9);
const beforeArm7 = sha256(rom.arm7);
let reports: Record<string, unknown> = {};
let dialogue: unknown[] = [];
let approvedDialogueChanges: unknown[] = [];
if (!baseline) {
  const { applyExpansion } = await import("./rom/build");
  const assembled = await applyExpansion(rom);
  reports = assembled.modules;
  dialogue = assembled.dialogue;
  approvedDialogueChanges = assembled.approvedDialogueChanges;
}
if (sha256(source) !== inputHash) throw new Error("A build module mutated borrowed base-ROM bytes; copy before editing");
console.log(`Exporting ${baseline ? "unchanged baseline" : "modified ROM"} with DSi data preserved...`);
const bytes = rom.save({ preserveOriginalLength: true });
const reloaded = new NintendoDSRom(bytes, { fileData: "view" });
if (reloaded.idCode !== rom.idCode || reloaded.files.length !== rom.files.length) throw new Error("Export/reload changed file inventory");
for (let index = 0; index < rom.files.length; index++) {
  if (sha256(reloaded.files[index]) !== sha256(rom.files[index])) throw new Error(`Export/reload changed NitroFS file ${index}`);
}
if (sha256(reloaded.arm9) !== sha256(rom.arm9) || sha256(reloaded.arm7) !== sha256(rom.arm7)) throw new Error("Export/reload changed executable sections");
const changedFileIds = rom.files.flatMap((file, index) => beforeFiles[index] === sha256(file) ? [] : [index]);
if (baseline && (changedFileIds.length || sha256(rom.arm9) !== beforeArm9 || sha256(rom.arm7) !== beforeArm7)) throw new Error("Baseline unexpectedly changed game resources");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, bytes);
const report = {
  kind: baseline ? "unchanged_export_baseline" : "development_build",
  baseSha256: inputHash,
  outputSha256: sha256(bytes),
  outputBytes: bytes.length,
  gameCode: reloaded.idCode,
  fileCount: reloaded.files.length,
  changedFileIds,
  arm9Changed: sha256(rom.arm9) !== beforeArm9,
  arm7Changed: sha256(rom.arm7) !== beforeArm7,
  exportReloadFileEquality: true,
  emulatorTested: false,
  hardwareTested: false,
  dialogue,
  modules: reports,
};
writeFileSync(output.replace(/\.nds$/i, "") + ".json", JSON.stringify(report, null, 2) + "\n");
if (!baseline) writeFileSync(output.replace(/\.nds$/i, "") + ".dialogue-approvals.json", JSON.stringify({
  original_rom_sha256: inputHash, changes: approvedDialogueChanges,
}, null, 2) + "\n");
console.log(JSON.stringify({ output, ...report, modules: Object.keys(reports) }, null, 2));
