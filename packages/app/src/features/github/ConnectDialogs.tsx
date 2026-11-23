"use client";
/**
 * "Connect GitHub" (device flow: show a code, the person types it on GitHub)
 * and "Use a token instead" (guided fine-grained token). Plain language: most
 * people using this aren't GitHub people.
 */
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useGithubActions } from "./api";
import type { DeviceStartView, GithubAccountView, GithubConfigView } from "./model";

export function ConnectDialog({ onClose, onConnected }: { onClose: () => void; onConnected: (a: GithubAccountView) => void }) {
  const actions = useGithubActions();
  const [start, setStart] = useState<DeviceStartView | null>(null);
  const [state, setState] = useState<{ status: string; error?: string }>({ status: "starting" });
  const [copied, setCopied] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const done = useRef(false);

  useEffect(() => {
    let alive = true;
    actions
      .startDevice()
      .then((s) => alive && (setMinutes(Math.max(1, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 60_000))), setStart(s), setState({ status: "pending" })))
      .catch((e) => alive && setState({ status: "error", error: (e as Error).message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask our server every couple of seconds; it asks GitHub at GitHub's pace.
  useEffect(() => {
    if (!start || state.status !== "pending") return;
    const t = setInterval(async () => {
      try {
        const s = await actions.deviceStatus(start.id);
        if (s.status === "done" && s.account && !done.current) {
          done.current = true;
          setState({ status: "done" });
          onConnected(s.account);
        } else if (s.status !== "pending") setState({ status: s.status, error: s.error });
      } catch (e) {
        setState({ status: "error", error: (e as Error).message });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [start, state.status, actions, onConnected]);

  const close = () => {
    if (start && state.status === "pending") void actions.cancelDevice(start.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect GitHub</DialogTitle>
          <DialogDescription>GitHub keeps your packs so friends can follow them. Type this code on GitHub to let labebal save packs for you.</DialogDescription>
        </DialogHeader>
        {state.status === "starting" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 className="size-4 animate-spin" /> Asking GitHub for a code…
          </p>
        )}
        {start && state.status === "pending" && (
          <div className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>Copy the code below.</li>
              <li>Open GitHub and sign in if it asks.</li>
              <li>Paste the code and press Authorize.</li>
            </ol>
            <div className="flex flex-col items-center gap-3 rounded-lg bg-muted p-4">
              <span className="font-mono text-3xl font-semibold tracking-widest select-all" aria-label="Code to type on GitHub" data-testid="device-code">
                {start.userCode}
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(start.userCode).then(() => setCopied(true));
                  }}
                >
                  {copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy code"}
                </Button>
                <Button asChild>
                  <a href={start.verificationUri} target="_blank" rel="noreferrer">
                    <IconExternalLink /> Open GitHub
                  </a>
                </Button>
              </div>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <IconLoader2 className="size-3.5 animate-spin" /> Waiting for you to authorize on GitHub… (the code works for {minutes} minutes)
            </p>
          </div>
        )}
        {state.status === "done" && <p className="text-sm">Connected.</p>}
        {["denied", "expired", "error"].includes(state.status) && <p className="text-sm text-destructive">{state.error ?? "That didn't work."}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {state.status === "done" ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Use a token instead": a prefilled GitHub page and short steps; checked with GitHub on save. */
export function TokenDialog({ config, onClose, onConnected }: { config: GithubConfigView; onClose: () => void; onConnected: (a: GithubAccountView) => void }) {
  const actions = useGithubActions();
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await actions.addToken(token.trim(), repo.trim() || undefined);
      toast.success(`Connected ${r.account.login}`, { description: r.repo ? `It can ${r.repo.canWrite ? "write to" : "read"} ${r.repo.fullName}.` : undefined });
      onConnected(r.account);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use a GitHub token</DialogTitle>
          <DialogDescription>A token is a password just for labebal, limited to the repositories you pick. It stays on this server and is never shown again.</DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          <li>
            <Button asChild size="sm" variant="outline">
              <a href={config.tokenUrl} target="_blank" rel="noreferrer">
                <IconExternalLink /> Create a token on GitHub
              </a>
            </Button>{" "}
            (name, permissions and no expiry are filled in for you).
          </li>
          <li>
            Under <b>Repository access</b>, choose <b>Only select repositories</b> and pick your packs repository (or <b>All repositories</b> if you want labebal to create one for you).
          </li>
          <li>
            Press <b>Generate token</b>, copy it, and paste it below.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Only following other people&apos;s private packs? A{" "}
          <a className="underline" href={config.readTokenUrl} target="_blank" rel="noreferrer">
            read-only token
          </a>{" "}
          is enough. Doesn&apos;t work?{" "}
          <a className="underline" href={config.classicTokenUrl} target="_blank" rel="noreferrer">
            Use a classic token
          </a>
          .
        </p>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Token</Label>
            <Input type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="GitHub token" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Repository to check (optional)</Label>
            <Input placeholder="you/labebal-packs" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || token.trim().length < 20}>
            {busy ? "Checking…" : "Save token"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
