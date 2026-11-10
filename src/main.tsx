import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

/** Text cut off with an ellipsis shows its full value on hover. */
document.addEventListener("mouseover", (ev) => {
  const el = (ev.target as HTMLElement | null)?.closest?.("*") as HTMLElement | null;
  for (let n: HTMLElement | null = el, i = 0; n && i < 3; n = n.parentElement, i++) {
    if (n.title || n.closest("[title]")) return;
    const cs = getComputedStyle(n);
    if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") {
      if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) n.title = (n.innerText || n.textContent || "").trim();
      return;
    }
  }
}, { passive: true });

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
        <Toaster position="top-right" richColors closeButton theme="system" />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
