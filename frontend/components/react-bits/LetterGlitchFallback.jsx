'use client';

import { useEffect, useRef } from 'react';

// Keep the background usable on devices where the WebGL shader cannot link.
export default function LetterGlitchFallback({ settings, className, style, ...rest }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!container || !canvas || !context) return undefined;
    const base = document.createElement('canvas');
    const baseContext = base.getContext('2d');
    if (!baseContext) return undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hot = new Map();
    let cells = [];
    let width = 1;
    let height = 1;
    let ratio = 1;
    let frame = 0;
    let last = 0;
    let visible = true;
    let signature = '';

    const glyph = () => {
      const pool = Array.from(settingsRef.current.characters);
      return pool[Math.floor(Math.random() * pool.length)] || 'A';
    };
    const mask = (x, y) => {
      const s = settingsRef.current;
      const edge = s.edgeFade * Math.min(width, height);
      const edgeWeight = edge ? Math.min(1, Math.max(0, Math.min(x, y, width - x, height - y) / edge)) : 1;
      const room = Math.hypot(Math.max(0, Math.abs(x - width / 2) - width * 0.3), Math.max(0, Math.abs(y - height / 2) - height * 0.24));
      return edgeWeight * (1 - s.centerFade * (1 - Math.min(1, room / (Math.min(width, height) * 0.24))));
    };
    const build = () => {
      const s = settingsRef.current;
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      ratio = Math.min(2, s.dpr || window.devicePixelRatio || 1);
      canvas.width = base.width = Math.ceil(width * ratio);
      canvas.height = base.height = Math.ceil(height * ratio);
      baseContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      baseContext.font = `${s.fontSize}px ${s.fontFamily}`;
      baseContext.textAlign = 'center';
      baseContext.textBaseline = 'middle';
      baseContext.fillStyle = s.baseColor;
      cells = [];
      hot.clear();
      const stepX = Math.max(8, s.fontSize * (0.65 + s.spacing));
      const stepY = Math.max(10, s.fontSize * (1 + s.spacing));
      for (let y = stepY / 2; y < height && cells.length < 20000; y += stepY) {
        for (let x = stepX / 2; x < width && cells.length < 20000; x += stepX) {
          const cell = { x, y, mask: mask(x, y) };
          cells.push(cell);
          if (Math.random() > s.density) continue;
          baseContext.globalAlpha = s.baseOpacity * cell.mask * (0.6 + Math.random() * 0.4);
          baseContext.fillText(glyph(), x, y);
        }
      }
      signature = JSON.stringify([s.fontFamily, s.fontSize, s.spacing, s.characters, s.baseColor, s.baseOpacity, s.density, s.edgeFade, s.centerFade, s.dpr]);
    };
    const wake = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const draw = (now) => {
      frame = 0;
      if (!visible || document.hidden) return;
      const s = settingsRef.current;
      const nextSignature = JSON.stringify([s.fontFamily, s.fontSize, s.spacing, s.characters, s.baseColor, s.baseOpacity, s.density, s.edgeFade, s.centerFade, s.dpr]);
      if (signature !== nextSignature) build();
      const elapsed = last ? Math.min(100, now - last) : 33;
      if (elapsed < 32 && !motion.matches) { wake(); return; }
      last = now;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      if (s.backgroundColor) {
        context.fillStyle = s.backgroundColor;
        context.fillRect(0, 0, width, height);
      }
      context.globalAlpha = 1;
      context.drawImage(base, 0, 0, width, height);
      if (!motion.matches && s.speed > 0) {
        const count = Math.min(12, Math.ceil(cells.length * s.glitchAmount * s.speed * elapsed / 18000));
        for (let i = 0; i < count; i++) {
          hot.set(Math.floor(Math.random() * cells.length), { char: glyph(), until: now + 120 + Math.random() * 320, color: s.colors[Math.floor(Math.random() * s.colors.length)] });
        }
      }
      context.font = `${s.fontSize}px ${s.fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (const [index, item] of hot) {
        if (item.until < now || motion.matches) { hot.delete(index); continue; }
        const cell = cells[index];
        if (!cell) continue;
        context.globalAlpha = Math.min(0.7, (item.until - now) / 250) * cell.mask;
        context.fillStyle = item.color;
        context.fillText(item.char, cell.x, cell.y);
      }
      context.globalAlpha = 1;
      if (!motion.matches && s.speed > 0) wake();
    };
    const onResize = () => { build(); wake(); };
    const onVisibility = () => { last = 0; wake(); };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) wake();
    });
    intersection.observe(container);
    document.addEventListener('visibilitychange', onVisibility);
    document.fonts?.addEventListener('loadingdone', onResize);
    motion.addEventListener('change', onVisibility);
    build();
    wake();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      document.fonts?.removeEventListener('loadingdone', onResize);
      motion.removeEventListener('change', onVisibility);
    };
  }, []);

  return (
    <div ref={containerRef} className={`letter-glitch${className ? ` ${className}` : ''}`} style={style} {...rest}>
      <canvas ref={canvasRef} className="letter-glitch-canvas" aria-hidden="true" data-renderer="canvas2d" />
    </div>
  );
}
