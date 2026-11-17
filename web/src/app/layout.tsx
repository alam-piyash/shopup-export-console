import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Providers } from "./providers";
import "@/index.css";

export const metadata: Metadata = {
  title: "ShopUp Export Console",
  description: "ShopUp Export Console: trades, EXPs, collections and incentives in one place.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAFAFA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&text=%E0%A7%B3&display=swap" rel="stylesheet" />
        <Script id="theme" strategy="beforeInteractive">
          {`try { var t = localStorage.getItem("ed-theme-v2"); if (t === "dark") document.documentElement.classList.add("dark"); } catch (e) {}`}
        </Script>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
