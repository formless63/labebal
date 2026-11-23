/**
 * User identity from an authenticating reverse proxy, and roles from groups.
 * Pure (no server or browser APIs) so it is shared by the server helper, the
 * client and tests. Configuration comes from environment variables; see
 * docs/DEPLOY.md "Users and roles".
 *
 * Off by default: with no header variables set nobody is identified and
 * everyone is admin, exactly as before.
 */

export const ROLES = ["viewer", "printer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** viewer < printer < editor < admin: each role can do everything the ones before it can. */
export const roleAtLeast = (have: Role, need: Role) => ROLES.indexOf(have) >= ROLES.indexOf(need);

export const ROLE_HELP: Record<Role, string> = {
  viewer: "Browse labels and templates, preview. No printing or changes.",
  printer: "Print (records history) and use the queue, stock runs and quick print.",
  editor: "Create and change templates, labels, data, stock runs and pictures.",
  admin: "Everything, including API tokens and deleting history.",
};

/**
 * Header names to read, first match wins. These cover Pangolin (Remote-*),
 * Authelia / Caddy forward_auth (Remote-*), oauth2-proxy and Pocket ID setups
 * behind it (X-Forwarded-* / X-Auth-Request-*) and authentik (X-authentik-*).
 */
export const DEFAULT_HEADERS = {
  user: ["Remote-User", "X-Forwarded-User", "X-Auth-Request-User", "X-authentik-username", "X-Remote-User"],
  email: ["Remote-Email", "X-Forwarded-Email", "X-Auth-Request-Email", "X-authentik-email"],
  name: ["Remote-Name", "X-Forwarded-Preferred-Username", "X-Auth-Request-Preferred-Username", "X-authentik-name"],
  groups: ["Remote-Groups", "Remote-Role", "X-Forwarded-Groups", "X-Auth-Request-Groups", "X-authentik-groups"],
};

export interface IdentityConfig {
  /** Read identity headers at all. */
  enabled: boolean;
  headers: { user: string[]; email: string[]; name: string[]; groups: string[] };
  /** Role -> group names (lower case; "user:<name or email>" matches a person; "*" anyone signed in). */
  roles: Partial<Record<Role, string[]>>;
  /** Signed-in user matching no role group. */
  defaultRole: Role;
  /** No identity headers on the request (while enabled). */
  anonymousRole: Role;
}

export interface Identity {
  /** Identity headers are configured. */
  enabled: boolean;
  /** The request carried a user (or e-mail). */
  signedIn: boolean;
  user: string;
  email: string;
  name: string;
  groups: string[];
  role: Role;
  /** Best display name: name, user or e-mail. */
  display: string;
}

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const asRole = (v: string | undefined): Role | undefined => (ROLES as readonly string[]).includes((v ?? "").trim().toLowerCase()) ? ((v ?? "").trim().toLowerCase() as Role) : undefined;

const truthy = (v: string | undefined) => /^(1|true|on|yes|default)$/i.test((v ?? "").trim());

/** Build the configuration from environment variables. */
export function configFromEnv(env: Record<string, string | undefined>): IdentityConfig {
  const custom = {
    user: list(env.LABEBAL_HEADER_USER),
    email: list(env.LABEBAL_HEADER_EMAIL),
    name: list(env.LABEBAL_HEADER_NAME),
    groups: list(env.LABEBAL_HEADER_GROUPS),
  };
  const anyCustom = Object.values(custom).some((l) => l.length);
  const enabled = truthy(env.LABEBAL_AUTH_HEADERS) || anyCustom;
  const headers = {
    user: custom.user.length ? custom.user : DEFAULT_HEADERS.user,
    email: custom.email.length ? custom.email : DEFAULT_HEADERS.email,
    name: custom.name.length ? custom.name : DEFAULT_HEADERS.name,
    groups: custom.groups.length ? custom.groups : DEFAULT_HEADERS.groups,
  };
  const roles: IdentityConfig["roles"] = {};
  for (const r of ROLES) {
    const groups = list(env[`LABEBAL_ROLE_${r.toUpperCase()}`]).map((g) => g.toLowerCase());
    if (groups.length) roles[r] = groups;
  }
  const mapped = Object.keys(roles).length > 0;
  // No role mapping: everyone signed in is admin (identity only labels history).
  const defaultRole = asRole(env.LABEBAL_DEFAULT_ROLE) ?? (mapped ? "viewer" : "admin");
  const anonymousRole = asRole(env.LABEBAL_ANONYMOUS_ROLE) ?? defaultRole;
  return { enabled, headers, roles, defaultRole, anonymousRole };
}

/** Split a groups header: comma, semicolon or pipe separated, or a JSON array. */
export function parseGroups(v: string | null | undefined): string[] {
  const s = (v ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const a: unknown = JSON.parse(s);
      if (Array.isArray(a)) return a.map(String).map((g) => g.trim()).filter(Boolean);
    } catch {}
  }
  return s
    .split(/[,;|]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/** Highest role whose groups (or user entries) match. */
export function roleFor(cfg: IdentityConfig, who: { user: string; email: string; groups: string[] }): Role {
  const groups = new Set(who.groups.map((g) => g.toLowerCase()));
  const people = new Set([who.user, who.email].filter(Boolean).map((p) => `user:${p.toLowerCase()}`));
  for (const r of [...ROLES].reverse()) {
    const want = cfg.roles[r];
    if (want?.some((g) => g === "*" || groups.has(g) || people.has(g))) return r;
  }
  return cfg.defaultRole;
}

/** Everyone is admin, nobody is identified (no headers configured). */
export const OPEN_IDENTITY: Identity = { enabled: false, signedIn: false, user: "", email: "", name: "", groups: [], role: "admin", display: "" };

/** Read the identity of a request. `get` returns a header value (case-insensitive) or null. */
export function identityFromHeaders(get: (name: string) => string | null, cfg: IdentityConfig): Identity {
  if (!cfg.enabled) return OPEN_IDENTITY;
  const first = (names: string[]) => {
    for (const n of names) {
      const v = get(n)?.trim();
      if (v) return decodeHeader(v);
    }
    return "";
  };
  const user = first(cfg.headers.user);
  const email = first(cfg.headers.email);
  const name = first(cfg.headers.name);
  let groups: string[] = [];
  for (const n of cfg.headers.groups) {
    const g = parseGroups(get(n));
    if (g.length) {
      groups = g;
      break;
    }
  }
  // Pangolin e-mail one-time-passcode logins only send Remote-Email.
  const signedIn = !!(user || email);
  if (!signedIn) return { ...OPEN_IDENTITY, enabled: true, role: cfg.anonymousRole };
  return { enabled: true, signedIn, user: user || email, email, name, groups, role: roleFor(cfg, { user, email, groups }), display: (name || user || email).slice(0, 100) };
}

/** Header values are ISO-8859-1; proxies sometimes send UTF-8 bytes or percent-encoding. */
function decodeHeader(v: string) {
  try {
    if (/%[0-9A-F]{2}/i.test(v)) return decodeURIComponent(v);
    // UTF-8 bytes read as Latin-1 ("JosÃ©") -> "José".
    if (/[À-ÿ][\u0080-¿]/.test(v)) return new TextDecoder().decode(Uint8Array.from([...v].map((c) => c.charCodeAt(0) & 0xff)));
  } catch {}
  return v;
}
