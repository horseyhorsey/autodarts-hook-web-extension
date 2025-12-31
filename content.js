// Content script: injects the page script and listens for custom events
console.log('[Autodarts Hook] Content script running');

(function() {
  try {
    // Inject the capture script into the page (run in page context)
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('autodarts-capture.js');
    script.onload = () => script.remove();

    (document.head || document.documentElement).appendChild(script);

    // Default options (keeps previous behavior: both listeners enabled)
    // Added SignalR-related options (disabled by default)
    const DEFAULT_OPTIONS = {
  // separate 'listen' flags control whether handlers are attached
    listenIncoming: true,
    listenOutgoing: true,
    logIncoming: true,
    logOutgoing: true,
    signalREnabled: false,
    signalRPublishIncoming: false,
    signalRPublishOutgoing: false,
    signalRHubUrl: '',
    signalRMethod: 'Publish'
    ,websocketEnabled: false
    ,websocketUrl: ''
    ,websocketPublishIncoming: false
    ,websocketPublishOutgoing: false
    ,signalRVerboseLogging: false
    ,websocketVerboseLogging: false
    };

    // Handler references so we can add/remove them dynamically
    let incomingHandler = null;
    let outgoingHandler = null;
    let incomingAttached = false;
    let outgoingAttached = false;
  // The currently applied options (keeps handlers able to check logging flags at event time)
  let currentOptions = Object.assign({}, DEFAULT_OPTIONS);

    // Try to load the shared ChannelFilter into the content script so we can reuse its extractor (non-blocking)
    (function tryLoadChannelFilter() {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL && typeof fetch === 'function') {
          const url = chrome.runtime.getURL('handlers/channel-filter.js');
          fetch(url).then(r => r.text()).then(code => {
            try {
              // Evaluate in this scope; the file registers `ChannelFilter` on `self`.
              new Function(code)();
            } catch (e) {
              console.warn('[Autodarts Hook] Failed to eval channel filter', e && e.message);
            }
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
    })();

    // Fast channel extraction: try to get a channel name from the data without doing a full parse
    function extractChannelFromData(rawData) {
      // Prefer the shared extractor when available (non-blocking load above)
      try {
        if (typeof ChannelFilter !== 'undefined' && ChannelFilter && typeof ChannelFilter.extractChannel === 'function') {
          const ch = ChannelFilter.extractChannel(rawData);
          if (ch) return ch;
        }
      } catch (e) { /* ignore and fall back */ }

      if (!rawData) return null;
      const KEYS = ['channel', 'topic', 'event', 'name', 'type'];
      if (typeof rawData === 'object') {
        for (const k of KEYS) if (typeof rawData[k] === 'string' && rawData[k]) return rawData[k];
        return null;
      }
      if (typeof rawData !== 'string') return null;
      if (rawData === '(binary data)') return null;
      // Quick indexOf-based scan for common key forms (fast, avoids regex/parse when possible)
      let s = rawData;
      let idx = s.indexOf('"channel"');
      if (idx === -1) idx = s.indexOf('"Channel"');
      if (idx === -1) idx = s.indexOf("'channel'");
      if (idx === -1) idx = s.indexOf("'Channel'");
      if (idx !== -1) {
        let i = s.indexOf(':', idx + 1);
        if (i === -1) return null;
        i++; while (i < s.length && /\s/.test(s[i])) i++;
        const quote = s[i];
        if (quote === '"' || quote === "'") {
          let start = i + 1; let esc = false;
          for (let j = start; j < s.length; j++) {
            const ch = s[j];
            if (ch === quote && !esc) return s.slice(start, j);
            esc = (ch === '\\' && !esc);
          }
          return null;
        }
        // unquoted token (rare)
        let start = i; while (start < s.length && /\s/.test(s[start])) start++;
        let j = start; while (j < s.length && /[^,\]\}\s]/.test(s[j])) j++;
        let token = s.slice(start, j);
        return token.replace(/^['"]|['"]$/g, '') || null;
      }
      // fallback to small regex search (still cheaper than full parse for most inputs)
      const m = /["']channel["']\s*:\s*["']([^"']+)["']/i.exec(s);
      if (m && m[1]) return m[1];
      return null;
    }

    function createIncomingHandler() {
      if (incomingHandler) return incomingHandler;
      incomingHandler = (event) => {
        try {
          // Compute channel cheaply; include it in the message to avoid background parsing
          let channel = null;
          try { channel = extractChannelFromData(event.detail && event.detail.data); } catch (e) { /* ignore */ }
          if (currentOptions.logIncoming) {
            console.log('[Autodarts Hook][Incoming]', event.detail);
          }
          // Forward to background for optional SignalR publishing
          try {
            const msg = { type: 'websocket-event', direction: 'incoming', detail: event.detail };
            if (channel) msg.channel = channel;
              chrome.runtime.sendMessage(msg, (resp) => {
              // optional response handling; ignore for now
            });
          } catch (e) {
            // silently ignore. chrome.runtime may be unavailable in some test contexts
          }
        } catch (e) {
          console.error('[Autodarts Hook] Error handling incoming event', e);
        }
      };
      return incomingHandler;
    }

    function createOutgoingHandler() {
      if (outgoingHandler) return outgoingHandler;
      outgoingHandler = (event) => {
        try {
          // Compute channel cheaply; include it in the message to avoid background parsing
          let channel = null;
          try { channel = extractChannelFromData(event.detail && event.detail.data); } catch (e) { /* ignore */ }
          if (currentOptions.logOutgoing) {
            console.log('[Autodarts Hook][Outgoing]', event.detail);
          }
          try {
            const msg = { type: 'websocket-event', direction: 'outgoing', detail: event.detail };
            if (channel) msg.channel = channel;
            // Forward to background for optional SignalR publishing
            chrome.runtime.sendMessage(msg, (resp) => {
              // optional response handling
            });
          } catch (e) {
            // ignore if runtime not available
          }
        } catch (e) {
          console.error('[Autodarts Hook] Error handling outgoing event', e);
        }
      };
      return outgoingHandler;
    }

    function attachIncoming() {
      if (incomingAttached) return;
      window.addEventListener('autodarts-incoming', createIncomingHandler());
      incomingAttached = true;
    }

    function detachIncoming() {
      if (!incomingAttached) return;
      window.removeEventListener('autodarts-incoming', incomingHandler);
      incomingAttached = false;
    }

    function attachOutgoing() {
      if (outgoingAttached) return;
      window.addEventListener('autodarts-outgoing', createOutgoingHandler());
      outgoingAttached = true;
    }

    function detachOutgoing() {
      if (!outgoingAttached) return;
      window.removeEventListener('autodarts-outgoing', outgoingHandler);
      outgoingAttached = false;
    }

    function applyOptions(options) {
      // Ensure we have sensible defaults (include signalR publish flags)
      const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
  // keep a reference to the currently applied options so handlers can inspect flags
  currentOptions = opts;
  // Attach incoming handler if either listening or SignalR publishing for incoming is enabled
  if (opts.listenIncoming || opts.signalRPublishIncoming || opts.websocketPublishIncoming) attachIncoming(); else detachIncoming();
  // Attach outgoing handler if either listening or SignalR publishing for outgoing is enabled
  if (opts.listenOutgoing || opts.signalRPublishOutgoing || opts.websocketPublishOutgoing) attachOutgoing(); else detachOutgoing();
    }

    // If chrome.storage is available, read stored settings and react to changes
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_OPTIONS, (values) => {
        try {
          // initialize current options from storage and apply
          currentOptions = Object.assign({}, DEFAULT_OPTIONS, values);
          applyOptions(currentOptions);
        } catch (e) {
          console.error('[Autodarts Hook] Error applying options', e);
        }
      });

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'sync') return;
        // Merge only the changed values into our current options and re-apply
        const newOpts = {};
        if (changes.logIncoming) newOpts.logIncoming = changes.logIncoming.newValue;
        if (changes.logOutgoing) newOpts.logOutgoing = changes.logOutgoing.newValue;
  if (changes.listenIncoming) newOpts.listenIncoming = changes.listenIncoming.newValue;
  if (changes.listenOutgoing) newOpts.listenOutgoing = changes.listenOutgoing.newValue;
        if (changes.signalRPublishIncoming) newOpts.signalRPublishIncoming = changes.signalRPublishIncoming.newValue;
        if (changes.signalRPublishOutgoing) newOpts.signalRPublishOutgoing = changes.signalRPublishOutgoing.newValue;
  if (changes.websocketPublishIncoming) newOpts.websocketPublishIncoming = changes.websocketPublishIncoming.newValue;
  if (changes.websocketPublishOutgoing) newOpts.websocketPublishOutgoing = changes.websocketPublishOutgoing.newValue;
  if (changes.websocketEnabled) newOpts.websocketEnabled = changes.websocketEnabled.newValue;
        if (changes.signalREnabled) newOpts.signalREnabled = changes.signalREnabled.newValue;
        if (changes.signalRHubUrl) newOpts.signalRHubUrl = changes.signalRHubUrl.newValue;
        if (changes.signalRMethod) newOpts.signalRMethod = changes.signalRMethod.newValue;
        // Merge with previously applied options so unspecified values are preserved
        const merged = Object.assign({}, currentOptions, newOpts);
        applyOptions(merged);
      });
    } else {
      // Fallback: no storage available
      attachIncoming();
      attachOutgoing();
    }
  } catch (error) {
    console.error('[Autodarts Hook] Content script error', error);
  }

})();