export const DEFAULT_PREVIEW_URL = 'https://ais-pre-7asbcj4i2k3t5ydostzqlu-520069861129.us-east1.run.app';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('quest_compendium_backend_url');
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }

  // If running in Electron (electronAPI is present), use the published cloud backend
  // so the desktop app can utilize the securely stored Gemini API key without prompting the user.
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return DEFAULT_PREVIEW_URL;
  }

  // If running from file:// (edge case), we need an absolute URL to the backend.
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return DEFAULT_PREVIEW_URL;
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

