function createCanvas(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  let drawing = false;
  let points = [];
  let color = '#000000';
  let strokeCallback = () => {};

  // Hi-DPI support
  function resizeForHiDPI() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = rect.width + 'px';
    canvasEl.style.height = rect.height + 'px';
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function setColor(c) { color = c; }

  function clear() {
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }

  function drawLineSegment(a, b, strokeColor) {
    ctx.strokeStyle = strokeColor || color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function drawStrokeImmediate(pts, strokeColor) {
    for (let i = 1; i < pts.length; i++) {
      drawLineSegment(pts[i - 1], pts[i], strokeColor);
    }
  }

  function drawRemoteStroke(stroke) {
    if (!stroke || !Array.isArray(stroke.points)) return;
    drawStrokeImmediate(stroke.points, stroke.color || '#000');
  }

  function pointerPos(evt) {
    const rect = canvasEl.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function startPoint(pt) {
    drawing = true;
    points = [pt];
  }

  function movePoint(pt) {
    if (!drawing) return;
    points.push(pt);
    const len = points.length;
    if (len > 1) drawLineSegment(points[len - 2], points[len - 1]);
  }

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    const stroke = {
      type: 'stroke',
      points: points.slice(),
      color,
      timestamp: Date.now()
    };
    strokeCallback(stroke);
  }

  // Events
  canvasEl.addEventListener('pointerdown', (e) => {
    canvasEl.setPointerCapture(e.pointerId);
    startPoint(pointerPos(e));
  });

  canvasEl.addEventListener('pointermove', (e) => {
    movePoint(pointerPos(e));
  });

  canvasEl.addEventListener('pointerup', (e) => {
    canvasEl.releasePointerCapture(e.pointerId);
    endStroke();
  });

  canvasEl.addEventListener('pointercancel', () => { endStroke(); });

  window.addEventListener('resize', () => { resizeForHiDPI(); });
  // initial resize for current canvas size
  setTimeout(resizeForHiDPI, 0);

  return {
    setColor,
    clear,
    drawRemoteStroke,
    onStrokeComplete(cb) { strokeCallback = cb; },
    // compatibility helpers used in index.html
    drawRemoteStroke: drawRemoteStroke
  };
}

// Export for simple import pattern when included via <script>
window.createCanvas = createCanvas;
