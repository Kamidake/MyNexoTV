import type { AddonConfig } from '../types/config'

function encodeConfigBase64Url(config: AddonConfig): string {
  const json = JSON.stringify(config)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface AddonUrls {
  token: string
  /** The server encrypted the token. When false, the token is Base64 of the config. */
  encrypted: boolean
  backendOrigin: string
  manifestUrl: string
  stremioUrl: string
}

/** Encrypts the config through POST /encrypt, or falls back to Base64URL when the server has no secret. */
export async function buildAddonUrls(config: AddonConfig): Promise<AddonUrls> {
  let token = ''
  let encrypted = false
  try {
    const res = await fetch('/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    })
    if (res.ok) {
      token = (await res.json()).token
      encrypted = true
    }
  } catch {
    // Fall back to Base64 below
  }
  if (!token) token = encodeConfigBase64Url(config)

  // In dev mode the frontend runs on a different port (5173) from the backend (7000).
  // Manifest and Stremio URLs must point to the backend, not the Vite dev server.
  const backendOrigin = import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:7000`
    : window.location.origin
  const manifestUrl = `${backendOrigin}/${token}/manifest.json`
  const stremioUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://')
  return { token, encrypted, backendOrigin, manifestUrl, stremioUrl }
}
