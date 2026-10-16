import { describe, it, expect, vi, afterEach } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  DEBUG: false,
  CACHE_ENABLED: false,
  CACHE_TTL_MS: 21600000,
  MAX_CACHE_ENTRIES: 300,
  IPTV_ORG_CACHE_TTL_MS: 21600000,
  M3U_CACHE_TTL_MS: 21600000,
  DATA_MEMORY_TTL_MS: 300000,
  UPDATE_INTERVAL_MS: 14400000,
  SQLITE_PATH: null,
  ADDON_NAME: 'TestAddon',
  ADDON_DESCRIPTION: 'Test description',
  ADDON_LOGO_URL: '',
  ADDON_BACKGROUND_URL: '',
  EPG_NATIVE_ENABLED: true,
  EPG_NATIVE_DAYS: 2,
}));
vi.mock('../../src/config/env', () => ({ default: mockEnv, repoRoot: '/tmp' }));
vi.mock('../../src/utils/sqliteCache', () => ({
  init: vi.fn(), get: vi.fn(() => null), set: vi.fn(), setRaw: vi.fn(),
  getRaw: vi.fn(() => null), del: vi.fn(), close: vi.fn(),
}));
vi.mock('../../src/providers/xtreamProvider', () => ({ fetchData: vi.fn() }));
vi.mock('../../src/providers/iptvOrgProvider', () => ({ fetchData: vi.fn() }));
vi.mock('../../src/providers/m3uProvider', () => ({ fetchData: vi.fn() }));
vi.mock('../../src/utils/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { M3UEPGAddon, isNativeEpg } from '../../src/addon/M3UEPGAddon';
import { createManifest } from '../../src/addon/manifest';
import { makeM3uConfig, makeIptvOrgConfig } from '../helpers/makeConfig';

const H = 3600000;
const DAY = Date.parse('2026-09-12T00:00:00.000Z');

function makeAddon() {
  const addon = new M3UEPGAddon(makeM3uConfig({ enableEpg: true }));
  const channel = { id: 'm3abc_1', name: 'News', attributes: { 'tvg-id': 'news.tv' } };
  addon.channels = [channel];
  addon.channelMap = new Map([[channel.id, channel]]);
  addon.epgData = {
    'news.tv': [
      { start: DAY - 2 * H, stop: DAY - H, title: 'Yesterday', desc: '' },
      { start: DAY - H, stop: DAY + H, title: 'Overnight', desc: '' },
      { start: DAY + 18 * H, stop: DAY + 19 * H, title: 'Evening News', desc: 'Headlines' },
      { start: DAY + 25 * H, stop: DAY + 26 * H, title: 'Tomorrow', desc: '' },
    ],
  };
  return { addon, channel };
}

afterEach(() => {
  mockEnv.EPG_NATIVE_ENABLED = true;
  vi.useRealTimers();
});

describe('isNativeEpg', () => {
  it('needs the host flag and the user EPG toggle', () => {
    expect(isNativeEpg(makeM3uConfig({ enableEpg: true }))).toBe(true);
    expect(isNativeEpg(makeM3uConfig({ enableEpg: false }))).toBe(false);
    mockEnv.EPG_NATIVE_ENABLED = false;
    expect(isNativeEpg(makeM3uConfig({ enableEpg: true }))).toBe(false);
  });

  it('stays off for iptv-org, which has no guide', () => {
    expect(isNativeEpg(makeIptvOrgConfig({ enableEpg: true }))).toBe(false);
  });
});

describe('createManifest with native EPG', () => {
  it('adds the optional date extra and epgProvider', () => {
    const m: any = createManifest('abc', undefined, true);
    expect(m.catalogs[0].extra).toContainEqual({ name: 'date', isRequired: false });
    expect(m.behaviorHints.epgProvider).toBe(true);
  });

  it('leaves the manifest unchanged when off', () => {
    const m: any = createManifest('abc');
    expect(m.catalogs[0].extra.map((e: any) => e.name)).not.toContain('date');
    expect(m.behaviorHints).not.toHaveProperty('epgProvider');
  });
});

describe('generateGuideMeta', () => {
  it('returns programmes that overlap the UTC day, as ISO start and end times', () => {
    const { addon, channel } = makeAddon();
    const meta: any = addon.generateGuideMeta(channel, '2026-09-12');
    expect(meta.behaviorHints).toEqual({ isLive: true, hasScheduledVideos: true });
    expect(meta.videos.map((v: any) => v.title)).toEqual(['Overnight', 'Evening News']);
    const news = meta.videos[1];
    expect(news.id).toBe('m3abc_1:epg:2026-09-12T18:00:00.000Z');
    expect(news.startTime).toBe('2026-09-12T18:00:00.000Z');
    expect(news.endTime).toBe('2026-09-12T19:00:00.000Z');
    expect(news.released).toBe(news.startTime);
    expect(news.overview).toBe('Headlines');
  });

  it('shifts programmes by epgOffsetHours', () => {
    const addon = new M3UEPGAddon(makeM3uConfig({ enableEpg: true, epgOffsetHours: 2 }));
    addon.epgData = { 'news.tv': [{ start: DAY + 18 * H, stop: DAY + 19 * H, title: 'X', desc: '' }] };
    const videos = addon.getProgrammeVideos({ id: 'c', attributes: { 'tvg-id': 'news.tv' } });
    expect(videos[0].startTime).toBe('2026-09-12T20:00:00.000Z');
  });

  it('returns no videos for a channel without a guide', () => {
    const { addon } = makeAddon();
    expect(addon.getProgrammeVideos({ id: 'x', attributes: {} })).toEqual([]);
  });
});

describe('getDetailedMeta with native EPG', () => {
  it('attaches the schedule from 3h ago onwards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY + 18.5 * H);
    const { addon, channel } = makeAddon();
    const meta: any = await addon.getDetailedMeta(channel.id);
    expect(meta.behaviorHints.hasScheduledVideos).toBe(true);
    expect(meta.videos.map((v: any) => v.title)).toEqual(['Evening News', 'Tomorrow']);
  });

  it('keeps the old meta shape when off', async () => {
    mockEnv.EPG_NATIVE_ENABLED = false;
    const { addon, channel } = makeAddon();
    const meta: any = await addon.getDetailedMeta(channel.id);
    expect(meta).not.toHaveProperty('videos');
  });
});
