(() => {
  'use strict';

  // The current production bundle polls every 8 seconds. Keep that bundle
  // compatible while reducing idle polling; the source bundle uses 60 seconds.
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (handler, delay, ...args) =>
    nativeSetInterval(handler, delay === 8000 ? 60000 : delay, ...args);

  // Reuse the last full staff snapshot when the Edge Function confirms that
  // generation/revision did not change. Cache is memory-only and auth-scoped.
  const nativeFetch = window.fetch.bind(window);
  let cached = null;
  let cachedAuthorization = '';
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'POST' || !url.endsWith('/functions/v1/office-staff')) return nativeFetch(input, init);

    let body;
    try { body = JSON.parse(String(init.body || '')); } catch { return nativeFetch(input, init); }
    if (body?.action !== 'load') return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const authorization = headers.get('authorization') || '';
    if (authorization !== cachedAuthorization) {
      cached = null;
      cachedAuthorization = authorization;
    }
    if (cached?.generation && Number.isSafeInteger(cached.revision)) {
      body.generation = cached.generation;
      body.revision = cached.revision;
    }

    const response = await nativeFetch(input, {...init, body: JSON.stringify(body)});
    if (!response.ok) return response;
    const data = await response.clone().json().catch(() => null);
    if (!data || typeof data !== 'object') return response;
    if (data.unchanged && cached) {
      const merged = {...cached, ...data, snapshot: cached.snapshot, unchanged: false};
      cached = merged;
      return new Response(JSON.stringify(merged), {status: response.status, statusText: response.statusText, headers: response.headers});
    }
    if (data.snapshot) cached = data;
    return response;
  };
})();
