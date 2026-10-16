import sax from 'sax';
import zlib from 'zlib';
import { Readable, pipeline } from 'stream';
import { StringDecoder } from 'string_decoder';
import { makeLogger } from '../utils/logger';
import env from '../config/env';

export interface ParseEPGOptions {
    /** Keep the full schedule from 24h ago to this many days ahead, for the native Stremio guide. */
    nativeDays?: number;
}

type Programme = { start: number; stop: number; title: string; desc: string };
type EPGSource = Readable | AsyncIterable<Buffer | string> | Iterable<Buffer | string>;

const MAX_UPCOMING = 5;
const YIELD_EVERY_BYTES = 256 * 1024;

/**
 * Stream XMLTV into a channel-keyed object without holding the document in memory.
 * Programmes are filtered as they arrive, so memory grows with what is kept, not with
 * the file size. Gzip is detected from the first bytes, since providers like m3u4u
 * serve .gz files without Content-Encoding. Input over EPG_MAX_BYTES (after
 * decompression) or malformed XML returns {}.
 *
 * By default keeps programmes airing in the last hour plus the next 5 per channel.
 */
export async function parseEPGStream(source: EPGSource, log?: ReturnType<typeof makeLogger>, options: ParseEPGOptions = {}) {
    const startedAt = Date.now();
    const nowTime = Date.now();
    const native = !!options.nativeDays;
    const cutoff = native ? nowTime - 24 * 3600 * 1000 : nowTime - 3600 * 1000;
    const horizon = native ? nowTime + options.nativeDays! * 24 * 3600 * 1000 : Infinity;

    const epgData: Record<string, Programme[]> = {};
    // Non-native mode: per channel, the earliest MAX_UPCOMING future programmes, kept sorted.
    const upcoming: Record<string, Programme[]> = {};

    const keep = (ch: string, p: Programme) => {
        if (p.stop < cutoff || p.start > horizon) return;
        if (native || p.start <= nowTime) {
            (epgData[ch] ||= []).push(p);
            return;
        }
        const list = (upcoming[ch] ||= []);
        if (list.length === MAX_UPCOMING && p.start >= list[MAX_UPCOMING - 1].start) return;
        let i = list.length;
        while (i > 0 && list[i - 1].start > p.start) i--;
        list.splice(i, 0, p);
        if (list.length > MAX_UPCOMING) list.pop();
    };

    const parser = sax.parser(true, { trim: false });
    let cur: { channel: string; start: string; stop: string; title: string | null; desc: string | null } | null = null;
    let field: 'title' | 'desc' | null = null;
    let text = '';

    parser.onopentag = (node: any) => {
        if (node.name === 'programme') {
            const a = node.attributes;
            cur = { channel: a.channel, start: a.start, stop: a.stop, title: null, desc: null };
        } else if (cur && (node.name === 'title' || node.name === 'desc') && cur[node.name] === null) {
            field = node.name;
            text = '';
        }
    };
    parser.ontext = parser.oncdata = (t: string) => { if (field) text += t; };
    parser.onclosetag = (name: string) => {
        if (!cur) return;
        if (field && name === field) {
            cur[field] = text.trim();
            field = null;
        } else if (name === 'programme') {
            if (cur.channel) {
                keep(cur.channel, {
                    start: parseEPGTime(cur.start).getTime(),
                    stop: parseEPGTime(cur.stop).getTime(),
                    title: cur.title || 'Unknown',
                    desc: cur.desc || '',
                });
            }
            cur = null;
        }
    };

    try {
        const decoder = new StringDecoder('utf8');
        let bytes = 0;
        let nextYield = YIELD_EVERY_BYTES;
        for await (const chunk of decompressed(source)) {
            bytes += chunk.length;
            if (bytes > env.EPG_MAX_BYTES) throw new Error('EPG_TOO_LARGE');
            parser.write(decoder.write(chunk));
            if (bytes >= nextYield) {
                // Let other requests run while a large guide is parsed
                nextYield = bytes + YIELD_EVERY_BYTES;
                await new Promise<void>(resolve => setImmediate(resolve));
            }
        }
        parser.write(decoder.end());
        parser.close();
    } catch (e: any) {
        if (log) {
            if (e.message === 'EPG_TOO_LARGE') {
                log.warn(`[EPG] Content too large (over ${(env.EPG_MAX_BYTES / 1024 / 1024).toFixed(0)} MB), skipping`);
            } else {
                log.warn('EPG parse failed', e.message);
            }
        }
        return {};
    }

    for (const ch in upcoming) (epgData[ch] ||= []).push(...upcoming[ch]);
    for (const ch in epgData) epgData[ch].sort((a, b) => a.start - b.start);

    if (log) {
        log.debug('EPG parsed', {
            channels: Object.keys(epgData).length,
            programmes: Object.values(epgData).reduce((a, b) => a + b.length, 0),
            ms: Date.now() - startedAt
        });
    }
    return epgData;
}

/** Yield the source as Buffers, gunzipped when it starts with the gzip magic bytes. */
async function* decompressed(source: EPGSource): AsyncGenerator<Buffer> {
    const it = (Readable.from(source as any) as AsyncIterable<Buffer | string>)[Symbol.asyncIterator]();
    const head = await it.next();
    if (head.done) return;
    const first = Buffer.from(head.value);
    async function* all() {
        yield first;
        for (let r = await it.next(); !r.done; r = await it.next()) yield Buffer.from(r.value);
    }
    if (first.length < 2 || first[0] !== 0x1f || first[1] !== 0x8b) {
        yield* all();
        return;
    }
    const gunzip = zlib.createGunzip();
    pipeline(Readable.from(all()), gunzip, () => {});
    yield* gunzip as AsyncIterable<Buffer>;
}

/**
 * Parse XMLTV held in a string. Thin wrapper over parseEPGStream.
 */
export async function parseEPG(content: string, log?: ReturnType<typeof makeLogger>, options: ParseEPGOptions = {}) {
    if (Buffer.byteLength(content, 'utf8') > env.EPG_MAX_BYTES) {
        if (log) log.warn(`[EPG] Content too large (over ${(env.EPG_MAX_BYTES / 1024 / 1024).toFixed(0)} MB), skipping`);
        return {};
    }
    const buf = Buffer.from(content);
    const chunks: Buffer[] = [];
    for (let i = 0; i < buf.length; i += 64 * 1024) chunks.push(buf.subarray(i, i + 64 * 1024));
    return parseEPGStream(chunks, log, options);
}

/**
 * Parse EPG time string (XMLTV format: YYYYMMDDHHmmss +HHMM).
 */
export function parseEPGTime(s: string, epgOffsetHours = 0) {
    if (!s) return new Date();
    const m = s.match(/^(\d{14})(?:\s*([+\-]\d{4}))?/);
    if (m) {
        const base = m[1];
        const tz = m[2] || null;
        const year = parseInt(base.slice(0, 4), 10);
        const month = parseInt(base.slice(4, 6), 10) - 1;
        const day = parseInt(base.slice(6, 8), 10);
        const hour = parseInt(base.slice(8, 10), 10);
        const min = parseInt(base.slice(10, 12), 10);
        const sec = parseInt(base.slice(12, 14), 10);
        let date: Date | undefined;
        if (tz) {
            const iso = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}${tz}`;
            const parsed = new Date(iso);
            if (!isNaN(parsed.getTime())) date = parsed;
        }
        if (!date) date = new Date(year, month, day, hour, min, sec);
        if (epgOffsetHours) {
            date = new Date(date.getTime() + epgOffsetHours * 3600000);
        }
        return date;
    }
    const d = new Date(s);
    if (epgOffsetHours && !isNaN(d.getTime()))
        return new Date(d.getTime() + epgOffsetHours * 3600000);
    return d;
}

/**
 * Find the currently airing program for a channel.
 */
export function getCurrentProgram(epgData: Record<string, any[]>, channelId: string, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return null;
    const nowTime = Date.now();
    for (const p of epgData[channelId]) {
        const start = p.start + (epgOffsetHours * 3600000);
        const stop = p.stop + (epgOffsetHours * 3600000);
        if (nowTime >= start && nowTime <= stop) {
            const startDate = new Date(start);
            const stopDate = new Date(stop);
            return { title: p.title, description: p.desc, start: startDate, stop: stopDate, startTime: startDate, stopTime: stopDate };
        }
    }
    return null;
}

/**
 * Get upcoming programs for a channel.
 */
export function getUpcomingPrograms(epgData: Record<string, any[]>, channelId: string, limit = 5, epgOffsetHours = 0) {
    if (!channelId || !epgData[channelId]) return [];
    const nowTime = Date.now();
    const upcoming: any[] = [];
    for (const p of epgData[channelId]) {
        const start = p.start + (epgOffsetHours * 3600000);
        if (start > nowTime && upcoming.length < limit) {
            upcoming.push({
                title: p.title,
                description: p.desc,
                startTime: new Date(start),
                stopTime: new Date(p.stop + (epgOffsetHours * 3600000))
            });
        }
    }
    return upcoming.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
