export const DEFAULT_LOCAL_URL = 'http://localhost:3000';
export const DEFAULT_PREVIEW_URL = 'https://ais-pre-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('quest_compendium_backend_url');
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }

    // If running in packaged Electron or standalone desktop with file protocol, use local server
    if ((window as any).electronAPI || window.location.protocol === 'file:') {
      return DEFAULT_LOCAL_URL;
    }

    // When testing desktop in development on localhost, use local dev server directly
    const host = window.location.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return '';
    }

    // If running embedded on Itch.io or its content delivery network (itch.zone / hwcdn.net)
    if (host.includes('itch.io') || host.includes('itch.zone') || host.includes('hwcdn.net')) {
      return DEFAULT_PREVIEW_URL;
    }
  }

  // If running in development (localhost:3000) or as a web app on the cloud, use relative paths
  return '';
};

export const setApiBaseUrl = (url: string) => {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('quest_compendium_backend_url', url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('quest_compendium_backend_url');
    }
  }
};

export const testBackendHealth = async (baseUrl?: string): Promise<{ ok: boolean; status?: number; error?: string; hasGeminiKey?: boolean }> => {
  const url = baseUrl !== undefined ? baseUrl.trim().replace(/\/+$/, '') : getApiBaseUrl();
  const endpoint = `${url}/api/health`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return { ok: true, status: res.status, hasGeminiKey: data.hasGeminiKey };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out (6s). Server is unreachable or unresponsive.' };
    }
    return { ok: false, error: err?.message || 'Network error' };
  }
};

