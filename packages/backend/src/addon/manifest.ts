import env from '../config/env';
import { version } from '../../package.json';

export function createManifest(idPrefix?: string, catalogName?: string, nativeEpg = false) {
    return {
        id: 'community.nexotv',
        version,
        name: env.ADDON_NAME,
        description: env.ADDON_DESCRIPTION,
        resources: ['catalog', 'stream', 'meta'],
        types: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: 'iptv_channels',
                name: catalogName || env.ADDON_NAME,
                extra: [
                    { name: 'genre', isRequired: false, options: [] },
                    { name: 'search', isRequired: false },
                    { name: 'skip' },
                    ...(nativeEpg ? [{ name: 'date', isRequired: false }] : [])
                ],
                genres: []
            }
        ],
        idPrefixes: idPrefix ? [`xc${idPrefix}_`, `io${idPrefix}_`, `m3${idPrefix}_`] : ['xc', 'io', 'm3'],
        behaviorHints: {
            configurable: true,
            configurationRequired: true,
            ...(nativeEpg ? { epgProvider: true } : {})
        },
        ...(env.ADDON_LOGO_URL ? { logo: env.ADDON_LOGO_URL } : {}),
        ...(env.ADDON_BACKGROUND_URL ? { background: env.ADDON_BACKGROUND_URL } : {}),
    };
}
