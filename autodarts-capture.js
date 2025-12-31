(function() {
  console.log('[Autodarts Hook] Starting Capture Script');

  try {
    const property = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');

    if (!property || !property.get) {
      console.error('[Autodarts Hook] Could not get data property descriptor');
      return;
    }

    const originalGetter = property.get;

    function interceptMessageData() {
      // Check if this is a WebSocket message
      const isWebSocket = this.currentTarget instanceof WebSocket;

      if (!isWebSocket) {
        return originalGetter.call(this);
      }

      const messageData = originalGetter.call(this);

      try {
        // assume string messages are JSON
        window.dispatchEvent(new CustomEvent('autodarts-incoming', {
          detail: {
            url: (this.currentTarget).url,
            data: typeof messageData === 'string' ? messageData : '(binary data)',
            timestamp: new Date().toISOString(),
          },
        }));
      } catch (error) {
        console.error('[Autodarts Hook] Error processing message:', error);
      }

      return messageData;
    }

    property.get = interceptMessageData;
    Object.defineProperty(MessageEvent.prototype, 'data', property);

    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      try {
        // assume string messages are JSON
        window.dispatchEvent(new CustomEvent('autodarts-outgoing', {
          detail: {
            url: this.url,
            data: typeof data === 'string' ? data : '(binary data)',
            timestamp: new Date().toISOString(),
          },
        }));
      } catch (error) {
        console.error('[Autodarts Hook] Error intercepting send:', error);
      }

      return originalSend.call(this, data);
    };

    console.log('[Autodarts Hook] Capture Initialized');
  } catch (error) {
    console.error('[Autodarts Hook] Capture failed:', error);
  }
})();
