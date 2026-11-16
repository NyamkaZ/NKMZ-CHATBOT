import type { ReactElement } from "react";

export interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: "start" | "end" | "center" | "random";
  useOriginalCharsOnly?: boolean;
  characters?: string;
  className?: string;
  parentClassName?: string;
  encryptedClassName?: string;
  animateOn?: "view" | "hover" | "inViewHover" | "click";
  clickMode?: "once" | "toggle";
  effect?: "scramble" | "flip" | "fade";
  scrambleColor?: string;
  loop?: boolean;
  loopDelay?: number;
  hoverRadius?: number;
}

export default function DecryptedText(props: DecryptedTextProps): ReactElement;
