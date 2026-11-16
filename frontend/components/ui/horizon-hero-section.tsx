"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type * as THREE from "three";

type HorizonHeroSectionProps = {
  children?: ReactNode;
  contained?: boolean;
};

// Adapted from the supplied Horizon hero: scoped motion, neutral colors and
// complete disposal keep the scene isolated from the rest of the app.
export function HorizonHeroSection({ children, contained = false }: HorizonHeroSectionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      root.querySelectorAll<HTMLElement>("[data-horizon-reveal]").forEach((element) => {
        gsap.fromTo(element, { y: 28, opacity: 0 }, {
          y: 0,
          opacity: 1,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: element, start: "top 94%", once: true },
        });
      });
    }, root);

    let cancelled = false;
    let visible = false;
    let initialized = false;
    let syncRenderer: (() => void) | undefined;
    let disposeScene: (() => void) | undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const initScene = async () => {
      const [Three, { EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import("three"),
        import("three/addons/postprocessing/EffectComposer.js"),
        import("three/addons/postprocessing/RenderPass.js"),
        import("three/addons/postprocessing/UnrealBloomPass.js"),
      ]);
      if (cancelled) return;

      // Keep the CSS horizon visible if WebGL is unavailable.
      const context = canvas.getContext("webgl2", { alpha: false, antialias: false });
      if (!context) return;
      const renderer = new Three.WebGLRenderer({ canvas, context, antialias: false });
      const scene = new Three.Scene();
      scene.background = new Three.Color(0x070707);
      scene.fog = new Three.FogExp2(0x070707, 0.00035);
      const camera = new Three.PerspectiveCamera(65, 1, 0.1, 2000);
      camera.position.set(0, 30, 100);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      const composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      const bloomPass = new UnrealBloomPass(new Three.Vector2(1, 1), 0.42, 0.5, 0.8);
      composer.addPass(renderPass);
      composer.addPass(bloomPass);

      let frame = 0;
      let progress = 0;
      let contextLost = false;
      const mountains: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[] = [];
      const animatedMaterials: THREE.ShaderMaterial[] = [];
      const startedAt = performance.now();

      const resize = () => {
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        composer.setSize(width, height);
      };
      const onScroll = () => {
        const { top, height } = root.getBoundingClientRect();
        const distance = contained ? height + window.innerHeight : height - window.innerHeight;
        const offset = contained ? window.innerHeight - top : -top;
        progress = Math.max(0, Math.min(offset / Math.max(distance, 1), 1));
      };
      const render = () => {
        frame = 0;
        if (cancelled || contextLost || document.hidden || !visible || motion.matches) return;
        const time = (performance.now() - startedAt) / 1000;
        animatedMaterials.forEach((material) => { material.uniforms.time.value = time; });
        camera.position.x += (Math.sin(time * 0.09) * 2 - camera.position.x) * 0.035;
        camera.position.y += (30 + progress * 18 - camera.position.y) * 0.035;
        camera.position.z += (100 - progress * 210 - camera.position.z) * 0.035;
        camera.lookAt(0, 10, -600);
        mountains.forEach((mountain, index) => {
          mountain.position.x = Math.sin(time * 0.08) * (index + 1);
        });
        composer.render();
        frame = requestAnimationFrame(render);
      };
      syncRenderer = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        render();
      };
      const onContextLost = (event: Event) => {
        event.preventDefault();
        contextLost = true;
        cancelAnimationFrame(frame);
        setSceneReady(false);
      };

      const sizeObserver = new ResizeObserver(resize);
      disposeScene = () => {
        cancelAnimationFrame(frame);
        sizeObserver.disconnect();
        window.removeEventListener("scroll", onScroll);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        scene.traverse((object) => {
          if (object instanceof Three.Mesh || object instanceof Three.Points) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        bloomPass.dispose();
        renderPass.dispose();
        composer.dispose();
        renderer.dispose();
      };

      const starCount = window.innerWidth < 640 ? 800 : 1800;
      for (let layer = 0; layer < 2; layer++) {
        const positions = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        for (let index = 0; index < starCount; index++) {
          const radius = 220 + Math.random() * 780;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(Math.random() * 2 - 1);
          positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
          positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
          positions[index * 3 + 2] = radius * Math.cos(phi);
          sizes[index] = Math.random() * 1.6 + 0.4;
        }
        const geometry = new Three.BufferGeometry();
        geometry.setAttribute("position", new Three.BufferAttribute(positions, 3));
        geometry.setAttribute("size", new Three.BufferAttribute(sizes, 1));
        const material = new Three.ShaderMaterial({
          uniforms: { time: { value: 0 }, depth: { value: layer } },
          vertexShader: `
            attribute float size;
            uniform float time;
            uniform float depth;
            void main() {
              vec3 pos = position;
              float angle = time * 0.012 * (1.0 - depth * 0.3);
              mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
              pos.xy = rot * pos.xy;
              vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
              gl_PointSize = clamp(size * (260.0 / max(-mvPosition.z, 1.0)), 0.0, 4.0);
              gl_Position = projectionMatrix * mvPosition;
            }
          `,
          fragmentShader: `
            void main() {
              float dist = length(gl_PointCoord - vec2(0.5));
              if (dist > 0.5) discard;
              float opacity = (1.0 - smoothstep(0.0, 0.5, dist)) * 0.65;
              gl_FragColor = vec4(vec3(0.86), opacity);
            }
          `,
          transparent: true,
          blending: Three.AdditiveBlending,
          depthWrite: false,
        });
        const starField = new Three.Points(geometry, material);
        scene.add(starField);
        animatedMaterials.push(material);
      }

      const nebulaMaterial = new Three.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float time;
          varying vec2 vUv;
          void main() {
            vec2 p = (vUv - 0.5) * vec2(1.0, 2.3);
            float glow = max(0.0, 1.0 - length(p) * 2.0);
            float cloud = sin(vUv.x * 11.0 + time * 0.08) * 0.12 + 0.25;
            gl_FragColor = vec4(vec3(0.35), glow * cloud);
          }
        `,
        transparent: true,
        blending: Three.AdditiveBlending,
        depthWrite: false,
      });
      const nebula = new Three.Mesh(new Three.PlaneGeometry(2400, 1100), nebulaMaterial);
      nebula.position.set(0, 80, -1050);
      scene.add(nebula);
      animatedMaterials.push(nebulaMaterial);

      [0x1c1c1c, 0x171717, 0x121212, 0x0d0d0d].forEach((color, layer) => {
        const points: THREE.Vector2[] = [];
        for (let index = 0; index <= 70; index++) {
          const x = (index / 70 - 0.5) * 2200;
          const height = 26 + layer * 12;
          const y = Math.sin(index * 0.21 + layer) * height
            + Math.sin(index * 0.49) * height * 0.35 - 95;
          points.push(new Three.Vector2(x, y));
        }
        points.push(new Three.Vector2(1100, -600), new Three.Vector2(-1100, -600));
        const mountain = new Three.Mesh(
          new Three.ShapeGeometry(new Three.Shape(points)),
          new Three.MeshBasicMaterial({ color, side: Three.DoubleSide }),
        );
        mountain.position.z = -180 - (3 - layer) * 100;
        scene.add(mountain);
        mountains.push(mountain);
      });

      resize();
      onScroll();
      sizeObserver.observe(canvas);
      window.addEventListener("scroll", onScroll, { passive: true });
      canvas.addEventListener("webglcontextlost", onContextLost);
      render();
      setSceneReady(true);
    };

    const syncPlayback = () => {
      if (!initialized && visible && !document.hidden && !motion.matches) {
        initialized = true;
        void initScene().catch(() => {
          disposeScene?.();
          disposeScene = undefined;
          syncRenderer = undefined;
          if (!cancelled) setSceneReady(false);
        });
      } else {
        syncRenderer?.();
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio > 0;
      syncPlayback();
    }, { threshold: [0, 0.001] });
    observer.observe(root);
    document.addEventListener("visibilitychange", syncPlayback);
    motion.addEventListener("change", syncPlayback);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      motion.removeEventListener("change", syncPlayback);
      media.revert();
      disposeScene?.();
    };
  }, [contained]);

  const layerPosition = contained ? "absolute" : "fixed";
  return (
    <div ref={rootRef} className="horizon-root dark relative isolate min-h-[100dvh] overflow-clip bg-[#070707] text-neutral-100" data-scene={sceneReady ? "ready" : "fallback"}>
      <div className={`horizon-fallback pointer-events-none ${layerPosition} inset-0 -z-30`} aria-hidden="true" />
      <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none ${layerPosition} inset-0 -z-20 h-full w-full transition-opacity duration-1000 motion-reduce:transition-none ${sceneReady ? "opacity-100" : "opacity-0"}`} />
      <div className={`horizon-shade pointer-events-none ${layerPosition} inset-0 -z-10`} aria-hidden="true" />
      {children ?? <HorizonDemoContent />}
    </div>
  );
}

function HorizonDemoContent() {
  const sections = [
    ["HORIZON", "Where vision meets reality,", "we shape the future of tomorrow"],
    ["COSMOS", "Beyond the boundaries of imagination,", "lies the universe of possibilities"],
    ["INFINITY", "In the space between thought and creation,", "we find the essence of true innovation"],
  ];

  return (
    <main>
      {sections.map(([title, firstLine, secondLine], index) => (
        <section key={title} className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center" aria-labelledby={`horizon-${index}`}>
          <div data-horizon-reveal>
            <p className="mb-8 text-xs tracking-[0.3em] text-neutral-400">0{index + 1} / 03</p>
            {index === 0 ? (
              <h1 id={`horizon-${index}`} className="text-[clamp(2.5rem,12vw,9rem)] font-medium tracking-tight">{title}</h1>
            ) : (
              <h2 id={`horizon-${index}`} className="text-[clamp(2.5rem,12vw,9rem)] font-medium tracking-tight">{title}</h2>
            )}
            <p className="mt-6 text-sm leading-7 text-neutral-300 sm:text-xl">{firstLine}<br />{secondLine}</p>
          </div>
        </section>
      ))}
    </main>
  );
}

export { HorizonHeroSection as Component };
