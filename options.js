// Options page script for Autodarts Hook
const DEFAULT_OPTIONS = {
  // separate 'listen' flags (whether to attach listeners) and 'log' flags (console debug)
  listenIncoming: true,
  listenOutgoing: true,
  logIncoming: true,
  logOutgoing: true,
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

document.addEventListener('DOMContentLoaded', () => {
  const listenIncomingEl = document.getElementById('listenIncoming');
  const logIncomingEl = document.getElementById('logIncoming');
  const listenOutgoingEl = document.getElementById('listenOutgoing');
  const logOutgoingEl = document.getElementById('logOutgoing');
  const sigEnabled = document.getElementById('signalREnabled');
  const sigHub = document.getElementById('signalRHubUrl');
  const sigMethod = document.getElementById('signalRMethod');
  const sigIncoming = document.getElementById('signalRPublishIncoming');
  const sigOutgoing = document.getElementById('signalRPublishOutgoing');
  const sigVerbose = document.getElementById('signalRVerboseLogging');
  const sigStatus = document.getElementById('signalR-status');
  const sigTest = document.getElementById('signalR-test');
  const sigSendTest = document.getElementById('signalR-send-test');
  const wsEnabled = document.getElementById('websocketEnabled');
  const wsUrl = document.getElementById('websocketUrl');
  const wsIncoming = document.getElementById('websocketPublishIncoming');
  const wsOutgoing = document.getElementById('websocketPublishOutgoing');
  const wsStatusEl = document.getElementById('websocket-status');
  const wsTest = document.getElementById('websocket-test');
  const wsSendTest = document.getElementById('websocket-send-test');
  const wsVerbose = document.getElementById('websocketVerboseLogging');
  const status = document.getElementById('status');

  function showStatus(msg) {
    status.textContent = msg;
    setTimeout(() => { status.textContent = ''; }, 1500);
  }

  function updatePublishControls() {
    // Incoming
    if (!listenIncomingEl.checked) {
      if (wsIncoming) { wsIncoming.checked = false; wsIncoming.disabled = true; }
      if (sigIncoming) { sigIncoming.checked = false; sigIncoming.disabled = true; }
    } else {
      if (wsIncoming) wsIncoming.disabled = false;
      if (sigIncoming) sigIncoming.disabled = false;
    }
    // Outgoing
    if (!listenOutgoingEl.checked) {
      if (wsOutgoing) { wsOutgoing.checked = false; wsOutgoing.disabled = true; }
      if (sigOutgoing) { sigOutgoing.checked = false; sigOutgoing.disabled = true; }
    } else {
      if (wsOutgoing) wsOutgoing.disabled = false;
      if (sigOutgoing) sigOutgoing.disabled = false;
    }
  }

  function loadOptions() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_OPTIONS, (values) => {
        listenIncomingEl.checked = !!values.listenIncoming;
        logIncomingEl.checked = !!values.logIncoming;
        listenOutgoingEl.checked = !!values.listenOutgoing;
        logOutgoingEl.checked = !!values.logOutgoing;
        sigEnabled.checked = !!values.signalREnabled;
        sigHub.value = values.signalRHubUrl || '';
        sigMethod.value = values.signalRMethod || 'Publish';
        sigIncoming.checked = !!values.signalRPublishIncoming;
        sigOutgoing.checked = !!values.signalRPublishOutgoing;
        sigVerbose.checked = !!values.signalRVerboseLogging;
        // websocket
        if (wsEnabled) wsEnabled.checked = !!values.websocketEnabled;
        if (wsUrl) wsUrl.value = values.websocketUrl || '';
        if (wsIncoming) wsIncoming.checked = !!values.websocketPublishIncoming;
        if (wsOutgoing) wsOutgoing.checked = !!values.websocketPublishOutgoing;
        if (wsVerbose) wsVerbose.checked = !!values.websocketVerboseLogging;
        updatePublishControls();
      });
    } else {
      // Fallback defaults in environments where chrome.storage isn't available
      listenIncomingEl.checked = DEFAULT_OPTIONS.listenIncoming;
      logIncomingEl.checked = DEFAULT_OPTIONS.logIncoming;
      listenOutgoingEl.checked = DEFAULT_OPTIONS.listenOutgoing;
      logOutgoingEl.checked = DEFAULT_OPTIONS.logOutgoing;
    }
  }

  function saveOptions() {
    const toSave = {
      listenIncoming: listenIncomingEl.checked,
      logIncoming: logIncomingEl.checked,
      listenOutgoing: listenOutgoingEl.checked,
      logOutgoing: logOutgoingEl.checked,
      signalREnabled: sigEnabled.checked,
      signalRHubUrl: sigHub.value,
      signalRMethod: sigMethod.value,
      signalRPublishIncoming: sigIncoming.checked,
      signalRPublishOutgoing: sigOutgoing.checked,
      signalRVerboseLogging: sigVerbose.checked,
      websocketEnabled: wsEnabled ? wsEnabled.checked : false,
      websocketUrl: wsUrl ? wsUrl.value : '',
      websocketPublishIncoming: wsIncoming ? wsIncoming.checked : false,
      websocketPublishOutgoing: wsOutgoing ? wsOutgoing.checked : false,
      websocketVerboseLogging: wsVerbose ? wsVerbose.checked : false
    };
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(toSave, () => {
        showStatus('Options saved');
        updatePublishControls();
      });
    } else {
      showStatus('Options saved (not persisted in this environment)');
      updatePublishControls();
    }
  }

  listenIncomingEl.addEventListener('change', () => { updatePublishControls(); saveOptions(); });
  logIncomingEl.addEventListener('change', saveOptions);
  listenOutgoingEl.addEventListener('change', () => { updatePublishControls(); saveOptions(); });
  logOutgoingEl.addEventListener('change', saveOptions);
  sigEnabled.addEventListener('change', saveOptions);
  sigHub.addEventListener('change', saveOptions);
  sigMethod.addEventListener('change', saveOptions);
  sigIncoming.addEventListener('change', saveOptions);
  sigOutgoing.addEventListener('change', saveOptions);
  if (sigVerbose) sigVerbose.addEventListener('change', saveOptions);
  if (wsEnabled) wsEnabled.addEventListener('change', saveOptions);
  if (wsUrl) wsUrl.addEventListener('change', saveOptions);
  if (wsIncoming) wsIncoming.addEventListener('change', saveOptions);
  if (wsOutgoing) wsOutgoing.addEventListener('change', saveOptions);

   // Test connection: ask background for status
   sigTest.addEventListener('click', () => {
     if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
       showStatus('Cannot reach background (not available)');
       return;
     }
     chrome.runtime.sendMessage({ type: 'signalr-ping' }, (resp) => {
       if (resp && resp.status) {
         sigStatus.textContent = `Status: ${resp.status}`;
       } else {
         sigStatus.textContent = 'No response from background';
       }
       setTimeout(() => { sigStatus.textContent = ''; }, 2500);
     });
   });

  sigSendTest.addEventListener('click', () => {
  // send a small test websocket-event to the background so you can verify it gets queued/published
  const channel = window.prompt('Optional channel for test message (e.g. autodarts.chat)') || null;
  const payloadObj = { type: 'test', time: new Date().toISOString() };
  if (channel) payloadObj.channel = channel;
  const testEvent = { type: 'websocket-event', direction: 'incoming', detail: { url: 'test', data: JSON.stringify(payloadObj), timestamp: new Date().toISOString() } };
    chrome.runtime.sendMessage(testEvent, (resp) => {
      if (resp && (resp.publishedSignalR || resp.publishedWebsocket || resp.published)) showStatus('Test message published');
      else if (resp && (resp.queuedSignalR || resp.queuedWebsocket || resp.queued)) showStatus('Test message queued');
      else showStatus('Test message not published');
    });
  });

  // WebSocket test button: check background for ws status
  if (wsTest && wsStatusEl) {
    wsTest.addEventListener('click', () => {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) { showStatus('Cannot reach background (not available)'); return; }
      chrome.runtime.sendMessage({ type: 'signalr-ping' }, (resp) => {
          if (resp && resp.wsStatus) {
            let txt = `Status: ${resp.wsStatus}`;
            if (resp.wsAutoStopped) txt += ' (auto-retry stopped)';
            wsStatusEl.textContent = txt;
          }
        else wsStatusEl.textContent = 'No response from background';
        setTimeout(() => { wsStatusEl.textContent = ''; }, 2500);
      });
    });
  }

  if (wsSendTest) {
    wsSendTest.addEventListener('click', () => {
      const channel = window.prompt('Optional channel for test message (e.g. autodarts.chat)') || null;
      const payloadObj = { type: 'test', time: new Date().toISOString() };
      if (channel) payloadObj.channel = channel;
      const testEvent = { type: 'websocket-event', direction: 'incoming', detail: { url: 'test', data: JSON.stringify(payloadObj), timestamp: new Date().toISOString() } };
      chrome.runtime.sendMessage(testEvent, (resp) => {
        if (resp && resp.publishedWebsocket) showStatus('Test message published to WebSocket');
        else if (resp && resp.queuedWebsocket) showStatus('Test message queued for WebSocket');
        else showStatus('Test message not published to WebSocket');
      });
    });
  }

  if (wsVerbose) wsVerbose.addEventListener('change', saveOptions);

  loadOptions();

  // Developer helper: show saved include/exclude lists in console
  const showSettingsBtn = document.getElementById('show-settings');
  if (showSettingsBtn) showSettingsBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_OPTIONS, (values) => {
        console.log('Saved settings:', values);
        showStatus('Saved settings logged to console');
      });
    } else {
      console.log('No chrome.storage; current settings are defaulted in this environment');
      showStatus('No storage; check console');
    }
  });

  // Small UI: help buttons beside each section - toggle a short help text (developer-oriented)
  document.querySelectorAll('.help-btn').forEach(btn => {
    const helpId = btn.getAttribute('aria-controls');
    const helpEl = helpId ? document.getElementById(helpId) : null;
    if (!helpEl) return;
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', (!expanded).toString());
      if (helpEl.hasAttribute('hidden')) helpEl.removeAttribute('hidden');
      else helpEl.setAttribute('hidden', '');
    });
  });
});
