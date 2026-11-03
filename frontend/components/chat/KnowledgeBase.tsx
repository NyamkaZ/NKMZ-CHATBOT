"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileUp, Loader2, X, FileText, CheckCircle2 } from "lucide-react";

interface DocItem {
  id: string;
  original_name: string;
  file_size: number;
  chunk_count: number;
  is_indexed: boolean;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function KnowledgeBase({ open, onClose }: Props) {
  const { t } = useChatStore();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = (await api.listDocuments()) as DocItem[];
      setDocs(list);
    } catch (e: any) {
      toast.error(e.message || t("loginRequiredDocs"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.uploadDocument(file);
      toast.success(`${t("indexed")}: ${file.name}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || t("uploadFailed"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{t("kbTitle")}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("kbSubtitle")}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <FileUp className="h-8 w-8 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">
              {uploading ? t("uploading") : t("clickToUpload")}
            </p>
            <p className="text-xs text-muted-foreground">{t("fileTypes")}</p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }}
            />
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2">
            {loading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && docs.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-6">
                {t("noDocuments")}
              </p>
            )}
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {d.original_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {(d.file_size / 1024).toFixed(1)} KB · {d.chunk_count} chunks
                  </div>
                </div>
                {d.is_indexed ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : (
                  <span className="text-[11px] text-amber-500">{t("pending")}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
