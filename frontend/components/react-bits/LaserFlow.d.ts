import type { HTMLAttributes, RefObject } from "react";
export interface LaserFlowProps extends HTMLAttributes<HTMLDivElement> {
  surfaceRef?: RefObject<HTMLElement>;
  beamPosition?: number;
  surfaceLevel?: number;
  color?: string;
  intensity?: number;
  beamWidth?: number;
  flare?: number;
  spread?: number;
  spill?: number;
  fog?: number;
  dust?: number;
  streaks?: number;
  dots?: number;
  pulse?: number;
  speed?: number;
  seed?: number;
  mouseInteraction?: boolean;
  revealImage?: string;
  revealRadius?: number;
  revealOpacity?: number;
  intro?: boolean;
  theme?: "dark" | "light";
  paused?: boolean;
  dpr?: number;
}
export declare function LaserFlow(props: LaserFlowProps): JSX.Element;
export default LaserFlow;
