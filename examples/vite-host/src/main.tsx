/**
 * A host app that isn't Next.js and doesn't use Tailwind: its own header,
 * its own pages, and labebal under /labels with the prebuilt styles.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LabebalApp } from "@labebal/app";
import "@labebal/app/styles.css";

function useLocationPath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    addEventListener("popstate", sync);
    addEventListener("labebal:navigate", sync);
    return () => {
      removeEventListener("popstate", sync);
      removeEventListener("labebal:navigate", sync);
    };
  }, []);
  return path;
}

function Host() {
  const path = useLocationPath();
  const inLabels = path === "/labels" || path.startsWith("/labels/");
  return (
    <>
      <nav className="host-bar">
        <strong>Example inventory</strong>
        <a href="/">Home</a>
        <a href="/labels">Labels</a>
        <span>Signed in as Pat (admin)</span>
      </nav>
      {inLabels ? (
        <LabebalApp basePath="/labels" chrome="embedded" colorScheme="system" className="host-frame" />
      ) : (
        <main className="host-page">
          <h1>Host home page</h1>
          <p>
            The label app lives at <a href="/labels">/labels</a>.
          </p>
        </main>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
