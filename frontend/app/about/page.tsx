import type { Metadata } from "next";
import { AboutSite } from "@/components/about/AboutSite";

export const metadata: Metadata = {
  title: "About NKMZ",
  description: "About NKMZ and NKMZ Chat: an AI workspace for knowledge, ideas, and everyday work.",
};

export default function AboutPage() {
  return <AboutSite />;
}

