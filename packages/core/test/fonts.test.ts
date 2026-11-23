import { describe, expect, it } from "vitest";
import { BUILTIN_FONTS, UPLOADED_SUFFIX, fontDef, isBuiltinFont, registerFont, restoreBuiltinFont, uploadedFamily } from "../src/fonts";

describe("font registry", () => {
  const builtin = BUILTIN_FONTS[0];

  it("never lets an upload silently shadow a built-in font", () => {
    const out = registerFont({ family: builtin.family, url: "/api/assets/x" });
    expect(out.family).toBe(builtin.family + UPLOADED_SUFFIX);
    expect(fontDef(builtin.family)).toBe(builtin);
    expect(fontDef(out.family)?.url).toBe("/api/assets/x");
    expect(uploadedFamily(builtin.family)).toBe(out.family);
    expect(uploadedFamily("Arial")).toBe("Arial" + UPLOADED_SUFFIX);
    expect(uploadedFamily("My Font")).toBe("My Font");
  });

  it("replaces a built-in only when asked, and can restore it", () => {
    const out = registerFont({ family: builtin.family, url: "/api/assets/y" }, { replace: true });
    expect(out.family).toBe(builtin.family);
    expect(fontDef(builtin.family)?.url).toBe("/api/assets/y");
    restoreBuiltinFont(builtin.family);
    expect(fontDef(builtin.family)).toBe(builtin);
  });

  it("re-registering the built-in itself or a new family is a plain register", () => {
    expect(registerFont(builtin).family).toBe(builtin.family);
    expect(registerFont({ family: "Uploaded One", url: "/a" }).family).toBe("Uploaded One");
    expect(isBuiltinFont("Uploaded One")).toBe(false);
    expect(isBuiltinFont(builtin.family)).toBe(true);
  });
});
