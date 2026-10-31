# Pokémon Black 2: Hidden Unova — working project

This private repository contains the expansion implementation, original authoring data, and the user-supplied US Black 2 base ROM through Git LFS. **A playable development candidate and verified BPS patch are available.** Trainer, campaign, world, story, access, and species modules have real-ROM checks. New towns, interiors, and battles run in the emulator. A complete campaign playthrough and physical 3DS XL test remain unverified.

Confirmed scope: Black 2; make all 649 Generation 1–5 species obtainable in one save; a much larger connected map; moderately tougher ordinary trainers and a much tougher Elite Four/Champion. **N replaces Iris as Champion**, with N and Alder appearing throughout the expanded story. Victini, Keldeo and Darkrai receive permanent quest encounters.

The native build allocates **24 new settlements across four regions, 40 routes, 12 additional Gyms, 96 secret areas, four sewer areas, and 48 furnished interiors**. These use 224 additional playable map headers and 248 independent map chunks. The twelve new Gyms have separate saved emblems and three-control puzzles; the original eight badge slots remain intact. Automated resource checks cover every allocation. An isolated emulator tour has loaded all 248 chunks and entered and exited all 48 houses; natural campaign traversal was stopped at the user's request before completion.

**Everything belongs to the main adventure.** The original eight and new twelve Gyms form one 20-Gym campaign before N's final battle. All areas, all 649 Pokémon, unique items, upgrades and facilities must be accessible before becoming Champion. Ordinary exploration/story/Gym prerequisites remain. This requires migrating original Black 2 endgame barriers too. The postgame is a sages search and rematches through already accessible places, without exclusive collectible rewards. See `config/campaign.json`.

The user explicitly approved rewriting only the original lines needed for N's Champion role and N/Alder story continuity. Preserve every other original line and add original dialogue in the same concise Pokémon style. Implemented dialogue changes are pinned to exact original and replacement hashes. Each build verifies preservation of all other original text entries.

The current patch is in [releases/v0.2.1-candidate](releases/v0.2.1-candidate), with source/target hashes and application instructions. Previous packages remain preserved. See [TRANSFER.md](TRANSFER.md) for spoiler-free cartridge/SD setup and the prepared local game file. [PLAYING.md](PLAYING.md) contains spoilers: entrances, the twenty-Gym order and quest guidance.

The current source adds **36 ordinary route trainers with 112 Pokémon**, corrects three house entrances and terrain alignment, raises the native Frigate/Ghetsis/Kyurem battles to match campaign progression, and preserves N's original Zekrom handoff. The v0.2.1 candidate at `build/candidate-access.nds` also moves the sewer entrance guide onto the main entrance's ground corridor in both seasonal layouts. Its exact serialized delta from v0.2 is five coordinate bytes; all other NitroFS resources and both executables are unchanged. Static placement checks pass in both seasonal layouts. The current natural-run season also passes interaction, reciprocal retreat, ordinary saving, raw-save cold loading and re-entry; see [runtime evidence](verification/native-access-runtime.json). [Current QA status](verification/current-qa-status.json) records exact hashes and unfinished campaign/hardware checks. The fresh campaign started from New Game without imported progress; its continuation across this fix requires an ordinary-save cold restart and retains both ROM hashes. Prepared saves used for focused tests are recorded separately.

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
npm run test:native-access-placement
npm run test:access
npm run test:dialogue-layout
npm run test:epilogue
npm run test:qa-save
npm run test:route-trainers
npm run test:route-placement
npm run test:house-doors
npm run test:terrain-alignment
npm run test:climax
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

The input-only `playthrough-runner.py` supports `--render-cores 2` when cold-starting from an ordinary raw save into a new output directory. The default remains one core; changing this option while resuming a savestate is refused. Manifests retain requested/queried core options and script hashes. A short isolated benchmark measured 1.062× overall throughput and 1.142× for field/menu frames; this is not a full-playthrough speed guarantee. See [benchmark limits](verification/emulator-speed.md) and [option checks](verification/emulator-options.json).

The runner also accepts `{"autoBattle":{"moveSlot":2,"maxTurns":3,"maxFrames":5000}}` for the retained, approved routine battle layout. It checks the menu, active/opponent names and move PP before repeating touches, then stops for changed choices, low HP, unknown screens or configured limits. All inputs stay in the replay log. A natural-run pilot submitted two moves and reached a native battle-end stop in 6.35 seconds without intervening model calls. This is bounded automation for that context, not a general battle agent or a measured full-playthrough speedup. See [exact pilot evidence](verification/autoturn-controller.json). Run `python3 tests/playthrough-autoturn.test.py` and `python3 tests/playthrough-autoturn-integration.test.py` for retained-image and mocked integration checks.

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
- All 36 added ordinary trainers passed native wins and repeat interactions with a prepared QA party: 21 on the preceding candidate and 15 on v0.2, with identical route resources. The actual v0.2 ROM cold-loaded all 36 defeated flags and resaved; a separate native loss/retry test also passed. See `verification/route-trainer-runtime.json`; this is not campaign balance proof.
- Both legacy Zekrom chapter-continuation entries ran on the actual v0.2 ROM and survived ordinary saving, raw-save cold loading and resaving. Prepared legacy conditions are explicit in `verification/legacy-dragon-recovery.json`. The stage1 save also completed native Lv70 Kyurem capture and actual DNA Splicers delivery on the unchanged candidate. Both survived ordinary saving, a raw-save cold restart and resaving, with all 73 block CRCs, duplicate CRCs and table CRCs valid in both save copies. See [the capture evidence](verification/legacy-kyurem-runtime.json); this used an artificial party and inherited Master Balls, so it does not establish natural progression or battle balance.
- New zone 616: native warp, generated terrain, NPC dialogue, ordinary in-game save, then fresh emulator startup from the battery save all demonstrated. This is an isolated map fixture.
- Gym trainer 814 passes victory, emblem persistence after cold reload, and loss recovery to a Pokémon Center. N's actual Champion battle, Hall of Fame handoff, credits, ordinary save, and cold reload pass with a prepared QA party. The expanded-campaign ending also preserves the supplied prior-progress markers. These checks do not establish campaign balance.
- Bramblewick's native exterior, house entry, rest dialogue, ordinary save, cold reload inside the house, and return to town work in the full-world fixture.
- A new grass habitat starts a native wild battle; a static Deerling can be captured, saved and reloaded, after which its duplicate offer is suppressed. Fleeing leaves the uncaught offer available immediately and after a cold reload.
- Victini’s ordered clues, three repairs, keeper completion and capture run in the native game; quest state and the captured party member persist through ordinary saving and a cold restart. The corrected work words avoid the earlier native flag collisions.
- Route 7’s five-badge rejection, six-badge entry, unconditional return and below-threshold escape pass. Rood’s visit is remembered after a cold reload.
- Species validation binds all 649 species using the 68 new habitats, 140 new static encounters, native Dragonspiral Zekrom and offline evolution alternatives. This checks resource-backed availability; it does not certify a complete pre-Champion acquisition playthrough. The former supplemental Zekrom encounter now provides directions; older saves that already captured it have a guarded native chapter continuation.
- New dialogue is measured against the game's font and 232-pixel line width. The original 80,082 entries are preserved except exact, approved story and trainer changes.
- No physical 3DS XL/flashcart test or full campaign playthrough has been performed.

The tracked `toolchain-lock.json` and [verification/](verification/) record input hashes and evidence boundaries. These tools are third-party community projects; retain their notices and authorship.
