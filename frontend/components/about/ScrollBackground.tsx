"use client";

import { useEffect, useRef } from "react";
import EtchedAccretion from "@/components/ui/etched-accretion";

export function ScrollBackground() {
  const frameRef = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bounds = frameRef.current;
    if (!bounds) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let current = 0;
    let target = 0;
    const paint = () => {
      current += (target - current) * 0.08;
      if (Math.abs(target - current) < 0.001) current = target;
      if (scene.current) {
        scene.current.style.transform = `scale(${1 + current * 0.65})`;
        scene.current.style.opacity = String(1 - current * 0.35);
      }
      frame = current !== target ? requestAnimationFrame(paint) : 0;
    };
    const update = () => {
      const { top, height } = bounds.getBoundingClientRect();
      target = media.matches ? 0 : Math.min(1, Math.max(0, -top / Math.max(1, height)));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    media.addEventListener("change", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      media.removeEventListener("change", update);
    };
  }, []);
  return (
    <div ref={frameRef} className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div ref={scene} className="h-full w-full origin-[68%_38%] will-change-transform">
        <EtchedAccretion height="100%" interactive={false} renderScale={0.8} params={{ center: [0.68, 0.38], exposure: 0.85 }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/80" />
    </div>
  );
}
