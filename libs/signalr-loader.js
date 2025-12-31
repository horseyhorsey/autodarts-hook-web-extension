// SignalR loader: try to load a local copy first, then fall back to CDN
(function() {
  const localPath = chrome.runtime.getURL('libs/signalr.min.js');
  try {
    importScripts(localPath);
    console.log('[SignalR Loader] Loaded local SignalR from', localPath);
    return;
  } catch (e) {
    console.warn('[SignalR Loader] Local SignalR not found, attempting CDN load', e && e.message);
  }

  // Fallback to CDN (best-effort). Some environments may block remote import due to CSP.
  try {
    importScripts('https://cdn.jsdelivr.net/npm/@microsoft/signalr@7.0.5/dist/browser/signalr.min.js');
    console.log('[SignalR Loader] Loaded SignalR from CDN');
  } catch (e) {
    console.error('[SignalR Loader] Failed to load SignalR library', e && e.message);
  }
})();
