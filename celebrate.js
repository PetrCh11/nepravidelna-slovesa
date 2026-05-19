// Lightweight confetti celebration — no dependencies.
// Triggered from app.js on lesson completion via window.celebrate({ intensity }).
(function () {
  'use strict';

  const COLORS = [
    '#5dc9bd', // brand teal
    '#7c6ff5', // brand purple
    '#f5a623', // warn/orange
    '#22c08e', // success green
    '#ff6b9d', // pink
    '#ffd166', // yellow
    '#5b59d9', // deep purple
    '#06d6a0', // mint
  ];

  let layer = null;

  function ensureLayer() {
    if (layer && document.body.contains(layer)) return layer;
    layer = document.createElement('div');
    layer.className = 'celebrate-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  }

  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function pickColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  function spawnPiece(host) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';

    // Random shape: rectangle (most common), circle, or square
    const shape = Math.random();
    if (shape < 0.2) piece.classList.add('circle');
    else if (shape < 0.35) piece.classList.add('square');

    const startX = rand(0, 100);        // vw
    const driftX = rand(-15, 15);       // vw (horizontal sway)
    const startY = rand(-12, -2);       // vh (above viewport)
    const fallDur = rand(2.4, 4.0);     // seconds
    const fallDelay = rand(0, 0.6);     // staggered start
    const rotStart = rand(0, 360);
    const rotEnd = rotStart + rand(180, 720) * (Math.random() < 0.5 ? -1 : 1);
    const size = rand(7, 12);           // px

    piece.style.setProperty('--start-x', `${startX}vw`);
    piece.style.setProperty('--drift-x', `${driftX}vw`);
    piece.style.setProperty('--start-y', `${startY}vh`);
    piece.style.setProperty('--rot-start', `${rotStart}deg`);
    piece.style.setProperty('--rot-end', `${rotEnd}deg`);
    piece.style.setProperty('--fall-dur', `${fallDur}s`);
    piece.style.setProperty('--fall-delay', `${fallDelay}s`);
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (piece.classList.contains('circle') ? 1 : rand(0.4, 1.4))}px`;
    piece.style.background = pickColor();

    host.appendChild(piece);

    // Self-cleanup
    const total = (fallDur + fallDelay) * 1000 + 200;
    setTimeout(() => piece.remove(), total);
  }

  function pulseElement(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove('celebrate-pulse');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('celebrate-pulse');
    setTimeout(() => el.classList.remove('celebrate-pulse'), 1400);
  }

  // Public API
  window.celebrate = function (opts) {
    const options = opts || {};
    const intensity = typeof options.intensity === 'number' ? options.intensity : 1;

    // Respect reduced-motion preference — fall back to a single mild pulse
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const host = ensureLayer();

    if (!reduced) {
      // 60 pieces at intensity=1, scaled by intensity (capped 30-120)
      const count = Math.max(30, Math.min(120, Math.round(60 * intensity)));
      for (let i = 0; i < count; i++) spawnPiece(host);
    }

    // Always pulse the headline (subtle, no motion sickness risk)
    pulseElement('.lesson-results h2');
  };
})();
