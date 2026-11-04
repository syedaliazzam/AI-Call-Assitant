/**
 * File: apps/web/src/features/dev/UiGallery.tsx
 * Purpose: The UI gallery at /dev/ui: typography, buttons, split button, form fields, selects,
 *          segmented control, stepper, radio cards, toggle, chips, key caps, menus, tabs, progress bar,
 *          badges, card, dialog and sidebar, each on a light surface and on a dark one, so the theme can
 *          be checked in one place and screenshotted.
 * Used by: app/(app)/dev/ui/page.tsx
 * Depends on: src/ui (every component)
 * Architecture: docs/design/kite-ui-theme.md §3–§5, §9 (stage U1)
 */
'use client';

import { useId, useState } from 'react';
import { Badge } from '@/ui/Badge';
import { BrandLockup } from '@/ui/BrandLockup';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Chip, SoonBadge } from '@/ui/Chip';
import { Dialog, DialogPanel } from '@/ui/Dialog';
import { Eyebrow } from '@/ui/Eyebrow';
import { Input } from '@/ui/Input';
import { KeyCap } from '@/ui/KeyCap';
import { Menu } from '@/ui/Menu';
import { MultiSelect } from '@/ui/MultiSelect';
import { MenuAction, MenuBlock, MenuStepper, MenuSwitch, MenuTheme } from '@/ui/PanelMenu';
import { ProgressBar } from '@/ui/ProgressBar';
import { RadioCards } from '@/ui/RadioCard';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Select } from '@/ui/Select';
import { Sidebar } from '@/ui/Sidebar';
import { SplitButton } from '@/ui/SplitButton';
import { Stepper } from '@/ui/Stepper';
import { Tabs } from '@/ui/Tabs';
import { Textarea } from '@/ui/Textarea';
import { Toggle } from '@/ui/Toggle';

/** The sample tabs. */
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'regular', label: 'Regular' },
  { value: 'mock', label: 'Mock' },
] as const;

/** A sample tab value. */
type TabValue = (typeof TABS)[number]['value'];

/** The sample select options. */
const MODELS = [
  { value: 'fast', label: 'Fast (best for live answers)' },
  { value: 'smart', label: 'Smart (slower, more careful)' },
] as const;

/** A sample select value. */
type ModelValue = (typeof MODELS)[number]['value'];

/** The sample searchable list. */
const LANGUAGES = [
  { value: 'Danish', label: 'Danish' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
] as const;

/** A sample language. */
type LanguageValue = (typeof LANGUAGES)[number]['value'];

/**
 * A titled row of the gallery.
 *
 * @param props.label    The row's eyebrow.
 * @param props.children The samples.
 * @returns The row.
 * Rendered by: GallerySet
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-ui-border pt-5">
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  );
}

/**
 * Every component once, on whatever surface it is placed (the --ui-* tokens decide).
 *
 * @param props.name "Light" or "Dark" (the set's heading and the ids of its fields).
 * @returns The set.
 * Rendered by: UiGallery (twice)
 */
function GallerySet({ name }: { name: string }) {
  const [tab, setTab] = useState<TabValue>('all');
  const [model, setModel] = useState<ModelValue>('fast');
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<string[]>([]);
  const [language, setLanguage] = useState<LanguageValue>('English');
  const [segment, setSegment] = useState<TabValue>('all');
  const [radio, setRadio] = useState<TabValue>('regular');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const titleId = useId();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Eyebrow>{name} surface</Eyebrow>
        <h2 className="text-[24px] font-semibold text-ui-heading">Answers while you talk.</h2>
      </div>

      <Row label="Lockup">
        <div className="flex flex-wrap items-center gap-8">
          <BrandLockup tone={name === 'Dark' ? 'dark' : 'light'} size="lg" />
          <BrandLockup tone={name === 'Dark' ? 'dark' : 'light'} size="sm" byline={false} />
        </div>
      </Row>

      <Row label="Typography">
        <p className="text-[18px] font-semibold text-ui-heading">Section heading, 18 px</p>
        <p className="max-w-prose text-[15px] leading-relaxed text-ui-text">
          Body text, 15 px with a 1.6 line height. Paramount AI listens to both sides of the call
          and writes a short answer you can say right away.
        </p>
        <p className="text-[13px] text-ui-muted">Small muted text, 13 px.</p>
        <p className="text-[15px]">
          <a href="#ui-gallery" className="text-ui-link hover:underline">
            A text link
          </a>
        </p>
        <div className="flex flex-wrap gap-4">
          <Eyebrow className="text-ui-you">You</Eyebrow>
          <Eyebrow className="text-ui-them">Them</Eyebrow>
          <Eyebrow>Answer · 0.9 s</Eyebrow>
          <Eyebrow>Ctrl + Enter</Eyebrow>
          <span className="text-[15px] text-ui-heading">2,080 · 15,600</span>
        </div>
      </Row>

      <Row label="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Answer</Button>
          <Button variant="secondary">Screenshot</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm">Small primary</Button>
          <Button size="sm" variant="secondary">
            Small secondary
          </Button>
          <Button size="sm" disabled>
            Disabled
          </Button>
        </div>
      </Row>

      <Row label="Form fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Company" defaultValue="Northwind Logistics" />
          <Input label="Email" placeholder="name@company.com" hint="The sign-in email." />
          <Input label="Seats" defaultValue="forty" error="Enter a number." />
          <Input label="Disabled" defaultValue="Read only" disabled />
          <Select label="Model" options={MODELS} value={model} onChange={setModel} />
          <Textarea label="Instructions" defaultValue="Keep answers short." hint="Optional." />
        </div>
        <Toggle
          label="Save transcript"
          hint="Keep the call's transcript on this computer."
          checked={on}
          onChange={setOn}
        />
      </Row>

      <Row label="Split button, chips and key caps">
        <div className="flex flex-wrap items-center gap-3">
          <SplitButton
            onClick={() => undefined}
            menuLabel="More session types"
            items={[
              { label: 'Interview call', onSelect: () => undefined },
              { label: 'Regular call', onSelect: () => undefined },
              { label: 'Mock interview', onSelect: () => undefined },
            ]}
          >
            Create session
          </SplitButton>
          <Chip>Interview</Chip>
          <SoonBadge />
          <KeyCap hotkey="answer" />
          <KeyCap hotkey="screenshot" />
          <Menu
            label="Menu"
            items={[
              { label: 'Edit', onSelect: () => undefined },
              { divider: true },
              { label: 'Tutorials', soon: true },
              { label: 'Delete', danger: true, onSelect: () => undefined },
            ]}
          />
        </div>
      </Row>

      <Row label="Selects">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Language"
            searchable
            options={LANGUAGES}
            value={language}
            onChange={setLanguage}
          />
          <MultiSelect
            label="Documents"
            options={[
              { value: 'a', label: 'Pricing sheet' },
              { value: 'b', label: 'Runbook' },
            ]}
            values={docs}
            onChange={setDocs}
          />
        </div>
      </Row>

      <Row label="Segmented control, stepper and radio cards">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-6">
            <SegmentedControl
              label="Session type"
              options={TABS}
              value={segment}
              onChange={setSegment}
            />
            <Stepper steps={['Details', 'Preferences']} current={0} />
          </div>
          <RadioCards
            label="Sample cards"
            options={TABS.map((item) => ({
              value: item.value,
              label: item.label,
              description: 'A line about this choice.',
            }))}
            value={radio}
            onChange={setRadio}
          />
        </div>
      </Row>

      <Row label="Panel menu">
        <div className="max-w-80">
          <MenuBlock>
            <MenuAction label="Dashboard" out onSelect={() => undefined} />
            <MenuAction label="Voice profile" soon />
            <MenuSwitch label="Private" info="Hides these windows." checked={on} onChange={setOn} />
            <MenuStepper
              label="Zoom"
              value="100%"
              onMore={() => undefined}
              onLess={() => undefined}
              onReset={() => undefined}
            />
            <MenuTheme value={theme} onChange={setTheme} />
          </MenuBlock>
        </div>
      </Row>

      <Row label="Tabs and progress">
        <Tabs label={`${name} sample tabs`} options={TABS} value={tab} onChange={setTab} />
        <ProgressBar value={0.62} label="Downloading the speech model" />
      </Row>

      <Row label="Badges">
        <div className="flex flex-wrap gap-4">
          <Badge tone="success">Connected</Badge>
          <Badge tone="warning">Warming</Badge>
          <Badge tone="danger">Error</Badge>
          <Badge tone="neutral">Ended</Badge>
        </div>
      </Row>

      <Row label="Card">
        <Card eyebrow="Step 1 of 2" title="Session details">
          <p className="text-[15px] text-ui-text">
            Cards have a 1 px border, a 16 px radius and a faint shadow.
          </p>
        </Card>
      </Row>

      <Row label="Dialog">
        <div className="max-w-md border border-ui-border bg-ui-surface">
          <DialogPanel
            titleId={titleId}
            title="Delete this session?"
            onClose={() => undefined}
            footer={
              <>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger">Delete</Button>
              </>
            }
          >
            Everything saved with it on this computer will be deleted.
          </DialogPanel>
        </div>
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Open the real dialog
          </Button>
        </div>
        <Dialog open={open} onClose={() => setOpen(false)} title="A real dialog">
          It dims the page, traps focus and closes on Escape.
        </Dialog>
      </Row>
    </div>
  );
}

/**
 * The UI gallery.
 *
 * @returns The light set, the dark set and the sidebar.
 * Rendered by: app/(app)/dev/ui/page.tsx
 */
export function UiGallery() {
  return (
    <div id="ui-gallery" className="flex flex-col">
      <header className="k-light bg-ui-bg px-4 py-8 sm:px-8">
        <Eyebrow>Dev Tools</Eyebrow>
        <h1 className="text-[24px] font-semibold text-ui-heading">UI components</h1>
        <p className="mt-1 max-w-prose text-[15px] text-ui-muted">
          The theme (docs/design/paramount-ai-ui-spec.md §1): neutral zinc, one blue accent, Inter,
          soft radii and thin borders.
        </p>
      </header>
      <section aria-label="Light surface" className="k-light bg-ui-bg px-4 py-8 sm:px-8">
        <GallerySet name="Light" />
      </section>
      <section aria-label="Grey band" className="k-light bg-ui-band px-4 py-8 sm:px-8">
        <Eyebrow>Grey band (--k-band)</Eyebrow>
        <h2 className="text-[18px] font-semibold text-ui-heading">Alternating sections</h2>
        <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-ui-text">
          Long pages alternate white and grey-band sections, as on the company site. On the band,
          body text, headings, muted text and status colours all pass 4.5:1; links and the
          &quot;You&quot; label do not (4.37:1), so they stay on white surfaces such as the card
          below.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card eyebrow="On the band" title="A white card">
            <p className="text-[15px] text-ui-text">
              Cards sit on the band as white surfaces.{' '}
              <a href="#ui-gallery" className="text-ui-link hover:underline">
                Links go here
              </a>
              .
            </p>
          </Card>
          <div className="flex flex-col gap-3">
            <Badge tone="success">Saved</Badge>
            <Badge tone="warning">Unsaved changes</Badge>
            <p className="text-[13px] text-ui-muted">Muted text on the band: 4.75:1.</p>
            <div>
              <Button variant="secondary">Secondary on the band</Button>
            </div>
          </div>
        </div>
      </section>
      <section aria-label="Dark surface" className="k-dark bg-ui-bg px-4 py-8 sm:px-8">
        <GallerySet name="Dark" />
      </section>
      <section aria-label="Sidebar" className="k-light bg-ui-band px-4 py-8 sm:px-8">
        <Eyebrow>Sidebar (always dark)</Eyebrow>
        <div className="mt-3 flex h-96 max-w-full overflow-hidden border border-ui-border">
          <Sidebar user={{ name: 'Sample User', email: 'sample@example.com', role: 'admin' }} />
          <div className="flex-1 bg-ui-band" />
        </div>
      </section>
    </div>
  );
}
