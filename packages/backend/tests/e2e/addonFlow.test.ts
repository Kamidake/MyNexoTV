/**
 * End-to-end tests for the full addon chain with no mocks:
 * HTTP route → token → builder → provider fetch → M3U/Xtream/XMLTV parsers → Stremio response.
 *
 * A local HTTP server plays the IPTV provider. It serves an M3U playlist, a fake
 * Xtream panel, and the guide as gzip with no Content-Encoding (like m3u4u).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import request from 'supertest';
import type { Express } from 'express';

vi.hoisted(() => {
    process.env.ALLOW_LOCAL_URLS = 'true';
    process.env.CACHE_ENABLED = 'false';
    process.env.IP_RATE_LIMIT_ENABLED = 'false';
    process.env.TOKEN_RATE_LIMIT_ENABLED = 'false';
    process.env.CONFIG_SECRET = '';
});

import env from '../../src/config/env';
import { createTestApp } from '../helpers/testApp';

interface MetaPreview { id: string; name: string; genres: string[] }
interface Programme { title: string; startTime: string; endTime: string }
interface GuideMeta extends MetaPreview {
    behaviorHints: { isLive: boolean; hasScheduledVideos: boolean };
    videos: Programme[];
}
interface Stream { url: string; behaviorHints: { proxyHeaders?: { request: Record<string, string> } } }

const H = 3600 * 1000;
let base = '';
let server: http.Server;
let app: Express;

function xmltvTime(ms: number) {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`;
}

const GUIDE: Array<[string, string[]]> = [
    ['globo.br', ['Bom Dia', 'Jornal Hoje', 'Novela', 'Jornal Nacional', 'Futebol', 'Filme', 'Corujao', 'Madrugada']],
    ['espn.br', ['SportsCenter', 'NBA', 'Futebol ao vivo']],
];

/** Each channel's second programme ("Jornal Hoje", "NBA") is on air now. */
function buildGuide() {
    const now = Date.now();
    const rows = GUIDE.flatMap(([channel, titles]) => titles.map((title, i) => {
        const start = now - H + i * H;
        return `<programme start="${xmltvTime(start)}" stop="${xmltvTime(start + H)}" channel="${channel}">` +
            `<title lang="pt">${title}</title><desc>${title} desc</desc></programme>`;
    }));
    return `<?xml version="1.0" encoding="UTF-8"?><tv><channel id="globo.br"/><channel id="espn.br"/>${rows.join('')}</tv>`;
}

function playlist() {
    return [
        `#EXTM3U url-tvg="${base}/epg.gz"`,
        '#EXTINF:-1 tvg-id="globo.br" tvg-logo="https://example.com/globo.png" group-title="Abertos",Globo HD',
        `${base}/live/globo.m3u8`,
        '#EXTINF:-1 tvg-id="espn.br" group-title="Esportes" http-user-agent="TiviMate/5",ESPN Brasil',
        `${base}/live/espn.m3u8`,
        '#EXTINF:-1 group-title="Esportes",SporTV 2',
        `${base}/live/sportv2.m3u8`,
        '#EXTINF:-1 group-title="Filmes",Tropa de Elite (2007)',
        `${base}/movie/user/secret/501.mkv`,
        '#EXTINF:-1 group-title="Series",Cidade Invisivel S01 E01',
        `${base}/series/user/secret/601.mp4`,
    ].join('\n');
}

function provider(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', 'http://fixture');
    if (url.pathname === '/list.m3u') {
        res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
        return res.end(playlist());
    }
    if (url.pathname === '/epg.gz' || url.pathname === '/xmltv.php') {
        res.writeHead(200, { 'Content-Type': 'application/gzip' });
        return res.end(zlib.gzipSync(buildGuide()));
    }
    if (url.pathname === '/player_api.php') {
        if (url.searchParams.get('password') !== 'secret') {
            res.writeHead(401);
            return res.end();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (url.searchParams.get('action') === 'get_live_categories') {
            return res.end(JSON.stringify([{ category_id: '1', category_name: 'Abertos' }]));
        }
        return res.end(JSON.stringify([
            { stream_id: 101, name: 'Globo HD', category_id: '1', epg_channel_id: 'globo.br', stream_icon: '' },
            { stream_id: 102, name: 'Record', category_id: '1', epg_channel_id: '', stream_icon: '' },
        ]));
    }
    res.writeHead(404);
    res.end();
}

beforeAll(async () => {
    server = http.createServer(provider);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
    base = `http://127.0.0.1:${address.port}`;
    app = createTestApp();
});

afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

const token = (config: Record<string, unknown>) => Buffer.from(JSON.stringify(config)).toString('base64url');
const m3uToken = () => token({ provider: 'm3u', m3uUrl: `${base}/list.m3u`, enableEpg: true, catalogName: 'Casa' });

async function metas(t: string, extra = ''): Promise<MetaPreview[]> {
    const res = await request(app).get(`/${t}/catalog/tv/iptv_channels${extra ? '/' + extra : ''}.json`);
    expect(res.status).toBe(200);
    return res.body.metas;
}

async function guide(t: string, extra: string): Promise<GuideMeta[]> {
    const res = await request(app).get(`/${t}/catalog/tv/iptv_channels/${extra}.json`);
    expect(res.status).toBe(200);
    return res.body.metasDetailed;
}

async function streams(t: string, id: string): Promise<Stream[]> {
    return (await request(app).get(`/${t}/stream/tv/${id}.json`)).body.streams;
}

async function description(t: string, id: string): Promise<string> {
    return (await request(app).get(`/${t}/meta/tv/${id}.json`)).body.meta.description;
}

const names = (list: MetaPreview[]) => list.map(m => m.name);

describe('M3U playlist, end to end', () => {
    it('serves a manifest with the catalog name and the playlist groups as genres', async () => {
        const res = await request(app).get(`/${m3uToken()}/manifest.json`);
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('NexoTV');
        expect(res.body.catalogs[0].name).toBe('Casa');
        expect(res.body.catalogs[0].genres).toEqual(['All Channels', 'Abertos', 'Esportes']);
        expect(res.body.behaviorHints.configureUrl).toMatch(/\/configure$/);
        expect(res.body.behaviorHints).not.toHaveProperty('epgProvider');
    });

    it('lists every channel, filters by genre, searches by partial name, and pages', async () => {
        const t = m3uToken();
        expect(names(await metas(t))).toEqual(['Globo HD', 'ESPN Brasil', 'SporTV 2']);
        expect(names(await metas(t, 'genre=Esportes'))).toEqual(['ESPN Brasil', 'SporTV 2']);
        expect(names(await metas(t, 'search=sport'))).toEqual(['SporTV 2']);
        expect(await metas(t, 'skip=100')).toEqual([]);
    });

    it('shows the current programme from a gzip guide served without Content-Encoding', async () => {
        const t = m3uToken();
        const [globo] = await metas(t);
        const text = await description(t, globo.id);
        expect(text).toContain('NOW: Jornal Hoje');
        expect(text).toContain('UPCOMING');
    });

    it('returns the stream with the per-channel User-Agent as a proxy header', async () => {
        const t = m3uToken();
        const espn = (await metas(t))[1];
        const [stream] = await streams(t, espn.id);
        expect(stream.url).toBe(`${base}/live/espn.m3u8`);
        expect(stream.behaviorHints.proxyHeaders?.request['User-Agent']).toBe('TiviMate/5');
    });

    it('uses the global User-Agent for channels that do not declare one', async () => {
        const t = token({ provider: 'm3u', m3uUrl: `${base}/list.m3u`, globalUserAgent: 'VLC/3.0' });
        const [globo] = await metas(t);
        const [stream] = await streams(t, globo.id);
        expect(stream.behaviorHints.proxyHeaders?.request['User-Agent']).toBe('VLC/3.0');
    });

    it('returns no streams for an unknown channel id', async () => {
        expect(await streams(m3uToken(), 'm3nothing_000')).toEqual([]);
    });

    it('leaves Xtream movie and series entries out by default', async () => {
        const t = m3uToken();
        const list = names(await metas(t));
        expect(list).not.toContain('Tropa de Elite (2007)');
        expect(list).not.toContain('Cidade Invisivel S01 E01');
        expect(names(await metas(t, 'genre=Filmes'))).toEqual([]);
    });

    it('keeps movie and series entries when M3U_INCLUDE_VOD is on', async () => {
        env.M3U_INCLUDE_VOD = true;
        try {
            const t = token({ provider: 'm3u', m3uUrl: `${base}/list.m3u`, catalogName: 'Com VOD' });
            expect(names(await metas(t))).toEqual([
                'Globo HD', 'ESPN Brasil', 'SporTV 2', 'Tropa de Elite (2007)', 'Cidade Invisivel S01 E01',
            ]);
        } finally {
            env.M3U_INCLUDE_VOD = false;
        }
    });
});

describe('Xtream panel, end to end', () => {
    const xtreamToken = (password = 'secret') =>
        token({ provider: 'xtream', xtreamUrl: base, xtreamUsername: 'user', xtreamPassword: password, enableEpg: true });

    it('maps live streams to categories and builds the HLS stream URL', async () => {
        const t = xtreamToken();
        const list = await metas(t);
        expect(list.map(m => [m.name, m.genres[0]])).toEqual([['Globo HD', 'Abertos'], ['Record', 'Abertos']]);
        expect((await streams(t, list[0].id)).map(s => s.url)).toContain(`${base}/live/user/secret/101.m3u8`);
    });

    it('reads the guide from xmltv.php', async () => {
        const t = xtreamToken();
        const [globo] = await metas(t);
        expect(await description(t, globo.id)).toContain('NOW: Jornal Hoje');
    });

    it('returns an empty catalog when the panel rejects the credentials', async () => {
        expect(await metas(xtreamToken('wrong'))).toEqual([]);
    });
});

describe('native Stremio guide, end to end', () => {
    it('declares the guide and returns paged metasDetailed with the day schedule', async () => {
        env.EPG_NATIVE_ENABLED = true;
        try {
            const t = token({ provider: 'm3u', m3uUrl: `${base}/list.m3u`, enableEpg: true, catalogName: 'Guia' });
            const manifest = (await request(app).get(`/${t}/manifest.json`)).body;
            expect(manifest.behaviorHints.epgProvider).toBe(true);
            expect(manifest.catalogs[0].extra.map((e: { name: string }) => e.name)).toContain('date');

            const today = new Date().toISOString().slice(0, 10);
            const page = await guide(t, `date=${today}`);
            expect(names(page)).toEqual(['Globo HD', 'ESPN Brasil', 'SporTV 2']);
            expect(page[0].behaviorHints.hasScheduledVideos).toBe(true);
            expect(page[0].videos.length).toBeGreaterThan(0);
            for (const v of page[0].videos) expect(Date.parse(v.endTime)).toBeGreaterThan(Date.parse(v.startTime));
            expect(page[2].videos).toEqual([]);

            expect(await guide(t, `date=${today}&skip=3`)).toEqual([]);
            expect(await guide(t, 'date=not-a-date')).toEqual([]);
        } finally {
            env.EPG_NATIVE_ENABLED = false;
        }
    });
});

describe('token handling, end to end', () => {
    it('rejects a token that is not valid config', async () => {
        const res = await request(app).get('/not-a-real-token/manifest.json');
        expect(res.status).toBe(400);
    });
});
