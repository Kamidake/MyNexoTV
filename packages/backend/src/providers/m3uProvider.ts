'use strict';

import crypto from 'crypto';
import { parseM3U } from '../parsers/m3uParser';
import { validatePublicUrl } from '../utils/validateUrl';
import env from '../config/env';
import { SourceReport, describeFetchError, describeHttpStatus, formatCount, hostOf } from '../addon/sourceReport';
import { loadGuide } from './guide';

async function withTimeout(url: string, options: any, ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Derive a stable 12-char hex ID for a channel.
 */
function deriveBaseId(channel: any, idPrefix: string) {
    const raw = channel.tvgId && channel.tvgId.trim()
        ? channel.tvgId.trim()
        : channel.url;
    const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
    return `m3${idPrefix}_${hash}`;
}

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;
    const report: SourceReport = addonInstance.report ?? new SourceReport();
    const m3uUrl = typeof config.m3uUrl === 'string' ? config.m3uUrl.trim() : '';

    const started = Date.now();
    if (!m3uUrl) {
        throw report.failWith('playlist', 'Playlist download', started, 'Enter the playlist URL.', 'm3uUrl');
    }
    const host = hostOf(m3uUrl);

    const conditionalHeaders: Record<string, string> = {};
    if (addonInstance.m3uEtag) {
        conditionalHeaders['If-None-Match'] = addonInstance.m3uEtag;
    } else if (addonInstance.m3uLastModified) {
        conditionalHeaders['If-Modified-Since'] = addonInstance.m3uLastModified;
    }

    let resp: Response;
    let text: string;
    try {
        await validatePublicUrl(m3uUrl);
        resp = await withTimeout(m3uUrl, { headers: conditionalHeaders }, env.FETCH_TIMEOUT_MS);
        if (resp.status === 304) {
            addonInstance.log?.debug('M3U 304 Not Modified — skipping parse');
            report.ok('playlist', 'Playlist download', started, `${host} · not changed since the last download`);
            return;
        }
        if (!resp.ok) {
            throw report.failWith('playlist', 'Playlist download', started,
                describeHttpStatus(resp.status, host, 'playlist'), 'm3uUrl');
        }
        text = await resp.text();
    } catch (e) {
        if (report.hasFailed('playlist')) throw e;
        throw report.failWith('playlist', 'Playlist download', started,
            describeFetchError(e, m3uUrl, env.FETCH_TIMEOUT_MS), 'm3uUrl');
    }
    report.ok('playlist', 'Playlist download', started, `${host} · ${formatCount(Math.ceil(Buffer.byteLength(text) / 1024))} KB`);

    addonInstance.m3uEtag = resp.headers.get('etag') ?? null;
    addonInstance.m3uLastModified = resp.headers.get('last-modified') ?? null;

    addonInstance.channels = [];
    addonInstance.epgData = {};

    const parseStarted = Date.now();
    const { channels: parsed, epgUrl: detectedEpgUrl, vodSkipped } = parseM3U(text, { includeVod: env.M3U_INCLUDE_VOD });
    report.vodSkipped = vodSkipped;
    if (vodSkipped > 0) {
        addonInstance.log?.debug(`M3U skipped ${vodSkipped} VOD entries (movie/series); set M3U_INCLUDE_VOD=true to keep them`);
    }

    const seenIds = new Set<string>();
    addonInstance.channels = parsed.map((ch: any) => {
        let id = deriveBaseId(ch, addonInstance.idPrefix);
        if (seenIds.has(id)) {
            let counter = 2;
            while (seenIds.has(`${id}_${counter}`)) counter++;
            id = `${id}_${counter}`;
        }
        seenIds.add(id);

        return {
            id,
            name:     ch.name,
            type:     'tv',
            url:      ch.url,
            logo:     ch.logo || '',
            category: ch.group,
            epg_channel_id: ch.tvgId || ch.tvgName || '',
            userAgent: ch.userAgent || config.globalUserAgent || '',
            referrer:  ch.referrer || '',
            attributes: {
                'tvg-id':      ch.tvgId,
                'tvg-name':    ch.tvgName,
                'tvg-logo':    ch.logo,
                'group-title': ch.group,
            },
        };
    });

    if (addonInstance.channels.length === 0) {
        const why = vodSkipped > 0
            ? `The playlist has only movies and series (${formatCount(vodSkipped)} entries), and NexoTV serves live channels.`
            : 'The playlist has no channels. Check that the address returns an M3U file.';
        report.fail('channels', 'Live channels', parseStarted, why, 'm3uUrl');
    } else {
        report.ok('channels', 'Live channels', parseStarted);
    }
    if (vodSkipped > 0) {
        report.skip('vod', 'Movies and series', `${formatCount(vodSkipped)} entries, not live`);
    }

    if (!config.enableEpg) {
        report.skip('guide', 'Program guide', 'Turned off');
        return;
    }
    const customEpgUrl = typeof config.epgUrl === 'string' ? config.epgUrl.trim() : '';
    const epgSource = customEpgUrl || detectedEpgUrl;
    if (!epgSource) {
        report.skip('guide', 'Program guide', 'The playlist names no guide. Add a custom guide URL in the advanced options.');
        return;
    }
    await loadGuide(addonInstance, report, { url: epgSource, custom: !!customEpgUrl });
}
