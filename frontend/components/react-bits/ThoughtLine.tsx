"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import "./ThoughtLine.css";

// Adapted from the supplied ThoughtLine: existing icons, no decorative logo,
// and a response timer (not an estimate of the model's private reasoning).
export default function ThoughtLine({ working, label = "Thinking…", doneLabel = "Response finished", steps = [], fontSize = 14, breathPeriod = 1.6, breathDepth = 0.45, settleDuration = 350, settleBlur = 2, collapsible = true, collapseOnSettle = true, showTimer = true, onSettle }: {
  working: boolean; label?: string; doneLabel?: string; steps?: string[];
  fontSize?: number; breathPeriod?: number; breathDepth?: number;
  settleDuration?: number; settleBlur?: number; collapsible?: boolean;
  collapseOnSettle?: boolean; showTimer?: boolean; onSettle?: (seconds: number) => void;
}) {
  const reduce = useReducedMotion();
  const [seconds, setSeconds] = useState(0);
  const [open, setOpen] = useState(true);
  const [seenWorking, setSeenWorking] = useState(working);
  const started = useRef<number | null>(null);
  const callback = useRef(onSettle);
  callback.current = onSettle;
  useEffect(() => {
    if (working) {
      setSeenWorking(true);
      setOpen(true);
      started.current = performance.now();
      setSeconds(0);
      const timer = setInterval(() => setSeconds((performance.now() - started.current!) / 1000), 100);
      return () => clearInterval(timer);
    }
    if (started.current !== null) {
      const elapsed = (performance.now() - started.current) / 1000;
      started.current = null;
      setSeconds(elapsed);
      callback.current?.(elapsed);
    }
    if (collapseOnSettle) setOpen(false);
  }, [working, collapseOnSettle]);
  if (!working && !seenWorking) return null;
  const toggle = collapsible && steps.length > 0;
  const heading = <>
    <motion.span key={working ? "working" : "done"} initial={reduce ? false : { opacity: 0, filter: `blur(${settleBlur}px)` }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: reduce ? 0 : settleDuration / 1000 }}>
      <motion.span animate={{ opacity: working && !reduce ? [1 - breathDepth, 1, 1 - breathDepth] : 1 }} transition={{ duration: breathPeriod, repeat: working && !reduce ? Infinity : 0 }}>{working ? label : doneLabel}</motion.span>
    </motion.span>
    {showTimer && <span aria-hidden="true" className="thought-line__timer">{seconds.toFixed(1)}s</span>}
    {toggle && <ChevronDown aria-hidden="true" className={`h-3 w-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />}
  </>;
  return <div className="thought-line not-prose" style={{ fontSize }}>
    <span role="status" className="sr-only">{working ? label : doneLabel}</span>
    {toggle ? <button type="button" className="thought-line__head" aria-expanded={open} onClick={() => setOpen(v => !v)}>{heading}</button> : <div className="thought-line__head">{heading}</div>}
    {steps.length > 0 && <div className="thought-line__trace" data-open={open || !collapsible ? "" : undefined} aria-hidden={collapsible && !open}>
      <div className="thought-line__fold"><ol className="thought-line__steps">{steps.map((step, i) => <li key={step}>
        {!working || i < steps.length - 1 ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : <span className="h-1 w-1 mx-1 shrink-0 rounded-full bg-current" aria-hidden="true" />}{step}
      </li>)}</ol></div>
    </div>}
  </div>;
}
