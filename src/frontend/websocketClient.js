function createWebsocketClient(wsUrl, handlers = {}) {
  const { onOpen = () => {}, onClose = () => {}, onStroke = () => {} } = handlers;
  let ws = null;
  let backoff = 500;
  let shouldRun = true;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      console.log('[ws] connected');
      backoff = 500;
      onOpen();
    });

    ws.addEventListener('message', (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload && payload.type === 'stroke') {
          onStroke(payload);
        }
      } catch (err) {
        console.warn('[ws] invalid message', err);
      }
    });

    ws.addEventListener('close', () => {
      console.log('[ws] closed');
      onClose();
      if (shouldRun) scheduleReconnect();
    });

    ws.addEventListener('error', (err) => {
      console.warn('[ws] error', err);
      ws.close();
    });
  }

  function scheduleReconnect() {
    setTimeout(() => {
      backoff = Math.min(5000, backoff * 1.5);
      console.log('[ws] reconnecting...');
      connect();
    }, backoff);
  }

  function sendStroke(stroke) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(stroke));
      return true;
    } catch (err) {
      console.warn('[ws] send failed', err);
      return false;
    }
  }

  function close() {
    shouldRun = false;
    if (ws) ws.close();
  }

  connect();

  return { sendStroke, close };
}

window.createWebsocketClient = createWebsocketClient;
