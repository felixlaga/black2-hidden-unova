/** Gym-local puzzle state uses retail map-local work slots, never global flags.
 * 0x4000/4001 are explicitly documented as map_local_0/map_local_1 by the pinned
 * compiler. Every Gym entry resets them; saves and native map initialization may
 * also reset them. Emblems retain their separate campaign-owned victory flags. */
export const WORLD_PUZZLE_WORK={stage:0x4000,gym:0x4001} as const;
export const WORLD_GYM_PUZZLES=[
 {stations:['Seed gate','Reed filter','Glasshouse outlet'],order:[0,1,2],clue:'Water reaches the seeds first. The reeds clean it before the glasshouse outlet opens.',done:'The three irrigation gates are aligned. The gardener clears the dry crossing.'},
 {stations:['Air bellows','Fuel hatch','Cooling vent'],order:[1,0,2],clue:'Load the fuel before the bellows feed the flame. Open the cooling vent last.',done:'The kiln pressure is steady. The fire steward clears the crossing.'},
 {stations:['Wheel brake','Copper contact','Signal isolator'],order:[2,0,1],clue:'Isolate the old signal, stop the wheel, then reconnect the copper contact.',done:'The wheelworks circuit is safe. The engineer clears the inspection lane.'},
 {stations:['Morning shadow','Noon marker','Evening shadow'],order:[0,1,2],clue:'Trace one day across the sundial: morning, noon, then evening.',done:'The three sight lines meet. The surveyor clears the contour path.'},
 {stations:['Upper gate','Nursery sluice','Lower gate'],order:[2,1,0],clue:'Make room downstream first. Let the nursery water settle before releasing the upper gate.',done:'The water levels match. The lockkeeper clears the dry walkway.'},
 {stations:['Fine gravel','Foundation slab','Drainage stones'],order:[1,2,0],clue:'Lay the foundation, leave drainage spaces, then level the fine gravel.',done:'The quarry ramp is stable. The mason clears the marked steps.'},
 {stations:['Windward ribbon','Sheltered ribbon','Crosswind ribbon'],order:[0,2,1],clue:'Read the strongest wind first, then its crosswind. Finish at the sheltered ribbon.',done:'The sail braces agree. The courier clears the windbreak crossing.'},
 {stations:['Frost shutter','Warmstone valve','Snowmelt drain'],order:[2,0,1],clue:'Open the meltwater drain. Shield the frozen bank before admitting warm water.',done:'The warmstone circuit is balanced. The keeper clears the refuge bridge.'},
 {stations:['Steady stance','Measured step','Resting breath'],order:[2,0,1],clue:'Begin with a calm breath, find your stance, then take a measured step.',done:'The training pattern is complete. The instructor clears the practice lane.'},
 {stations:['Harbor earth','Lamp contact','Signal coil'],order:[0,2,1],clue:'Earth the harbor circuit, test the signal coil, then connect the lamp.',done:'The lamps hold a steady light. The electrician clears the quay crossing.'},
 {stations:['Cloud reflection','Horizon mark','Near-bank mirror'],order:[1,0,2],clue:'Fix the horizon first. Compare the cloud above with its near-bank reflection.',done:'The three observations agree. The observer clears the mirror walk.'},
 {stations:['Upstream watch','Bridge marker','Downstream watch'],order:[0,2,1],clue:'Both banks must report before the bridge marker is set. Upstream speaks first.',done:'The shared watch is ready. The bridgekeeper clears the challenge crossing.'},
] as const;
export function puzzleReset(gym:number){return `work_set ${WORLD_PUZZLE_WORK.stage}, 0\nwork_set ${WORLD_PUZZLE_WORK.gym}, ${gym+1}`;}
export function puzzleNormalize(gym:number){return `if world_puzzle_gym != ${gym+1}\n${puzzleReset(gym)}\nend`;}
export function puzzleSwitchBody(gym:number,station:number,messages:{correct:number;wrong:number;done:number},blocker:number){
 const stage=WORLD_GYM_PUZZLES[gym].order.indexOf(station as never),complete=stage===2;
 return ['lock',puzzleNormalize(gym),'if world_puzzle_stage == 3',`talk message: ${messages.done}`,'finish_interaction','end',`if world_puzzle_stage != ${stage}`,`work_set ${WORLD_PUZZLE_WORK.stage}, 0`,`talk message: ${messages.wrong}`,'finish_interaction','end',`work_set ${WORLD_PUZZLE_WORK.stage}, ${stage+1}`,...(complete?[`actor_delete ${blocker}`]:[]),`talk message: ${complete?messages.done:messages.correct}`,'finish_interaction'].join('\n');
}
export function puzzleBlockerBody(gym:number,missing:number,done:number,actorId:number){return ['lock',puzzleNormalize(gym),'if world_puzzle_stage == 3',`talk message: ${done}`,`actor_delete ${actorId}`,'finish_interaction','end',`talk message: ${missing}`,'finish_interaction'].join('\n');}
