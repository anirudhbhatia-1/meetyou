import { Button, useToast } from '@meetyou/ui';
import { useEffect, useState } from 'react';

import type { ExportView } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';

/** How often Settings checks an export that is still preparing. */
const POLL_MS = 4_000;

function readyUntil(expiresAt: string): string {
  return new Date(expiresAt).toLocaleString('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * DESIGN §13.2 "Download all my data" (S3-11, FR-SET-04): starts the export job, tells the user
 * when it is ready, and offers the download for 24 hours. Each click asks for a fresh link, since
 * signed links are short-lived.
 * TODO(S4-12): a browser notification when the page is in the background.
 */
export function DataExport() {
  const api = useApi();
  const toast = useToast();
  const [current, setCurrent] = useState<ExportView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.latestExport().then(
      (e) => live && setCurrent(e),
      () => undefined, // The row simply shows the start button.
    );
    return () => {
      live = false;
    };
  }, [api]);

  const preparing = current?.status === 'preparing';
  useEffect(() => {
    if (!preparing || current === null) return;
    const id = current.id;
    const timer = setInterval(() => {
      api.getExport(id).then(
        (next) => {
          if (next === null || next.status === 'preparing') return;
          setCurrent(next);
          if (next.status === 'ready') toast({ message: 'Your export is ready' });
        },
        () => undefined, // Try again on the next tick.
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, toast, preparing, current]);

  const start = async () => {
    setBusy(true);
    try {
      const next = await api.startExport();
      setCurrent(next);
      if (next.status === 'preparing') {
        toast({ message: 'We’re preparing your download. We’ll let you know when it’s ready.' });
      }
    } catch {
      toast({ message: 'Couldn’t start the export. Try again.' });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (current === null) return;
    let fresh: ExportView | null;
    try {
      fresh = await api.getExport(current.id);
    } catch {
      // A network blip says nothing about the export: keep the row as it is.
      toast({ message: 'Couldn’t get the download link. Try again.' });
      return;
    }
    if (fresh?.status === 'ready' && fresh.downloadUrl !== null) {
      window.location.assign(fresh.downloadUrl);
      return;
    }
    if (fresh?.status === 'ready') {
      toast({ message: 'The download link isn’t available right now. Try again later.' });
      return;
    }
    setCurrent(fresh);
    toast({ message: 'This export has expired. Start a new one.' });
  };

  return (
    <div className="setting-row">
      <div>
        <h3 className="setting-title">Download all my data</h3>
        <p className="meta" role="status">
          {current?.status === 'ready' && current.expiresAt !== null
            ? `Your export is ready · ${current.meetingCount ?? 0} meetings · link works until ${readyUntil(current.expiresAt)}`
            : preparing
              ? 'Preparing your download…'
              : current?.status === 'failed'
                ? 'The last export didn’t finish. Try again.'
                : 'Every meeting’s transcript, notes and summary as JSON and Markdown.'}
        </p>
      </div>
      {current?.status === 'ready' ? (
        <Button variant="primary" onClick={() => void download()}>
          Download
        </Button>
      ) : (
        <Button disabled={busy || preparing} onClick={() => void start()}>
          {preparing ? 'Preparing…' : 'Download all my data'}
        </Button>
      )}
    </div>
  );
}
