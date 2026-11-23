"use client";
import { Page } from "../../components/app-shell";
import { WebhooksSection } from "../inbox/WebhooksSection";
import { BackupSection } from "../library/BackupSection";
import { PacksSection } from "../packs/PacksSection";
import { ApiTokensSection } from "./ApiTokensSection";
import { CalibrationSection } from "./CalibrationSection";
import { CountersSection } from "../counters/CountersSection";
import { FontsSection } from "./FontsSection";
import { PrinterInfoSection } from "./PrinterInfoSection";
import { IconsSection } from "./IconsSection";
import { StockSection } from "./StockSection";
import { TeamValuesSection } from "./TeamValuesSection";
import { NetPrintersSection } from "../netprinters/NetPrintersSection";
import { YouSection } from "./YouSection";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Settings: each section is owned by its feature (see the section files). */
export function SettingsPage() {
  return (
    <Page title="Settings">
      <Section title="Connected printer" description="What the printer reports: serial, firmware, battery, lid/paper status, roll and ribbon.">
        <PrinterInfoSection />
      </Section>
      <Section title="You" description="Your name on this browser, recorded with each print.">
        <YouSection />
      </Section>
      <Section title="Printers" description="Calibration offsets, darkness per material, test pattern.">
        <CalibrationSection />
      </Section>
      <Section title="Network printers" description="Zebra and other ZPL label printers on the network. The server prints to them, so any browser can use them, phones included.">
        <NetPrintersSection />
      </Section>
      <Section title="Team values" description="Company name, address, website and other text many labels share. Templates show them as {{team:name}}.">
        <TeamValuesSection />
      </Section>
      <Section title="Stock and ribbons" description="Your own label stock and ribbons, marked direct thermal or thermal transfer. Shared with the team.">
        <StockSection />
      </Section>
      <Section title="Packs" description="Template and label packs from git repos or links: install, turn on / off, update.">
        <PacksSection />
      </Section>
      <Section title="Fonts" description="Upload label fonts; pixel fonts are detected automatically.">
        <FontsSection />
      </Section>
      <Section title="Icons" description="Upload your own SVG icons (connector drawings, logos) to use next to the built-in libraries.">
        <IconsSection />
      </Section>
      <Section title="Counters" description="Persistent numbers for labels (box, batch, serial), with daily / monthly / per-lot resets.">
        <CountersSection />
      </Section>
      <Section title="API access" description="Tokens for other systems to push labels and data.">
        <ApiTokensSection />
      </Section>
      <Section title="Webhooks" description="Tell other systems when labels are printed or voided and when print requests change."><WebhooksSection /></Section>
      <Section title="Backup" description="Everything in one file: download, restore, and automatic backups on the server.">
        <BackupSection />
      </Section>
    </Page>
  );
}
