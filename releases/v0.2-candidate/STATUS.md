# v0.2 development candidate

Target SHA-256: `32f0891f30ca94331d4410486abc37e46bc4bb009be60ac32336a84ccb51987a`.

Adds 36 ordinary route trainers with 112 Pokémon; fixes three house entrances and terrain alignment; adjusts the native Frigate, Ghetsis and fused Kyurem levels; keeps Zekrom in N’s original story and supports older supplemental-capture saves.

The patch independently reconstructs the exact target. An isolated emulator tour passed all 248 chunks, all 48 house entries/returns, and the 12 Gym puzzles. Prepared-save battle and story checks are recorded separately.

The repaired legacy dragon path also passed native Kyurem capture and actual DNA Splicers delivery on this unchanged candidate, followed by ordinary save, cold restart and resave. See [the evidence](../../verification/legacy-kyurem-runtime.json) for the artificial save setup and exact hashes.

**The natural 20-Gym campaign playthrough is in progress. Physical 3DS XL testing has not occurred: no flashcart/loader setup is available. This is a candidate, not a completed compatibility certification.** See ../../verification/current-qa-status.json for current evidence.

Use APPLY.txt and the pinned original ROM. Start a new game for an ordinary playthrough; development QA saves contain artificial state and must remain separate. The older v0.1 package remains preserved.
