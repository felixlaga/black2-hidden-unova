# Playing the Black 2 expansion on a 3DS XL

**The target console is a Nintendo 3DS XL. The user reports no flashcart or loader setup; no console has been written, modified, or tested. The current local candidate is `build/candidate-final.nds`, SHA-256 `32f0891f30ca94331d4410486abc37e46bc4bb009be60ac32336a84ccb51987a`. Emulator testing is in progress. Physical compatibility remains unverified.**

Black 2 is a Nintendo DS game. The output remains a DS `.nds` game.

## Cartridge route

A compatible **DS flash cartridge** loads the modified `.nds` from the flashcart's own microSD card using its correct kernel/launcher. A normal retail Black 2 cartridge cannot have its game ROM replaced: writable save data is separate from the read-only game.

Compatibility depends on the exact flashcart hardware, label URL/revision, kernel, and 3DS firmware. The name “R4” is not sufficient. A card's ability to install ntrboot does not prove that it can launch DS games normally. Record the actual model and system version before choosing a setup.

Sources: [GodMode9 drive types](https://github.com/d0k3/GodMode9#available-drive-types), [flashcart loader documentation](https://wiki.ds-homebrew.com/twilightmenu/installing-flashcard), [compatibility table and qualifications](https://3ds.hacks.guide/ntrboot.html).

## Console SD-card alternative

If the system already has suitable custom firmware, TWiLight Menu++/nds-bootstrap can run DS software from the console's SD card. This is an alternative to a flashcart. An ordinary SD card in an unmodified system does not by itself provide this capability. No custom firmware installation is being performed in this project.

Sources: [TWiLight Menu++ prerequisites](https://wiki.ds-homebrew.com/twilightmenu/installing-3ds), [nds-bootstrap](https://github.com/DS-Homebrew/nds-bootstrap).

## Getting a base from an owned cartridge

If you have a Black 2 cartridge and GodMode9 is already available on your system, its documented route is `[C:] GAMECART` → the `.nds` file → `Copy to 0:/gm9/out`. Use the documented **untrimmed** dump. Transfer that file to this computer; keep the original unchanged. This requires the appropriate existing setup, not just inserting a cartridge into a stock 3DS XL.

See the [cartridge dumping guide](https://3ds.hacks.guide/dumping-titles-and-game-cartridges.html#dumping-a-game-cartridge) and [GodMode9 releases](https://github.com/d0k3/GodMode9/releases). The project should identify language, region, revision, and hash before editing. Initial integration is scoped to US English Black 2 (`IREO`).

## Required validation before calling the expansion cartridge-ready

The pending hardware run is recorded in [verification/hardware-pending.json](verification/hardware-pending.json). It needs the actual console and its loading setup; emulator results cannot fill those fields.

- Record exact modified ROM hash, flashcart/kernel or loader version, console model, and firmware.
- Test the unmodified dump through the same loading route first.
- Play the modified build through battles, map entry/exit, quest progression and encounters.
- Save in-game, fully power down, restart and reload; verify party, inventory, quest flags and location.
- Repeat save/reload inside a new area and after an Elite Four/Champion victory.
- Test fleeing/defeating rare encounters, blackout recovery, and a full party when receiving a gift.
- Keep saves from the original game separate. Existing saves are not automatically compatible with new quest flags and map IDs; a new save is the initial test target.

An emulator pass or successful boot does not prove reliable saves on the user's flashcart. Source: [nds-bootstrap testing guidance](https://wiki.ds-homebrew.com/nds-bootstrap/testing).
