import { describe, it, expect, vi, afterEach } from 'vitest';
import zlib from 'zlib';
import env from '../../src/config/env';
import {
  parseEPGStream,
  parseEPG,
  parseEPGTime,
  getCurrentProgram,
  getUpcomingPrograms,
} from '../../src/parsers/epgParser';
import { SAMPLE_XMLTV } from '../helpers/fixtures';

afterEach(() => {
  vi.useRealTimers();
});

// ─── parseEPG ────────────────────────────────────────────────────────────────

describe('parseEPG', () => {
  it('parses valid XMLTV and returns structured epgData map', async () => {
    // Fake time before all programs so none are filtered out by the cutoff
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const epgData = await parseEPG(SAMPLE_XMLTV);
    expect(typeof epgData).toBe('object');
    expect(epgData['cnn.us']).toBeDefined();
    expect(epgData['cnn.us'].length).toBeGreaterThan(0);
  });

  it('returns empty object on invalid XML', async () => {
    const result = await parseEPG('<not valid xml!!!');
    expect(result).toEqual({});
  });

  it('returns empty object on empty string', async () => {
    const result = await parseEPG('');
    expect(result).toEqual({});
  });

  it('handles multiple channels and programs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const xml = [
      '<?xml version="1.0"?>',
      '<tv>',
      '  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="ch1">',
      '    <title>Show A</title>',
      '  </programme>',
      '  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="ch2">',
      '    <title>Show B</title>',
      '  </programme>',
      '</tv>',
    ].join('\n');
    const epgData = await parseEPG(xml);
    expect(Object.keys(epgData)).toHaveLength(2);
    expect(epgData['ch1'][0].title).toBe('Show A');
    expect(epgData['ch2'][0].title).toBe('Show B');
  });
});

// ─── parseEPGTime ────────────────────────────────────────────────────────────

describe('parseEPGTime', () => {
  it('parses YYYYMMDDHHmmss +0000 format', () => {
    const d = parseEPGTime('20260319120000 +0000');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // March = index 2
    expect(d.getUTCDate()).toBe(19);
    expect(d.getUTCHours()).toBe(12);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('parses YYYYMMDDHHmmss +0300 with offset', () => {
    // 12:00 +03:00 and 09:00 +00:00 should be the same moment
    const withOffset = parseEPGTime('20260319120000 +0300');
    const utcEquiv = parseEPGTime('20260319090000 +0000');
    expect(withOffset.getTime()).toBe(utcEquiv.getTime());
  });

  it('applies epgOffsetHours correctly', () => {
    const base = parseEPGTime('20260319120000 +0000');
    const shifted = parseEPGTime('20260319120000 +0000', 2);
    expect(shifted.getTime()).toBe(base.getTime() + 2 * 3600000);
  });

  it('returns NaN for completely invalid string', () => {
    const d = parseEPGTime('not-a-date');
    expect(isNaN(d.getTime())).toBe(true);
  });
});

// ─── getCurrentProgram ───────────────────────────────────────────────────────

describe('getCurrentProgram', () => {
  const makeEpgData = () => ({
    'cnn.us': [
      {
        start: new Date('2026-03-19T12:00:00Z').getTime(),
        stop: new Date('2026-03-19T13:00:00Z').getTime(),
        title: 'CNN Newsroom',
        desc: 'Live news coverage',
      },
      {
        start: new Date('2026-03-19T13:00:00Z').getTime(),
        stop: new Date('2026-03-19T14:00:00Z').getTime(),
        title: 'The Situation Room',
        desc: '',
      },
    ],
  });

  it('returns current program for known channel at given time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'cnn.us');
    expect(prog).not.toBeNull();
    expect(prog!.title).toBe('CNN Newsroom');
  });

  it('returns null when no program active at given time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T11:00:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'cnn.us');
    expect(prog).toBeNull();
  });

  it('returns null for unknown channel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'nonexistent');
    expect(prog).toBeNull();
  });
});

// ─── getUpcomingPrograms ─────────────────────────────────────────────────────

describe('getUpcomingPrograms', () => {
  const makeEpgData = () => ({
    'cnn.us': [
      {
        start: new Date('2026-03-19T12:00:00Z').getTime(),
        stop: new Date('2026-03-19T13:00:00Z').getTime(),
        title: 'CNN Newsroom',
        desc: 'Live',
      },
      {
        start: new Date('2026-03-19T13:00:00Z').getTime(),
        stop: new Date('2026-03-19T14:00:00Z').getTime(),
        title: 'The Situation Room',
        desc: '',
      },
      {
        start: new Date('2026-03-19T14:00:00Z').getTime(),
        stop: new Date('2026-03-19T15:00:00Z').getTime(),
        title: 'News Tonight',
        desc: '',
      },
    ],
  });

  it('returns N upcoming programs in order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const upcoming = getUpcomingPrograms(makeEpgData(), 'cnn.us', 5);
    expect(upcoming.length).toBeGreaterThan(0);
    for (let i = 1; i < upcoming.length; i++) {
      expect(upcoming[i].startTime.getTime()).toBeGreaterThanOrEqual(
        upcoming[i - 1].startTime.getTime()
      );
    }
  });

  it('returns empty array when no future programs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T16:00:00Z')); // after all programs
    const upcoming = getUpcomingPrograms(makeEpgData(), 'cnn.us', 5);
    expect(upcoming).toEqual([]);
  });

  it('respects the limit parameter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const upcoming1 = getUpcomingPrograms(makeEpgData(), 'cnn.us', 1);
    const upcoming2 = getUpcomingPrograms(makeEpgData(), 'cnn.us', 2);
    expect(upcoming1.length).toBeLessThanOrEqual(1);
    expect(upcoming2.length).toBeLessThanOrEqual(2);
    expect(upcoming2.length).toBeGreaterThanOrEqual(upcoming1.length);
  });
});

// ─── parseEPGStream ──────────────────────────────────────────────────────────

describe('parseEPGStream', () => {
  const chunks = (buf: Buffer, size: number) => {
    const out: Buffer[] = [];
    for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
    return out;
  };

  it('parses XMLTV split into small chunks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const epgData = await parseEPGStream(chunks(Buffer.from(SAMPLE_XMLTV), 7));
    expect(epgData['cnn.us'].map(p => p.title)).toEqual(['CNN Newsroom', 'The Situation Room']);
  });

  it('decompresses gzip served without Content-Encoding (m3u4u)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const epgData = await parseEPGStream(chunks(zlib.gzipSync(SAMPLE_XMLTV), 16));
    expect(epgData['cnn.us'].length).toBe(2);
  });

  it('keeps multi-byte characters split across chunks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const xml = SAMPLE_XMLTV.replace('CNN Newsroom', 'Jornal da Manhã ção');
    const buf = Buffer.from(xml);
    const at = buf.indexOf(Buffer.from('ã')) + 1; // split inside the 2-byte character
    const epgData = await parseEPGStream([buf.subarray(0, at), buf.subarray(at)]);
    expect(epgData['cnn.us'][0].title).toBe('Jornal da Manhã ção');
  });

  it('reads CDATA and uses the first title when several languages exist', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const xml = `<tv><programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="a">
      <title lang="pt">Primeiro</title><title lang="en">First</title><desc><![CDATA[Desc & more]]></desc>
    </programme></tv>`;
    const epgData = await parseEPG(xml);
    expect(epgData.a[0]).toMatchObject({ title: 'Primeiro', desc: 'Desc & more' });
  });

  it('keeps the earliest 5 upcoming programmes even when the file is unsorted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const rows = [8, 3, 6, 1, 7, 2, 5, 4].map(h => {
      const s = String(10 + h).padStart(2, '0');
      return `<programme start="20260319${s}0000 +0000" stop="20260319${s}5900 +0000" channel="a"><title>H${h}</title></programme>`;
    }).join('');
    const epgData = await parseEPG(`<tv>${rows}</tv>`);
    expect(epgData.a.map(p => p.title)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5']);
  });

  it('stops reading once the decompressed size passes EPG_MAX_BYTES', async () => {
    const original = env.EPG_MAX_BYTES;
    env.EPG_MAX_BYTES = 1024;
    try {
      const bomb = zlib.gzipSync(Buffer.from('<tv>' + 'a'.repeat(64 * 1024) + '</tv>'));
      expect(await parseEPGStream([bomb])).toEqual({});
      expect(await parseEPGStream([Buffer.from('<tv>' + ' '.repeat(4096) + '</tv>')])).toEqual({});
    } finally {
      env.EPG_MAX_BYTES = original;
    }
  });

  it('returns {} for a corrupt gzip body', async () => {
    const gz = zlib.gzipSync(SAMPLE_XMLTV);
    expect(await parseEPGStream([gz.subarray(0, 20), Buffer.from('garbage')])).toEqual({});
  });
});

// ─── parseEPG native window ──────────────────────────────────────────────────

describe('parseEPG with nativeDays', () => {
  const xml = (rows: string) => `<?xml version="1.0"?><tv>${rows}</tv>`;
  const prog = (start: string, stop: string, title: string) =>
    `<programme start="${start} +0000" stop="${stop} +0000" channel="a"><title>${title}</title></programme>`;
  const many = Array.from({ length: 8 }, (_, i) => {
    const h = String(12 + i).padStart(2, '0');
    const h2 = String(13 + i).padStart(2, '0');
    return prog(`20260319${h}0000`, `20260319${h2}0000`, `Show ${i}`);
  }).join('');

  it('keeps more than 5 future programmes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const short = await parseEPG(xml(many));
    const full = await parseEPG(xml(many), undefined, { nativeDays: 2 });
    expect(short.a.length).toBe(5);
    expect(full.a.length).toBe(8);
  });

  it('drops programmes past the horizon', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const rows = prog('20260319120000', '20260319130000', 'Soon') + prog('20260325120000', '20260325130000', 'Next week');
    const full = await parseEPG(xml(rows), undefined, { nativeDays: 2 });
    expect(full.a.map((p: any) => p.title)).toEqual(['Soon']);
  });
});
