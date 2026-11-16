"use client";

import { useEffect, useRef } from "react";
import EtchedAccretion from "@/components/ui/etched-accretion";

const ZOOM = 1.1; // extra scale at the bottom of the page
const ORBIT_PARAMS = { center: [0.68, 0.38] as [number, number], exposure: 0.85 };

/**
 * The single backdrop of the About page: one animated orbit fixed behind
 * everything, zooming towards its centre as the page is scrolled.
 */
export function ScrollBackground() {
  const scene = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let current = 0;
    let target = 0;
    const paint = () => {
      current += (target - current) * 0.08;
      if (Math.abs(target - current) < 0.001) current = target;
      if (scene.current) scene.current.style.transform = `scale(${1 + current * ZOOM})`;
      // Text further down sits over the bright centre: darken as we get closer.
      if (shade.current) shade.current.style.opacity = String(current * 0.5);
      frame = current !== target ? requestAnimationFrame(paint) : 0;
    };
    const update = () => {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      target = media.matches || distance <= 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / distance));
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
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div ref={scene} className="h-full w-full origin-[68%_38%] will-change-transform">
        <EtchedAccretion height="100%" interactive={false} renderScale={0.8} params={ORBIT_PARAMS} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/80" />
      <div ref={shade} className="absolute inset-0 bg-black opacity-0" />
    </div>
  );
}
