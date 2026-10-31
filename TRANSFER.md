# Play Hidden Unova on your 3DS XL — spoiler-free

The local transfer package is `private/ready-to-play/Hidden-Unova-v0.2.1/`.
Its ready-to-copy game is:

`COPY_TO_MICROSD/roms/nds/Black2-Hidden-Unova.nds`

This is the already-modified, 512 MiB game. No additional BPS patch is needed. Its bytes match the current candidate exactly; `SHA256SUMS.txt` records the hash. No test save or cartridge menu software is included. Start a **New Game**.

## Using a game cartridge

You need a **DS flashcart**, its own microSD card, and a card reader. A normal retail Pokémon cartridge cannot have its game ROM rewritten. [GodMode9 cartridge documentation](https://github.com/d0k3/GodMode9#available-drive-types)

1. Choose a flashcart that supports ordinary DS games on an unmodified 3DS XL. **Ace3DS X is one documented option**, but this modified game has not been tested on it. Generic “R4” branding does not identify the correct hardware or menu software. [Flashcart comparison](https://www.flashcarts.net/ds-quick-start-guide)
2. Prepare a microSD using the exact card's setup guide, including its matching menu/loader. Back up any existing files before formatting. For Ace3DS X, use **NDS mode**; its “3DS” switch position is for ntrboot, not playing games. [Switch explanation](https://3ds.hacks.guide/ntrboot.html)
3. Copy the package's `roms` folder onto that microSD. If the menu uses a `Games` folder instead, put `Black2-Hidden-Unova.nds` there.
4. Safely eject the card, put it in the flashcart, and insert the flashcart into the powered-off 3DS XL. Turn it on, open the cartridge icon, browse to the game, and launch it.

**Black 2 loader detail:** Ace Wood's normal Black 2 support needs an anti-piracy fix; otherwise experience gain can fail. Its setup guide describes a bypass option, but recognition and compatibility with this modified file remain unverified. Do not assume a clean-game cheat works for this build. Choose the loader using the [current Ace3DS setup guide](https://sanrax.github.io/flashcart-guides/cart-guides/ace3ds_r4ils/); the exact card and loader still need checking together.

## Alternative: the console's SD card

With custom firmware installed through [3DS Hacks Guide](https://3ds.hacks.guide/), install [TWiLight Menu++](https://wiki.ds-homebrew.com/twilightmenu/installing-3ds), copy `roms/nds/Black2-Hidden-Unova.nds` onto the **console's SD card**, and open it in TWiLight Menu++. This route does not require a flashcart. Copying the file to a stock console's SD card alone will not launch it.

## First start

Check that battles award experience, then save normally, fully restart, and check that Continue restores your progress. Keep backups of your `.sav` file.

The game is a playable candidate. The full campaign test was stopped at your request, and physical 3DS XL testing has not been performed. The transfer package is ready; exact cartridge/loader compatibility is still unverified.
