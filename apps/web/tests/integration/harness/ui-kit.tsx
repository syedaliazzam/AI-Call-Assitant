/**
 * File: apps/web/tests/integration/harness/ui-kit.tsx
 * Purpose: Every shared UI piece of the v1.2.0 foundation on one page, with no server, for
 *          tests/integration/ui-kit.spec.ts: behaviour in a real browser and measured sizes.
 * Used by: apps/web/tests/integration/ui-kit.spec.ts
 * Depends on: src/ui/*
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3
 */
import { Bot, Briefcase, Phone } from 'lucide-react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/ui/Button';
import { Chip, SoonBadge } from '@/ui/Chip';
import { Input } from '@/ui/Input';
import { KeyCap } from '@/ui/KeyCap';
import { Menu } from '@/ui/Menu';
import { Modal } from '@/ui/Modal';
import { MultiSelect } from '@/ui/MultiSelect';
import { MenuAction, MenuBlock, MenuStepper, MenuSwitch, MenuTheme } from '@/ui/PanelMenu';
import { RadioCards } from '@/ui/RadioCard';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Select } from '@/ui/Select';
import { SplitButton } from '@/ui/SplitButton';
import { Stepper } from '@/ui/Stepper';
import { Textarea } from '@/ui/Textarea';
import { Switch, Toggle } from '@/ui/Toggle';
import { Tooltip } from '@/ui/Tooltip';

/** Languages, long enough for the list to scroll. */
const LANGUAGES = [
  'Croatian',
  'Czech',
  'Danish',
  'Dutch',
  'English',
  'French',
  'German',
  'Spanish',
];

/** What the harness reports back to the test. */
const log: string[] = [];
(window as unknown as { uiKitLog: string[] }).uiKitLog = log;

/**
 * The page.
 *
 * @returns Every piece.
 */
function Kit() {
  const [language, setLanguage] = useState('English');
  const [resume, setResume] = useState('none');
  const [docs, setDocs] = useState<string[]>([]);
  const [type, setType] = useState<'interview' | 'regular' | 'mock'>('interview');
  const [length, setLength] = useState<'short' | 'medium' | 'detailed'>('medium');
  const [on, setOn] = useState(false);
  const [modal, setModal] = useState(false);
  const [rail, setRail] = useState(false);
  const [aside, setAside] = useState(false);
  const [stepNo, setStepNo] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');

  const resumeSelect = (
    <Select
      label="CV / Resume"
      options={[
        { value: 'none', label: 'None' },
        { value: 'cv', label: 'A resume with a very long file name that has to wrap (1) (1).pdf' },
      ]}
      value={resume}
      onChange={setResume}
      actions={[{ label: 'Upload a resume', onSelect: () => log.push('upload') }]}
    />
  );

  return (
    <main className="flex flex-col gap-6 bg-ui-bg p-6 text-ui-text">
      <div className="flex flex-wrap items-center gap-3">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="accent" size="lg">
          Large accent
        </Button>
        <SplitButton
          onClick={() => log.push('split-main')}
          menuLabel="More session types"
          items={[
            {
              label: 'Interview call',
              icon: <Briefcase size={18} />,
              onSelect: () => log.push('interview'),
            },
            {
              label: 'Regular call',
              icon: <Phone size={18} />,
              onSelect: () => log.push('regular'),
            },
            { label: 'Mock interview', icon: <Bot size={18} />, onSelect: () => log.push('mock') },
          ]}
        >
          Create session
        </SplitButton>
      </div>

      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <Input label="Company" placeholder="Company name" hint="The other side's name." />
        <Input label="Bad" defaultValue="x" error="Enter more." />
        <Textarea
          label="Job description"
          value="Hello"
          maxLength={5000}
          counter
          onChange={() => undefined}
        />
        <Select
          label="Language"
          searchable
          searchPlaceholder="Search language"
          options={LANGUAGES.map((value) => ({ value, label: value }))}
          value={language}
          onChange={setLanguage}
          hint="Language of the answers"
        />
        <Select
          label="Model"
          options={[
            { value: 'fast', label: 'Claude Haiku 5.5', tag: 'Recommended' },
            { value: 'smart', label: 'Claude Sonnet 5.5', tag: 'Deeper, slower' },
            { value: 'off', label: 'Turned off', disabled: true },
          ]}
          value="fast"
          onChange={(value) => log.push(`model:${value}`)}
        />
        {resumeSelect}
        <MultiSelect
          label="Documents"
          options={[
            { value: 'a', label: 'Pricing sheet' },
            { value: 'b', label: 'Runbook' },
          ]}
          values={docs}
          onChange={setDocs}
          emptyLabel="No documents yet"
          actions={[{ label: 'Add a document', onSelect: () => log.push('add-doc') }]}
        />
        <MultiSelect
          label="Empty documents"
          options={[]}
          values={[]}
          onChange={() => undefined}
          emptyLabel="No documents yet"
        />
      </div>

      <div className="max-w-xl">
        <SegmentedControl
          label="Session type"
          options={[
            { value: 'interview', label: 'Interview', icon: <Briefcase size={18} /> },
            { value: 'regular', label: 'Regular', icon: <Phone size={18} /> },
            { value: 'mock', label: 'Mock', icon: <Bot size={18} /> },
          ]}
          value={type}
          onChange={setType}
        />
      </div>

      <div className="flex items-start gap-10">
        <Stepper steps={['Details', 'Preferences']} current={stepNo} />
        <Button variant="secondary" onClick={() => setStepNo(1)}>
          Next step
        </Button>
      </div>

      <div className="max-w-md">
        <RadioCards
          label="Length"
          options={[
            { value: 'short', label: 'Short', description: 'Just the essentials.' },
            { value: 'medium', label: 'Balanced', description: 'The answer and useful context.' },
            { value: 'detailed', label: 'Detailed', description: 'More depth and examples.' },
          ]}
          value={length}
          onChange={setLength}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Toggle
          label="Save transcript"
          hint="Keep it on this computer."
          checked={on}
          onChange={setOn}
        />
        <Switch ariaLabel="Bare switch" checked={!on} onChange={(next) => setOn(!next)} />
        <Chip icon={<Briefcase aria-hidden="true" size={14} />}>Interview</Chip>
        <SoonBadge />
        <Tooltip content="Coming soon">
          <Button variant="secondary" disabled>
            Resume Maker
          </Button>
        </Tooltip>
        <KeyCap hotkey="answer" />
        <KeyCap hotkey="screenshot" />
        <KeyCap hotkey="clear-transcript" />
        <KeyCap hotkey="prev" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Menu
          label="Open menu"
          items={[
            { label: 'Edit', onSelect: () => log.push('edit') },
            { label: 'Duplicate', detail: 'Copy', onSelect: () => log.push('duplicate') },
            { divider: true },
            { label: 'Tutorials', soon: true },
            {
              label: 'Theme',
              detail: 'System',
              items: [
                { label: 'Light', onSelect: () => log.push('theme:light') },
                { label: 'Dark', onSelect: () => log.push('theme:dark') },
              ],
            },
            { divider: true },
            { label: 'Delete', danger: true, onSelect: () => log.push('delete') },
          ]}
        />
        <Button variant="secondary" onClick={() => setModal(true)}>
          Open modal
        </Button>
        <Button variant="secondary" onClick={() => setRail(true)}>
          Open rail modal
        </Button>
        <Button variant="secondary" onClick={() => setAside(true)}>
          Open aside modal
        </Button>
      </div>

      <div className="w-80">
        <MenuBlock>
          <MenuAction label="Dashboard" out onSelect={() => log.push('dashboard')} />
          <MenuAction label="Voice profile" soon />
          <MenuSwitch label="Private" info="Hides these windows." checked={on} onChange={setOn} />
          <MenuSwitch label="Meeting detect" soon checked={false} onChange={() => undefined} />
          <MenuStepper
            label="Zoom"
            value="100%"
            onMore={() => log.push('more')}
            onLess={() => log.push('less')}
            onReset={() => log.push('reset')}
          />
          <MenuTheme value={theme} onChange={setTheme} />
        </MenuBlock>
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Plain modal"
        subtitle="With a subtitle."
        footer={
          <Button size="lg" onClick={() => setModal(false)}>
            Done
          </Button>
        }
      >
        <Select
          label="Language in the modal"
          searchable
          options={LANGUAGES.map((value) => ({ value, label: value }))}
          value={language}
          onChange={setLanguage}
        />
      </Modal>
      <Modal
        open={rail}
        onClose={() => setRail(false)}
        title="Create session"
        subtitle="Add the call details."
        width={760}
        height={600}
        fullScreenOnPhone
        closeOnBackdrop={false}
        rail={<Stepper steps={['Details', 'Preferences']} current={0} />}
        footer={
          <>
            <Button variant="ghost" size="lg" onClick={() => setRail(false)}>
              Cancel
            </Button>
            <Button size="lg">Next</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Company in the rail modal" placeholder="Company name" />
          <div className="h-[900px] rounded-card bg-ui-panel p-4">
            A tall block, so the pane scrolls.
          </div>
        </div>
      </Modal>
      <Modal
        open={aside}
        onClose={() => setAside(false)}
        title="Answer preferences"
        subtitle="Choose how answers are shaped."
        width={920}
        height={560}
        aside={<p>The preview goes here.</p>}
      >
        <p>The rows go here.</p>
      </Modal>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Kit />);
(window as unknown as { uiKitReady: boolean }).uiKitReady = true;
