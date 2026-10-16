'use strict';

import { StringDecoder } from 'string_decoder';

const MAX_LINE_LENGTH = 4096;

const KNOWN_ATTR_NAMES = [
    'tvg-id', 'tvg-name', 'tvg-logo', 'tvg-country', 'tvg-language',
    'tvg-type', 'group-title', 'user-agent', 'referrer',
    'catchup', 'catchup-days', 'catchup-source', 'x-tvg-url',
];

/**
 * Escape special regex metacharacters in a string.
 */
function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compiled attribute regexes to avoid per-call regex construction (ReDoS mitigation).
const ATTR_REGEX_MAP: Record<string, [RegExp, RegExp]> = {};
for (const attr of KNOWN_ATTR_NAMES) {
    const escaped = escapeRegExp(attr);
    ATTR_REGEX_MAP[attr] = [
        new RegExp(`${escaped}="([^"]{0,2048})"`, 'i'),
        new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i'),
    ];
}

/**
 * Extract a named attribute value from an #EXTINF or #EXTM3U line.
 * Returns null if the attribute is not found.
 */
function extractAttr(line: string, attr: string): string | null {
    const regs = ATTR_REGEX_MAP[attr.toLowerCase()];
    if (regs) {
        const m = regs[0].exec(line) || regs[1].exec(line);
        return m ? m[1] : null;
    }
    // Fallback dynamic regex for unknown attributes (backward compatibility).
    const escaped = escapeRegExp(attr);
    const m =
        new RegExp(`${escaped}="([^"]{0,2048})"`, 'i').exec(line) ||
        new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i').exec(line);
    return m ? m[1] : null;
}

/**
 * Strip HTTP header injection characters (CR, LF, null bytes) and truncate to 512 chars.
 */
function sanitizeHeaderValue(v: string | null | undefined): string | null {
    if (!v) return null;
    return v.replace(/[\r\n\0\x0b\x0c]/g, '').slice(0, 512) || null;
}

/**
 * Extract channel display name: text after the last comma in an #EXTINF line.
 */
function extractChannelName(extinfLine: string) {
    const commaIdx = extinfLine.lastIndexOf(',');
    if (commaIdx === -1) return 'Unknown';
    return extinfLine.slice(commaIdx + 1).trim() || 'Unknown';
}

const VOD_PATH_KINDS = new Set(['movie', 'series']);

/**
 * True when the URL uses the Xtream VOD layout: `/movie/<user>/<pass>/<id>.<ext>`
 * or `/series/<user>/<pass>/<id>.<ext>`. Only the path is checked, so a live
 * channel named "Movies HD" stays a channel.
 */
export function isVodUrl(url: string): boolean {
    let path = url;
    const queryIdx = path.search(/[?#]/);
    if (queryIdx !== -1) path = path.slice(0, queryIdx);
    const schemeIdx = path.indexOf('://');
    if (schemeIdx !== -1) {
        const slashIdx = path.indexOf('/', schemeIdx + 3);
        if (slashIdx === -1) return false;
        path = path.slice(slashIdx);
    }
    const segments = path.split('/').filter(Boolean);
    if (segments.length < 4) return false;
    return VOD_PATH_KINDS.has(segments[segments.length - 4].toLowerCase());
}

export interface ParseM3UOptions {
    /** Keep Xtream movie and series entries. Default: false. */
    includeVod?: boolean;
}

type M3UChannel = {
    tvgId: string | null;
    tvgName: string | null;
    logo: string | null;
    group: string;
    name: string;
    url: string | null;
    userAgent: string | null;
    referrer: string | null;
};

export interface M3UResult {
    channels: M3UChannel[];
    epgUrl: string | null;
    vodSkipped: number;
}

/** Line-by-line M3U state machine, shared by the string and the streaming parser. */
class M3ULineParser {
    private readonly includeVod: boolean;
    private pending: M3UChannel | null = null;
    readonly result: M3UResult = { channels: [], epgUrl: null, vodSkipped: 0 };

    constructor({ includeVod = false }: ParseM3UOptions) {
        this.includeVod = includeVod;
    }

    push(rawLine: string) {
        const line = rawLine.trim();
        if (!line) return;
        if (line.length > MAX_LINE_LENGTH) return;

        if (line.startsWith('#EXTM3U')) {
            const tvgUrl = extractAttr(line, 'url-tvg') || extractAttr(line, 'x-tvg-url');
            if (tvgUrl) this.result.epgUrl = tvgUrl;
            return;
        }

        if (line.startsWith('#EXTINF:')) {
            this.pending = {
                tvgId:     extractAttr(line, 'tvg-id'),
                tvgName:   extractAttr(line, 'tvg-name'),
                logo:      extractAttr(line, 'tvg-logo'),
                group:     extractAttr(line, 'group-title') || 'Uncategorized',
                name:      extractChannelName(line),
                url:       null,
                userAgent: sanitizeHeaderValue(extractAttr(line, 'user-agent') || extractAttr(line, 'http-user-agent')),
                referrer:  sanitizeHeaderValue(extractAttr(line, 'referrer') || extractAttr(line, 'http-referrer')),
            };
            return;
        }

        if (line.startsWith('#EXTVLCOPT:') && this.pending) {
            const opt = line.slice('#EXTVLCOPT:'.length);
            const eqIdx = opt.indexOf('=');
            if (eqIdx !== -1) {
                const key = opt.slice(0, eqIdx).trim().toLowerCase();
                const val = opt.slice(eqIdx + 1).trim();
                if (key === 'http-user-agent') this.pending.userAgent = sanitizeHeaderValue(val);
                if (key === 'http-referrer') this.pending.referrer = sanitizeHeaderValue(val);
            }
            return;
        }

        if (line.startsWith('#')) return;

        if (this.pending) {
            if (!this.includeVod && isVodUrl(line)) {
                this.result.vodSkipped++;
            } else {
                this.pending.url = line;
                this.result.channels.push(this.pending);
            }
            this.pending = null;
        }
    }
}

/**
 * Parse raw M3U / M3U_PLUS text into a structured result.
 * Xtream VOD entries are dropped unless `includeVod` is true; `vodSkipped` counts them.
 */
export function parseM3U(text: string, options: ParseM3UOptions = {}): M3UResult {
    const parser = new M3ULineParser(options);
    if (!text || !text.trim()) return parser.result;
    for (const line of text.split(/\r\n|\r|\n/)) parser.push(line);
    return parser.result;
}

export class M3UTooLargeError extends Error {
    constructor(readonly maxBytes: number) {
        super(`Playlist is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
}

/**
 * Parse a playlist as it downloads, one line at a time, so memory holds the
 * channels that are kept and never the whole file. A 77 MB m3u_plus list with
 * 310,000 VOD entries otherwise costs several hundred MB of heap while parsing.
 * Throws M3UTooLargeError once more than `maxBytes` have been read.
 */
export async function parseM3UStream(
    source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
    options: ParseM3UOptions & { maxBytes: number },
): Promise<M3UResult & { bytes: number }> {
    const parser = new M3ULineParser(options);
    const decoder = new StringDecoder('utf8');
    let bytes = 0;
    let carry = '';
    for await (const chunk of source) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > options.maxBytes) throw new M3UTooLargeError(options.maxBytes);
        const text = carry + decoder.write(buf);
        const lines = text.split(/\r\n|\r|\n/);
        // The last piece may be a line cut in half by the chunk boundary
        carry = lines.pop() ?? '';
        for (const line of lines) parser.push(line);
    }
    carry += decoder.end();
    if (carry) parser.push(carry);
    return { ...parser.result, bytes };
}
