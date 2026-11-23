"use client";
/** Settings section: this browser's display name for print history. */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { setWho, useWho } from "../history/who";
import { IdentityNote } from "../auth/me-client";

export function YouSection() {
  const who = useWho();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? who;
  const save = () => {
    setWho(value);
    setDraft(null);
    toast.success(value.trim() ? `Prints from this browser are recorded as "${value.trim()}"` : "Name cleared");
  };
  return (
    <>
      <IdentityNote />
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input className="w-64" value={value} maxLength={100} placeholder="Your name, e.g. Sam" onChange={(e) => setDraft(e.target.value)} aria-label="Your name" />
        <Button type="submit" variant="outline" disabled={draft === null || draft.trim() === who}>
          Save
        </Button>
        <span className="text-xs text-muted-foreground">Stored in this browser only. Shown in History as who printed.</span>
      </form>
    </>
  );
}
