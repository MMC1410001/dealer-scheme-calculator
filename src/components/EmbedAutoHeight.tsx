"use client";
/**
 * Tells the host page (SAP Commerce / SFA) the content height of /embed, so that the host can size the iframe
 * and no inner scroll bar shows. Message: { type: "scheme-calculator:height", height: <CSS pixels> }.
 * It goes only to the origins that may frame the page (EMBED_ALLOWED_ORIGINS) and to this origin (the dev host
 * page). The browser drops a message whose target origin is not the parent's origin, so other sites get nothing.
 * Host side: docs/api-contract.md section 14.4.
 */
import { useEffect, useRef } from "react";

export const EMBED_HEIGHT_MESSAGE = "scheme-calculator:height";

export function EmbedAutoHeight({ origins, children }: { origins: string[]; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.parent === window) return;
    const targets = Array.from(new Set([window.location.origin, ...origins]));
    let last = -1;
    let frame = 0;
    const send = () => {
      frame = 0;
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      for (const origin of targets) window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, origin);
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(send);
    });
    observer.observe(el);
    send();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [origins]);

  return <div ref={ref}>{children}</div>;
}
