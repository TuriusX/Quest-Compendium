export const DEFAULT_PREVIEW_URL = 'https://quest-compendium-1.ai.studio';

export const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    const customUrl = localStorage.getItem('quest_compendium_backend_url');
    if (customUrl && customUrl.trim()) {
      return customUrl.trim().replace(/\/+$/, '');
    }
  }

  // If running from file:// (Electron packaged), default to local server running on port 3000
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'http://localhost:3000';
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

