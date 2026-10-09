/**
 * Test traffic: kept out of the daily stats, the player costs, game demand and the review queue (corrections, missing
 * fights), so the Discord summary and the Costs tab count real players only.
 *
 *   - test guest ids: guest_e2e_…, guest_test_…, guest_sim_…, guest_dev_…, guest_local_…, guest_ci_… (what test scripts
 *     use; the apps make guest_<random> and guest_deck_<hex>)
 *   - anything answered by a server that isn't the deployed one: a local dev server (Cloud Run sets K_SERVICE; set
 *     QC_COUNT_LOCAL=1 to count a local server anyway)
 */
export const TEST_ID = /^guest_(?:e2e|test|tests|sim|dev|local|ci)(?:_|$)/i;

export const isLocalServer = (env: Record<string, string | undefined> = process.env) => !env.K_SERVICE && env.QC_COUNT_LOCAL !== '1';

export function isTestId(uid: unknown): boolean {
  return TEST_ID.test(String(uid || ''));
}

/** True when this player's activity shouldn't be counted. */
export function isTestTraffic(uid: unknown, env: Record<string, string | undefined> = process.env): boolean {
  return isTestId(uid) || isLocalServer(env);
}
