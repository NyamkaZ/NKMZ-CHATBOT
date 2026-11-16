import type { CSSProperties, HTMLAttributes } from "react";

export interface LetterGlitchProps extends HTMLAttributes<HTMLDivElement> {
  glitchColors?: string[];
  baseColor?: string;
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  spacing?: number;
  density?: number;
  baseOpacity?: number;
  glitchAmount?: number;
  speed?: number;
  smooth?: boolean;
  interactive?: boolean;
  cursorRadius?: number;
  clickEffect?: "tear" | "none" | string;
  flow?: number;
  edgeFade?: number;
  centerFade?: number;
  intro?: boolean;
  lightMode?: boolean;
  backgroundColor?: string;
  dpr?: number;
  style?: CSSProperties;
}

export default function LetterGlitch(props: LetterGlitchProps): React.JSX.Element;
