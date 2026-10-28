# Verification scope

`build-summary.json` and the patch manifest identify the delivered candidate. The base ROM stays unchanged. The export was reloaded and all 662 NitroFS files compared with the staged build; both executable sections remain unchanged.

The module tests cover trainer/evolution records, 20-Gym order, map allocation/collision reachability, quest and battle branches, dialogue preservation, native access migration and optional sages. Independent quest review exercised 11,952 compiled interactions. Event metadata review checked every nonempty table and all 224 new maps as fixture origins. Exactly 39 original text entries have hash-pinned approvals; the other original entries remain unchanged.

The JSON files record individual emulator experiments and their exact ROM hashes. Earlier fixtures are retained as evidence of the feature tested at that revision; they are not represented as a complete run of the final candidate. The final production build was used directly for Victini capture/save/reload and later cold-load checks. Intermediate tests used prepared saves, artificial progress, and a powerful test Pokémon. They prove the named native behavior, not difficulty balance or a natural twenty-Gym playthrough.

Representative checks include new-town and room traversal/save/reload, a Gym puzzle and reset, trainer victory/loss, grass encounters, static capture and uncaught flee/retry after cold reload, the full Victini clue/repair/completion sequence, entry badge checks and unconditional escape, sage visit persistence, and the native N battle and Hall of Fame ceremony. `champion-ending.json` records the unmigrated ending branch; `champion-expanded-ending.json` records the expanded-campaign branch with preserved progress markers and a cold restart on the delivered build.

Full acquisition of all 649 species, a complete fresh-save campaign, every original facility/form event, every map/camera crossing, and physical 3DS XL/flashcart operation remain unverified. Some species use naturalist actors instead of custom walking sprites; new leaders reuse native battle-class portraits. New rooms use furnished native room templates. Ranger/Mystery Dungeon references are original adaptations, not imported complete regions.

Screenshots are selected evidence, not a full recording. Full local run reports, raw saves, states and action logs remain under ignored `build/`; do not use those QA saves for an ordinary playthrough.
