import { validatePublicUrl } from '../utils/validateUrl';
import env from '../config/env';
import { SourceReport, describeFetchError, describeHttpStatus, hostOf } from '../addon/sourceReport';
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

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;
    const report: SourceReport = addonInstance.report ?? new SourceReport();
    const {
        xtreamUrl,
        xtreamUsername,
        xtreamPassword
    } = config;

    const started = Date.now();
    if (!xtreamUrl || !xtreamUsername || !xtreamPassword) {
        const field = !xtreamUrl ? 'xtreamUrl' : !xtreamUsername ? 'xtreamUsername' : 'xtreamPassword';
        throw report.failWith('server', 'Panel reachable', started, 'Enter the server URL, username and password.', field);
    }
    const host = hostOf(xtreamUrl);

    const base = `${xtreamUrl}/player_api.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;

    const liveHeaders: Record<string, string> = {};
    if (addonInstance.xtreamEtag) liveHeaders['If-None-Match'] = addonInstance.xtreamEtag;

    let liveResp: Response;
    let liveCatsResp: Response | null;
    try {
        await validatePublicUrl(xtreamUrl);
        [liveResp, liveCatsResp] = await Promise.all([
            withTimeout(`${base}&action=get_live_streams`, { headers: liveHeaders }, env.FETCH_TIMEOUT_MS),
            withTimeout(`${base}&action=get_live_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null)
        ]);
    } catch (e) {
        throw report.failWith('server', 'Panel reachable', started,
            describeFetchError(e, xtreamUrl, env.FETCH_TIMEOUT_MS), 'xtreamUrl');
    }
    report.ok('server', 'Panel reachable', started, host);

    const loginStarted = Date.now();
    if (liveResp.status === 304) {
        addonInstance.log?.debug('Xtream 304 Not Modified — skipping update');
        report.ok('login', 'Login accepted', loginStarted, 'Channel list not changed since the last download');
        return;
    }
    if (!liveResp.ok) {
        const field = liveResp.status === 401 || liveResp.status === 403 ? 'xtreamPassword' : 'xtreamUrl';
        throw report.failWith('login', 'Login accepted', loginStarted,
            describeHttpStatus(liveResp.status, host, 'Xtream API'), field);
    }

    let live: unknown;
    try {
        live = await liveResp.json();
    } catch {
        throw report.failWith('login', 'Login accepted', loginStarted,
            `${host} did not answer as an Xtream Codes panel. Check the server URL.`, 'xtreamUrl');
    }
    // Panels answer a bad login with HTTP 200 and an object such as {"user_info":{"auth":0}}
    if (!Array.isArray(live)) {
        throw report.failWith('login', 'Login accepted', loginStarted,
            `${host} did not accept the username and password.`, 'xtreamPassword');
    }
    report.ok('login', 'Login accepted', loginStarted);

    addonInstance.xtreamEtag = liveResp.headers.get('etag') ?? null;

    addonInstance.channels = [];
    addonInstance.epgData = {};

    let liveCatMap: Record<string, string> = {};
    try {
        if (liveCatsResp && liveCatsResp.ok) {
            const arr = await liveCatsResp.json();
            if (Array.isArray(arr)) {
                for (const c of arr) {
                    if (c && c.category_id && c.category_name)
                        liveCatMap[c.category_id] = c.category_name;
                }
            }
        }
    } catch { /* ignore */ }

    addonInstance.channels = live.map((s: any) => {
        const cat = liveCatMap[s.category_id] || s.category_name || s.category_id || 'Live';
        return {
            id: `xc${addonInstance.idPrefix}_${s.stream_id}`,
            name: s.name,
            type: 'tv',
            url: `${xtreamUrl}/live/${xtreamUsername}/${xtreamPassword}/${s.stream_id}.m3u8`,
            logo: s.stream_icon,
            category: cat,
            epg_channel_id: s.epg_channel_id,
            attributes: {
                'tvg-logo': s.stream_icon,
                'tvg-id': s.epg_channel_id,
                'group-title': cat
            }
        };
    });

    if (addonInstance.channels.length === 0) {
        report.fail('channels', 'Live streams', loginStarted, 'The panel accepted the login but lists no live channels.');
    } else {
        report.ok('channels', 'Live streams', loginStarted);
    }

    if (!config.enableEpg) {
        report.skip('guide', 'Program guide', 'Turned off');
        return;
    }
    const customEpgUrl = config.epgUrl && typeof config.epgUrl === 'string' && config.epgUrl.trim() ? config.epgUrl.trim() : null;
    await loadGuide(addonInstance, report, customEpgUrl
        ? { url: customEpgUrl, custom: true }
        : { url: `${xtreamUrl}/xmltv.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`, custom: false, trusted: true });
}
