// Background service worker: manages a SignalR connection and publishes messages sent from content scripts.
importScripts(chrome.runtime.getURL('libs/signalr-loader.js'));

const DEFAULTS = {
  signalREnabled: false,
  signalRHubUrl: '',
  signalRMethod: 'Publish',
  signalRPublishIncoming: false,
  signalRPublishOutgoing: false
  ,signalRVerboseLogging: false
  ,websocketEnabled: false
  ,websocketUrl: ''
  ,websocketPublishIncoming: false
  ,websocketPublishOutgoing: false
  ,websocketVerboseLogging: false
};

let settings = Object.assign({}, DEFAULTS);
let connection = null;
let queue = [];
const QUEUE_LIMIT = 500;
// WebSocket support
// Simple leveled logging helpers so we can demote expected errors
function logDebug(...args) {
  if (settings.signalRVerboseLogging) console.debug('[AutoDarts SignalR]', ...args);
}
function logInfo(...args) {
  if (settings.signalRVerboseLogging) console.info('[AutoDarts SignalR]', ...args);
}
function logWarn(...args) {
  const msg = args.join(' ');
  if (
    (msg.includes('Failed to complete negotiation with the server') ||
     msg.includes('Failed to fetch') ||
     msg.includes('HubConnection failed to start successfully')) &&
    !settings.signalRVerboseLogging
  ) {
    return;
  }
  console.warn('[AutoDarts SignalR]', ...args);
}

function logError(...args) {
  const msg = args.join(' ');
  if (
    (msg.includes('Failed to complete negotiation with the server') ||
     msg.includes('Failed to fetch') ||
     msg.includes('HubConnection failed to start successfully')) &&
    !settings.signalRVerboseLogging
  ) {
    return;
  }
  console.error('[AutoDarts SignalR]', ...args);
}

async function startConnection() {
  if (!settings.signalREnabled || !settings.signalRHubUrl) {
    stopConnection();
    return;
  }

  if (!ensureSignalR()) {
    // retry later
    setTimeout(startConnection, 3000);
    return;
  }

  if (connection && connection.state === signalR.HubConnectionState.Connected) {
    return;
  }

  if (connection) {
    try { await connection.stop(); } catch (e) { /* ignore */ }
  }

  connection = createConnection(settings.signalRHubUrl);
  if (!connection) return;

  try {
    await connection.start();
    logInfo('SignalR connected');
    flushQueue();
  } catch (err) {
    const msg = (err && err.message) || '';
    if (
      msg.includes('Failed to complete negotiation with the server') ||
      msg.includes('Failed to fetch')
    ) {
      if (settings.signalRVerboseLogging) {
        logDebug('SignalR start failed (negotiation/fetch)', msg);
      }
      // else: do not log
    } else {
      logWarn('SignalR start failed', msg);
    }
    setTimeout(startConnection, 3000);
  }
}

function stopConnection() {
  if (!connection) return;
  try {
  connection.stop().catch(e => logWarn('stop error', e && e.message));
  } finally {
    connection = null;
  }
}

// import handler scripts
importScripts(chrome.runtime.getURL('handlers/channel-filter.js'));
importScripts(chrome.runtime.getURL('handlers/signalr-handler.js'));
importScripts(chrome.runtime.getURL('handlers/websocket-handler.js'));

chrome.storage.sync.get(DEFAULTS, (vals) => {
  settings = Object.assign({}, DEFAULTS, vals || {});
  // Initialize handlers with settings and logging functions
  signalrHandler.initSignalR(settings, { logDebug, logInfo, logWarn, logError });
  websocketHandler.initWebSocket(settings, { logDebug, logInfo, logWarn, logError });
  if (settings.signalREnabled) signalrHandler.startConnection();
  if (settings.websocketEnabled) websocketHandler.startWebSocketConnection({ auto: true });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  let restart = false;
  let wsRestart = false;
  for (const k of Object.keys(changes)) {
    settings[k] = changes[k].newValue;
    if (k === 'signalREnabled' || k === 'signalRHubUrl' || k === 'signalRMethod') restart = true;
    if (k === 'websocketEnabled' || k === 'websocketUrl') wsRestart = true;
    // React to verbose logging changes immediately
    if (k === 'signalRVerboseLogging') {
      settings.signalRVerboseLogging = changes[k].newValue;
    }
    if (k === 'websocketVerboseLogging') {
      settings.websocketVerboseLogging = changes[k].newValue;
    }
  }
  // Re-init handlers with updated settings
  signalrHandler.initSignalR(settings, { logDebug, logInfo, logWarn, logError });
  websocketHandler.initWebSocket(settings, { logDebug, logInfo, logWarn, logError });
  if (restart) {
    if (settings.signalREnabled) signalrHandler.startConnection(); else signalrHandler.stopConnection();
  }
  if (wsRestart) {
    if (settings.websocketEnabled) websocketHandler.startWebSocketConnection({ auto: true }); else websocketHandler.stopWsConnection();
  }
});


// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'websocket-event') return;

  const direction = message.direction;
  const detail = message.detail || {};
  const rawData = detail.data;
  let parsedData; // lazy-parsed only when needed

  // Prefer a precomputed channel supplied by the content script (fastest)
  let ch = message.channel || null;

  // If content script didn't compute a channel, try cheap extraction
  if (!ch) {
    try {
      if (typeof ChannelFilter !== 'undefined' && ChannelFilter && typeof ChannelFilter.extractChannel === 'function') {
        ch = ChannelFilter.extractChannel(rawData);
      } else if (typeof rawData === 'object' && rawData !== null) {
        const KEYS = ['channel', 'topic', 'event', 'name', 'type'];
        for (const k of KEYS) if (typeof rawData[k] === 'string' && rawData[k]) { ch = rawData[k]; break; }
      } else if (typeof rawData === 'string') {
        let s = rawData;
        if (s !== '(binary data)') {
          let idx = s.indexOf('\"channel\"');
          if (idx === -1) idx = s.indexOf('\"Channel\"');
          if (idx === -1) idx = s.indexOf("'channel'");
          if (idx === -1) idx = s.indexOf("'Channel'");
          if (idx !== -1) {
            let i = s.indexOf(':', idx + 1);
            if (i !== -1) {
              i++; while (i < s.length && /\s/.test(s[i])) i++;
              const quote = s[i];
              if (quote === '"' || quote === "'") {
                let start = i + 1; let esc = false;
                for (let j = start; j < s.length; j++) {
                  const ch2 = s[j];
                  if (ch2 === quote && !esc) { ch = s.slice(start, j); break; }
                  esc = (ch2 === '\\' && !esc);
                }
              } else {
                let start = i; while (start < s.length && /\s/.test(s[start])) start++;
                let j = start; while (j < s.length && /[^,\]\}\s]/.test(s[j])) j++;
                let token = s.slice(start, j);
                ch = token.replace(/^['\"]|['\"]$/g, '') || null;
              }
            }
          } else {
            const m = /["']channel["']\s*:\s*["']([^"']+)["']/i.exec(s);
            if (m && m[1]) ch = m[1];
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Log extracted channel for debugging (no filtering applied here)
  if (ch) logDebug('extracted channel', ch);

  // Create payload early so parsing can be lazy and shared across branches
  const payload = {
    direction,
    url: detail.url,
    data: undefined, // lazy-parse only when necessary
    rawData: detail.data,
    timestamp: detail.timestamp,
    tabId: sender.tab ? sender.tab.id : null,
    frameId: sender.frameId
  };

  function parseDataIfNeeded() {
    if (payload.data !== undefined) return;
    const rd = payload.rawData;
    if (typeof rd === 'object' && rd !== null) {
      payload.data = rd;
      return;
    }
    if (typeof rd === 'string') {
      try { payload.data = JSON.parse(rd); } catch (e) { payload.data = rd; }
      return;
    }
    payload.data = rd;
  }

  const method = settings.signalRMethod || DEFAULTS.signalRMethod;
  const allowedSignalR = settings.signalREnabled && ((direction === 'incoming' && settings.signalRPublishIncoming) || (direction === 'outgoing' && settings.signalRPublishOutgoing));
  const allowedWs = settings.websocketEnabled && ((direction === 'incoming' && settings.websocketPublishIncoming) || (direction === 'outgoing' && settings.websocketPublishOutgoing));

  if (!allowedSignalR && !allowedWs) {
    sendResponse({ published: false, reason: 'disabled' });
    return;
  }

  const tasks = [];
  const result = {};

  // SignalR task
  if (allowedSignalR) {
    parseDataIfNeeded();
    if (connection && connection.state === signalR.HubConnectionState.Connected) {
      const p = connection.invoke(method, payload).then(() => { result.publishedSignalR = true; }).catch(err => { logDebug('invoke error', err && err.message); signalrHandler.publishToSignalR({ method, payload }); result.publishedSignalR = false; result.errorSignalR = String(err); });
      tasks.push(p);
    } else {
      signalrHandler.publishToSignalR({ method, payload });
      result.queuedSignalR = true;
    }
  }

  // WebSocket task
  if (allowedWs) {
    try {
      parseDataIfNeeded();
      websocketHandler.publishToWebSocket(payload);
      result.queuedWebsocket = true;
    } catch (err) {
      logDebug('websocket handling failed', err && err.message);
      result.errorWebsocket = String(err);
    }
  }

  if (tasks.length > 0) {
    Promise.all(tasks).then(() => sendResponse(result)).catch(() => sendResponse(result));
    return true; // keep channel open
  }

  sendResponse(result);
  return false;
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'signalr-ping') {
    let wsStatus = 'no-connection';
    try {
      if (wsConnection) {
        switch (wsConnection.readyState) {
          case WebSocket.CONNECTING: wsStatus = 'connecting'; break;
          case WebSocket.OPEN: wsStatus = 'connected'; break;
          case WebSocket.CLOSING: wsStatus = 'closing'; break;
          case WebSocket.CLOSED: wsStatus = 'closed'; break;
          default: wsStatus = String(wsConnection.readyState);
        }
      }
    } catch (e) { wsStatus = 'unknown'; }
    // Use signalrHandler.getConnectionState for accurate status
    let sigStatus = 'no-connection';
    try {
      if (signalrHandler && typeof signalrHandler.getConnectionState === 'function') {
        sigStatus = signalrHandler.getConnectionState();
      }
    } catch (e) {}
    sendResponse({
      status: sigStatus,
      wsStatus,
      wsAutoAttempts: websocketHandler.wsAutoAttempts,
      wsAutoStopped: !!(websocketHandler.wsAutoAttempts >= websocketHandler.WS_AUTO_RETRY_MAX),
      settings
    });
    return;
  }

  if (message.type === 'signalr-ensure-connected') {
    // Only start if SignalR is enabled and a hub URL is configured
    if (!settings.signalREnabled) {
      sendResponse({ ok: false, reason: 'disabled' });
      return;
    }
    if (!settings.signalRHubUrl) {
      sendResponse({ ok: false, reason: 'no-hub-url' });
      return;
    }
    try {
      if (signalrHandler && typeof signalrHandler.startConnection === 'function') {
        signalrHandler.startConnection();
      } else {
        startConnection();
      }
      let sigStatus = 'no-connection';
      try {
        if (signalrHandler && typeof signalrHandler.getConnectionState === 'function') {
          sigStatus = signalrHandler.getConnectionState();
        }
      } catch (e) {}
      sendResponse({ ok: true, started: true, status: sigStatus });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return;
  }
});
