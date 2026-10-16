export type Provider = 'xtream' | 'iptv-org' | 'm3u';

export interface XtreamConfig {
  provider: 'xtream';
  xtreamUrl: string;
  xtreamUsername: string;
  xtreamPassword: string;
  enableEpg: boolean;
  epgUrl?: string;
  epgOffsetHours?: number;
  reformatLogos: boolean;
  instanceId?: string;
}

export interface IptvOrgConfig {
  provider: 'iptv-org';
  iptvOrgCountry: string | null;
  iptvOrgCategory: string | null;
}

export interface M3uConfig {
  provider: 'm3u';
  m3uUrl: string;
  enableEpg: boolean;
  epgUrl?: string;
  epgOffsetHours?: number;
  reformatLogos: boolean;
  globalUserAgent?: string;
}

export type PosterShape = 'poster' | 'landscape';

export type AddonConfig = (XtreamConfig | IptvOrgConfig | M3uConfig) & { catalogName?: string; posterShape?: PosterShape };

export interface AddonInfo {
  name: string;
  description: string;
  logoUrl: string;
  encryptionEnabled: boolean;
}

export interface PublicPlaylist {
  label: string;
  note?: string;
  url: string;
}

/** A config field the server can blame for a failed step. */
export type ConfigField = 'xtreamUrl' | 'xtreamUsername' | 'xtreamPassword' | 'm3uUrl' | 'epgUrl';

export type StepStatus = 'ok' | 'skip' | 'fail';

export interface CheckStep {
  id: string;
  label: string;
  status: StepStatus;
  ms: number;
  detail: string;
  field?: ConfigField;
}

/** Response of GET /:token/check.json */
export interface CheckResult {
  ok: boolean;
  provider: Provider;
  channels: number;
  groups: number;
  programmes: number;
  channelsWithGuide: number;
  vodSkipped: number;
  steps: CheckStep[];
  error?: string;
}
