import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
    process.env.CACHE_ENABLED = 'false';
});

import {
    SourceReport, SourceError, computeStats, describeFetchError, describeHttpStatus, hostOf,
} from '../../src/addon/sourceReport';
import { runCheck } from '../../src/addon/check';
import type { M3UEPGAddon } from '../../src/addon/M3UEPGAddon';

const URL_ = 'http://panel.example.com:8080/get.php?username=u&password=p';

function codeError(code: string) {
    return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) });
}

describe('describeFetchError', () => {
    it.each([
        [new Error('Invalid URL: x'), 'This is not a valid http:// or https:// address.'],
        [new Error('Only HTTP(S) URLs are allowed'), 'This is not a valid http:// or https:// address.'],
        [new Error('Blocked host: 10.0.0.1'), 'panel.example.com is on a private network, and this server only connects to public addresses.'],
        [new Error('Cannot resolve host: x'), 'Cannot find panel.example.com. Check the address.'],
        [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'panel.example.com did not answer within 30 s.'],
        [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), 'panel.example.com did not answer within 30 s.'],
        [codeError('ENOTFOUND'), 'Cannot find panel.example.com. Check the address.'],
        [codeError('ECONNREFUSED'), 'panel.example.com refused the connection. Check the address and port.'],
        [codeError('ECONNRESET'), 'panel.example.com closed the connection.'],
        [codeError('CERT_HAS_EXPIRED'), 'panel.example.com has an invalid TLS certificate.'],
        [codeError('UND_ERR_CONNECT_TIMEOUT'), 'panel.example.com did not answer within 30 s.'],
        [new TypeError('fetch failed'), 'Cannot reach panel.example.com.'],
        ['a string', 'Cannot reach panel.example.com.'],
    ])('describes %s', (error, expected) => {
        expect(describeFetchError(error, URL_, 30_000)).toBe(expected);
    });

    it('never repeats the path or the query of the URL', () => {
        expect(describeFetchError(new Error('Blocked host'), URL_, 1000)).not.toMatch(/password|get\.php/);
    });
});

describe('describeHttpStatus', () => {
    it.each([
        [401, 'h rejected the login (HTTP 401). Check the username and password.'],
        [403, 'h rejected the login (HTTP 403). Check the username and password.'],
        [404, 'h has no playlist at this address (HTTP 404).'],
        [429, 'h is limiting requests (HTTP 429). Try again in a few minutes.'],
        [502, 'h had an internal error (HTTP 502). Try again later.'],
        [410, 'h refused the playlist request (HTTP 410).'],
    ])('describes HTTP %i', (status, expected) => {
        expect(describeHttpStatus(status, 'h', 'playlist')).toBe(expected);
    });
});

describe('hostOf', () => {
    it('falls back for a URL that does not parse', () => {
        expect(hostOf('not a url')).toBe('the server');
    });
});

describe('computeStats', () => {
    it('counts distinct groups, programmes and channels with a guide', () => {
        const channels = [
            { category: 'News', attributes: { 'tvg-id': 'a' } },
            { attributes: { 'group-title': ' News ', 'tvg-name': 'b' } },
            { category: 'Sports', attributes: { 'tvg-id': 'c' } },
            { attributes: {} },
        ];
        expect(computeStats(channels, { a: [1, 2], b: [], c: [3], z: [4] })).toEqual({
            channels: 4, groups: 2, programmes: 4, channelsWithGuide: 2,
        });
    });
});

describe('SourceReport', () => {
    it('returns a SourceError that carries the field', () => {
        const report = new SourceReport();
        const err = report.failWith('login', 'Login', Date.now(), 'Bad login', 'xtreamPassword');
        expect(err).toBeInstanceOf(SourceError);
        expect(err.field).toBe('xtreamPassword');
        expect(report.hasFailed('login')).toBe(true);
        expect(report.hasFailed('guide')).toBe(false);
    });
});

function fakeAddon(overrides: Partial<M3UEPGAddon> = {}) {
    return {
        providerName: 'm3u',
        lastReport: null,
        channels: [],
        epgData: {},
        updateData: vi.fn(async () => {}),
        ensureDataLoaded: vi.fn(async () => {}),
        ensureEpgLoaded: vi.fn(async () => {}),
        _evictFromMemory: vi.fn(),
        ...overrides,
    } as unknown as M3UEPGAddon;
}

describe('runCheck', () => {
    it('reports channels served from the server cache when no fetch ran', async () => {
        const addon = fakeAddon({
            channels: [{ category: 'News', attributes: { 'tvg-id': 'a' } }],
            epgData: { a: [{}, {}] },
        });
        const result = await runCheck(addon);
        expect(addon.ensureDataLoaded).toHaveBeenCalled();
        expect(result).toMatchObject({ ok: true, channels: 1, groups: 1, programmes: 2, channelsWithGuide: 1 });
        expect(result.steps.map(s => s.id)).toEqual(['cache']);
    });

    it('fails when the source has no channels', async () => {
        const result = await runCheck(fakeAddon());
        expect(result.ok).toBe(false);
        expect(result.error).toBe('The source has no live channels.');
    });

    it('retries a fetch that failed a while ago and reports the new attempt', async () => {
        const old = new SourceReport();
        old.fail('playlist', 'Playlist download', Date.now(), 'Cannot reach h.');
        old.finishedAt = Date.now() - 60_000;

        const fresh = new SourceReport();
        fresh.ok('playlist', 'Playlist download', Date.now(), 'h');
        fresh.stats = { channels: 5, groups: 2, programmes: 0, channelsWithGuide: 0 };
        fresh.finishedAt = Date.now();

        const addon = fakeAddon({ lastReport: old });
        vi.mocked(addon.updateData).mockImplementation(async () => { addon.lastReport = fresh; });

        const result = await runCheck(addon);
        expect(addon.updateData).toHaveBeenCalledWith(true);
        expect(result).toMatchObject({ ok: true, channels: 5 });
    });

    it('reports a fresh failure without fetching again', async () => {
        const report = new SourceReport();
        report.fail('login', 'Login accepted', Date.now(), 'Bad login', 'xtreamPassword');
        report.finishedAt = Date.now();
        const addon = fakeAddon({ lastReport: report });

        const result = await runCheck(addon);
        expect(addon.updateData).not.toHaveBeenCalled();
        expect(result).toMatchObject({ ok: false, error: 'Bad login' });
        expect(result.steps[0].field).toBe('xtreamPassword');
    });
});
