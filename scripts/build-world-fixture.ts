import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { NintendoDSRom } from "../vendor/pokeweb-serverless/src/nds/rom";
import { NARC } from "../vendor/pokeweb-serverless/src/nds/narc";
import { readU16, readU32 } from "../vendor/pokeweb-serverless/src/nds/binary";
import { installMapCameraTestWarp } from "../vendor/pokeweb-serverless/src/pokeweb/mapCameraTest";
import { applyWorld, WORLD_FIRST_ZONE } from "./rom/world";

const sourceIndex = process.argv.indexOf("--source");
const sourcePath = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "roms/pokemon-black2-us.nds";
if (!sourcePath) throw new Error("--source requires a built ROM path");
const sourceBytes = readFileSync(sourcePath);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const rom = new NintendoDSRom(sourceBytes, { fileData: "view" });
if (rom.idCode !== "IREO" || sourceBytes[0x1e] !== 0) throw new Error("QA fixture requires US Black 2 revision 0");
const probe = process.argv[3] ?? "geometry";
const report = sourceIndex >= 0 ? { reusedBuiltSource: sourcePath, sourceSha256 }
  : probe === "full" ? await (await import("./rom/build")).applyExpansion(rom)
  : applyWorld(rom, { probe: probe as NonNullable<Parameters<typeof applyWorld>[1]>["probe"] });
const saveIndex = process.argv.indexOf("--save");
const savePath = saveIndex >= 0 ? process.argv[saveIndex + 1] : "vendor/pokeweb-serverless/src/assets/testbattle/test.sav";
if (!savePath) throw new Error("--save requires an isolated QA save path");
const save = readFileSync(savePath);
if (save.length !== 524288) throw new Error("QA fixture requires a raw 512 KiB save");
const origin = { zoneId: readU32(save, 0x19580), gridX: readU16(save, 0x19586), gridY: readU16(save, 0x1958a), gridZ: readU16(save, 0x1958e) };
const headers = new NARC(new Uint8Array(rom.getFileByName("a/0/1/2"))).files[0];
const scripts = new NARC(new Uint8Array(rom.getFileByName("a/0/5/6")));
const events = new NARC(new Uint8Array(rom.getFileByName("a/1/2/6")));
const scriptId = readU16(headers, origin.zoneId*48+6), eventId = readU16(headers, origin.zoneId*48+22);
const zoneId = Number(process.argv[2] ?? WORLD_FIRST_ZONE);
const tileX = Number(process.argv[4] ?? 15), tileZ = Number(process.argv[5] ?? 26);
const fixture = installMapCameraTestWarp(scripts.files[scriptId], events.files[eventId], origin,
  { zoneId, tileX, tileZ, height: 0, facing: "up" });
scripts.files[scriptId] = fixture.scripts;
events.files[eventId] = fixture.events;
rom.files[rom.fileId("a/0/5/6")] = scripts.save();
rom.files[rom.fileId("a/1/2/6")] = events.save();
mkdirSync("build", { recursive: true });
const base = `build/world-${probe}${probe === "full" ? `-${zoneId}` : ""}`;
writeFileSync(base+".nds", rom.save({ preserveOriginalLength: true }));
writeFileSync(base+".sav", save);
writeFileSync(base+".json", JSON.stringify({ fixtureOnly: true, sourcePath, sourceSha256, savePath, origin, scriptId, eventId, zoneId, world: report }, null, 2));
console.log(JSON.stringify({ fixtureOnly: true, base, origin, scriptId, eventId, zoneId }));
