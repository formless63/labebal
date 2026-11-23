import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { theme as openapi, useOpenapi } from "vitepress-openapi/client";
import "vitepress-openapi/dist/style.css";
import spec from "../../public/openapi.json";
import "./style.css";

export default {
  extends: DefaultTheme,
  enhanceApp(ctx) {
    useOpenapi({ spec, config: { operation: { hiddenSlots: ["playground"] } } });
    openapi.enhanceApp(ctx);
  },
} satisfies Theme;
