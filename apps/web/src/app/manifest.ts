import type { MetadataRoute } from "next";

/** Web app manifest: installable on desktop Chrome / Edge and Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "labebal labels",
    short_name: "labebal",
    description: "Design and print labels on Niimbot printers.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#18181b",
    theme_color: "#18181b",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Quick print", short_name: "Quick print", url: "/quick", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192" }] },
      { name: "Templates", url: "/templates" },
      { name: "History", url: "/history" },
    ],
  };
}
