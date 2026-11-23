import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/labebal/",
  cleanUrls: true,
  lang: "en",
  title: "labebal",
  description: "Design and print labels from the browser.",
  head: [["link", { rel: "icon", href: "/labebal/icon.svg" }]],
  rewrites: {
    "DEPLOY.md": "deploy.md",
    "EMBEDDING.md": "embedding.md",
    "TEMPLATES.md": "templates.md",
    "PACKS.md": "packs.md",
    "API.md": "api.md",
    "ARCHITECTURE.md": "architecture.md",
    "ROADMAP.md": "roadmap.md",
  },
  // Links to repository files outside docs/ only make sense on GitHub.
  ignoreDeadLinks: [/^\.\.\//, /localhost/],
  markdown: {
    config: (md) => {
      // Most pages are plain text full of <id>-style placeholders: only a few use real HTML or Vue.
      const html = md.options.html;
      const render = md.render.bind(md);
      md.render = (src, env) => {
        md.set({ html: ["rest.md", "index.md"].includes(env?.relativePath) || ["guide", "reference"].includes(env?.relativePath?.split("/")[0]) ? html : false });
        const out = render(src, env);
        // {{field}} is labebal text here, not a Vue expression.
        return env?.relativePath === "rest.md" ? out : out.replaceAll("{{", "&#123;&#123;");
      };
    },
  },
  vite: { ssr: { noExternal: ["vitepress-openapi"] }, build: { chunkSizeWarningLimit: 4000 } },
  themeConfig: {
    logo: "/icon.svg",
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/formless63/labebal" }],
    editLink: { pattern: "https://github.com/formless63/labebal/edit/main/docs/:path" },
    nav: [
      { text: "Guide", link: "/guide/start" },
      { text: "REST API", link: "/rest" },
      { text: "Package API", link: "/reference/app/src/client" },
    ],
    sidebar: [
      {
        text: "Use labebal",
        items: [
          { text: "Get started", link: "/guide/start" },
          { text: "Print labels", link: "/guide/print" },
          { text: "Design labels", link: "/guide/design" },
          { text: "Labels from data", link: "/guide/data" },
          { text: "Template text", link: "/templates" },
          { text: "Packs", link: "/packs" },
        ],
      },
      {
        text: "Run it",
        items: [
          { text: "Deploy", link: "/deploy" },
          { text: "Niimbot N1 notes", link: "/printers/N1-NOTES" },
          { text: "Niimbot M2 notes", link: "/printers/M2-NOTES" },
        ],
      },
      {
        text: "Build on it",
        items: [
          { text: "Embed in your app", link: "/embedding" },
          { text: "REST API reference", link: "/rest" },
          { text: "REST API guide", link: "/api" },
          {
            text: "Package API",
            collapsed: false,
            items: [
              { text: "@labebal/core", link: "/reference/core/src" },
              { text: "@labebal/app", link: "/reference/app/src/client" },
              { text: "@labebal/app/server", link: "/reference/app/src/server/" },
            ],
          },
          { text: "Architecture", link: "/architecture" },
          { text: "Roadmap", link: "/roadmap" },
        ],
      },
    ],
    footer: { message: "MIT licence. Not affiliated with Niimbot, Brother or Zebra." },
  },
});
