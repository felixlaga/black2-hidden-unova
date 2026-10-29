# Isolated emulator speed benchmark

Benchmark-only. No live control used, no benchmark state imported, no commit.

## Result
Installed arm64 core has no supported JIT/dynarec option. Two rendering cores produced 1.062x whole-chain and 1.142x representative neutral/menu/field throughput versus one core (two trials each). Four cores was slower than two in its single trial. This is a modest improvement, not a solution for an urgently much faster playthrough.

| Run | Cores | Whole chain seconds | Representative seconds | Raw unchanged |
|---|---:|---:|---:|---|
| baseline-valid-1 | 1 | 14.3404 | 5.1653 | True |
| cores2-valid-1 | 2 | 13.3685 | 4.5764 | True |
| cores4-valid-1 | 4 | 13.8552 | 4.7912 | True |
| baseline-valid-2 | 1 | 14.5922 | 5.3295 | True |
| cores2-valid-2 | 2 | 13.8686 | 4.6129 | True |

## Evidence
Same ROM path, copied natural raw save, and exact input chain for every valid run. No ROM copied/exported. Hashes, all queried/selected options, segments, valid field observations, dimensions, color counts, captures, and timings are in each report.json. Final five segments cover field idle, X press, menu idle, B press, field idle; 1224 frames total. Screenshots stay here and are not embedded in chat. Menu opens and closes under input; bottom screen differs by 48029 pixels when open and only 8 after closing. Two-core trial 1 matched 19/20 baseline images byte-for-byte; one earlier field capture differed in a 14x7 bottom-screen region. Final representative checkpoints match. Every completed valid run preserved the original raw battery hash after unload. No fresh ordinary in-game resave was attempted.

ROM SHA256: `32f0891f30ca94331d4410486abc37e46bc4bb009be60ac32336a84ccb51987a`
Core SHA256: `33845ef6ffc0ca2fc5203e58a1f1dc608ba90e8e9b140de109d52b14ccec3c17`
Save SHA256: `d30654b4ecd53998c7f796e5a7a390a5044240c33a988067aedfe6562d8ef84c`

## Supported-option boundary
Installed SET_VARIABLES reports `CPU Mode (restart); interpreter`, not jit. SET_CORE_OPTIONS_DISPLAY hides desmume_cpu_mode. Upstream options conditionally include jit under HAVE_JIT, and upstream macOS arm64 Makefile explicitly sets DESMUME_JIT=0 and DESMUME_JIT_ARM=0 (lines 123-128). Never forced an unrecognized jit value or counted fallback as success. CPU Cores advertises 1|2|3|4 and GET_VARIABLE confirms requested 2/4 in candidate reports. Resolution 256x192, frameskip 0, texture scaling 1, edge marking and other rendering settings stay unchanged.

Official upstream sources (snapshots retained here):
- https://github.com/libretro/desmume/blob/master/desmume/src/frontend/libretro/Makefile.libretro
- https://github.com/libretro/desmume/blob/master/desmume/src/frontend/libretro/libretro_core_options.h
- https://github.com/libretro/desmume/blob/master/desmume/src/frontend/libretro/libretro.cpp

## Minimal opt-in integration recommendation
Root may add optional `options=None` to Emulator.__init__, then `self.options.update(options or {})` before callback registration/retro_init. Keep the current defaults. Explicitly opt a newly created isolated runner into `{b"desmume_num_cores": b"2"}`; record requested/queried options in its manifest. Do not mutate the active process or reuse a one-core savestate to claim this cold-boot evidence. Revert by omitting the option. Do not expose jit on this core. This patch is only a recommendation; shared code was not edited.

## Limits
- Short isolated input chain; no full campaign, battle, hardware, or long-term stability claim.
- No new ordinary in-game save created; cold loaded existing ordinary raw save and verified unchanged raw battery after unload.
- Concurrent live worker may add timing noise.
- Initial baseline-valid-1 predates read-only field instrumentation.
- No global JIT settings, live control, live state, ROM, core, or shared harness changes.

Initial prompt-only trials are retained but excluded. Benchmark script instruments the shared harness only in its own process memory and refuses output/input-save paths outside this benchmark directory.
