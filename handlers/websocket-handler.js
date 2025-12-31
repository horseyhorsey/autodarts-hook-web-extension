// moved from ../websocket-handler.js
(function() {
// websocket-handler.js
// Handles WebSocket connection and message logic for the extension.
// This file is intended to be imported via importScripts in background.js
let wsConnection = null;
let wsQueue = [];
const WS_QUEUE_LIMIT = 500;
let wsReconnectDelay = 3000;
let wsReconnectTimer = null;
let wsAutoAttempts = 0;
const WS_RECONNECT_BASE_MS = 3000;
const WS_RECONNECT_MAX_MS = 60000;
const WS_AUTO_RETRY_MAX = 6;

let settings = {};
let logDebug = () => {};
let logInfo = () => {};
let logWarn = () => {};
let logError = () => {};

function wsEnqueue(payload) {
  if (wsQueue.length >= WS_QUEUE_LIMIT) {
    logWarn('WebSocket queue full, dropping message');
    return;
  }
  wsQueue.push({ payload, ts: Date.now() });
}

function flushWsQueue() {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
  while (wsQueue.length > 0) {
    const item = wsQueue.shift();
    try {
      wsConnection.send(JSON.stringify(item.payload));
    } catch (err) {
      logDebug('WebSocket send failed when flushing', err && err.message);
      wsEnqueue(item.payload);
      return;
    }
  }
}

function startWebSocketConnection(opts = {}) {
  if (!settings.websocketEnabled || !settings.websocketUrl) {
    stopWsConnection();
    return;
  }
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    logDebug('WebSocket already connected');
    return;
  }
  if (wsConnection) {
    try { wsConnection.close(); } catch (e) { /* ignore */ }
    wsConnection = null;
  }
  logInfo('Connecting WebSocket to', settings.websocketUrl);
  wsConnection = new WebSocket(settings.websocketUrl);
  wsConnection.onopen = function() {
    logInfo('WebSocket connected');
    wsReconnectDelay = WS_RECONNECT_BASE_MS;
    wsAutoAttempts = 0;
    flushWsQueue();
  };
  wsConnection.onclose = function(evt) {
    logWarn('WebSocket closed', evt && evt.code, evt && evt.reason);
    wsConnection = null;
    if (settings.websocketEnabled && (opts.auto !== false)) {
      if (wsAutoAttempts < WS_AUTO_RETRY_MAX) {
        wsAutoAttempts++;
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, WS_RECONNECT_MAX_MS);
        logInfo('WebSocket reconnecting in', wsReconnectDelay, 'ms (attempt', wsAutoAttempts, ')');
        wsReconnectTimer = setTimeout(() => startWebSocketConnection({ auto: true }), wsReconnectDelay);
      } else {
        logWarn('WebSocket auto-retry stopped after', wsAutoAttempts, 'attempts');
      }
    }
  };
  wsConnection.onerror = function(err) {
    logError('WebSocket error', err && err.message);
  };
  wsConnection.onmessage = function(evt) {
    logDebug('WebSocket received message', evt && evt.data);
    // Optionally, relay to content/background if needed
  };
}

function stopWsConnection() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsConnection) {
    try { wsConnection.close(); } catch (e) { /* ignore */ }
    wsConnection = null;
  }
}

function publishToWebSocket(data) {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    try {
      wsConnection.send(JSON.stringify(data));
      logDebug('WebSocket sent message', data);
    } catch (err) {
      logWarn('WebSocket send error', err && err.message);
      wsEnqueue(data);
    }
  } else {
    wsEnqueue(data);
    if (settings.websocketEnabled) {
      startWebSocketConnection({ auto: false });
    }
  }
}

function initWebSocket(newSettings, logFns) {
  settings = newSettings;
  logDebug = logFns.logDebug;
  logInfo = logFns.logInfo;
  logWarn = logFns.logWarn;
  logError = logFns.logError;
}

self.websocketHandler = {
  initWebSocket,
  startWebSocketConnection,
  stopWsConnection,
  publishToWebSocket,
  wsEnqueue,
  flushWsQueue,
  get wsAutoAttempts() { return wsAutoAttempts; },
  get WS_AUTO_RETRY_MAX() { return WS_AUTO_RETRY_MAX; }
};

})();
