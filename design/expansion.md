# The Wayside Ledger — Black 2 expansion design

**Status: design only, not integrated or playable.** The user-supplied base ROM is recorded in `toolchain-lock.json`. The source is [`content/expansion.json`](../content/expansion.json), schema version `1.1.0`. No modified ROM, patch, engine map allocation, or emulator result is supplied.

The design targets **24 new settlements, 96 secret locations, 40 connecting routes, and 12 additional gym buildings** across four contiguous expansion regions. The 19 named original Black 2 settlements and original eight gyms remain separate: the combined design targets 43 named settlements and 20 gyms. The 120 town/secret records exclude gym interiors and route connections; none is a verified engine map slot. The broader goal remains all 649 Generation 1–5 species; these 96 encounter proposals do **not** establish that availability. No Fairy type, Mega Evolution, or later-generation species is introduced.

## Main-campaign access contract

**Nothing in the world or collectible roster is locked behind becoming Champion.** All 24 new towns, 96 secret areas and twelve additional gyms belong before N’s final battle. `gate.late_campaign` means **eight original Badges plus the relevant pre-League travel/story milestones**. It never requires Champion victory, League completion or extra emblems. High-power visitors keep sensible late-campaign levels and optional observation requirements without waiting for the ending. Chapters 8–12 use this same access phase.

The twelve additional emblem records join the original eight victories in one **twenty-gym campaign**. N’s final challenge may require all twenty victories. Exploration, species, items and upgrades never require N’s defeat. After the ending, only optional sages searches and rematches remain, with no exclusive world or collectible rewards.

**Base Unova also needs gate migration.** Survey every originally postgame-only base route, town, interior, encounter, gift, item, shop, facility and upgrade, including indirect prerequisite chains. Move those dependencies to appropriate pre-League story/Gym milestones. Updating the expansion alone is insufficient. The abstract base-world graph proves neither those script changes nor pre-ending availability; exact bindings and verification await a ROM. Root owns story, difficulty and the dialogue guard.

## Story and preservation

Travelers once maintained a network of refuges with low entrances, quiet bells, shaded water, sheltered banks, and clear paths home. The player reconstructs its guide by watching Pokémon habits and comparing old notes. Six marks reveal missing northern pages; late campaign surveys restore those pages and leave the last one open for future discoveries. There is no new main-story crisis. Every quest is optional and can be completed without a capture.

**N replaces Iris as the original League Champion.** The selected binding is `story.n_champion` in the separately owned `content/story.json`; its recurring N/Alder arc and teams are not duplicated here. The original eight and twelve new gyms form one twenty-gym main campaign ending with N’s final Champion battle. Preserve all existing dialogue except the minimum specifically authorized story-consistency changes for that arc, in the same Pokémon voice. Exact entries await the ROM and must use the parent-owned guard’s hash-pinned exceptions. Original towns, eight gyms, and unrelated scenes remain. Every route and script binding still requires a ROM survey.

## Preserved eight settlement concepts and secret encounters

The table below retains the first eight concepts; its old placement labels are provenance, not eight independent entrances. Canonical approaches and all 24 towns now use the regional route network below. Each listed secret has an original clue, discovery action, progression gate, encounter, and retry policy in the JSON. Levels are balance proposals. All encounters are deliberate interactions with visible visitors; each permits one successful capture per save continuity. Ordinary exploration does not require battling them.

| Preserved settlement / former placement reference | Progression | Four secret locations and proposed visitors |
| --- | --- | --- |
| Bramblewick / Route 20 | first badge | Leaffold Alcove — Deerling #585 Lv.10; Mossstep Well — Bulbasaur #1 Lv.12; Whistling Root Burrow — Cyndaquil #155 Lv.12; Mooncup Garden — Cleffa #173 Lv.14 |
| Sootbell Yard / Virbank Complex | second badge | Warmbrick Kiln — Charmander #4 Lv.16; Cinder Fan Loft — Elekid #239 Lv.17; Tapline Cistern — Squirtle #7 Lv.16; Bellkeeper's Nook — Togepi #175 Lv.18 |
| Sandglass Court / Route 4 | third badge | Dewglass Vault — Mudkip #258 Lv.22; Windscore Steps — Trapinch #328 Lv.23; Shaded Seedroom — Treecko #252 Lv.22; Fossil Listener's Cellar — Omanyte #138 Lv.24 |
| Reedwake / Route 6 | fifth badge | Oxbow Hide — Totodile #158 Lv.30; Driftroot Pocket — Turtwig #387 Lv.30; Reedpipe Grotto — Feebas #349 Lv.31; Dragonfly Sluice — Yanma #193 Lv.32 |
| Threadmill Crossing / Route 7 | sixth badge | Spoolwind Loft — Chikorita #152 Lv.35; Lintwood Shelter — Torchic #255 Lv.35; Hushbeam Gallery — Ralts #280 Lv.34; Blue Kite Hollow — Riolu #447 Lv.36 |
| Saltlamp Quay / Route 21 | eighth badge | Tidebell Grotto — Piplup #393 Lv.43; Old Net Chamber — Dratini #147 Lv.42; Warm Current Pocket — Chimchar #390 Lv.43; Lantern Silt Room — Chinchou #170 Lv.42 |
| Frostmere Hearth / Giant Chasm exterior | late campaign | Steamroot Hollow — Snorlax #143 Lv.55; Frostscript Gallery — Absol #359 Lv.55; Hearthstone Vault — Larvitar #246 Lv.50; Winterseed Refuge — Articuno #144 Lv.60 |
| Stillwater Fold / Route 23 | late campaign | Mirrorbough Grove — Eevee #133 Lv.50; Skyprint Observatory — Dragonite #149 Lv.62; Lastwatch Shelter — Celebi #251 Lv.60; Unwritten Spring — Mew #151 Lv.60 |

Articuno and Dragonite additionally require **Seasons in the Margins**; Celebi requires **A Path for Every Visitor**; Mew requires **The Page Left Blank**. Their rooms remain available for observation before the visitor appears. All four encounters are late campaign. Snorlax and Absol are also late campaign proposals. Ralts retains its Generation V typing; Deerling uses its normal seasonal form without a season lock. Omanyte is proposed as a descendant of a former researcher’s specimen, requiring no new revival mechanic.

## Connected regional map and additional gyms

[`content/world-map.json`](../content/world-map.json) is the canonical proposed topology. Four real geographic approaches enter from **Route 20, Route 6, Route 7, and Route 21**. Other old anchor symbols remain marked as superseded placement references, with no extra entrance edge. A town’s regional approach is not an individual teleport. Original Unova is represented by one explicitly abstract connected node and four original-route links; this is not a surveyed base map.

Each region contains six settlements, a six-route loop and one local bridge/cave shortcut: **28 internal routes + four entries + eight interregional connections = 40**. The eight interregional links pair the four neighboring regions around a continuous loop. Escarpment roads and Copper Cut join the south to the west; Rainwind Pass and Quarry Courier Road connect west to north; Snowmelt Descent and Cloudcliff Path descend east; two dock-to-dock coastal ferries close the loop to the south. These ferries are geographical boat links with no real-time schedule lock.

| Region | Six connected settlements | Original-world entry |
| --- | --- | --- |
| Southworks Greenbelt | Bramblewick, Sootbell Yard, Cloverbank, Copperbrook, Applecross, Heatherford | Route 20; first badge |
| Western Basin | Sandglass Court, Reedwake, Ochrestead, Lockwillow, Flintmarket, Rainbarrow | Route 6; fifth badge |
| Highmarch | Threadmill Crossing, Frostmere Hearth, Windrest, Slatehaven, Cloudmere, Pinewatch | Route 7; sixth badge |
| Eastern Reach | Saltlamp Quay, Stillwater Fold, Pearlhaven, Tideglass, Gullspire, Dawnbridge | Route 21; eighth badge |

Forward travel respects destination base-progress requirements, even on cross-region shortcuts; once entered, physical exits remain usable. Sandglass Court’s earlier quest condition is retained, but its canonical regional approach now opens at the fifth badge; quest investigation content is retained while contradictory late-access conditions are migrated. Frostmere Hearth, Stillwater Fold, Cloudmere, Pinewatch, Gullspire, and Dawnbridge remain late campaign. Structural reachability ignores these requirements; a separate progression/collision audit awaits the ROM.

The sixteen added towns each have four concise clue/discovery records and one Gen I–V visitor per secret. Their 64 new visitors use National Dex IDs 1–649. Early regions use modest unevolved visitors; high-power proposals such as Tyranitar, Salamence, Metagross, Volcarona, Milotic and Kingdra are late campaign at levels 56–62. Articuno, Celebi and Mew retain their observation prerequisites, with access moved before N. Victini, Keldeo and Darkrai are bound to three existing secret slots through story.json; the total remains 96, and their ordinary resident species are preserved. The original 32 secrets and all twelve authored quests retain their IDs and investigation content; their contradictory access gates now use `gate.late_campaign`. New towns do not require new quest state machines.

Every additional gym is a proposed signed building with a dedicated semantic interior, named leader, type, puzzle, permanent street exit, and unique victory emblem. Trainer teams, engine map slots and save storage are not allocated.

| Town / gym building | Leader / type | Puzzle | Emblem / challenge gate |
| --- | --- | --- | --- |
| Bramblewick / Glasshouse Gym | Hazel / Grass | Rotate three irrigation gates to open a dry path between growing beds. | Sprout Emblem; first badge |
| Sootbell Yard / Kilnworks Gym | Bram / Fire | Vent three cooling kilns in the order shown by their temperature bells. | Ember Emblem; second badge, bramblewick |
| Copperbrook / Waterwheel Gym | Ferris / Steel | Align waterwheel axles to lower three metal walkways. | Rivet Emblem; third badge, sootbell yard |
| Sandglass Court / Survey Hall Gym | Dune / Ground | Set sand-table contour markers to reveal a stable staircase. | Contour Emblem; fifth badge |
| Reedwake / Lockhouse Gym | Maris / Water | Equalize canal chambers while keeping the central walking bank dry. | Current Emblem; fifth badge, sandglass court |
| Flintmarket / Quarry Gym | Petra / Rock | Turn stone turntables until their ramps form a continuous climbing path. | Stratum Emblem; sixth badge, reedwake |
| Threadmill Crossing / Ribbon Mill Gym | Aella / Flying | Follow ribbon directions and close wind shutters to bridge open platforms. | Gust Emblem; sixth badge |
| Slatehaven / Coldstore Gym | Neve / Ice | Slide insulated crates into marked bays to form a safe route over ice. | Rime Emblem; eighth badge, threadmill crossing |
| Frostmere Hearth / Hearth Dojo Gym | Tor / Fighting | Coordinate practice dummies and floor switches without blocking the walking lanes. | Resolve Emblem; late campaign, slatehaven |
| Saltlamp Quay / Lighthouse Gym | Lux / Electric | Route current through lamp circuits to illuminate the three correct stairs. | Beacon Emblem; eighth badge |
| Tideglass / Prism Hall Gym | Veda / Psychic | Rotate colored glass screens to match the visible mural and reveal real doors. | Prism Emblem; late campaign, saltlamp quay |
| Stillwater Fold / Spring Archive Gym | Soren / Dragon | Arrange dragon migration panels by habitat clues to open the final bridge. | Horizon Emblem; late campaign, tideglass |

The three gyms within each region have explicit predecessor-emblem requirements. The four regional chains may be interleaved when original progression permits. **Twelve expansion emblems are separate persistent records, not twelve assumed new vanilla badge bits.** Storage, collection UI, victory hooks, save migration and reentry behavior remain implementation questions. All twelve victories are part of the main campaign and earn a journal certificate before N. Together with the original eight gym victories they form the twenty-gym requirement for N’s final challenge, whose hook belongs to `story.n_champion`. No location, species, item or upgrade requires defeating N.

## Twelve linked quests

The first six chapters follow normal regional access. Chapter 7 and chapters 8–12 all belong to the main campaign; the latter use pre-League `gate.late_campaign` and remain completable before N’s final battle. Later chapters require the preceding chapter; chapter 7 explicitly requires all first six. Quest rewards are journal findings and optional encounter access, so inventory capacity never blocks reporting.

| # | Quest | Investigation and result |
| --- | --- | --- |
| 1 | Leaves at the Gate | The leaf mark identifies a resting place, not buried treasure. |
| 2 | Bells Without Wind | The bell mark records safe warmth and quiet hours. |
| 3 | A Map That Drinks | The drop mark joins cool shade to reliable water. |
| 4 | The Water's Long Way | The reed mark follows a safe bank, leaving the water habitat undisturbed. |
| 5 | Thread on the Breeze | The thread mark records shelter from noise and strong wind. |
| 6 | Lamps Below the Tide | The lamp mark separates a walking route from the spaces water Pokémon need. |
| 7 | Six Marks, One Margin | The six marks form a guide to suitable resting places, with two missing pages. |
| 8 | Warmth Beneath the Frost | The hearth mark preserves different needs; warmth is not a universal welcome. |
| 9 | The Quiet Fold | The open-page mark invites new observations instead of declaring the guide finished. |
| 10 | Seasons in the Margins | A seasonal appendix opens optional visits from Articuno and Dragonite; neither is needed to finish the plot. |
| 11 | A Path for Every Visitor | The refuges reconnect as an optional network on paper; no cross-region fast travel is added. Celebi may now visit Lastwatch Shelter. |
| 12 | The Page Left Blank | The optional plot ends with a maintained, unfinished guide. Mew may now visit the spring; capture is an optional epilogue. |

Each quest has concrete stages in the JSON. Observations are repeatable and idempotent. Chapters 10–12 request fresh observations after acceptance; earlier chapters may use recorded notes. No clock window, real-season wait, capture count, or consumable is a quest gate. The restored network is a guide to walking routes, not new cross-region fast travel.

## First implementation candidate: Leaves at the Gate

“First playable slice” is a planning field, not a claim of playability. This candidate uses only **Bramblewick and Leaffold Alcove**; the other 118 town/secret locations, routes, and additional gyms belong to later work. It does not replace choosing the base-game starter.

After the first Badge, a proposed side path off Route 20 leads to Mara’s hamlet. Mara asks the player to investigate a berry basket. Skins lead toward soft mud; split hoofprints turn under a branch; a two-leaf carving identifies an old resting place. These suggest a clue chain, but the three clues can be inspected in any order after acceptance. Pre-acceptance examination gives flavor text and does not consume a clue.

**Layout intent.** Bramblewick is a small walking loop: Route 20 entry and exit to the south, Mara and the ledger west, basket in the center, mud northeast, and the carved entrance north. The east path loops home. In the alcove, the shelter board is west, Deerling rests off the main path north, and the south exit is reachable along a clear east passage. Neither NPCs nor the encounter can obstruct a landing, the shelter board, or an exit. Dimensions and collision tiles remain unresolved.

| Persistent quest state | Action | Result |
| --- | --- | --- |
| `not_accepted` | Accept Mara’s request | `investigating`; declining leaves the offer available. |
| `investigating` | Inspect any of three clues | Set its persistent bit once; all six inspection orders work. |
| `investigating` | Inspect branch with all three bits | Reveal the alcove permanently; quest state stays unchanged. |
| `investigating` | Inspect shelter board | `shelter_inspected`; capture is irrelevant. |
| `shelter_inspected` | Report to Mara | `complete`; record one journal entry and enable the next chapter when its gate is met. |
| `complete` | Report or revisit again | Repeat dialogue; no duplicate reward, no closure of the refuge. |

**Original dialogue examples** (canonical text and semantic IDs are in the JSON):

- Mara: “The berries are gone, but the basket is still here. Could you follow those little tracks?”
- Mud clue: “Small, split prints turn beneath a low branch. Nothing here was dragged.”
- Shelter board: “Fresh leaves cover an old stone bed. The board shows a resting place and a path back out.”
- Mara, report: “A low door and a dry bed. Someone knew just what a tired Pokémon needed.”
- Iva, later chapter: “A good path fits the traveler. It does not have to be the grandest one.”

**Rare encounter.** Deerling (#585), level 10, appears only through deliberate interaction after the alcove opens. Persistent encounter state is `available` or `captured`, separate from quest state. Declining leaves it immediately available. Fleeing or defeating it leaves it available with temporary retry suppression; reentry or an out-of-battle reload clears that suppression. Blackout uses ordinary base-game recovery. Full party and storage capacity cannot consume the opportunity or block shelter inspection.

A successful ownership transfer and the encounter’s captured status must be committed consistently. Recheck status before battle and transfer, and prevent overlapping interactions. A saved captured encounter stays resolved after trading or releasing that Pokémon; catching another Deerling elsewhere does not resolve this one. A pre-capture save restores its own pre-capture ownership and encounter state. This is not an anti-rollback guarantee, and atomic persistence remains an engine requirement to prove.

**Return intent.** Entry stores only `warp.leaffold.to_bramblewick`, an allowlisted semantic key. The physical south exit and optional return sign use a validated clear landing beside the hamlet branch. A missing or stale key falls back to that same safe landing. Neither exit depends on quest or encounter progress. Blackout never invokes this return script or overwrites the normal recovery destination. Do not enable entry until the physical exit and fallback bindings are proven valid.

**Save/resume acceptance criteria** — specified, not executed against a game:

- Save/reload each of the eight clue subsets; retain acceptance and exactly the earned clue bits.
- Save inside the alcove and after shelter inspection; clear temporary locks, preserve access, and allow reporting.
- Repeat completed reports; grant one journal reward and preserve an uncaptured encounter.
- Capture before inspection or after completion; quest progress remains independent.
- Save after capture and reload; restore ownership and captured state consistently, including after later trade/release.
- Flee, defeat, or blackout; reentry/reload restores an uncaptured encounter and all routes out.
- Test full storage, repeated interactions, invalid return keys, and reset during battle.
- On inconsistent migrated capture data, keep navigation and observation quests usable, suppress further transfer, and report a diagnostic rather than generating another Pokémon.

## Authoring handoff

`symbols` registers semantic maps, anchors, scripts, flags, states, warps, and landings. `dialogue` contains only original text. `all_of` gates are conjunctive; gate predicates are read-only views of base progression. Quest completion flags belong only to the expansion. National Dex numbers and proposed levels are content facts, not resolved engine identifiers.

The JSON is authoring data, not an executable script language or a ROM compatibility claim. Later work must survey actual map/script/text capacity, bind symbols, prove append-only dialogue preservation, implement encounter/save hooks, validate warps and collision, and playtest level/catch pacing. Observation stages outside the first slice remain concise authoring intents.

Validation for this handoff checks 24 settlements, 96 secrets, 12 preserved quest investigations with updated access gates, 12 additional gyms, 40 routes, exactly four base entrances, unique IDs, references, four secrets per town, Generation 1–5 bounds, and structural graph reachability. The old repository validator hard-codes 8/32 and needs an owner update; the expanded checks were run separately. These checks do not prove game behavior, engine capacity, progression balance, or all-649 availability.
