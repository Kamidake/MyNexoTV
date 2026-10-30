import crypto from 'crypto';
import LRUCache from '../utils/lruCache';
import * as sqliteCache from '../utils/sqliteCache';
import { makeLogger } from '../utils/logger';
import { parseEPG, getCurrentProgram, getUpcomingPrograms } from '../parsers/epgParser';
import env from '../config/env';
import * as xtreamProvider from '../providers/xtreamProvider';
import * as iptvOrgProvider from '../providers/iptvOrgProvider';
import * as m3uProvider from '../providers/m3uProvider';
import { SourceReport, computeStats, formatCount } from './sourceReport';

const CACHE_ENABLED = env.CACHE_ENABLED;
const CACHE_TTL_MS = env.CACHE_TTL_MS;
const MAX_CACHE_ENTRIES = env.MAX_CACHE_ENTRIES;

if (CACHE_ENABLED) {
    sqliteCache.init(env.SQLITE_PATH);
}

export const buildPromiseCache = new LRUCache({ max: MAX_CACHE_ENTRIES, ttl: CACHE_TTL_MS });

const PROVIDER_MAP: Record<string, { fetchData: (addon: any) => Promise<void> }> = {
    'xtream': xtreamProvider,
    'iptv-org': iptvOrgProvider,
    'm3u': m3uProvider,
};

export interface AddonConfig {
    provider?: string;
    xtreamUrl?: string;
    xtreamUsername?: string;
    xtreamPassword?: string;
    m3uUrl?: string;
    epgUrl?: string;
    enableEpg?: boolean;
    epgOffsetHours?: number | string;
    reformatLogos?: boolean;
    iptvOrgCountry?: string;
    iptvOrgCategory?: string;
    instanceId?: string;
    catalogName?: string;
    /** Channel artwork: portrait (default) or 16:9 landscape. */
    posterShape?: 'poster' | 'landscape';
    globalUserAgent?: string;
}

/**
 * The native Stremio guide holds days of programmes per channel, so it stays
 * off unless the host opts in with EPG_NATIVE_ENABLED (self-hosted instances).
 */
export function isNativeEpg(config: AddonConfig) {
    const provider = config.provider || 'xtream';
    return env.EPG_NATIVE_ENABLED && !!config.enableEpg && (provider === 'm3u' || provider === 'xtream');
}

function stableStringify(obj: any) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

export function createCacheKey(config: AddonConfig) {
    const provider = config.provider || 'xtream';
    let minimal: any;
    if (provider === 'iptv-org') {
        minimal = {
            provider,
            iptvOrgCountry: config.iptvOrgCountry || null,
            iptvOrgCategory: config.iptvOrgCategory || null,
        };
    } else if (provider === 'm3u') {
        minimal = {
            provider,
            m3uUrl: config.m3uUrl || null,
            enableEpg: !!config.enableEpg,
            epgUrl: config.epgUrl || null,
            epgOffsetHours: config.epgOffsetHours,
            reformatLogos: !!config.reformatLogos,
            globalUserAgent: config.globalUserAgent || null,
        };
    } else {
        minimal = {
            provider: 'xtream',
            epgUrl: config.epgUrl,
            enableEpg: !!config.enableEpg,
            xtreamUrl: config.xtreamUrl,
            xtreamUsername: config.xtreamUsername,
            epgOffsetHours: config.epgOffsetHours,
            reformatLogos: !!config.reformatLogos
        };
    }
    if (config.posterShape === 'landscape') minimal.posterShape = 'landscape';
    return crypto.createHash('md5').update(stableStringify(minimal)).digest('hex');
}

export function createStorageKey(config: AddonConfig, cacheKey = createCacheKey(config)) {
    if ((config.provider || 'xtream') !== 'xtream') return cacheKey;
    const secret = crypto.createHash('sha256').update(String(config.xtreamPassword ?? '')).digest('hex').slice(0, 16);
    return `${cacheKey}:${secret}`;
}

export class M3UEPGAddon {
    providerName: string;
    config: AddonConfig;
    manifestRef: any;
    cacheKey: string;
    storageKey: string;
    idPrefix: string;
    updateInterval: number;
    channels: any[];
    channelMap: Map<string, any>;
    epgData: Record<string, any[]>;
    lastUpdate: number;
    m3uEtag: string | null;
    m3uLastModified: string | null;
    iptvOrgEtag: string | null;
    xtreamEtag: string | null;
    lastEpgUpdate: number | null;
    _evictTimer: any;
    private _updateTimer: ReturnType<typeof setInterval> | null;
    _loadPromise: any;
    firstCatalogRefreshDone: boolean;
    firstCatalogRefreshPromise: any;
    private _consecutiveRefreshFailures = 0;
    private _refreshFailedAt: number | null = null;
    private _timerConsecutiveFailures = 0;
    private _timerPausedUntil: number | null = null;
    cacheTtl: number;
    nativeEpg: boolean;
    report: SourceReport | null = null;
    lastReport: SourceReport | null = null;
    log: ReturnType<typeof makeLogger>;

    constructor(config: AddonConfig = {}, manifestRef?: any) {
        this.providerName = config.provider || 'xtream';
        this.config = config;
        this.manifestRef = manifestRef;
        this.cacheKey = createCacheKey(config);
        this.storageKey = createStorageKey(config, this.cacheKey);
        this.idPrefix = this.cacheKey.slice(0, 8);
        this.updateInterval = env.UPDATE_INTERVAL_MS;
        this.channels = [];
        this.channelMap = new Map();
        this.epgData = {};
        this.lastUpdate = 0;
        this.m3uEtag = null;
        this.m3uLastModified = null;
        this.iptvOrgEtag = null;
        this.xtreamEtag = null;
        this.lastEpgUpdate = null;
        this._evictTimer = null;
        this._updateTimer = null;
        this._loadPromise = null;
        this.firstCatalogRefreshDone = false;
        this.firstCatalogRefreshPromise = null;
        const TTL_MAP: Record<string, number> = {
            'iptv-org': env.IPTV_ORG_CACHE_TTL_MS,
            'm3u': env.M3U_CACHE_TTL_MS,
        };
        this.cacheTtl = TTL_MAP[this.providerName] ?? CACHE_TTL_MS;
        this.nativeEpg = isNativeEpg(config);
        this.log = makeLogger();

        if (typeof this.config.epgOffsetHours === 'string') {
            const n = parseFloat(this.config.epgOffsetHours);
            if (!isNaN(n)) this.config.epgOffsetHours = n;
        }
        if (typeof this.config.epgOffsetHours !== 'number' || !isFinite(this.config.epgOffsetHours as number))
            this.config.epgOffsetHours = 0;
        if (Math.abs(this.config.epgOffsetHours as number) > 48)
            this.config.epgOffsetHours = 0;

        if (this.providerName === 'iptv-org' || this.providerName === 'm3u') {
            this.config.reformatLogos = true;
        }
    }

    async saveChannelsToCache() {
        if (!CACHE_ENABLED) return;
        sqliteCache.setRaw('addon:channels:' + this.storageKey, {
            channels: this.channels,
            lastUpdate: this.lastUpdate,
            m3uEtag: this.m3uEtag ?? null,
            m3uLastModified: this.m3uLastModified ?? null,
            iptvOrgEtag: this.iptvOrgEtag ?? null,
            xtreamEtag: this.xtreamEtag ?? null,
            lastEpgUpdate: this.lastEpgUpdate ?? null,
        }, this.cacheTtl);
    }

    async loadChannelsFromCache() {
        if (!CACHE_ENABLED) return;
        const cached = sqliteCache.getRaw('addon:channels:' + this.storageKey);
        if (cached) {
            this.channels = cached.channels || [];
            this.channelMap = new Map(this.channels.map((c: any) => [c.id, c]));
            this.lastUpdate = cached.lastUpdate || 0;
            this.m3uEtag = cached.m3uEtag ?? null;
            this.m3uLastModified = cached.m3uLastModified ?? null;
            this.iptvOrgEtag = cached.iptvOrgEtag ?? null;
            this.xtreamEtag = cached.xtreamEtag ?? null;
            this.lastEpgUpdate = cached.lastEpgUpdate ?? null;
        }
    }

    epgCacheKey() {
        return 'addon:epg:' + this.storageKey + (this.nativeEpg ? ':native' : '');
    }

    async saveEpgToCache() {
        if (!CACHE_ENABLED) return;
        if (!this.epgData || Object.keys(this.epgData).length === 0) return;
        sqliteCache.set(this.epgCacheKey(), { epgData: this.epgData }, this.cacheTtl);
    }

    async loadEpgFromCache() {
        if (!CACHE_ENABLED) return;
        const cached = sqliteCache.get(this.epgCacheKey());
        if (cached) {
            this.epgData = cached.epgData || {};
        }
    }

    async ensureEpgLoaded() {
        if (this.epgData && Object.keys(this.epgData).length > 0) return;
        if (!CACHE_ENABLED) return;
        await this.loadEpgFromCache();
    }

    buildGenresInManifest() {
        if (!this.manifestRef) return;
        const tvCatalog = this.manifestRef.catalogs.find((c: any) => c.id === 'iptv_channels');
        if (tvCatalog) {
            const groups = [
                ...new Set(
                    this.channels
                        .map((c: any) => c.category || c.attributes?.['group-title'])
                        .filter(Boolean)
                        .map((s: string) => s.trim())
                )
            ].sort((a: any, b: any) => a.localeCompare(b));
            if (!groups.includes('All Channels')) groups.unshift('All Channels');
            tvCatalog.genres = groups;

            const genreExtra = tvCatalog.extra.find((e: any) => e.name === 'genre');
            if (genreExtra) {
                genreExtra.options = groups;
            }
        }
    }

    async updateData(force = false) {
        const now = Date.now();
        if (!force && CACHE_ENABLED) {
            if (this.lastUpdate && now - this.lastUpdate < this.updateInterval) return;
            if (this.channels.length && now - this.lastUpdate < env.MIN_UPDATE_INTERVAL_MS) return;
        }
        const report = new SourceReport();
        this.report = report;
        try {
            const providerModule = PROVIDER_MAP[this.providerName];
            if (!providerModule) throw new Error(`Unknown provider: ${this.providerName}`);
            const epgUpdateTimeBefore = this.lastEpgUpdate;
            await providerModule.fetchData(this);
            await this.finishReport(report);
            this.channelMap = new Map(this.channels.map((c: any) => [c.id, c]));
            this.lastUpdate = Date.now();
            if (CACHE_ENABLED && this.channels.length > 0) {
                await this.saveChannelsToCache();
                if (this.lastEpgUpdate !== epgUpdateTimeBefore) {
                    await this.saveEpgToCache();
                }
            }
            this.buildGenresInManifest();
        } catch (e: any) {
            throw e;
        } finally {
            report.finishedAt = Date.now();
            this.report = null;
            this.lastReport = report;
        }
    }

    private async finishReport(report: SourceReport) {
        if (Object.keys(this.epgData).length === 0 && report.steps.some(s => s.id === 'guide' && s.status === 'skip')) {
            await this.loadEpgFromCache();
        }
        const stats = computeStats(this.channels, this.epgData);
        report.stats = stats;
        for (const step of report.steps) {
            if (step.id === 'channels' && step.status === 'ok') {
                step.detail = `${formatCount(stats.channels)} in ${formatCount(stats.groups)} groups`;
            } else if (step.id === 'guide' && step.status === 'ok') {
                step.detail = `${formatCount(stats.channelsWithGuide)} of ${formatCount(stats.channels)} channels matched`;
            }
        }
    }

    private _getRefreshCooldownMs(): number {
        if (this._consecutiveRefreshFailures <= 0) return 0;
        if (this._consecutiveRefreshFailures === 1) return 60_000;
        if (this._consecutiveRefreshFailures === 2) return 5 * 60_000;
        return 30 * 60_000;
    }

    async refreshOnFirstCatalogRequest() {
        if (this._refreshFailedAt !== null) {
            const cooldown = this._getRefreshCooldownMs();
            if (Date.now() - this._refreshFailedAt < cooldown) return;
        }
        if (this.firstCatalogRefreshDone) return;
        if (this.firstCatalogRefreshPromise) {
            await this.firstCatalogRefreshPromise;
            return;
        }
        const JUST_FETCHED_MS = 2 * 60 * 1000;
        if (this.lastUpdate && (Date.now() - this.lastUpdate < JUST_FETCHED_MS)) {
            this.firstCatalogRefreshDone = true;
            return;
        }
        this.firstCatalogRefreshPromise = (async () => {
            this.m3uEtag = null;
            this.m3uLastModified = null;
            this.iptvOrgEtag = null;
            this.xtreamEtag = null;
            if (CACHE_ENABLED) {
                sqliteCache.del('addon:channels:' + this.storageKey);
                sqliteCache.del(this.epgCacheKey());
            }
            await this.updateData(true);
            this.firstCatalogRefreshDone = true;
        })();
        try {
            await this.firstCatalogRefreshPromise;
            this._consecutiveRefreshFailures = 0;
            this._refreshFailedAt = null;
        } catch (e) {
            this._consecutiveRefreshFailures++;
            this._refreshFailedAt = Date.now();
            throw e;
        } finally {
            this.firstCatalogRefreshPromise = null;
        }
    }

    get posterShape(): 'poster' | 'landscape' {
        return this.config.posterShape === 'landscape' ? 'landscape' : 'poster';
    }

    deriveFallbackLogoUrl(item: any) {
        const [w, h] = this.posterShape === 'landscape' ? [480, 270] : [250, 375];
        let finalUrl: string;
        const logoAttr = item.attributes?.['tvg-logo'] || item.logo;
        if (logoAttr && logoAttr.trim()) {
            finalUrl = logoAttr;
        } else {
            finalUrl = `https://placehold.co/${w}x${h}/2b2b2b/FFFFFF.png?text=${encodeURIComponent(item.name || 'TV')}`;
        }
        if (this.config.reformatLogos && finalUrl.startsWith('http') && !finalUrl.includes('wsrv.nl') && !finalUrl.includes('placehold.co')) {
            if (finalUrl.includes('imgur.com')) {
                finalUrl = `https://proxy.duckduckgo.com/iu/?u=${encodeURIComponent(finalUrl)}`;
            }
            return `https://wsrv.nl/?url=${encodeURIComponent(finalUrl)}&w=${w}&h=${h}&fit=contain&we&bg=2b2b2b`;
        }
        return finalUrl;
    }

    generateMetaPreview(item: any) {
        const logoUrl = this.deriveFallbackLogoUrl(item);
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            description: '📡 Live Channel',
            poster: logoUrl,
            background: logoUrl,
            posterShape: this.posterShape,
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live'
        };
    }

    getProgrammeVideos(item: any, from = -Infinity, to = Infinity) {
        const epgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
        const programmes = epgId ? this.epgData[epgId] : undefined;
        if (!programmes) return [];
        const offsetMs = (this.config.epgOffsetHours as number) * 3600000;
        const videos: any[] = [];
        for (const p of programmes) {
            const start = p.start + offsetMs;
            const stop = p.stop + offsetMs;
            if (stop <= start || stop <= from || start >= to) continue;
            const startTime = new Date(start).toISOString();
            videos.push({
                id: `${item.id}:epg:${startTime}`,
                title: p.title,
                overview: p.desc || undefined,
                released: startTime,
                startTime,
                endTime: new Date(stop).toISOString(),
                runtime: `${Math.round((stop - start) / 60000)} min`,
            });
        }
        return videos;
    }

    generateGuideMeta(item: any, date: string) {
        const dayStart = Date.parse(`${date}T00:00:00.000Z`);
        const dayEnd = dayStart + 24 * 3600000;
        return {
            ...this.generateMetaPreview(item),
            behaviorHints: { isLive: true, hasScheduledVideos: true },
            videos: this.getProgrammeVideos(item, dayStart, dayEnd),
        };
    }

    async getStreams(id: string) {
        await this.ensureDataLoaded();
        const item = this.channelMap.get(id);
        if (!item) return [];

        const reqHeaders: Record<string, string> = {};
        if (item.userAgent) reqHeaders['User-Agent'] = item.userAgent;
        if (item.referrer)  reqHeaders['Referer']    = item.referrer;
        const behaviorHints = Object.keys(reqHeaders).length
            ? { notWebReady: true, proxyHeaders: { request: reqHeaders } }
            : { notWebReady: true };

        if (item.urls && item.urls.length > 0) {
            return item.urls.map((url: string, index: number) => ({
                url,
                title: item.urls.length > 1 ? `${item.name} - Link ${index + 1}` : `${item.name} - Live`,
                behaviorHints,
            }));
        }

        const streams = [{ url: item.url, title: `${item.name} - Live`, behaviorHints }];
        const xtreamRe = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(\d+)$/;
        if (xtreamRe.test(item.url)) {
            streams.unshift({
                url: item.url + '.m3u8',
                title: `${item.name} - HLS`,
                behaviorHints,
            });
        }
        return streams;
    }

    async getDetailedMeta(id: string) {
        await this.ensureDataLoaded();
        await this.ensureEpgLoaded(); 
        const item = this.channelMap.get(id);
        if (!item) return null;

        const epgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
        const current = getCurrentProgram(this.epgData, epgId, this.config.epgOffsetHours as number);
        const upcoming = getUpcomingPrograms(this.epgData, epgId, 3, this.config.epgOffsetHours as number);
        
        let description = '';

        if (current) {
            const start = current.startTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
            const end = current.stopTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
            description += `📡 NOW: ${current.title}${start && end ? ` (${start}-${end})` : ''}`;
            if (current.description) description += `\n\n${current.description}`;
        }
        
        if (upcoming.length) {
            if (description) description += '\n\n';
            description += '📅 UPCOMING:\n';
            for (const p of upcoming) {
                description += `${p.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${p.title}\n`;
            }
        }

        if (!description) {
            description = '📡 Live Channel';
        }

        const logoUrl = this.deriveFallbackLogoUrl(item);
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            poster: logoUrl,
            background: logoUrl,
            posterShape: this.posterShape,
            description: description,
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live',
            ...(this.nativeEpg ? {
                behaviorHints: { isLive: true, hasScheduledVideos: true },
                videos: this.getProgrammeVideos(item, Date.now() - 3 * 3600000),
            } : {}),
        };
    }

    _resetEvictTimer() {
        clearTimeout(this._evictTimer);
        this._evictTimer = setTimeout(() => this._evictFromMemory(), env.DATA_MEMORY_TTL_MS);
    }

    private _startUpdateTimer() {
        if (this._updateTimer !== null) return; 
        this._updateTimer = setInterval(() => {
            if (this._timerPausedUntil !== null && Date.now() < this._timerPausedUntil) return;
            this.updateData().then(() => {
                this._timerConsecutiveFailures = 0;
                this._timerPausedUntil = null;
            }).catch((e: any) => {
                this._timerConsecutiveFailures++;
                if (this._timerConsecutiveFailures >= 3) {
                    this._timerPausedUntil = Date.now() + 30 * 60_000; 
                }
            });
        }, env.UPDATE_INTERVAL_MS);
        if (typeof (this._updateTimer as any).unref === 'function') {
            (this._updateTimer as any).unref();
        }
    }

    _evictFromMemory() {
        clearTimeout(this._evictTimer);
        clearInterval(this._updateTimer as any);
        this._updateTimer = null; 
        this._evictTimer = null;
        this.channels = [];
        this.channelMap = new Map();
        this.epgData = {};
    }

    async ensureDataLoaded() {
        if (this.channels.length > 0) {
            this._resetEvictTimer();
            return;
        }
        if (!CACHE_ENABLED) return;
        if (this._loadPromise) {
            await this._loadPromise;
            return;
        }
        this._loadPromise = this.loadChannelsFromCache().finally(() => { this._loadPromise = null; });
        await this._loadPromise;
        this._resetEvictTimer();
        this._startUpdateTimer();
    }

    async getChannelsForCatalog() {
        await this.ensureDataLoaded();
        return this.channels;
    }
}

export { CACHE_ENABLED };
