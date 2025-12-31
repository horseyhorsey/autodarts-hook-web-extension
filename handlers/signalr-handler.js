// moved from ../signalr-handler.js
(function() {
// signalr-handler.js
// Handles SignalR connection, message, and filtering logic for the extension.
// This file is intended to be imported via importScripts in background.js

let connection = null;
let queue = [];
const QUEUE_LIMIT = 500;

let settings = {};
let logDebug = () => {};
let logInfo = () => {};
let logWarn = () => {};
let logError = () => {};

let reconnectAttempts = 0;
let reconnectTimer = null;
const RECONNECT_BASE_DELAY = 2000; // ms
const RECONNECT_MAX_DELAY = 60000; // ms
const RECONNECT_JITTER_FACTOR = 0.3; // ±30% jitter

// Patterns to suppress noisy SignalR/WebSocket messages (negotiation failures, WS 1006, etc.)
const SIGNALR_SUPPRESS_LOG_PATTERNS = [
  /Failed to complete negotiation with the server/i,
  /Failed to start the connection/i,
  /Connection disconnected with error/i,
  /WebSocket closed with status code:\s*1006/i,
];

function shouldSuppressSignalRMessage(msg) {
  if (!msg) return false;
  try {
    const s = typeof msg === 'string'
      ? msg
      : (msg && (msg.message || (msg.toString && msg.toString()))) || JSON.stringify(msg);
    return SIGNALR_SUPPRESS_LOG_PATTERNS.some(re => re.test(s));
  } catch (e) {
    return false;
  }
}

let __consoleWrapped = false;
function wrapConsoleForSignalRSuppression() {
  if (__consoleWrapped) return;
  __consoleWrapped = true;
  try {
    if (typeof console !== 'undefined') {
      const origError = console.error && console.error.bind(console);
      const origWarn = console.warn && console.warn.bind(console);
      const wrap = (orig) => (...args) => {
        try {
          if (args.some(a => shouldSuppressSignalRMessage(a))) {
            logDebug('signalr-handler: suppressed console output', args);
            return;
          }
        } catch (e) {}
        if (orig) orig(...args);
      };
      if (origError) console.error = wrap(origError);
      if (origWarn) console.warn = wrap(origWarn);
    }

    if (typeof self !== 'undefined' && self.addEventListener) {
      self.addEventListener('unhandledrejection', ev => {
        try {
          const reason = ev && ev.reason;
          const msg = reason && (reason.message || (reason.toString && reason.toString()));
          if (shouldSuppressSignalRMessage(msg)) {
            logDebug('signalr-handler: suppressed unhandledrejection', msg);
            ev.preventDefault();
          }
        } catch (e) {}
      });

      self.addEventListener('error', ev => {
        try {
          const msg = ev && (ev.message || (ev.error && ev.error.message));
          if (shouldSuppressSignalRMessage(msg)) {
            logDebug('signalr-handler: suppressed error event', msg);
            ev.preventDefault();
          }
        } catch (e) {}
      });
    }
  } catch (e) {
    // never throw while wrapping console
  }
}

function makeSignalRLogger() {
  return {
    log(level, message) {
      try {
        const msg = typeof message === 'string' ? message : (message && (message.message || String(message)));
        if (shouldSuppressSignalRMessage(msg)) {
          logDebug('signalr-handler: suppressed signalr log', msg);
          return;
        }
        if (typeof signalR !== 'undefined' && signalR.LogLevel) {
          switch (level) {
            case signalR.LogLevel.Critical:
            case signalR.LogLevel.Error:
              logError(msg);
              break;
            case signalR.LogLevel.Warning:
              logWarn(msg);
              break;
            case signalR.LogLevel.Information:
              logInfo(msg);
              break;
            default:
              logDebug(msg);
          }
        } else {
          logDebug(msg);
        }
      } catch (e) {
        // swallow
      }
    }
  };
}

function ensureSignalR() {
  if (typeof signalR === 'undefined') {
    logWarn('signalR library not available');
    return false;
  }
  // install console / event filtering as soon as SignalR is present (safe, idempotent)
  wrapConsoleForSignalRSuppression();
  return true;
}

function isChannelAllowed(channel, /* allowedPatterns = [] */) {
  // Channel filtering removed: always allow (handlers should be responsible for filtering if needed)
  return true;
}

function extractChannel(parsedData) {
  if (!parsedData) return null;

  // Prefer the shared cheap extractor when available (fast string/object scan)
  try {
    if (typeof ChannelFilter !== 'undefined' && ChannelFilter && typeof ChannelFilter.extractChannel === 'function') {
      const ch = ChannelFilter.extractChannel(parsedData);
      if (ch) return ch;
    }
  } catch (e) {
    console.warn('ChannelFilter.extractChannel failed', e && e.message);
  }
}

function createConnection(url) {
  if (!ensureSignalR()) return null;
  return new signalR.HubConnectionBuilder()
    .withUrl(url)
    .configureLogging(makeSignalRLogger())
    .build();
}

async function startConnection() {
  if (!settings.signalREnabled || !settings.signalRHubUrl) return false;
  if (connection) stopConnection();
  connection = createConnection(settings.signalRHubUrl);
  if (!connection) {
    logError('Failed to create SignalR connection');
    return false;
  }

  // Set up event handlers
  connection.onclose(error => {
    logDebug('SignalR connection closed (scheduling reconnect)');
    scheduleReconnect('onclose');
  });
  connection.onreconnecting(error => {
    logDebug('SignalR reconnecting');
  });
  connection.onreconnected(connectionId => {
    logInfo('SignalR reconnected', connectionId);
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    flushQueue();
  });

  try {
    await connection.start();
    logInfo('SignalR connected');
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    flushQueue();
    return true;
  } catch (err) {
    logDebug('SignalR connection failed (will retry)', err && err.message);
    scheduleReconnect('start-failed');
    return false;
  }
}

function flushQueue() {
  if (!connection || connection.state !== (signalR && signalR.HubConnectionState && signalR.HubConnectionState.Connected)) {
    logDebug('flushQueue: not connected, state:', connection && connection.state);
    return;
  }
  while (queue.length > 0) {
    const { method, payload } = queue.shift();
    logDebug('flushQueue: invoking', method, payload);
    connection.invoke(method, payload).then(() => {
      logDebug('flushQueue: invoke success', method);
    }).catch(err => {
      logDebug('invoke failed (flush), re-queueing', err && err.message);
      if (queue.length < QUEUE_LIMIT) {
        queue.push({ method, payload, ts: Date.now() });
      }
    });
  }
}

function computeReconnectDelay(attempts) {
  const base = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempts - 1), RECONNECT_MAX_DELAY);
  const jitter = Math.floor(base * RECONNECT_JITTER_FACTOR * (Math.random() * 2 - 1));
  return Math.max(1000, base + jitter);
}

function scheduleReconnect(reason) {
  if (!settings.signalREnabled || !settings.signalRHubUrl) return;
  if (reconnectTimer) return; // already scheduled
  reconnectAttempts++;
  const delay = computeReconnectDelay(reconnectAttempts);
  logDebug('SignalR: scheduling reconnect', { attempt: reconnectAttempts, delay, reason });
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!settings.signalREnabled) {
      reconnectAttempts = 0;
      return;
    }
    if (connection && connection.state === (signalR && signalR.HubConnectionState && signalR.HubConnectionState.Connected)) {
      reconnectAttempts = 0;
      return;
    }
    const ok = await startConnection();
    if (!ok) {
      // schedule again
      scheduleReconnect('retry');
    } else {
      reconnectAttempts = 0;
    }
  }, delay);
}

function stopConnection() {
  // cancel pending reconnect attempts
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (connection) {
    connection.stop().catch(err => {
      // swallow transient stop errors so we don't spam console
      logDebug('SignalR stop failed', err && err.message);
    });
    connection = null;
  }
}


function publishToSignalR({ method, payload }) {
  logDebug('publishToSignalR: called with', { method, payload });
  if (!connection || connection.state !== (signalR && signalR.HubConnectionState && signalR.HubConnectionState.Connected)) {
    logDebug('publishToSignalR: not connected, state:', connection && connection.state);
    // queue the message if not connected
    if (queue.length >= QUEUE_LIMIT) {
      logWarn('queue full, dropping message');
      return;
    }
    queue.push({ method, payload, ts: Date.now() });
    return;
  }
  // Try to send immediately
  logDebug('publishToSignalR: invoking', method, payload);
  connection.invoke(method, payload).then(() => {
    logDebug('publishToSignalR: invoke success', method);
  }).catch(err => {
    logDebug('invoke failed, re-queueing', err && err.message);
    if (queue.length < QUEUE_LIMIT) {
      queue.push({ method, payload, ts: Date.now() });
    }
  });
}

function initSignalR(newSettings, logFns) {
  settings = newSettings;
  logDebug = logFns.logDebug;
  logInfo = logFns.logInfo;
  logWarn = logFns.logWarn;
  logError = logFns.logError;

  // ensure console/event wrappers are set if signalR is already available
  try { wrapConsoleForSignalRSuppression(); } catch (e) {}
}


function getConnectionState() {
  return connection ? connection.state : 'no-connection';
}

self.signalrHandler = {
  initSignalR,
  startConnection,
  stopConnection,
  publishToSignalR,
  isChannelAllowed,
  extractChannel,
  getConnectionState
};

})();
