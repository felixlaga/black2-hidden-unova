# Editing-tool and source downloads

Checked 28 October 2026. These links lead to the projects' own repositories or releases. They are **editing tools/source projects, not downloads of commercial Pokémon game images**. Source availability alone does not establish that every resource is unrestricted for redistribution.

## Gen 5 — selected project

- **Pokeweb Serverless:** <https://github.com/hzla/Pokeweb-Serverless>. Downloaded to `vendor/pokeweb-serverless/`; local editor on port 5178. The old Ruby/Python Pokeweb repository is deprecated in favor of this successor. Covers BW/BW2 data, text, scripts, encounters and map-related editing. Actual support for a particular ROM must be tested.
- **CTRMap Community Edition:** <https://github.com/ds-pokemon-hacking/CTRMap-CE/releases>. Downloaded `CTRMap.jar`, version `2026/04/28/1` (prerelease).
- **CTRMapV plugin:** <https://github.com/ds-pokemon-hacking/CTRMapV/releases>. Downloaded `CTRMapV.jar`, version `1.4.1` (prerelease). The core alone is insufficient for Gen 5 editing. Requires a working Java/graphics environment; Mac launch not tested.
- **Frost's Gen 5 Editor:** <https://github.com/FrostFalcon/FrostsGen5Editor/releases>. Alternative Windows editor; source targets Windows Forms/.NET Framework 4.8. Linked, not installed. Its author explicitly excludes White2Upgrade from the general compatibility claim.
- **White2Upgrade:** <https://github.com/ds-pokemon-hacking/White2Upgrade>. Separate, experimental species-expansion project with a documented 721-species target currently implemented and a heavy-work-in-progress warning. Its documented build targets US White 2. It is not part of this Black 2/649-species setup.

New matrix entries or zone headers do not automatically make a complete town. Independent map graphics, collisions, heights, warps, events, scripts and game progression must all be integrated. See the editor's [map guide](https://github.com/hzla/Pokeweb-Serverless/blob/master/wiki/Maps.md) and [map import constraints](https://github.com/hzla/Pokeweb-Serverless/blob/master/docs/map-glb-import.md).

## Other generations — sources found, not downloaded locally

- **Gen 1:** [Red/Blue source](https://github.com/pret/pokered), [Yellow source](https://github.com/pret/pokeyellow). Editable assembly projects with their own build instructions.
- **Gen 2:** [Gold/Silver source](https://github.com/pret/pokegold), [Crystal source](https://github.com/pret/pokecrystal).
- **Gen 3:** [Emerald source](https://github.com/pret/pokeemerald), [FireRed/LeafGreen source](https://github.com/pret/pokefirered), [Porymap downloads](https://github.com/huderlem/porymap/releases), [HexManiacAdvance downloads](https://github.com/haven1433/HexManiacAdvance/releases). Porymap edits decompilation projects, not an arbitrary ROM; HexManiacAdvance is a Windows binary editor.
- **Gen 4:** [DSPRE downloads](https://github.com/DS-Pokemon-Rom-Editor/DSPRE/releases) for supported Diamond/Pearl/Platinum/HeartGold/SoulSilver versions. Windows tool; verify its language/version matrix.
- **Gen 6/7:** [pk3DS source](https://github.com/kwsch/pk3DS). Requires extracted RomFS/ExeFS. There are no GitHub releases; the [maintainer's page](https://projectpokemon.org/home/forums/topic/34377-pk3ds-pok%C3%A9mon-3ds-rom-editor-and-randomizer/) links build artifacts, whose current availability has not been checked here.

Only the selected Gen 5 tools were downloaded. Mixing editors or applying unrelated hacks to one ROM is not assumed compatible.
