/**
 * A small fake GitHub for tests and local development (never shipped).
 * Implements just what labebal uses: the device flow, /user, installations,
 * repos (list / create / get), contents (raw read, first-commit write),
 * commits/{ref} with ETag + `application/vnd.github.sha`, and the Git Data
 * API (blobs, trees, commits, refs). Blob shas are real git blob shas.
 *
 * Point the app at it (dev / test only; ignored in production builds):
 *   LABEBAL_GITHUB_API_URL=http://127.0.0.1:5186 LABEBAL_GITHUB_URL=http://127.0.0.1:5186
 *   LABEBAL_GITHUB_CLIENT_ID=mock-client LABEBAL_GITHUB_APP_SLUG=labebal-mock
 * Run standalone: pnpm --filter @labebal/core exec tsx <path>/mock-github.ts [port]
 *
 * The device page (GET /login/device) has an "Authorize" button; tests can
 * set `autoApproveAfter` instead. Tokens: app users get "ghu_mock_<login>",
 * the seeded personal token is "github_pat_mock_<login>_000000000000".
 */
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

interface User {
  id: number;
  login: string;
  name: string;
}
interface Repo {
  owner: string;
  name: string;
  private: boolean;
  description: string;
  defaultBranch: string;
  refs: Map<string, string>;
}
interface Commit {
  tree: string;
  parents: string[];
  message: string;
  author: { name: string; email: string; date: string };
}

export interface MockGithubOptions {
  /** Device flow: answer authorization_pending this many times, then approve (default: wait for the device page). */
  autoApproveAfter?: number;
  /** POST /user/repos with an App token: refuse (403), like an App without Administration permission. */
  appCannotCreateRepos?: boolean;
  /** Repos an App installation covers ("only select repositories"); default all of the user's. */
  installationRepos?: string[] | null;
}

const sha1 = (s: string | Buffer) => createHash("sha1").update(s).digest("hex");
export const blobSha = (b: Buffer) => sha1(Buffer.concat([Buffer.from(`blob ${b.length}\u0000`), b]));

export class MockGithub {
  users: User[] = [
    { id: 1001, login: "octo", name: "Octo Cat" },
    { id: 1002, login: "friend", name: "A Friend" },
  ];
  /** token -> login, kind */
  tokens = new Map<string, { login: string; kind: "app" | "token" }>();
  repos = new Map<string, Repo>();
  blobs = new Map<string, Buffer>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, Commit>();
  devices = new Map<string, { userCode: string; polls: number; approvedBy: string | null; denied: boolean }>();
  log: string[] = [];
  server: http.Server | null = null;
  url = "";

  constructor(public opts: MockGithubOptions = {}) {
    for (const u of this.users) this.tokens.set(`github_pat_mock_${u.login}_000000000000`, { login: u.login, kind: "token" });
  }

  /* ------------------------------------------------ git store helpers */

  putBlob(data: Buffer) {
    const s = blobSha(data);
    this.blobs.set(s, data);
    return s;
  }
  putTree(files: Map<string, string>) {
    const s = sha1(`tree ${JSON.stringify([...files].sort())}`);
    this.trees.set(s, new Map(files));
    return s;
  }
  putCommit(c: Commit) {
    const s = sha1(`commit ${JSON.stringify(c)}`);
    this.commits.set(s, c);
    return s;
  }
  /** Seed a repo with files (empty = no commits). */
  addRepo(owner: string, name: string, files: Record<string, string | Buffer> | null, o: { private?: boolean; description?: string } = {}) {
    const r: Repo = { owner, name, private: o.private ?? false, description: o.description ?? "", defaultBranch: "main", refs: new Map() };
    this.repos.set(`${owner}/${name}`.toLowerCase(), r);
    if (files) {
      const map = new Map<string, string>();
      for (const [p, d] of Object.entries(files)) map.set(p, this.putBlob(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      r.refs.set("main", this.putCommit({ tree: this.putTree(map), parents: [], message: "init", author: { name: owner, email: "x", date: new Date(0).toISOString() } }));
    }
    return r;
  }
  /** Files of a branch head (path -> utf8). */
  files(fullName: string, branch = "main"): Record<string, string> {
    const r = this.repos.get(fullName.toLowerCase());
    const head = r?.refs.get(branch);
    if (!head) return {};
    const t = this.trees.get(this.commits.get(head)!.tree)!;
    return Object.fromEntries([...t].map(([p, s]) => [p, this.blobs.get(s)!.toString("utf8")]));
  }
  headCommit(fullName: string, branch = "main") {
    const r = this.repos.get(fullName.toLowerCase());
    const h = r?.refs.get(branch);
    return h ? { sha: h, ...this.commits.get(h)! } : null;
  }
  /** Commit files on top of a branch (simulates someone pushing). */
  push(fullName: string, files: Record<string, string | null>, message = "push") {
    const r = this.repos.get(fullName.toLowerCase())!;
    const head = r.refs.get("main");
    const map = new Map(head ? this.trees.get(this.commits.get(head)!.tree)! : []);
    for (const [p, d] of Object.entries(files)) {
      if (d === null) map.delete(p);
      else map.set(p, this.putBlob(Buffer.from(d)));
    }
    r.refs.set("main", this.putCommit({ tree: this.putTree(map), parents: head ? [head] : [], message, author: { name: "x", email: "x", date: new Date().toISOString() } }));
  }

  /* ------------------------------------------------ server */

  async start(port = 0): Promise<string> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        try {
          this.handle(req, res, Buffer.concat(chunks));
        } catch (e) {
          send(res, 500, { message: String(e) });
        }
      });
    });
    await new Promise<void>((r) => this.server!.listen(port, "127.0.0.1", r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  stop() {
    return new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private who(req: http.IncomingMessage) {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const tk = t ? this.tokens.get(t) : undefined;
    if (!tk) return null;
    return { user: this.users.find((u) => u.login === tk.login)!, kind: tk.kind };
  }

  private canSee(me: { user: User; kind: string }, r: Repo) {
    if (r.owner.toLowerCase() !== me.user.login.toLowerCase() && r.private) return false;
    if (me.kind === "app" && r.owner.toLowerCase() === me.user.login.toLowerCase()) {
      const list = this.opts.installationRepos;
      if (list && !list.map((x) => x.toLowerCase()).includes(`${r.owner}/${r.name}`.toLowerCase())) return false;
    }
    return true;
  }

  private repoJson(r: Repo, me: { user: User }) {
    const mine = r.owner.toLowerCase() === me.user.login.toLowerCase();
    return {
      name: r.name,
      full_name: `${r.owner}/${r.name}`,
      owner: { login: r.owner },
      private: r.private,
      description: r.description,
      default_branch: r.defaultBranch,
      permissions: { admin: mine, push: mine, pull: true },
      html_url: `${this.url}/${r.owner}/${r.name}`,
      size: r.refs.size ? 10 : 0,
    };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) {
    const u = new URL(req.url ?? "/", "http://x");
    const p = u.pathname;
    const m = req.method ?? "GET";
    this.log.push(`${m} ${p}${u.search}`);
    const form = () => Object.fromEntries(new URLSearchParams(body.toString("utf8")));
    const json = () => (body.length ? JSON.parse(body.toString("utf8")) : {});

    /* ---------------- device flow (github.com) */
    if (m === "POST" && p === "/login/device/code") {
      const f = form();
      if (f.client_id !== "mock-client") return send(res, 200, { error: "incorrect_client_credentials", error_description: "The client_id is not valid." });
      const code = `dc_${this.devices.size + 1}`;
      const userCode = `WIIM-${String(1000 + this.devices.size).slice(-4)}`;
      this.devices.set(code, { userCode, polls: 0, approvedBy: null, denied: false });
      return send(res, 200, { device_code: code, user_code: userCode, verification_uri: `${this.url}/login/device`, expires_in: 900, interval: 1 });
    }
    if (m === "POST" && p === "/login/oauth/access_token") {
      const f = form();
      const d = this.devices.get(f.device_code);
      if (f.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") return send(res, 200, { error: "unsupported_grant_type" });
      if (!d) return send(res, 200, { error: "incorrect_device_code" });
      d.polls++;
      if (d.denied) return send(res, 200, { error: "access_denied" });
      if (this.opts.autoApproveAfter !== undefined && d.polls > this.opts.autoApproveAfter) d.approvedBy ??= "octo";
      if (!d.approvedBy) return send(res, 200, { error: "authorization_pending" });
      const token = `ghu_mock_${d.approvedBy}`;
      this.tokens.set(token, { login: d.approvedBy, kind: "app" });
      return send(res, 200, { access_token: token, token_type: "bearer", scope: "" });
    }
    if (m === "GET" && p === "/login/device") {
      const rows = [...this.devices].filter(([, d]) => !d.approvedBy && !d.denied);
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(
        `<!doctype html><title>Mock GitHub device</title><body style="font-family:sans-serif;padding:2rem"><h1>Mock GitHub: device activation</h1>${rows.map(([c, d]) => `<form method="post" action="/login/device/approve"><input type="hidden" name="code" value="${c}"><p>Code <b>${d.userCode}</b> <button name="as" value="octo">Authorize as octo</button></p></form>`).join("") || "<p>No pending codes.</p>"}</body>`,
      );
    }
    if (m === "POST" && p === "/login/device/approve") {
      const f = form();
      const d = this.devices.get(f.code);
      if (d) d.approvedBy = f.as || "octo";
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><body style="font-family:sans-serif;padding:2rem"><h1>Device authorized</h1><p>You can go back to labebal.</p></body>`);
    }
    if (m === "GET" && /^\/apps\/[^/]+\/installations\/new$/.test(p)) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><body style="font-family:sans-serif;padding:2rem"><h1>Mock: install the App</h1></body>`);
    }

    /* ---------------- API */
    const me = this.who(req);
    if (!me) return send(res, 401, { message: "Bad credentials" });

    if (m === "GET" && p === "/user") return send(res, 200, { id: me.user.id, login: me.user.login, name: me.user.name, avatar_url: `${this.url}/avatars/${me.user.login}.png` });
    if (m === "GET" && p === "/user/installations") {
      if (me.kind !== "app") return send(res, 403, { message: "Resource not accessible by personal access token" });
      return send(res, 200, { total_count: 1, installations: [{ id: 77, account: { login: me.user.login } }] });
    }
    if (m === "GET" && p === "/user/installations/77/repositories") {
      const repos = [...this.repos.values()].filter((r) => r.owner === me.user.login && this.canSee(me, r));
      return send(res, 200, { total_count: repos.length, repositories: repos.map((r) => this.repoJson(r, me)) });
    }
    if (m === "GET" && p === "/user/repos") return send(res, 200, [...this.repos.values()].filter((r) => r.owner === me.user.login).map((r) => this.repoJson(r, me)));
    if (m === "POST" && p === "/user/repos") {
      if (me.kind === "app" && this.opts.appCannotCreateRepos) return send(res, 403, { message: "Resource not accessible by integration" });
      const b = json();
      if (this.repos.has(`${me.user.login}/${b.name}`.toLowerCase())) return send(res, 422, { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] });
      const r = this.addRepo(me.user.login, b.name, b.auto_init ? { "README.md": `# ${b.name}\n` } : null, { private: !!b.private, description: b.description ?? "" });
      return send(res, 201, this.repoJson(r, me));
    }

    const rm = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
    if (!rm) return send(res, 404, { message: "Not Found" });
    const repo = this.repos.get(`${rm[1]}/${rm[2]}`.toLowerCase());
    if (!repo || !this.canSee(me, repo)) return send(res, 404, { message: "Not Found" });
    const rest = rm[3] ?? "";
    const write = () => repo.owner.toLowerCase() === me.user.login.toLowerCase();

    if (m === "GET" && rest === "") return send(res, 200, this.repoJson(repo, me));
    let mm: RegExpExecArray | null;
    if (m === "GET" && (mm = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      if (!repo.refs.size) return send(res, 409, { message: "Git Repository is empty." });
      const sha = repo.refs.get(decodeURIComponent(mm[1]));
      return sha ? send(res, 200, { ref: `refs/heads/${mm[1]}`, object: { sha, type: "commit" } }) : send(res, 404, { message: "Not Found" });
    }
    if (m === "GET" && (mm = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest))) {
      const c = this.commits.get(mm[1]);
      return c ? send(res, 200, { sha: mm[1], tree: { sha: c.tree }, parents: c.parents.map((s) => ({ sha: s })), message: c.message, author: c.author }) : send(res, 404, { message: "Not Found" });
    }
    if (m === "GET" && (mm = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest))) {
      const t = this.trees.get(mm[1]);
      return t ? send(res, 200, { sha: mm[1], truncated: false, tree: [...t].map(([path, sha]) => ({ path, sha, type: "blob", mode: "100644" })) }) : send(res, 404, { message: "Not Found" });
    }
    if (m === "GET" && (mm = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest))) {
      const b = this.blobs.get(mm[1]);
      return b ? send(res, 200, { sha: mm[1], encoding: "base64", content: b.toString("base64"), size: b.length }) : send(res, 404, { message: "Not Found" });
    }
    if (m === "POST" && rest === "/git/blobs") {
      if (!write()) return send(res, 403, { message: "Resource not accessible" });
      if (!repo.refs.size) return send(res, 409, { message: "Git Repository is empty." });
      const b = json();
      return send(res, 201, { sha: this.putBlob(Buffer.from(b.content, b.encoding === "base64" ? "base64" : "utf8")) });
    }
    if (m === "POST" && rest === "/git/trees") {
      if (!write()) return send(res, 403, { message: "Resource not accessible" });
      const b = json() as { base_tree?: string; tree: { path: string; sha: string | null }[] };
      const map = new Map(b.base_tree ? (this.trees.get(b.base_tree) ?? []) : []);
      for (const e of b.tree) {
        if (e.sha === null) map.delete(e.path);
        else {
          if (!this.blobs.has(e.sha)) return send(res, 422, { message: `sha ${e.sha} not found` });
          map.set(e.path, e.sha);
        }
      }
      return send(res, 201, { sha: this.putTree(map) });
    }
    if (m === "POST" && rest === "/git/commits") {
      if (!write()) return send(res, 403, { message: "Resource not accessible" });
      const b = json();
      const sha = this.putCommit({ tree: b.tree, parents: b.parents, message: b.message, author: b.author });
      return send(res, 201, { sha, html_url: `${this.url}/${repo.owner}/${repo.name}/commit/${sha}` });
    }
    if (m === "PATCH" && (mm = /^\/git\/refs\/heads\/(.+)$/.exec(rest))) {
      if (!write()) return send(res, 403, { message: "Resource not accessible" });
      const b = json();
      const br = decodeURIComponent(mm[1]);
      const cur = repo.refs.get(br);
      if (!cur) return send(res, 422, { message: "Reference does not exist" });
      if (!b.force && !this.commits.get(b.sha)?.parents.includes(cur)) return send(res, 422, { message: "Update is not a fast forward" });
      repo.refs.set(br, b.sha);
      return send(res, 200, { ref: `refs/heads/${br}`, object: { sha: b.sha } });
    }
    if (m === "PUT" && (mm = /^\/contents\/(.+)$/.exec(rest))) {
      if (!write()) return send(res, 403, { message: "Resource not accessible" });
      const b = json();
      const branch = b.branch ?? repo.defaultBranch;
      const head = repo.refs.get(branch);
      const map = new Map(head ? this.trees.get(this.commits.get(head)!.tree)! : []);
      map.set(decodeURIComponent(mm[1]), this.putBlob(Buffer.from(b.content, "base64")));
      const sha = this.putCommit({ tree: this.putTree(map), parents: head ? [head] : [], message: b.message, author: { name: me.user.login, email: "x", date: new Date().toISOString() } });
      repo.refs.set(branch, sha);
      return send(res, 201, { commit: { sha } });
    }
    if (m === "GET" && (mm = /^\/contents\/(.+)$/.exec(rest))) {
      const ref = u.searchParams.get("ref") ?? repo.defaultBranch;
      const head = this.commits.has(ref) ? ref : repo.refs.get(ref === "HEAD" ? repo.defaultBranch : ref);
      const t = head ? this.trees.get(this.commits.get(head)!.tree) : null;
      const s = t?.get(decodeURIComponent(mm[1]));
      if (!s) return send(res, 404, { message: "Not Found" });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(this.blobs.get(s));
    }
    if (m === "GET" && (mm = /^\/commits\/(.+)$/.exec(rest))) {
      const ref = decodeURIComponent(mm[1]);
      const sha = this.commits.has(ref) ? ref : repo.refs.get(ref === "HEAD" ? repo.defaultBranch : ref);
      if (!sha) return send(res, repo.refs.size ? 404 : 409, { message: "Not Found" });
      const etag = `"${sha}"`;
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { etag });
        return res.end();
      }
      if ((req.headers.accept ?? "").includes("vnd.github.sha")) {
        res.writeHead(200, { "content-type": "text/plain", etag });
        return res.end(sha);
      }
      return send(res, 200, { sha }, { etag });
    }
    return send(res, 404, { message: "Not Found" });
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(s).toString(), ...headers });
  res.end(s);
}

// Standalone: tsx mock-github.ts [port]
if (process.argv[1] && /mock-github\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2] ?? 5186);
  const gh = new MockGithub();
  // A friend's public pack repo to follow, with one pack.
  gh.addRepo("friend", "label-packs", {
    "labebal-packs.json": JSON.stringify({ name: "Friend's packs", packs: ["shelf/labebal-pack.json"] }),
    "shelf/labebal-pack.json": JSON.stringify({ id: "friend-shelf", name: "Shelf labels", version: "1.0.0", templates: ["templates/shelf.json"], labels: ["labels/shelf.csv"] }),
    "shelf/templates/shelf.json": JSON.stringify(shelfTemplate("Shelf")),
    "shelf/labels/shelf.csv": "id,name,template,title\nl-shelf-a,Shelf A,t-friend-shelf,Shelf A\nl-shelf-b,Shelf B,t-friend-shelf,Shelf B\n",
  });
  void gh.start(port).then((url) => {
    console.log(`mock GitHub on ${url}`);
    // Simulate the friend publishing 1.1.0 after a while: POST /__push
    gh.server!.prependListener("request", (req: http.IncomingMessage) => {
      if (req.url === "/__friend-update" && req.method === "POST") {
        gh.push("friend/label-packs", {
          "shelf/labebal-pack.json": JSON.stringify({ id: "friend-shelf", name: "Shelf labels", version: "1.1.0", templates: ["templates/shelf.json"], labels: ["labels/shelf.csv"] }),
          "shelf/templates/shelf.json": JSON.stringify(shelfTemplate("Shelf v2")),
          "shelf/labels/shelf.csv": "id,name,template,title\nl-shelf-a,Shelf A,t-friend-shelf,Shelf A1\nl-shelf-c,Shelf C,t-friend-shelf,Shelf C\nl-shelf-d,Shelf D,t-friend-shelf,Shelf D\n",
        });
        console.log("friend pushed 1.1.0");
      }
    });
  });
}

/** A tiny valid template for the mock's sample pack. */
export function shelfTemplate(text: string) {
  return {
    id: "t-friend-shelf",
    name: "Friend shelf",
    schema: 2,
    design: { w: 40, h: 12 },
    root: {
      id: "root",
      name: "Label",
      type: "frame",
      layout: "column",
      w: { kind: "fill" },
      h: { kind: "fill" },
      align: "stretch",
      children: [{ id: "title", name: "Title", type: "text", text: `{{title}}`, font: "sans-serif", weight: 700, sizePt: 14, minSizePt: 5, fit: "shrink", align: "center", valign: "middle", color: "black", w: { kind: "fill" }, h: { kind: "fill" } }],
    },
    fields: [{ key: "title", label: text, type: "text", default: "Shelf" }],
  };
}
