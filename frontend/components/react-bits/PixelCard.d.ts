import type { CSSProperties, ReactNode } from "react";

export interface PixelCardProps {
  children?: ReactNode;
  variant?: "default" | "blue" | "yellow" | "pink";
  colors?: string[] | string;
  gap?: number;
  speed?: number;
  pixelSize?: number;
  shape?: "square" | "circle" | "diamond";
  origin?: string;
  revealDuration?: number;
  spotlight?: number;
  glow?: number;
  glowColor?: string;
  opacity?: number;
  fade?: number;
  trigger?: "hover" | "click" | "always";
  clickPulse?: boolean;
  intro?: boolean;
  introDelay?: number;
  noFocus?: boolean;
  tabIndex?: number;
  theme?: "dark" | "light";
  radius?: number;
  className?: string;
  style?: CSSProperties;
}

export default function PixelCard(props: PixelCardProps): React.JSX.Element;
