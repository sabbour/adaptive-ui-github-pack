// ─── GitHub Auth ───
// Supports two auth methods:
// 1. OAuth Device Flow — uses GitHub OAuth App client_id
//    In dev, the Vite proxy forwards requests to github.com (avoiding CORS).
//    In production, a CORS proxy URL can be configured in settings.
// 2. Personal Access Token (PAT) — direct token entry (api.github.com supports CORS)

// Default GitHub OAuth App client ID — public, not secret
const DEFAULT_CLIENT_ID = 'Ov23liG3k61qLZnRjBGu';

// Vite dev proxy paths (see vite.config.ts)
const DEV_DEVICE_CODE_PATH = '/github-oauth/device/code';
const DEV_TOKEN_PATH = '/github-oauth/access_token';

// Direct GitHub URLs (for production with CORS proxy)
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const POLL_INTERVAL = 5000;

// Storage keys
const STORAGE_TOKEN = 'adaptive-ui-github-token';
const STORAGE_USER = 'adaptive-ui-github-user';
const STORAGE_CLIENT_ID = 'adaptive-ui-github-client-id';
const STORAGE_CORS_PROXY = 'adaptive-ui-github-cors-proxy';
const STORAGE_ORG = 'adaptive-ui-github-org';
const STORAGE_REPO = 'adaptive-ui-github-repo';

let cachedToken: string | null = null;
let cachedUser: string | null = null;

// ─── Token Storage ───

export function getStoredToken(): string | null {
  if (!cachedToken) {
    try { cachedToken = localStorage.getItem(STORAGE_TOKEN); } catch {}
  }
  return cachedToken;
}

export function getStoredUser(): string | null {
  if (!cachedUser) {
    try { cachedUser = localStorage.getItem(STORAGE_USER); } catch {}
  }
  return cachedUser;
}

export function storeAuth(token: string | null, user: string | null): void {
  cachedToken = token;
  cachedUser = user;
  try {
    if (token) localStorage.setItem(STORAGE_TOKEN, token);
    else localStorage.removeItem(STORAGE_TOKEN);
    if (user) localStorage.setItem(STORAGE_USER, user);
    else localStorage.removeItem(STORAGE_USER);
  } catch {}
}

export function getStoredClientId(): string {
  try { return localStorage.getItem(STORAGE_CLIENT_ID) || DEFAULT_CLIENT_ID; } catch { return DEFAULT_CLIENT_ID; }
}

export function storeClientId(clientId: string): void {
  try {
    if (clientId) localStorage.setItem(STORAGE_CLIENT_ID, clientId);
    else localStorage.removeItem(STORAGE_CLIENT_ID);
  } catch {}
}

export function getStoredCorsProxy(): string {
  try { return localStorage.getItem(STORAGE_CORS_PROXY) || ''; } catch { return ''; }
}

export function storeCorsProxy(proxy: string): void {
  try {
    if (proxy) localStorage.setItem(STORAGE_CORS_PROXY, proxy);
    else localStorage.removeItem(STORAGE_CORS_PROXY);
  } catch {}
}

// ─── Org/Repo persistence (survives across sessions) ───

export function getStoredOrg(): string {
  try { return localStorage.getItem(STORAGE_ORG) || ''; } catch { return ''; }
}

export function storeOrg(org: string): void {
  try {
    if (org) localStorage.setItem(STORAGE_ORG, org);
    else localStorage.removeItem(STORAGE_ORG);
  } catch {}
}

export function getStoredRepo(): string {
  try { return localStorage.getItem(STORAGE_REPO) || ''; } catch { return ''; }
}

export function storeRepo(repo: string): void {
  try {
    if (repo) localStorage.setItem(STORAGE_REPO, repo);
    else localStorage.removeItem(STORAGE_REPO);
  } catch {}
}

/** Detect if we're running under the Vite dev server (proxy available) */
function isDevMode(): boolean {
  try { return import.meta.env?.DEV === true; } catch { return false; }
}

/**
 * Resolve the URL for a GitHub OAuth endpoint.
 * In dev mode, uses the Vite proxy paths to avoid CORS.
 * In production, uses a CORS proxy if configured, otherwise direct URLs.
 */
function resolveOAuthUrl(endpoint: 'device_code' | 'access_token'): string {
  if (isDevMode()) {
    return endpoint === 'device_code' ? DEV_DEVICE_CODE_PATH : DEV_TOKEN_PATH;
  }
  const proxy = getStoredCorsProxy();
  const url = endpoint === 'device_code' ? GITHUB_DEVICE_CODE_URL : GITHUB_TOKEN_URL;
  if (!proxy) return url;
  const base = proxy.endsWith('/') ? proxy : proxy + '/';
  return base + url;
}

// ─── PAT Auth ───

export async function loginWithPAT(token: string): Promise<{ login: string; name: string | null; avatar_url: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Authentication failed (${res.status})`);
  const data = await res.json();
  storeAuth(token, data.login);
  return { login: data.login, name: data.name, avatar_url: data.avatar_url };
}

export interface GitHubTokenInspection {
  ok: boolean;
  status: number;
  login: string;
  scopes: string[];
  acceptedScopes: string[];
  hasWorkflowScope: boolean;
  tokenPreview: string;
  message?: string;
}

function parseScopes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function previewToken(token: string): string {
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/** Inspect stored GitHub token (without exposing full token value). */
export async function inspectStoredToken(): Promise<GitHubTokenInspection> {
  const token = getStoredToken();
  if (!token) {
    return {
      ok: false,
      status: 0,
      login: '',
      scopes: [],
      acceptedScopes: [],
      hasWorkflowScope: false,
      tokenPreview: '',
      message: 'No stored GitHub token found.',
    };
  }

  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });

  const scopes = parseScopes(res.headers.get('x-oauth-scopes'));
  const acceptedScopes = parseScopes(res.headers.get('x-accepted-oauth-scopes'));

  let login = '';
  let message: string | undefined;
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    login = String((data as any)?.login || '');
  } else {
    const err = await res.json().catch(() => ({}));
    message = String((err as any)?.message || `Authentication failed (${res.status})`);
  }

  return {
    ok: res.ok,
    status: res.status,
    login,
    scopes,
    acceptedScopes,
    hasWorkflowScope: scopes.indexOf('workflow') !== -1,
    tokenPreview: previewToken(token),
    message,
  };
}

// ─── OAuth Device Flow ───

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** Step 1: Request a device code */
export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const url = resolveOAuthUrl('device_code');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: 'repo workflow read:user read:org',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (!isDevMode() && !getStoredCorsProxy()) {
      throw new Error('CORS blocked. In production, set a CORS proxy URL in the GitHub settings.');
    }
    throw new Error(`Failed to request device code: ${res.status} ${text}`);
  }
  return res.json();
}

/** Step 2: Poll for the access token */
export async function pollForToken(
  clientId: string,
  deviceCode: string,
  onPoll?: () => void
): Promise<string> {
  const maxAttempts = 60; // 5 minutes at 5s intervals
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    onPoll?.();

    const res = await fetch(resolveOAuthUrl('access_token'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await res.json();

    if (data.access_token) {
      // Fetch user info and store
      const user = await loginWithPAT(data.access_token);
      return user.login;
    }

    if (data.error === 'authorization_pending') {
      continue; // User hasn't completed auth yet
    }

    if (data.error === 'slow_down') {
      // Back off
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization denied by user.');
    }

    throw new Error(data.error_description || data.error || 'Unknown error');
  }

  throw new Error('Polling timed out. Please try again.');
}

/** Disconnect — clear stored auth */
export function logout(): void {
  storeAuth(null, null);
}
