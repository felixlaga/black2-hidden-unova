# Pokémon Black 2: Hidden Unova — working project

This private repository contains the expansion implementation, original authoring data, and the user-supplied US Black 2 base ROM through Git LFS. **A playable development candidate and verified BPS patch are available.** Trainer, campaign, world, story, access, and species modules have real-ROM checks. New towns, interiors, and battles run in the emulator. A complete campaign playthrough and physical 3DS XL test remain unverified.

Confirmed scope: Black 2; make all 649 Generation 1–5 species obtainable in one save; a much larger connected map; moderately tougher ordinary trainers and a much tougher Elite Four/Champion. **N replaces Iris as Champion**, with N and Alder appearing throughout the expanded story. Victini, Keldeo and Darkrai receive permanent quest encounters.

The native build allocates **24 new settlements across four regions, 40 routes, 12 additional Gyms, 96 secret areas, four sewer areas, and 48 furnished interiors**. These use 224 additional playable map headers and 248 independent map chunks. The twelve new Gyms have separate saved emblems and three-control puzzles; the original eight badge slots remain intact. Automated resource checks cover every allocation; emulator traversal is still being checked.

**Everything belongs to the main adventure.** The original eight and new twelve Gyms form one 20-Gym campaign before N's final battle. All areas, all 649 Pokémon, unique items, upgrades and facilities must be accessible before becoming Champion. Ordinary exploration/story/Gym prerequisites remain. This requires migrating original Black 2 endgame barriers too. The postgame is a sages search and rematches through already accessible places, without exclusive collectible rewards. See `config/campaign.json`.

The user explicitly approved rewriting only the original lines needed for N's Champion role and N/Alder story continuity. Preserve every other original line and add original dialogue in the same concise Pokémon style. Implemented dialogue changes are pinned to exact original and replacement hashes. Each build verifies preservation of all other original text entries.

The patch is in [releases/v0.1-candidate](releases/v0.1-candidate), with source/target hashes and application instructions. See [PLAYING.md](PLAYING.md) for entrances, the twenty-Gym order and quest guidance.

## What is here

- `vendor/pokeweb-serverless/`: ignored upstream browser editor, restored by bootstrap from the source and commit in `toolchain-lock.json`. It is an editing tool, not the game.
- `roms/pokemon-black2-us.nds`: user-supplied base ROM stored through Git LFS in this private repository.
- `tools/ctrmap/CTRMap.jar` and `CTRMapV.jar`: optional ignored map editor and Gen 5 plugin. These prereleases were downloaded locally but have not been launched on this Mac; a fresh clone does not include them.
- `content/expansion.json` and `design/expansion.md`: original design data; actual native bindings and validation evidence are emitted by build modules.
- `content/world-map.json`: proposed connected travel graph, regions and extra Gyms.
- `content/story.json` and `design/story.md`: N/Alder story chapters and permanent Victini, Keldeo and Darkrai quests.
- `config/difficulty.json`: trainer/League balancing applied by `scripts/rom/trainers.ts`.
- `config/campaign.json`: main-campaign access invariant and base-content migration requirements.
- `config/dialogue-policy.json`: the user's narrow story-rewrite scope. Native modules return exact, hash-pinned changes.
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

## Native build and checks

The original ROM is never edited in place. Build modules copy the archive bytes they change, then the exporter reloads the result and compares all NitroFS files and executable sections. The full build requires every implementation module and exact dialogue preservation to pass.

```sh
npm run build:baseline
npm run test:trainers
npm run test:campaign
npm run test:story
npm run test:species
npm run test:world
npm run test:access
npm run test:dialogue-layout
npm run test:epilogue
npm run test:qa-save
npm run test:package
npm run build:rom
```

The development output is `build/black2-hidden-unova.nds`, with a JSON module report and exact dialogue-approval manifest alongside it. `build/` is ignored. A development export is not certification that the campaign can be completed.

To create a standard BPS patch and verify its complete reconstructed output with an independent applier:

```sh
python3 scripts/package-rom.py setup-patcher
npm run package:rom -- --status candidate
```

The output under `build/distribution/` includes the patch, exact source/target hashes, and application instructions. The packager refuses existing outputs and verifies the pinned base.

`build-world-fixture.ts` and `build-battle-fixture.ts` create isolated QA fixtures using a bundled test save. These saves have artificial progress and powerful Pokémon and are never intended for an ordinary playthrough. `emulator-check.py` keeps screenshots, battery saves and states in a chosen project output folder. It expects the macOS ARM64 DeSmuME libretro core at `.cache/emulator/desmume_libretro.dylib`; its download and required hash are recorded in `toolchain-lock.json`. Native map 615 is an engine cache sentinel; the expansion reserves it and starts at 616.

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

- Pinned base import and unchanged export/reload: all 662 NitroFS files and both executable sections preserved; exported baseline reaches the emulator title screen.
- Trainer, campaign, world, story, access, species and dialogue focused tests pass against the supplied ROM. They check untouched input bytes, binary references, original dialogue, and generated script branches.
- New zone 616: native warp, generated terrain, NPC dialogue, ordinary in-game save, then fresh emulator startup from the battery save all demonstrated. This is an isolated map fixture.
- Gym trainer 814 passes victory, emblem persistence after cold reload, and loss recovery to a Pokémon Center. N's actual Champion battle, Hall of Fame handoff, credits, ordinary save, and cold reload pass with a prepared QA party. The expanded-campaign ending also preserves the supplied prior-progress markers. These checks do not establish campaign balance.
- Bramblewick's native exterior, house entry, rest dialogue, ordinary save, cold reload inside the house, and return to town work in the full-world fixture.
- A new grass habitat starts a native wild battle; a static Deerling can be captured, saved and reloaded, after which its duplicate offer is suppressed. Fleeing leaves the uncaught offer available immediately and after a cold reload.
- Victini’s ordered clues, three repairs, keeper completion and capture run in the native game; quest state and the captured party member persist through ordinary saving and a cold restart. The corrected work words avoid the earlier native flag collisions.
- Route 7’s five-badge rejection, six-badge entry, unconditional return and below-threshold escape pass. Rood’s visit is remembered after a cold reload.
- Species validation finds actual native sources for all 649 species using the 68 new habitats, 141 static bindings and offline evolution alternatives. This checks resource-backed availability; it does not certify a complete pre-Champion acquisition playthrough.
- New dialogue is measured against the game's font and 232-pixel line width. The original 80,082 entries are preserved except exact, approved story and trainer changes.
- No physical 3DS XL/flashcart test or full campaign playthrough has been performed.

The tracked `toolchain-lock.json` and [verification/](verification/) record input hashes and evidence boundaries. These tools are third-party community projects; retain their notices and authorship.
