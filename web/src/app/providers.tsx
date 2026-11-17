"use client";
import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

/** Text cut off with an ellipsis shows its full value on hover. */
function useEllipsisTitles() {
  useEffect(() => {
    const on = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.("*") as HTMLElement | null;
      for (let n: HTMLElement | null = el, i = 0; n && i < 3; n = n.parentElement, i++) {
        if (n.title || n.closest("[title]")) return;
        const cs = getComputedStyle(n);
        if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") {
          if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) n.title = (n.innerText || n.textContent || "").trim();
          return;
        }
      }
    };
    document.addEventListener("mouseover", on, { passive: true });
    return () => document.removeEventListener("mouseover", on);
  }, []);
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  // The console is a signed-in internal tool: render in the browser only (no server rendering),
  // so screens can read the session, localStorage and window sizes from the first render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEllipsisTitles();
  return (
    <QueryClientProvider client={qc}>
      {mounted ? children : null}
      <Toaster position="top-right" richColors closeButton theme="system" />
    </QueryClientProvider>
  );
}
