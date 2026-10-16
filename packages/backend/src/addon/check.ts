import { CACHE_ENABLED } from './M3UEPGAddon';
import type { M3UEPGAddon } from './M3UEPGAddon';
import { CheckStep, SourceStats, computeStats } from './sourceReport';

/** A failed fetch older than this is retried by the check instead of reported again. */
const RETRY_FAILED_AFTER_MS = 5000;

export interface CheckResult extends SourceStats {
    ok: boolean;
    provider: string;
    vodSkipped: number;
    steps: CheckStep[];
    error?: string;
}

/** Steps whose failure leaves the addon usable: the guide is optional. */
const OPTIONAL_STEPS = new Set(['guide']);

/**
 * Reports what the built addon serves: the steps of its last provider fetch and
 * the counts of channels, groups and programmes. Runs on the same instance that
 * Stremio requests use, so a passed check leaves the cache warm for the install.
 */
export async function runCheck(addon: M3UEPGAddon): Promise<CheckResult> {
    let report = addon.lastReport;

    const failedLongAgo = report !== null && report.hasFailed() &&
        Date.now() - (report.finishedAt ?? 0) > RETRY_FAILED_AFTER_MS;
    if (failedLongAgo) {
        try {
            await addon.updateData(true);
        } catch {
            // The failure is in the new report
        }
        if (CACHE_ENABLED) addon._evictFromMemory();
        report = addon.lastReport;
    }

    let stats = report?.stats ?? null;
    let steps: CheckStep[] = report ? report.steps.map(s => ({ ...s })) : [];
    if (!stats) {
        if (report === null) {
            // Built from the server cache: no fetch ran, so there are no fetch steps
            await addon.ensureDataLoaded();
            await addon.ensureEpgLoaded();
            steps = [{ id: 'cache', label: 'Server cache', status: 'ok', ms: 0, detail: 'Channels loaded from the last download' }];
        }
        stats = computeStats(addon.channels, addon.epgData);
    }

    const failed = steps.find(s => s.status === 'fail' && !OPTIONAL_STEPS.has(s.id));
    const ok = !failed && stats.channels > 0;
    return {
        ok,
        provider: addon.providerName,
        ...stats,
        vodSkipped: report?.vodSkipped ?? 0,
        steps,
        ...(ok ? {} : { error: failed?.detail ?? 'The source has no live channels.' }),
    };
}
