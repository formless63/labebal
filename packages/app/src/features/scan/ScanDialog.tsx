"use client";
/**
 * Scan: find a label or dataset row by scanning its code. Uses the camera
 * through `BarcodeDetector` where the browser has it (Chrome / Edge on
 * Android, ChromeOS, macOS); everywhere else (and for USB / Bluetooth
 * scanners, which type like a keyboard and press Enter) the text field.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "../../lib/router";
import { useQueryClient } from "@tanstack/react-query";
import { IconCamera, IconCameraOff, IconEdit, IconFileDescription, IconPrinter, IconScan, IconTable } from "@tabler/icons-react";
import { labelIdFromUrl, labelPath } from "@labebal/core";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { json, send, type ApplyResult } from "../data/api";
import { LIBRARY_KEY } from "../labels/api";
import { useLabelStore } from "../labels/store";
import { apiRoot } from "../../lib/base";

interface ScanResult {
  q: string;
  labels: { id: string; name: string; templateId: string; templateName?: string; match: string }[];
  rows: { datasetId: string; datasetName: string; rowId: string; preview: Record<string, string>; column?: string; labelId?: string; labelExists: boolean; match: string }[];
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = (new (opts?: { formats?: string[] }) => BarcodeDetectorLike) & { getSupportedFormats?: () => Promise<string[]> };

const detectorCtor = () => (typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector : undefined);

/** Camera preview that calls `onCode` with the first code it reads. */
function CameraScanner({ onCode, onError }: { onCode: (code: string) => void; onError: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef({ onCode, onError });
  useEffect(() => {
    cb.current = { onCode, onError };
  });

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) return;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    (async () => {
      try {
        const formats = (await Ctor.getSupportedFormats?.()) ?? undefined;
        const detector = new Ctor(formats?.length ? { formats } : undefined);
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const hit = codes.find((c) => c.rawValue.trim());
            if (hit) return cb.current.onCode(hit.rawValue);
          } catch {}
          timer = setTimeout(loop, 250);
        };
        void loop();
      } catch (e) {
        cb.current.onError((e as Error).message || "Camera not available");
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return <video ref={video} className="aspect-video w-full rounded-md bg-black object-cover" muted playsInline />;
}

export function ScanButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const qc = useQueryClient();
  const enqueue = useLabelStore((s) => s.enqueue);
  const select = useLabelStore((s) => s.select);
  // Read once on the client; the button is client-only anyway.
  const [hasDetector] = useState(() => !!detectorCtor());

  async function lookup(code: string) {
    const q = code.trim();
    if (!q) return;
    setText(q);
    setCamera(false);
    setBusy(true);
    try {
      const r = await fetch(`${apiRoot()}/scan?q=${encodeURIComponent(q)}`).then((x) => json<ScanResult>(x));
      // A labebal label QR ({{labelUrl}}: https://host/l/<id>) opens that label's page.
      const pageId = labelIdFromUrl(q);
      const hit = pageId ? r.labels.find((l) => l.match === "id" && l.id === pageId) : undefined;
      if (hit) return go(labelPath(hit.id));
      setResult(r);
      if (!r.labels.length && !r.rows.length) toast.info(`Nothing found for "${r.q}"`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      // Ready for the next scan from a USB scanner.
      setTimeout(() => input.current?.select(), 0);
    }
  }

  const reprint = (labelId: string, name: string) => {
    enqueue(labelId, 1);
    toast.success(`Added ${name} to the print queue`, { action: { label: "Go to Print", onClick: () => router.push("/") } });
  };

  async function reprintRow(r: ScanResult["rows"][number]) {
    if (r.labelExists && r.labelId) return reprint(r.labelId, r.labelId);
    try {
      const a = await send(`${apiRoot()}/datasets/${encodeURIComponent(r.datasetId)}/labels`, "POST", { rowIds: [r.rowId] }).then((x) => json<ApplyResult>(x));
      if (!a.labelIds.length) return toast.error(a.skipped[0]?.reason ?? "No label could be made from this row");
      await qc.invalidateQueries({ queryKey: LIBRARY_KEY });
      reprint(a.labelIds[0], a.labelIds[0]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCamera(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Scan a label or code to find it">
          <IconScan /> <span className="hidden sm:inline">Scan</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan</DialogTitle>
          <DialogDescription>Scan a label&apos;s code with a USB scanner or the camera, or type a key / value, to find the label or data row.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(text);
          }}
        >
          <Input ref={input} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Scan or type, then Enter" aria-label="Code" />
          <Button type="submit" disabled={!text.trim() || busy}>
            Find
          </Button>
          {hasDetector && (
            <Button type="button" variant="outline" size="icon" title={camera ? "Stop camera" : "Use the camera"} onClick={() => setCamera((c) => !c)}>
              {camera ? <IconCameraOff /> : <IconCamera />}
            </Button>
          )}
        </form>
        {camera && (
          <CameraScanner
            onCode={(c) => void lookup(c)}
            onError={(m) => {
              setCamera(false);
              toast.error(`Camera: ${m}`);
            }}
          />
        )}
        {!hasDetector && <p className="text-xs text-muted-foreground">This browser can&apos;t read codes from the camera; a USB or Bluetooth scanner (keyboard mode) works.</p>}

        {result && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto">
            {result.labels.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Labels</h3>
                <ul className="divide-y rounded-md border">
                  {result.labels.map((l) => (
                    <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {l.templateName ?? l.templateId} · {l.match === "contains" ? "contains the code" : `matched by ${l.match}`}
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" title="Open the label's page" onClick={() => go(labelPath(l.id))}>
                        <IconFileDescription /> Page
                      </Button>
                      <Button size="sm" onClick={() => reprint(l.id, l.name)}>
                        <IconPrinter /> Reprint
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          select(l.id);
                          go("/");
                        }}
                      >
                        <IconEdit /> Edit
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.rows.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Data rows</h3>
                <ul className="divide-y rounded-md border">
                  {result.rows.map((r) => (
                    <li key={`${r.datasetId}/${r.rowId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {Object.values(r.preview)
                            .filter(Boolean)
                            .slice(0, 3)
                            .join(" · ") || r.rowId}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.datasetName}
                          {r.column && ` · ${r.column}`}
                        </div>
                      </div>
                      {r.labelId && (
                        <Button size="sm" onClick={() => void reprintRow(r)} title={r.labelExists ? "Add its label to the print queue" : "Create its label, then queue it"}>
                          <IconPrinter /> {r.labelExists ? "Reprint" : "Make + print"}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => go(`/data?dataset=${encodeURIComponent(r.datasetId)}&q=${encodeURIComponent(result.q)}`)}>
                        <IconTable /> Open row
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
