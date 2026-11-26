// Frame-time meter (always on, cheap) plus an optional ?debug=1 overlay with
// FPS, draw calls, triangles and the active backend. window.__kalenovo is a
// frozen, read-only handle for automated measurement.
export function createStats(renderer, { backend, quality, effects, debug, tod = 'afternoon' }) {
  const times = [];
  let overlay = null, lastText = 0, drawCalls = 0, triangles = 0;
  if (debug) {
    overlay = document.createElement('pre');
    overlay.className = 'debug-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.querySelector('#walk').append(overlay);
  }
  // The pipeline renders several passes per frame; count them all.
  renderer.info.autoReset = false;
  const fps = () => {
    if (times.length < 2) return 0;
    return +((times.length - 1) * 1000 / (times[times.length - 1] - times[0])).toFixed(1);
  };
  const api = Object.freeze({
    backend,
    quality,
    tod,
    effects: Object.freeze([...effects]),
    fps,
    stats: () => Object.freeze({ fps: fps(), drawCalls, triangles }),
  });
  Object.defineProperty(window, '__kalenovo', { value: api, writable: false, configurable: false, enumerable: false });
  return {
    frame(now) {
      times.push(now);
      while (times.length > 2 && now - times[0] > 1000) times.shift();
      drawCalls = renderer.info.render.drawCalls;
      triangles = renderer.info.render.triangles;
      renderer.info.reset();
      if (overlay && now - lastText > 250) {
        lastText = now;
        overlay.textContent = `${fps().toFixed(0)} fps · ${backend}\n${drawCalls} draws · ${(triangles / 1e6).toFixed(2)} M tris\n${quality} · ${tod}: ${effects.join(', ')}`;
      }
    },
  };
}
