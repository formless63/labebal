"use client";
import { ThemeProvider } from "next-themes";
import { LabebalApp } from "@labebal/app";

/** The module at the site root, with the standalone app's theme switcher and offline service worker. */
export function StandaloneApp() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <LabebalApp serviceWorker="/sw.js" />
    </ThemeProvider>
  );
}
