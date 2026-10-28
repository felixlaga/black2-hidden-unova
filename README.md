# Pokémon Black 2: Hidden Unova — working project

This private repository contains original expansion authoring data, a dialogue-preservation check, and the user-supplied US Black 2 base ROM through Git LFS. **The expansion is DESIGN ONLY: no modified ROM or playable expansion exists, and all-649 availability is not implemented.** No emulator playthrough or Nintendo hardware test has been performed.

Confirmed scope: Black 2; make all 649 Generation 1–5 species obtainable in one save; a much larger connected map; moderately tougher ordinary trainers and a much tougher Elite Four/Champion. **N replaces Iris as Champion**, with N and Alder appearing throughout the expanded story. Victini, Keldeo and Darkrai receive permanent quest encounters.

The enlarged design target is **24 new settlements across four connected regions, 12 additional Gyms, and 96 secret areas**, alongside the original Unova locations and eight Gyms. These counts describe authored plans, not verified engine capacity or implemented game maps. Additional Gym progression requires its own implementation; vanilla badge storage is not assumed to expand automatically.

**Everything belongs to the main adventure.** The original eight and new twelve Gyms form one 20-Gym campaign before N's final battle. All areas, all 649 Pokémon, unique items, upgrades and facilities must be accessible before becoming Champion. Ordinary exploration/story/Gym prerequisites remain. This requires migrating original Black 2 endgame barriers too. The postgame is a sages search and rematches through already accessible places, without exclusive collectible rewards. See `config/campaign.json`.

The user explicitly approved rewriting only the original lines needed for N's Champion role and N/Alder story continuity. Preserve every other original line and add original dialogue in the same concise Pokémon style. Exact rewritten entries still require inspection of the supplied base ROM and an explicit exact-change manifest.

## What is here

- `vendor/pokeweb-serverless/`: ignored upstream browser editor, restored by bootstrap from the source and commit in `toolchain-lock.json`. It is an editing tool, not the game.
- `roms/pokemon-black2-us.nds`: user-supplied base ROM stored through Git LFS in this private repository.
- `tools/ctrmap/CTRMap.jar` and `CTRMapV.jar`: optional ignored map editor and Gen 5 plugin. These prereleases were downloaded locally but have not been launched on this Mac; a fresh clone does not include them.
- `content/expansion.json` and `design/expansion.md`: original design data. New map resources, engine IDs, event flags, and game script bindings still need implementation.
- `content/world-map.json`: proposed connected travel graph, regions and extra Gyms.
- `content/story.json` and `design/story.md`: N/Alder story chapters and permanent Victini, Keldeo and Darkrai quests.
- `config/difficulty.json`: proposed trainer/League balancing, not applied to a ROM.
- `config/campaign.json`: main-campaign access invariant and base-content migration requirements.
- `config/dialogue-policy.json`: the user's narrow story-rewrite scope, with no actual original entries approved yet.
- `scripts/check-dialogue.ts`: read-only comparison of original versus modified Black 2 text archives.
- `DOWNLOADS.md`: author-maintained editing projects across generations.
- `HARDWARE.md`: 3DS XL playback and cartridge-dumping prerequisites.

## Clone and bootstrap

Prerequisites: access to the private `felixlaga/black2-hidden-unova` repository, Git with Git LFS available, Python 3.9+, and Node.js 22+ with npm. Bootstrap installs no system tools. Use a fresh directory:

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone git@github.com:felixlaga/black2-hidden-unova.git
cd black2-hidden-unova
git lfs install --local
git lfs pull
git lfs fsck
npm run setup:tools
npm run dev
```

Bootstrap reads `toolchain-lock.json`, fetches the exact editor commit into ignored `vendor/pokeweb-serverless/`, and runs `npm ci --ignore-scripts --no-audit --no-fund --cache` with the project-local `.cache/npm` directory. It refuses an unrelated, changed, or differently pinned checkout and preserves existing `node_modules`. A failed download is left for inspection; the script does not remove files. To validate an existing installation without installing or changing anything:

```sh
npm run setup:tools -- --check
```

Open <http://127.0.0.1:5178/> and select `roms/pokemon-black2-us.nds` in the upload interface. The editor listens on loopback. Loading and exporting this ROM in the browser remain unverified.

CTRMap is optional and installed manually: download each entry in `toolchain-lock.json` under `downloads` from its exact `source` to its recorded `file`, then verify its `size_bytes` and `sha256`. Do not replace existing files. These JARs are not required for the browser editor or dialogue checks.

## Supplied base ROM

The user supplied **US English Pokémon Black 2**, game code **`IREO`**, revision **0**. The original input is stored at `roms/pokemon-black2-us.nds` through Git LFS (512 MiB / 536,870,912 bytes). Its SHA-256 is:

```text
39a661636de026b7b8a5b1db0f5a2cbcd1ae449633b2c11c5c94f610666b0a99
```

Verify the downloaded bytes on macOS with `shasum -a 256 roms/pokemon-black2-us.nds`. A small text file beginning with `version https://git-lfs.github.com/spec/v1` is an LFS pointer; `git lfs pull` must retrieve the actual ROM before use. The recorded hash identifies the supplied input; a known-clean reference match has not been established.

Keep modified game images and saves in ignored `private/`; preserve the tracked base input unchanged. An original cartridge remains separate from a flash cartridge that can run a future modified result. No flashcart has been selected or hardware compatibility certified.

## First implementation steps

1. Inspect the supplied base. Export it without intentional edits, reload it, and establish an emulator and hardware baseline.
2. Apply one representative trainer change, then test a complete battle and save/reload. Map League records by inspected game data; do not guess trainer IDs.
3. Implement the authored first hidden-area quest with independent map/script/text resources, working entrance and exit, persistent quest state, and a repeatable chance to catch the rare encounter if it is defeated.
4. Compare original dialogue after every export, permitting only explicitly recorded N/Alder continuity changes. Also verify original NPC/script references: identical text entries alone do not prove that the right NPC still says them.
5. Audit all 649 species through a reachable wild encounter, gift, static encounter, breeding, or an available evolution. Add solo alternatives to trade-only and event-only requirements. An availability target is not yet an audited result.
6. Expand to the remaining towns and stories only after the first added map works on the target hardware. The town counts are design targets, not proven engine capacity.
7. Produce a version-specific patch and an installation note. Test the patched output independently, including League completion and hardware saves.

## Dialogue check

```sh
npm run test:dialogue
npm run check:dialogue -- /absolute/original.nds /absolute/modified.nds
npm run check:dialogue -- /absolute/original.nds /absolute/modified.nds --approved /absolute/exact-changes.json
```

By default, the guard permits appended text while rejecting removal or changes to original entries, formatting/control tokens, and stored entry flags at their original bank positions. An optional exact-change manifest must contain `original_rom_sha256` and a `changes` array. Each change requires `archive` (`messages` or `story`), `bank`, `entry`, `before_sha256`, `after_sha256`, and a nonempty `reason`. Text hashes are SHA-256 over the decoded UTF-8 text. Wildcards, duplicate exceptions, wrong hashes, or unused exceptions fail validation. Entry deletion and changed flags remain prohibited. The scope-policy file is deliberately not a usable exact-change manifest.

The guard reads both ROMs without writing either. It reports locations and hashes rather than printing the game's dialogue. It checks both BW2 message and story archives and distinguishes complete original-text preservation from preservation with approved changes.

The synthetic tests cover unchanged content, additions, modifications, deletions, index shifts, flags, missing banks, invalid archives, exact approved changes, and mismatched/stale/wildcard exceptions. **Synthetic tests do not validate a real Pokémon ROM, quest, or hardware save.** The guard relies on the pinned upstream text decoder; raw engine behavior and rendering remain separate checks.

## Current evidence

- Browser editor source and local dependencies downloaded; Vite starts on port 5178.
- T3 navigation and a subsequent direct DOM read confirmed the editor's ROM-upload interface with its `.nds` input and no Vite error overlay. Both screenshot/snapshot attempts timed out and no fallback browser was available. ROM loading and game-editing interactions are not verified.
- CTRMap downloads recorded with versions, file sizes, and SHA-256 hashes.
- Dialogue guard passed synthetic preservation and exact-exception checks.
- A read-only comparison of the supplied ROM against itself decoded 495 message banks / 66,993 entries and 676 story banks / 13,089 entries with zero differences. This establishes baseline decoding only; no edited export/reload or gameplay was tested.
- No modified ROM, playable expansion build, emulator playthrough, cartridge write, or console test performed. All-649 availability remains a design requirement.

These tools are third-party community projects, not Nintendo products. Preserve their notices and authorship. The original content here is provisional until it has been integrated and played.
