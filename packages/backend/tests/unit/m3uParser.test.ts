import { describe, it, expect } from 'vitest';
import { parseM3U, isVodUrl } from '../../src/parsers/m3uParser';
import { SAMPLE_M3U, MALFORMED_M3U, generateLargeM3U } from '../helpers/fixtures';

describe('parseM3U', () => {
  it('returns empty array for empty string', () => {
    const { channels, epgUrl } = parseM3U('');
    expect(channels).toEqual([]);
    expect(epgUrl).toBeNull();
  });

  it('returns empty array for non-M3U content', () => {
    const { channels } = parseM3U('just some text without m3u headers');
    expect(channels).toEqual([]);
  });

  it('parses basic channel with name and URL', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,My Channel\nhttp://stream.example.com/live';
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('My Channel');
    expect(channels[0].url).toBe('http://stream.example.com/live');
  });

  it('extracts tvg-id, tvg-name, tvg-logo, group-title', () => {
    const { channels } = parseM3U(SAMPLE_M3U);
    const cnn = channels.find((c: any) => c.tvgId === 'cnn.us');
    expect(cnn).toBeDefined();
    expect(cnn!.tvgName).toBe('CNN');
    expect(cnn!.logo).toBe('http://logo.example.com/cnn.png');
    expect(cnn!.group).toBe('News');
  });

  it('extracts x-tvg-url from EXTM3U header', () => {
    const { epgUrl } = parseM3U(SAMPLE_M3U);
    expect(epgUrl).toBe('http://epg.example.com/guide.xml');
  });

  it('parses multiple channels correctly', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="ch1",Channel One',
      'http://stream.example.com/ch1',
      '#EXTINF:-1 tvg-id="ch2",Channel Two',
      'http://stream.example.com/ch2',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(2);
    expect(channels[0].tvgId).toBe('ch1');
    expect(channels[1].tvgId).toBe('ch2');
  });

  it('falls back to null tvg-id when tvg-id attribute absent', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 tvg-name="No ID",No ID Channel\nhttp://stream.example.com/noid';
    const { channels } = parseM3U(m3u);
    expect(channels[0].tvgId).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const m3u = '#EXTM3U\r\n#EXTINF:-1,CRLF Channel\r\nhttp://stream.example.com/crlf\r\n';
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('CRLF Channel');
  });

  it('skips #EXTINF lines without a following URL', () => {
    const { channels } = parseM3U(MALFORMED_M3U);
    // MALFORMED_M3U has two #EXTINF but only one has a URL on the next line
    expect(channels).toHaveLength(1);
  });

  it('parses user-agent and referrer attributes', () => {
    const { channels } = parseM3U(SAMPLE_M3U);
    const espn = channels.find((c: any) => c.tvgId === 'espn.us');
    expect(espn).toBeDefined();
    expect(espn!.userAgent).toBe('VLC/3.0');
  });

  it('handles quoted and unquoted attribute values', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id=unquoted tvg-name="Quoted Name",Channel',
      'http://stream.example.com/ch',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels[0].tvgId).toBe('unquoted');
    expect(channels[0].tvgName).toBe('Quoted Name');
  });

  it('handles 10,000 channels without error', () => {
    const large = generateLargeM3U(10000);
    const { channels } = parseM3U(large);
    expect(channels).toHaveLength(10000);
  });
});

describe('parseM3U VOD filter', () => {
  const XTREAM_M3U_PLUS = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="hbo" group-title="Movies",Movies HD',
    'http://panel.example.com:8080/live/user/pass/100.ts',
    '#EXTINF:-1 group-title="Cinema",Movie Channel 24/7',
    'http://panel.example.com:8080/user/pass/101',
    '#EXTINF:-1 group-title="VOD | Action",The Movie (2020)',
    'http://panel.example.com:8080/movie/user/pass/200.mkv',
    '#EXTINF:-1 group-title="Series | Drama",Show S01 E01',
    'http://panel.example.com:8080/series/user/pass/300.mp4',
  ].join('\n');

  it('drops movie and series entries by default and counts them', () => {
    const { channels, vodSkipped } = parseM3U(XTREAM_M3U_PLUS);
    expect(channels.map((c: any) => c.name)).toEqual(['Movies HD', 'Movie Channel 24/7']);
    expect(vodSkipped).toBe(2);
  });

  it('keeps every entry when includeVod is true', () => {
    const { channels, vodSkipped } = parseM3U(XTREAM_M3U_PLUS, { includeVod: true });
    expect(channels.map((c: any) => c.url)).toEqual([
      'http://panel.example.com:8080/live/user/pass/100.ts',
      'http://panel.example.com:8080/user/pass/101',
      'http://panel.example.com:8080/movie/user/pass/200.mkv',
      'http://panel.example.com:8080/series/user/pass/300.mp4',
    ]);
    expect(vodSkipped).toBe(0);
  });

  it('returns vodSkipped 0 for an empty playlist', () => {
    expect(parseM3U('').vodSkipped).toBe(0);
  });
});

describe('isVodUrl', () => {
  it.each([
    'http://panel.example.com:8080/movie/user/pass/200.mkv',
    'http://panel.example.com/series/user/pass/300.mp4',
    'https://proxy.example.com/xtream/movie/user/pass/200.mp4?token=abc',
    'http://panel.example.com/MOVIE/user/pass/200.mkv',
  ])('detects the Xtream VOD path in %s', (url) => {
    expect(isVodUrl(url)).toBe(true);
  });

  it.each([
    'http://panel.example.com:8080/live/user/pass/100.ts',
    'http://panel.example.com:8080/user/pass/101',
    'http://panel.example.com/live/movies/user/pass/1.ts',
    'http://panel.example.com/movie/stream.m3u8',
    'http://panel.example.com/channels/movie/hd.m3u8',
    'http://panel.example.com/live.m3u8?path=/movie/user/pass/1.mkv',
    'http://panel.example.com',
    'rtmp://movie',
  ])('keeps the live URL %s', (url) => {
    expect(isVodUrl(url)).toBe(false);
  });
});
