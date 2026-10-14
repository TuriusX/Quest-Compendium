/**
 * "Spot it (landmarks, NPCs, chests)" (roadmap item 7): a guide entry looked for on a fresh screenshot of the game
 * (server: spot.ts). The Guide view sends this event with the entry ({ id: g:<area slug>:<entry id>, label, where });
 * the quest log sends the same through its tracker events. App.tsx runs the check.
 */
export const SPOT_EVENT = 'qc-spot';
export type SpotRequest = { id: string; label: string; where?: string };
