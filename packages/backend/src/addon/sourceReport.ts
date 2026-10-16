/**
 * The steps a provider fetch went through, kept on the addon instance so the
 * check endpoint can show the user what happened during the last build.
 *
 * Step details are shown on the configure page, so they never carry a URL
 * path, a query string or a credential: only the host name.
 */

export type StepStatus = 'ok' | 'skip' | 'fail';

/** The config field a failed step points at, so the page can mark it. */
export type ConfigField = 'xtreamUrl' | 'xtreamUsername' | 'xtreamPassword' | 'm3uUrl' | 'epgUrl';

export interface CheckStep {
    id: string;
    label: string;
    status: StepStatus;
    ms: number;
    detail: string;
    field?: ConfigField;
}

export interface SourceStats {
    channels: number;
    groups: number;
    programmes: number;
    channelsWithGuide: number;
}

/** An error the user can act on: the message is safe to show as is. */
export class SourceError extends Error {
    readonly field?: ConfigField;

    constructor(message: string, field?: ConfigField) {
        super(message);
        this.name = 'SourceError';
        this.field = field;
    }
}

export class SourceReport {
    readonly steps: CheckStep[] = [];
    readonly startedAt = Date.now();
    finishedAt: number | null = null;
    vodSkipped = 0;
    stats: SourceStats | null = null;

    ok(id: string, label: string, since: number, detail = '') {
        this.steps.push({ id, label, status: 'ok', ms: Date.now() - since, detail });
    }

    skip(id: string, label: string, detail: string) {
        this.steps.push({ id, label, status: 'skip', ms: 0, detail });
    }

    fail(id: string, label: string, since: number, detail: string, field?: ConfigField) {
        this.steps.push({ id, label, status: 'fail', ms: Date.now() - since, detail, ...(field ? { field } : {}) });
    }

    /** Records the failure and returns the error for the provider to throw. */
    failWith(id: string, label: string, since: number, detail: string, field?: ConfigField) {
        this.fail(id, label, since, detail, field);
        return new SourceError(detail, field);
    }

    hasFailed(id?: string) {
        return this.steps.some(s => s.status === 'fail' && (id === undefined || s.id === id));
    }
}

/** Host name of a URL, or a placeholder when the URL does not parse. */
export function hostOf(url: string) {
    try {
        return new URL(url).hostname || 'the server';
    } catch {
        return 'the server';
    }
}

function errorCode(e: unknown): string {
    if (typeof e !== 'object' || e === null) return '';
    const err = e as { code?: unknown; cause?: unknown; name?: unknown };
    if (typeof err.code === 'string') return err.code;
    if (err.cause) return errorCode(err.cause);
    return '';
}

/**
 * Turns a thrown fetch or URL-validation error into one sentence the user can act on.
 */
export function describeFetchError(e: unknown, url: string, timeoutMs: number): string {
    const host = hostOf(url);
    const message = e instanceof Error ? e.message : String(e);
    const name = e instanceof Error ? e.name : '';

    if (message.startsWith('Invalid URL') || message.startsWith('Only HTTP(S)')) {
        return 'This is not a valid http:// or https:// address.';
    }
    if (message.startsWith('Blocked host')) {
        return `${host} is on a private network, and this server only connects to public addresses.`;
    }
    if (message.startsWith('Cannot resolve host')) {
        return `Cannot find ${host}. Check the address.`;
    }
    if (name === 'AbortError' || name === 'TimeoutError') {
        return `${host} did not answer within ${Math.round(timeoutMs / 1000)} s.`;
    }

    const code = errorCode(e);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Cannot find ${host}. Check the address.`;
    if (code === 'ECONNREFUSED') return `${host} refused the connection. Check the address and port.`;
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return `${host} closed the connection.`;
    if (code.startsWith('ERR_TLS') || code.includes('CERT')) return `${host} has an invalid TLS certificate.`;
    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
        return `${host} did not answer within ${Math.round(timeoutMs / 1000)} s.`;
    }
    return `Cannot reach ${host}.`;
}

/** One sentence for a non-2xx response. */
export function describeHttpStatus(status: number, host: string, what: string): string {
    if (status === 401 || status === 403) {
        return `${host} rejected the login (HTTP ${status}). Check the username and password.`;
    }
    if (status === 404) return `${host} has no ${what} at this address (HTTP 404).`;
    if (status === 429) return `${host} is limiting requests (HTTP 429). Try again in a few minutes.`;
    if (status >= 500) return `${host} had an internal error (HTTP ${status}). Try again later.`;
    return `${host} refused the ${what} request (HTTP ${status}).`;
}

/** Counts shown in the check summary, from the data the addon serves. */
export function computeStats(channels: any[], epgData: Record<string, unknown[]>): SourceStats {
    const groups = new Set<string>();
    let channelsWithGuide = 0;
    for (const c of channels) {
        const group = c.category || c.attributes?.['group-title'];
        if (group) groups.add(String(group).trim());
        const epgId = c.attributes?.['tvg-id'] || c.attributes?.['tvg-name'];
        if (epgId && Array.isArray(epgData[epgId]) && epgData[epgId].length > 0) channelsWithGuide++;
    }
    let programmes = 0;
    for (const list of Object.values(epgData)) {
        if (Array.isArray(list)) programmes += list.length;
    }
    return { channels: channels.length, groups: groups.size, programmes, channelsWithGuide };
}

export function formatCount(n: number) {
    return n.toLocaleString('en-US');
}
