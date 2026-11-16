"use client";

import useSWR from "swr";
import { api } from "@/lib/api";

export function ModelName() {
  const { data } = useSWR("active-ollama-model", () => api.getModelInfo(), {
    refreshInterval: 60_000,
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const model = data?.current_model;
  if (typeof model !== "string" || !model || model.length > 128) return <>Local AI</>;
  const qwen = model.match(/^qwen([\d.]+):([\d.]+b)$/i);
  return <>{qwen ? `Qwen${qwen[1]} ${qwen[2].toUpperCase()}` : model}</>;
}
