"use client";

import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

const IDLE_SPEED = 0.6;
const HOVER_SPEED = 1;
const CLICK_SPEED = 2.4;
const STYLE_ID = "liquid-metal-button-style";

// The shader library inserts its own canvas; these rules size it to the ring
// and define the click ripple. Injected once for all buttons.
const STYLES = `
.liquid-metal-shader canvas {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  border-radius: inherit !important;
}
@keyframes liquid-metal-ripple {
  0% { transform: translate(-50%, -50%) scale(0); opacity: 0.6; }
  100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
}
.liquid-metal-button:focus-visible { outline: 2px solid #e5e5e5; outline-offset: 3px; }
`;

type ShaderHandle = { setSpeed?: (speed?: number) => void; dispose?: () => void; destroy?: () => void };

export interface LiquidMetalButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "style"> {
  /** Text shown in the button, and its accessible name unless aria-label is given. */
  label?: string;
  /** Custom content (text and icons). Overrides `label` and the default icon. */
  children?: React.ReactNode;
  /** "text" is a pill, "icon" is a circle. */
  viewMode?: "text" | "icon";
  /** Icon for viewMode="icon" when no children are given. */
  icon?: React.ReactNode;
  /** Height in px; an icon button is this wide as well. */
  size?: number;
  /** Width in px for a text button. Ignored with fullWidth. */
  width?: number;
  /** Stretch to the width of the parent. */
  fullWidth?: boolean;
  /** Classes for the content row, e.g. "justify-between px-5". */
  contentClassName?: string;
}

export function LiquidMetalButton({
  label = "Get Started",
  children,
  viewMode = "text",
  icon,
  size = 46,
  width = 142,
  fullWidth = false,
  contentClassName = "",
  className = "",
  disabled = false,
  type = "button",
  onClick,
  ...buttonProps
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const shaderRef = useRef<HTMLDivElement>(null);
  const shaderMount = useRef<ShaderHandle | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rippleId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const hovered = useRef(false);
  const still = useRef(false); // reduced motion: the metal does not flow

  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, delay);
    timers.current.add(timer);
  };

  useEffect(() => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
    still.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const pending = timers.current;
    try {
      if (shaderRef.current) {
        shaderMount.current = new ShaderMount(
          shaderRef.current,
          liquidMetalFragmentShader,
          {
            u_repetition: 4,
            u_softness: 0.5,
            u_shiftRed: 0.3,
            u_shiftBlue: 0.3,
            u_distortion: 0,
            u_contour: 0,
            u_angle: 45,
            u_scale: 8,
            u_shape: 1,
            u_offsetX: 0.1,
            u_offsetY: -0.1,
          },
          undefined,
          still.current ? 0 : IDLE_SPEED,
        ) as ShaderHandle;
      }
    } catch (error) {
      // Without WebGL the button still works; it just has a plain dark ring.
      console.warn("LiquidMetalButton: shader unavailable", error);
    }
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
      const mount = shaderMount.current;
      shaderMount.current = null;
      (mount?.dispose ?? mount?.destroy)?.call(mount);
    };
  }, []);

  const setSpeed = (speed: number) => {
    if (!still.current) shaderMount.current?.setSpeed?.(speed);
  };

  const handleEnter = () => {
    if (disabled) return;
    hovered.current = true;
    setIsHovered(true);
    setSpeed(HOVER_SPEED);
  };

  const handleLeave = () => {
    hovered.current = false;
    setIsHovered(false);
    setIsPressed(false);
    setSpeed(IDLE_SPEED);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setSpeed(CLICK_SPEED);
    later(() => setSpeed(hovered.current ? HOVER_SPEED : IDLE_SPEED), 300);

    // Keyboard activation reports no pointer position: ripple from the centre.
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const fromPointer = event.detail > 0;
      const ripple = {
        x: fromPointer ? event.clientX - rect.left : rect.width / 2,
        y: fromPointer ? event.clientY - rect.top : rect.height / 2,
        id: rippleId.current++,
      };
      setRipples(previous => [...previous, ripple]);
      later(() => setRipples(previous => previous.filter(item => item.id !== ripple.id)), 600);
    }
    onClick?.(event);
  };

  const iconOnly = viewMode === "icon";
  const active = isHovered && !disabled;
  const pressed = isPressed && !disabled;
  const spring = "0.8s cubic-bezier(0.34, 1.56, 0.64, 1)";
  const pressTransform = pressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)";
  const content = children ?? (iconOnly ? icon ?? <Sparkles size={16} aria-hidden="true" /> : label);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: fullWidth ? "block" : "inline-block",
        width: fullWidth ? "100%" : iconOnly ? size : width,
        height: size,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "opacity 0.2s ease",
      }}
    >
      {/* Flowing metal: visible as the 2px ring around the dark face. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 100,
          transform: pressTransform,
          transition: `transform ${spring}, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)`,
          background: "#1c1c1c",
          boxShadow: pressed
            ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
            : active
              ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
              : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
        }}
      >
        <div
          ref={shaderRef}
          className="liquid-metal-shader"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, borderRadius: 100, overflow: "hidden" }}
        />
      </div>

      {/* Dark face */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 2,
          borderRadius: 100,
          background: "linear-gradient(180deg, #202020 0%, #000000 100%)",
          transform: pressTransform,
          transition: `transform ${spring}, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)`,
          boxShadow: pressed
            ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
            : "none",
        }}
      />

      <button
        {...buttonProps}
        ref={buttonRef}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onBlur={event => {
          setIsPressed(false);
          buttonProps.onBlur?.(event);
        }}
        aria-label={buttonProps["aria-label"] ?? (iconOnly && !children ? label : undefined)}
        className="liquid-metal-button"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          padding: 0,
          background: "transparent",
          border: "none",
          borderRadius: 100,
          overflow: "hidden",
          cursor: disabled ? "default" : "pointer",
          font: "inherit",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          className={contentClassName}
          style={{
            position: "relative",
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
            ...(contentClassName ? null : { justifyContent: "center" }),
            gap: 6,
            fontSize: 14,
            fontWeight: 500,
            whiteSpace: "nowrap",
            color: active ? "#f5f5f5" : "#b4b4b4",
            textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
            transform: pressTransform,
            transition: `transform ${spring}, color 0.2s ease`,
          }}
        >
          {content}
        </span>
        {ripples.map(ripple => (
          <span
            key={ripple.id}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: ripple.x,
              top: ripple.y,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 70%)",
              pointerEvents: "none",
              animation: "liquid-metal-ripple 0.6s ease-out",
            }}
          />
        ))}
      </button>
    </div>
  );
}
