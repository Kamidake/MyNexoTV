import { Readable } from 'stream';
import { parseEPGStream } from '../parsers/epgParser';
import { validatePublicUrl } from '../utils/validateUrl';
import env from '../config/env';
import { SourceReport, describeFetchError, describeHttpStatus, hostOf } from '../addon/sourceReport';

const ID = 'guide';
const LABEL = 'Program guide';

interface GuideSource {
    url: string;
    /** The user typed this URL, so a failure points at the guide URL field. */
    custom: boolean;
    /** The URL was already validated as the provider URL. */
    trusted?: boolean;
}

/**
 * Downloads and parses the XMLTV guide into addonInstance.epgData.
 * A failed guide is recorded on the report and never thrown: the guide is optional.
 */
export async function loadGuide(addonInstance: any, report: SourceReport, source: GuideSource) {
    const now = Date.now();
    const stale = !addonInstance.lastEpgUpdate || (now - addonInstance.lastEpgUpdate > env.EPG_UPDATE_INTERVAL_MS);
    if (!stale) {
        addonInstance.log?.debug('EPG skip (interval not elapsed)', { ms: now - (addonInstance.lastEpgUpdate ?? 0) });
        report.skip(ID, LABEL, 'Loaded recently, kept from the last download.');
        return;
    }

    const field = source.custom ? 'epgUrl' as const : undefined;
    const host = hostOf(source.url);
    const started = Date.now();
    let resp: Response;
    try {
        if (!source.trusted) await validatePublicUrl(source.url);
        // The signal also bounds the body download, which is streamed into the parser
        resp = await fetch(source.url, { signal: AbortSignal.timeout(env.EPG_FETCH_TIMEOUT_MS) });
    } catch (e) {
        report.fail(ID, LABEL, started, describeFetchError(e, source.url, env.EPG_FETCH_TIMEOUT_MS), field);
        return;
    }

    if (!resp.ok) {
        report.fail(ID, LABEL, started, describeHttpStatus(resp.status, host, 'guide'), field);
        return;
    }

    const contentLength = parseInt(resp.headers.get('content-length') ?? '0', 10);
    if (contentLength > env.EPG_MAX_BYTES) {
        const sizeMb = (contentLength / 1024 / 1024).toFixed(1);
        const maxMb = (env.EPG_MAX_BYTES / 1024 / 1024).toFixed(0);
        addonInstance.log?.warn(`[EPG] Content-Length too large (${sizeMb} MB), skipping download`);
        try { await resp.body?.cancel(); } catch { /* ignore */ }
        report.fail(ID, LABEL, started, `The guide is ${sizeMb} MB, over this server's ${maxMb} MB limit.`, field);
        return;
    }

    try {
        addonInstance.epgData = await parseEPGStream(resp.body ? Readable.fromWeb(resp.body as any) : [], addonInstance.log, {
            nativeDays: addonInstance.nativeEpg ? env.EPG_NATIVE_DAYS : undefined,
        });
        addonInstance.lastEpgUpdate = Date.now();
    } catch (e) {
        report.fail(ID, LABEL, started, describeFetchError(e, source.url, env.EPG_FETCH_TIMEOUT_MS), field);
        return;
    }

    // The parser returns an empty guide for unreadable XML, a body over the limit, or a stale guide
    if (Object.keys(addonInstance.epgData).length === 0) {
        report.fail(ID, LABEL, started, `${host} sent no current or upcoming programmes. Check that the address is an XMLTV guide.`, field);
        return;
    }

    // The detail with the channel match is filled in by the addon once channels are known
    report.ok(ID, LABEL, started, host);
}
