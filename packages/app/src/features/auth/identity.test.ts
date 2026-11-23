import { describe, expect, it } from "vitest";
import { OPEN_IDENTITY, configFromEnv, identityFromHeaders, parseGroups, roleAtLeast } from "./identity";

const headers = (h: Record<string, string>) => {
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  return (name: string) => lower[name.toLowerCase()] ?? null;
};

describe("identity from proxy headers", () => {
  it("is off by default: everyone is admin, headers are ignored", () => {
    const cfg = configFromEnv({});
    expect(cfg.enabled).toBe(false);
    expect(identityFromHeaders(headers({ "Remote-User": "mallory", "Remote-Groups": "viewers" }), cfg)).toEqual(OPEN_IDENTITY);
  });

  it("reads Pangolin / Authelia Remote-* headers", () => {
    const cfg = configFromEnv({ LABEBAL_AUTH_HEADERS: "true" });
    const me = identityFromHeaders(headers({ "Remote-User": "sam", "Remote-Email": "sam@example.com", "Remote-Name": "Sam Example", "Remote-Groups": "admins, staff" }), cfg);
    expect(me).toMatchObject({ enabled: true, signedIn: true, user: "sam", email: "sam@example.com", name: "Sam Example", groups: ["admins", "staff"], display: "Sam Example" });
    // No role mapping configured: signed-in users are admins (identity only names history).
    expect(me.role).toBe("admin");
  });

  it("reads oauth2-proxy and authentik variants", () => {
    const cfg = configFromEnv({ LABEBAL_AUTH_HEADERS: "on" });
    expect(identityFromHeaders(headers({ "X-Forwarded-User": "kim", "X-Forwarded-Groups": "a,b" }), cfg)).toMatchObject({ user: "kim", groups: ["a", "b"] });
    expect(identityFromHeaders(headers({ "X-authentik-username": "lee", "X-authentik-groups": "ops|labels" }), cfg)).toMatchObject({ user: "lee", groups: ["ops", "labels"] });
  });

  it("uses the e-mail when only Remote-Email arrives (Pangolin one-time passcode)", () => {
    const me = identityFromHeaders(headers({ "Remote-Email": "guest@example.com" }), configFromEnv({ LABEBAL_AUTH_HEADERS: "1" }));
    expect(me).toMatchObject({ signedIn: true, user: "guest@example.com", display: "guest@example.com" });
  });

  it("custom header names enable identity and replace the defaults", () => {
    const cfg = configFromEnv({ LABEBAL_HEADER_USER: "X-User", LABEBAL_HEADER_GROUPS: "X-Teams" });
    expect(cfg.enabled).toBe(true);
    expect(identityFromHeaders(headers({ "X-User": "ana", "X-Teams": '["print"]', "Remote-User": "ignored" }), cfg)).toMatchObject({ user: "ana", groups: ["print"] });
  });

  it("maps groups to the highest role, with a default for everyone else", () => {
    const cfg = configFromEnv({
      LABEBAL_AUTH_HEADERS: "true",
      LABEBAL_ROLE_ADMIN: "labebal-admins",
      LABEBAL_ROLE_EDITOR: "Designers, user:bob@example.com",
      LABEBAL_ROLE_PRINTER: "staff",
    });
    const role = (h: Record<string, string>) => identityFromHeaders(headers(h), cfg).role;
    expect(role({ "Remote-User": "a", "Remote-Groups": "staff,labebal-admins" })).toBe("admin");
    expect(role({ "Remote-User": "b", "Remote-Groups": "designers" })).toBe("editor");
    expect(role({ "Remote-User": "bob", "Remote-Email": "Bob@example.com" })).toBe("editor");
    expect(role({ "Remote-User": "c", "Remote-Groups": "staff" })).toBe("printer");
    expect(role({ "Remote-User": "d", "Remote-Groups": "guests" })).toBe("viewer");
    // No user header at all: anonymous role (defaults to the default role).
    expect(role({})).toBe("viewer");
  });

  it("default and anonymous roles are configurable; * matches everyone signed in", () => {
    const cfg = configFromEnv({ LABEBAL_AUTH_HEADERS: "true", LABEBAL_ROLE_PRINTER: "*", LABEBAL_ANONYMOUS_ROLE: "Viewer", LABEBAL_DEFAULT_ROLE: "nonsense" });
    expect(cfg.defaultRole).toBe("viewer");
    expect(identityFromHeaders(headers({ "Remote-User": "x" }), cfg).role).toBe("printer");
    expect(identityFromHeaders(headers({}), cfg)).toMatchObject({ signedIn: false, role: "viewer" });
  });

  it("decodes UTF-8 names sent as Latin-1 or percent-encoding", () => {
    const cfg = configFromEnv({ LABEBAL_AUTH_HEADERS: "true" });
    expect(identityFromHeaders(headers({ "Remote-User": "jose", "Remote-Name": "JosÃ©" }), cfg).name).toBe("José");
    expect(identityFromHeaders(headers({ "Remote-User": "jose", "Remote-Name": "Jos%C3%A9" }), cfg).name).toBe("José");
  });

  it("parses group lists and ranks roles", () => {
    expect(parseGroups(" a ; b|c ,, ")).toEqual(["a", "b", "c"]);
    expect(parseGroups('["x y", "z"]')).toEqual(["x y", "z"]);
    expect(parseGroups(null)).toEqual([]);
    expect(roleAtLeast("editor", "printer")).toBe(true);
    expect(roleAtLeast("printer", "editor")).toBe(false);
  });
});
