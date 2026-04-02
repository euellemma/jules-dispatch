import type { SettingsData, ProviderConfig } from './types';

const API_BASE = ((import.meta as { env: Record<string, string | undefined> }).env.VITE_CONVEX_SITE_URL || '').replace(/\/$/, '');

function settingsUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function fetchConfig(token: string): Promise<SettingsData | null> {
  const resp = await fetch(settingsUrl(`/settings/api/config?token=${token}`));
  if (!resp.ok) {
    if (resp.status === 401) throw new Error('Session expired. Please get a new link from Telegram.');
    throw new Error('Failed to load settings');
  }
  return resp.json();
}

export async function saveConfig(token: string, config: ProviderConfig): Promise<void> {
  const resp = await fetch(settingsUrl('/settings/api/save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...config }),
  });
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Failed to save settings');
  }
}

export async function saveJulesKey(token: string, apiKey: string): Promise<void> {
  const resp = await fetch(settingsUrl('/settings/api/save-jules'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, apiKey }),
  });
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Failed to save Jules key');
  }
}

export async function saveExaKey(token: string, apiKey: string): Promise<void> {
  const resp = await fetch(settingsUrl('/settings/api/save-exa'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, apiKey }),
  });
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Failed to save Exa key');
  }
}

export async function testConnection(token: string, config: ProviderConfig): Promise<{ success: boolean; error?: string }> {
  const resp = await fetch(settingsUrl('/settings/api/test'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...config }),
  });
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Failed to test connection');
  }
  return resp.json();
}

export async function saveNotificationPreference(token: string, enabled: boolean): Promise<void> {
  const resp = await fetch(settingsUrl('/settings/api/notifications'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, enabled }),
  });
  if (!resp.ok) {
    const error = await resp.json();
    throw new Error(error.error || 'Failed to save notification preference');
  }
}
