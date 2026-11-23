import { Path2D as NapiPath2D, createCanvas } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import {
  drawIcon,
  formatIconId,
  iconifyToSvg,
  isLightColor,
  parseIconId,
  parseIconSvg,
  parseTransform,
  resolveIconifyIcon,
  sanitizeSvg,
  type IconifyCollection,
} from "../src/icons";

beforeAll(() => {
  (globalThis as { Path2D?: unknown }).Path2D ??= NapiPath2D;
});

describe("icon ids", () => {
  it("parses set:name and keeps plain names as Tabler", () => {
    expect(parseIconId("mdi:cookie-outline")).toEqual({ set: "mdi", name: "cookie-outline" });
    expect(parseIconId("screw")).toEqual({ set: "tabler", name: "screw" });
    expect(parseIconId(" tabler:nut ")).toEqual({ set: "tabler", name: "nut" });
    expect(parseIconId("game-icons:hexagonal-nut")).toEqual({ set: "game-icons", name: "hexagonal-nut" });
    expect(parseIconId("simple-icons:playstation2")).toEqual({ set: "simple-icons", name: "playstation2" });
    expect(parseIconId("custom:a-1f2e3d4c-0000-4000-8000-123456789abc")).toEqual({ set: "custom", name: "a-1f2e3d4c-0000-4000-8000-123456789abc" });
  });

  it("rejects ill-formed ids", () => {
    for (const bad of ["", "{{icon}}", "mdi:", ":chip", "mdi:chip:x", "../etc", "mdi/chip", "a b", "MDI COOKIE"]) expect(parseIconId(bad), bad).toBeNull();
  });

  it("formats canonical ids", () => {
    expect(formatIconId("tabler", "nut")).toBe("nut");
    expect(formatIconId("mdi", "chip")).toBe("mdi:chip");
  });
});

const set: IconifyCollection = {
  prefix: "t",
  width: 24,
  height: 24,
  icons: {
    chip: { body: `<path fill="currentColor" d="M6 4h12v16H6z"/>` },
    wide: { body: `<path d="M0 0h32v16H0z"/>`, width: 32, height: 16 },
  },
  aliases: {
    "chip-alias": { parent: "chip" },
    "chip-flipped": { parent: "chip", hFlip: true },
    "wide-turned": { parent: "wide", rotate: 1 },
    loop: { parent: "loop" },
  },
};

describe("iconify conversion", () => {
  it("resolves icons and aliases with set defaults", () => {
    expect(resolveIconifyIcon(set, "chip")).toMatchObject({ left: 0, top: 0, width: 24, height: 24, rotate: 0, hFlip: false });
    expect(resolveIconifyIcon(set, "chip-alias")?.body).toBe(set.icons.chip.body);
    expect(resolveIconifyIcon(set, "chip-flipped")?.hFlip).toBe(true);
    expect(resolveIconifyIcon(set, "nope")).toBeNull();
    expect(resolveIconifyIcon(set, "loop")).toBeNull();
  });

  it("builds a standalone SVG that parses into fill shapes", () => {
    const svg = iconifyToSvg(resolveIconifyIcon(set, "chip")!);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24">/);
    const icon = parseIconSvg(svg);
    expect(icon.viewBox).toEqual([0, 0, 24, 24]);
    expect(icon.shapes).toHaveLength(1);
    expect(icon.shapes[0].attrs).toMatchObject({ fill: "currentColor", stroke: "none" });
  });

  it("applies flips and quarter turns", () => {
    const flipped = parseIconSvg(iconifyToSvg(resolveIconifyIcon(set, "chip-flipped")!));
    expect(flipped.shapes[0].matrix).toEqual([-1, 0, 0, 1, 24, 0]);
    const turned = iconifyToSvg(resolveIconifyIcon(set, "wide-turned")!);
    expect(turned).toContain(`viewBox="8 -8 16 32"`);
    expect(turned).toContain(`rotate(90 16 8)`);
  });
});

describe("svg parsing", () => {
  it("inherits group paint (Lucide-style stroked groups) and composes transforms", () => {
    const icon = parseIconSvg(
      `<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" transform="translate(2 3)"><path d="M1 1h4"/><g transform="scale(2)"><circle cx="1" cy="1" r="1"/></g></g></svg>`,
    );
    expect(icon.shapes).toHaveLength(2);
    expect(icon.shapes[0].attrs).toMatchObject({ fill: "none", stroke: "currentColor", "stroke-width": "2" });
    expect(icon.shapes[0].matrix).toEqual([1, 0, 0, 1, 2, 3]);
    expect(icon.shapes[1].matrix).toEqual([2, 0, 0, 2, 2, 3]);
  });

  it("skips defs/masks, hidden and mostly-transparent shapes; reads style attributes", () => {
    const icon = parseIconSvg(
      `<svg viewBox="0 0 10 10"><defs><path d="M0 0h1v1z"/></defs><mask id="m"><rect width="10" height="10"/></mask>` +
        `<path opacity=".3" d="M0 0h10v10z"/><path style="display:none" d="M0 0h2v2z"/><path style="fill:#ffffff;stroke:none" d="M2 2h2v2z"/></svg>`,
    );
    expect(icon.shapes).toHaveLength(1);
    expect(icon.shapes[0].attrs.fill).toBe("#ffffff");
  });

  it("parses transform lists", () => {
    expect(parseTransform("translate(10,5) scale(2)")).toEqual([2, 0, 0, 2, 10, 5]);
    const r = parseTransform("rotate(90 12 12)");
    expect(r.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 24, 0]);
  });

  it("classifies light colours", () => {
    for (const c of ["#fff", "#FFFFFF", "white", "rgb(250, 250, 250)", "#eeeeeeff"]) expect(isLightColor(c), c).toBe(true);
    for (const c of ["#000", "currentColor", "black", "#336699", "red"]) expect(isLightColor(c), c).toBe(false);
  });
});

describe("drawing", () => {
  const dots = (svg: string, size: number) => {
    const c = createCanvas(size, size);
    const ctx = c.getContext("2d") as unknown as CanvasRenderingContext2D;
    drawIcon(ctx, parseIconSvg(svg), size);
    const d = c.getContext("2d").getImageData(0, 0, size, size).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
    return n;
  };

  it("fills fill-based icons", () => {
    // Half the 24-unit box at 48 px: 24 x 48 dots.
    expect(dots(`<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h12v24H0z"/></svg>`, 48)).toBe(24 * 48);
  });

  it("white shapes cut holes", () => {
    const n = dots(`<svg viewBox="0 0 10 10"><rect width="10" height="10"/><rect x="0" y="0" width="5" height="10" fill="#fff"/></svg>`, 20);
    expect(n).toBe(10 * 20);
  });

  it("evenodd paths keep their holes", () => {
    const n = dots(`<svg viewBox="0 0 10 10"><path fill-rule="evenodd" d="M0 0h10v10H0zM2.5 2.5h5v5h-5z"/></svg>`, 20);
    expect(n).toBe(400 - 100);
  });

  it("centres non-square view boxes", () => {
    expect(dots(`<svg viewBox="0 0 20 10"><rect width="20" height="10"/></svg>`, 20)).toBe(20 * 10);
  });
});

describe("svg sanitising", () => {
  it("drops scripts, foreign objects, handlers, links and external references", () => {
    const dirty =
      `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><!-- c -->` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" onload="alert(1)">` +
      `<script>alert("<path d='M0 0'/>")</script>` +
      `<style>path{fill:red}</style>` +
      `<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><path d="M9 9"/></div></foreignObject>` +
      `<a href="javascript:alert(1)"><path d="M1 1h1"/></a>` +
      `<image href="https://evil.example/x.png"/><use href="#p"/>` +
      `<sodipodi:namedview pagecolor="#fff"/>` +
      `<g onclick="x()" fill="url(https://evil.example/#g)" style="stroke:#000;behavior:url(x.htc)"><path id="p" d="M2 2h20v20H2z" onmouseover="x()"/></g>` +
      `</svg>`;
    const clean = sanitizeSvg(dirty)!;
    expect(clean).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g stroke="#000"><path d="M2 2h20v20H2z"/></g></svg>`);
    expect(clean).not.toMatch(/script|on\w+=|href|url\(|foreign|style|image|use|<a/i);
  });

  it("keeps a typical Inkscape drawing drawable", () => {
    const clean = sanitizeSvg(
      `<svg xmlns:inkscape="x" viewBox="0 0 10 10"><metadata><rdf:RDF/></metadata><g inkscape:label="Layer 1"><path style="fill:#000000;fill-rule:evenodd" d="M0 0h10v10z"/><circle cx="5" cy="5" r="2" fill="white"/></g></svg>`,
    )!;
    expect(clean).toContain(`<path d="M0 0h10v10z" fill="#000000" fill-rule="evenodd"/>`);
    expect(parseIconSvg(clean).shapes).toHaveLength(2);
  });

  it("escapes attribute values and title text", () => {
    const clean = sanitizeSvg(`<svg viewBox="0 0 1 1"><title>a &lt;b&gt; &amp; c</title><path d="M0 0&quot; onload=&quot;x"/></svg>`)!;
    expect(clean).toContain(`<title>a &lt;b&gt; &amp; c</title>`);
    expect(clean).toContain(`d="M0 0&quot; onload=&quot;x"`);
  });

  it("rejects input without a root svg or without shapes", () => {
    expect(sanitizeSvg("<html><body>hi</body></html>")).toBeNull();
    expect(sanitizeSvg(`<svg viewBox="0 0 1 1"><script>x</script></svg>`)).toBeNull();
    expect(sanitizeSvg("not svg at all")).toBeNull();
  });
});
