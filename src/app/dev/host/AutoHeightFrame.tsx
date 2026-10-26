"use client";
/**
 * Development only: an iframe that takes the height that /embed sends (src/components/EmbedAutoHeight.tsx).
 * The host side of SAP Commerce / SFA does the same (docs/api-contract.md section 14.4).
 */
import { useEffect, useRef, useState } from "react";
import { EMBED_HEIGHT_MESSAGE } from "@/components/EmbedAutoHeight";

export function AutoHeightFrame({ title, src, className }: { title: string; src: string; className: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow) return;
      const d = e.data as { type?: unknown; height?: unknown };
      if (d?.type === EMBED_HEIGHT_MESSAGE && typeof d.height === "number" && d.height > 0) setHeight(Math.min(d.height, 20000));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return <iframe ref={ref} title={title} src={src} className={className} style={{ height }} />;
}
