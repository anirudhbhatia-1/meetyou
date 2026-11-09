import {
  AlertDialog,
  Banner,
  Button,
  Card,
  Checkbox,
  ChipGroup,
  CitationChip,
  Icon,
  Menu,
  SearchInput,
  Segmented,
  Sheet,
  SkeletonRows,
  StatusPill,
  Switch,
  TextArea,
  TextInput,
  UnverifiedChip,
  useTheme,
  useToast,
} from '@meetyou/ui';
import { useState, type ReactNode } from 'react';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="catalogue-group">
        <h2 className="card-title">{title}</h2>
        <div className="catalogue-row">{children}</div>
      </div>
    </Card>
  );
}

/**
 * S4-02: every shared component (DESIGN §6) in its states, in light and dark, for the §24 design
 * QA review. Development builds only (`#/catalogue`).
 */
export function Catalogue() {
  const [theme, setTheme] = useTheme();
  const toast = useToast();
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [chip, setChip] = useState<'all' | 'standup'>('all');
  const [on, setOn] = useState(true);
  const [done, setDone] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const [cited, setCited] = useState(false);
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="display">Components</h1>
        <Segmented
          label="Appearance"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>
      <div className="catalogue-band" aria-hidden="true">
        Moonrise #dae2f8 → #d6a4a4
      </div>
      <Group title="6.1 Buttons">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Disabled</Button>
        <Button className="icon-btn round" aria-label="Search">
          <Icon name="search" />
        </Button>
      </Group>
      <Group title="6.2 Segmented · 6.3 Chips · 6.4 Switch · 6.5 Checkbox">
        <Segmented
          label="Example"
          value={seg}
          onChange={setSeg}
          options={[
            { value: 'a', label: 'One click' },
            { value: 'b', label: 'Automatic' },
            { value: 'c', label: 'Off' },
          ]}
        />
        <ChipGroup
          label="Filter"
          value={chip}
          onChange={setChip}
          options={[
            { value: 'all', label: 'All' },
            { value: 'standup', label: 'Standup' },
          ]}
        />
        <Switch label="Example switch" checked={on} onChange={setOn} />
        <Checkbox checked={done} onChange={setDone} />
      </Group>
      <Group title="6.6 Inputs">
        <TextInput placeholder="Text input" aria-label="Text input" />
        <TextInput compact placeholder="Compact" aria-label="Compact input" />
        <SearchInput
          label="Search"
          placeholder="Search meetings"
          value={query}
          onChange={setQuery}
        />
        <TextArea placeholder="Textarea" aria-label="Textarea" />
      </Group>
      <Group title="6.7 Toast · 6.8 Menu · 6.9 Sheet · 6.10 Alert">
        <Button onClick={() => toast({ message: 'Marked done', undo: () => undefined })}>
          Show toast
        </Button>
        <Menu
          label="Example menu"
          trigger="Menu"
          items={[
            { label: 'Rename', onSelect: () => undefined },
            { label: 'Download as .md', onSelect: () => undefined },
            { label: 'Delete meeting…', onSelect: () => undefined, danger: true, separated: true },
          ]}
        />
        <Button onClick={() => setSheet(true)}>Open sheet</Button>
        <Button variant="danger" onClick={() => setAlert(true)}>
          Open alert
        </Button>
      </Group>
      <Group title="6.12 Status · 6.13 Citation · 6.14 Unverified · 6.17 Skeleton">
        <StatusPill status="ready" />
        <StatusPill status="processing" />
        <StatusPill status="updated" />
        <StatusPill status="failed" />
        <CitationChip n={1} selected={cited} onSelect={() => setCited((v) => !v)} />
        <UnverifiedChip />
        <div style={{ width: 200 }}>
          <SkeletonRows rows={2} />
        </div>
      </Group>
      <Group title="6.15 Banners">
        <Banner tone="info" onDismiss={() => undefined}>
          We improved this transcript after the call.
        </Banner>
        <Banner tone="warning">Transcript delayed — catching up.</Banner>
        <Banner tone="error" action={<Button size="sm">Try again</Button>}>
          Something went wrong.
        </Banner>
      </Group>
      {sheet && (
        <Sheet
          title="Share notes"
          onClose={() => setSheet(false)}
          footer={
            <>
              <Button onClick={() => setSheet(false)}>Download file</Button>
              <Button variant="primary" onClick={() => setSheet(false)}>
                Copy
              </Button>
            </>
          }
        >
          <p className="meta">Nothing is sent automatically.</p>
        </Sheet>
      )}
      {alert && (
        <AlertDialog
          title="Delete this meeting?"
          body="Its audio, video, transcript, notes and action items will be removed."
          confirmLabel="Delete"
          failedText="The meeting wasn’t deleted. Try again."
          onCancel={() => setAlert(false)}
          onConfirm={async () => setAlert(false)}
        />
      )}
    </div>
  );
}
