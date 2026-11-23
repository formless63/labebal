"use client";
import { useState } from "react";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { useLabelStore } from "../labels/store";
import { newRunId, useRunActions } from "./api";

/** "Save as run" button for the print queue: stores the queue's labels and quantities as a stock run. */
export function SaveQueueAsRun() {
  const queue = useLabelStore((s) => s.queue);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { create } = useRunActions();
  const items = queue.filter((q) => q.qty > 0).map((q) => ({ labelId: q.labelId, qty: q.qty }));

  async function save() {
    try {
      await create.mutateAsync({ id: newRunId(), name: name.trim() || "Untitled run", notes: "", items });
      toast.success(`Saved "${name.trim() || "Untitled run"}" (${items.length} labels). Find it under Stock runs.`);
      setOpen(false);
      setName("");
    } catch (e) {
      toast.error(`Could not save: ${(e as Error).message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!items.length} title="Save these labels and quantities to print again later">
          <IconDeviceFloppy /> Save as run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save queue as a stock run</DialogTitle>
          <DialogDescription>A run remembers which labels and how many of each, so you can print the same batch again in one click.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="run-name">Name</Label>
          <Input id="run-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cable restock: 5 of each length" onKeyDown={(e) => e.key === "Enter" && void save()} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={save}>
            Save run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
