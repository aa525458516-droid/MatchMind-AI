/**
 * Phase 6 Dataset Guards, Season-Keyed Cache Keys, and Leakage Assertions
 *
 * Strictly forbids accessing:
 * - The 6 Protected Blind Holdout datasets
 * - The 10 External Validation datasets
 * - Chain B confirmatory datasets during Steps 1-3
 * - Target-match observed xG or post-kickoff data
 */

export const PROTECTED_BLIND_HOLDOUT_IDS: ReadonlySet<string> = new Set([
  'statsbomb-9-27', // Bundesliga 2015/2016
  'statsbomb-12-27', // Serie A 2015/2016
  'statsbomb-7-27', // Ligue 1 2015/2016
  'statsbomb-9-281', // Bundesliga 2023/2024
  'openliga-bl1-2015', // Duplicate season of statsbomb-9-27
  'openliga-bl1-2023', // Duplicate season of statsbomb-9-281
]);

export const EXTERNAL_VALIDATION_IDS: ReadonlySet<string> = new Set([
  'statsbomb-182-281', // Liga F 2023/2024
  'statsbomb-49-107', // NWSL 2023
  'statsbomb-37-281', // FA WSL 2023/2024
  'statsbomb-135-281', // Frauen Bundesliga 2023/2024
  'statsbomb-131-281', // Serie A Women 2023/2024
  'openliga-bl1-2024', // Bundesliga 2024/2025
  'openliga-bl1-2022', // Bundesliga 2022/2023
  'openliga-bl2-2024', // 2. Bundesliga 2024/2025
  'openliga-bl2-2023', // 2. Bundesliga 2023/2024
  'openliga-bl3-2023', // 3. Liga 2023/2024
]);

export const CHAIN_B_CONFIRMATORY_IDS: ReadonlySet<string> = new Set([
  'openliga-bl1-2009',
  'openliga-bl1-2010',
  'openliga-bl1-2011',
  'openliga-bl1-2012',
  'openliga-bl1-2013',
  'openliga-bl1-2014',
  'openliga-bl2-2009',
  'openliga-bl2-2010',
  'openliga-bl2-2011',
  'openliga-bl2-2012',
  'openliga-bl2-2013',
]);

export const APPROVED_CHAIN_A_BL1_SEASONS: readonly string[] = [
  '2016',
  '2017',
  '2018',
  '2019',
  '2020',
  '2021',
];

export const APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS: readonly string[] = [
  '2015',
  '2016',
  '2017',
  '2018',
  '2019',
  '2020',
];

export const APPROVED_CHAIN_C_STATSBOMB_IDS: readonly string[] = [
  'statsbomb-37-4',
  'statsbomb-37-42',
  'statsbomb-37-90',
];

export const APPROVED_STEP1_3_DATASET_IDS: ReadonlySet<string> = new Set([
  ...APPROVED_CHAIN_A_BL1_SEASONS.map((s) => `openliga-bl1-${s}`),
  ...APPROVED_CHAIN_A_BL2_BRIDGE_SEASONS.map((s) => `openliga-bl2-${s}`),
  ...APPROVED_CHAIN_C_STATSBOMB_IDS,
]);

export function normalizePhase6DatasetId(datasetId: string): string {
  return String(datasetId || '').trim().toLowerCase();
}

export function isProtectedBlindHoldout(datasetId: string): boolean {
  return PROTECTED_BLIND_HOLDOUT_IDS.has(normalizePhase6DatasetId(datasetId));
}

export function isExternalValidationDataset(datasetId: string): boolean {
  return EXTERNAL_VALIDATION_IDS.has(normalizePhase6DatasetId(datasetId));
}

export function isChainBConfirmatoryDataset(datasetId: string): boolean {
  return CHAIN_B_CONFIRMATORY_IDS.has(normalizePhase6DatasetId(datasetId));
}

export function assertApprovedPhase6Dataset(
  datasetId: string,
  options?: { allowChainB?: boolean }
): void {
  const id = normalizePhase6DatasetId(datasetId);
  if (!id) {
    throw new Error('PHASE 6 GUARD: Empty dataset identifier is forbidden.');
  }
  if (PROTECTED_BLIND_HOLDOUT_IDS.has(id)) {
    throw new Error(
      `PHASE 6 PROTECTED HOLDOUT GUARD: Access to protected blind holdout dataset "${id}" is strictly forbidden.`
    );
  }
  if (EXTERNAL_VALIDATION_IDS.has(id)) {
    throw new Error(
      `PHASE 6 EXTERNAL VALIDATION GUARD: Tuning or evaluation on external validation dataset "${id}" is strictly forbidden.`
    );
  }
  if (CHAIN_B_CONFIRMATORY_IDS.has(id) && !options?.allowChainB) {
    throw new Error(
      `PHASE 6 STEP 1-3 GUARD: Confirmatory Chain B dataset "${id}" must not be accessed before Step 4 authorization.`
    );
  }
  if (!APPROVED_STEP1_3_DATASET_IDS.has(id) && !(options?.allowChainB && CHAIN_B_CONFIRMATORY_IDS.has(id))) {
    throw new Error(
      `PHASE 6 ALLOWLIST GUARD: Dataset "${id}" is not in the approved Phase 6 Steps 1-3 development chains.`
    );
  }
}

/**
 * Canonical season-keyed cache key preventing openliga-bl1 cross-season collisions.
 */
export function makeSeasonCacheKey(
  provider: 'openliga' | 'statsbomb',
  competitionKey: string,
  seasonLabel: string,
  tier: number
): string {
  const cleanComp = String(competitionKey).trim().toLowerCase();
  const cleanSeason = String(seasonLabel).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `p6:${provider}:${cleanComp}:t${tier}:s_${cleanSeason}`;
}

/**
 * Enforce skipObservedXG: true on every statistics fetch inside Phase 6.
 */
export function enforceSkipObservedXG<T extends { skipObservedXG?: boolean }>(
  options?: T
): T & { skipObservedXG: true } {
  if (options && options.skipObservedXG === false) {
    throw new Error(
      'PHASE 6 LEAKAGE GUARD: Attempted statistics fetch with skipObservedXG=false. Target-match observed xG is strictly forbidden.'
    );
  }
  return {
    ...(options ?? ({} as T)),
    skipObservedXG: true,
  };
}

/**
 * Runtime guard asserting exact-timestamp batch evaluation causality:
 * Every match in a batch shares identical timestampMs > stateHighWaterMs.
 */
export function assertTimestampBatchIntegrity(
  batchTimestampMs: number,
  stateHighWaterMs: number | null,
  matches: ReadonlyArray<{ id: string; timestampMs: number }>
): void {
  if (!Number.isFinite(batchTimestampMs)) {
    throw new Error('PHASE 6 CAUSALITY GUARD: Batch has non-finite timestampMs.');
  }
  if (stateHighWaterMs !== null && batchTimestampMs <= stateHighWaterMs) {
    throw new Error(
      `PHASE 6 CAUSALITY GUARD: Out-of-order batch timestamp ${batchTimestampMs} <= committed high-water mark ${stateHighWaterMs}.`
    );
  }
  for (const m of matches) {
    if (m.timestampMs !== batchTimestampMs) {
      throw new Error(
        `PHASE 6 CAUSALITY GUARD: Match ${m.id} timestamp ${m.timestampMs} mismatches batch timestamp ${batchTimestampMs}.`
      );
    }
  }
}
