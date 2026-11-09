import { notesFileName, notesText, type Segment } from '@meetyou/contracts';
import { Button, Segmented, Sheet, Switch, useToast } from '@meetyou/ui';
import { useMemo, useState } from 'react';

import type { Meeting, MeetingSummary, Participant } from '../api/types.ts';
import { meetingTitle } from '../lib/format.ts';
import { saveTextFile, toNotesDoc } from '../lib/notes-doc.ts';

/**
 * DESIGN §13.1 share sheet (FR-EXP-01..04): Markdown or plain text, with or without times, a live
 * preview, Copy (primary) and Download file. Nothing is sent anywhere (FR-EXP-04).
 */
export function ShareSheet({
  meeting,
  summary,
  segments,
  people,
  onClose,
}: {
  meeting: Meeting;
  summary: MeetingSummary;
  segments: Segment[];
  people: Participant[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [format, setFormat] = useState<'markdown' | 'text'>('markdown');
  const [includeTimes, setIncludeTimes] = useState(false);
  const text = useMemo(
    () => notesText(toNotesDoc(meeting, summary, segments, people), { format, includeTimes }),
    [meeting, summary, segments, people, format, includeTimes],
  );
  const label = format === 'markdown' ? 'Markdown' : 'plain text';
  return (
    <Sheet
      title="Share notes"
      onClose={onClose}
      footer={
        <>
          <Button
            onClick={() => {
              saveTextFile(
                notesFileName(
                  meetingTitle(meeting),
                  meeting.startedAt,
                  format === 'markdown' ? 'md' : 'txt',
                ),
                text,
                format === 'markdown' ? 'text/markdown' : 'text/plain',
              );
              toast({ message: 'Downloaded' });
            }}
          >
            Download file
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              navigator.clipboard.writeText(text).then(
                () => {
                  toast({ message: `Copied as ${label}` });
                  onClose();
                },
                () => toast({ message: 'Couldn’t copy. Select the text and copy it instead.' }),
              );
            }}
          >
            Copy
          </Button>
        </>
      }
    >
      <p className="meta">
        Nothing is sent automatically. Copy it and paste into Slack, WhatsApp or email.
      </p>
      <div className="share-controls">
        <Segmented
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'markdown', label: 'Markdown' },
            { value: 'text', label: 'Plain text' },
          ]}
        />
        <label className="share-times">
          <Switch compact label="Include times" checked={includeTimes} onChange={setIncludeTimes} />
          Include times
        </label>
      </div>
      <pre className="share-preview" tabIndex={0} aria-label="Preview">
        {text}
      </pre>
    </Sheet>
  );
}
