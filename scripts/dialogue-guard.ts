import { NARC } from "../vendor/pokeweb-serverless/src/nds/narc";
import { decodeGen5TextBank } from "../vendor/pokeweb-serverless/src/pokeweb/text";
import { createHash } from "node:crypto";

export type Difference = { bank: number; entry: string; reason: string };
export type ApprovedTextChange = {
  bank: number; entry: string; before_sha256: string; after_sha256: string; reason: string;
};
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// Compare decoded entries at their original positions, including formatting and
// control tokens. Encryption seeds may change when an archive is rebuilt.
// New banks/entries are permitted only after all original entries are retained.
export function compareTextArchives(beforeBytes: Uint8Array, afterBytes: Uint8Array, approvals: ApprovedTextChange[] = []) {
  const approvalMap = new Map<string, ApprovedTextChange>();
  for (const approval of approvals) {
    if (!Number.isInteger(approval.bank) || approval.bank < 0 || !/^\d+_\d+[A-Pc]*$/.test(approval.entry)
      || !/^[0-9a-f]{64}$/.test(approval.before_sha256) || !/^[0-9a-f]{64}$/.test(approval.after_sha256)
      || typeof approval.reason !== "string" || !approval.reason.trim()) throw new Error("Invalid exact text-change approval");
    const key = `${approval.bank}:${approval.entry}`;
    if (approvalMap.has(key)) throw new Error(`Duplicate text-change approval: ${key}`);
    approvalMap.set(key, approval);
  }
  const before = new NARC(beforeBytes);
  const after = new NARC(afterBytes);
  const differences: Difference[] = [];
  const approvedDifferences: Difference[] = [];
  const consumed = new Set<string>();
  let originalEntries = 0;
  let addedEntries = 0;
  for (let bank = 0; bank < before.files.length; bank++) {
    const original = decodeGen5TextBank(before.files[bank]);
    originalEntries += original.length;
    if (!after.files[bank]) {
      differences.push({ bank, entry: "*", reason: "original bank removed" });
      continue;
    }
    const updated = decodeGen5TextBank(after.files[bank]);
    const byId = new Map(updated.map(entry => [entry[0], entry[1]]));
    for (const [id, text] of original) {
      if (!byId.has(id)) differences.push({ bank, entry: id, reason: "original entry or flags removed" });
      else if (byId.get(id) !== text) {
        const key = `${bank}:${id}`, approval = approvalMap.get(key);
        if (approval && approval.before_sha256 === digest(text) && approval.after_sha256 === digest(byId.get(id)!)) {
          consumed.add(key);
          approvedDifferences.push({ bank, entry: id, reason: approval.reason });
        } else differences.push({ bank, entry: id, reason: "original text changed" });
      }
    }
    const originalIds = new Set(original.map(entry => entry[0]));
    addedEntries += updated.filter(entry => !originalIds.has(entry[0])).length;
  }
  for (let bank = before.files.length; bank < after.files.length; bank++) {
    addedEntries += decodeGen5TextBank(after.files[bank]).length;
  }
  const unusedApprovals = [...approvalMap.keys()].filter(key => !consumed.has(key));
  return { originalBanks: before.files.length, originalEntries, addedEntries, differences, approvedDifferences, unusedApprovals };
}
