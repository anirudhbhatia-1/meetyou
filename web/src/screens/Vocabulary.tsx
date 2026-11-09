import { Banner, Card, Icon } from '@meetyou/ui';
import { useState, type KeyboardEvent } from 'react';

import { useApi } from '../lib/api-context.ts';
import { useAsync } from '../lib/useAsync.ts';

/** Shown as "{n} of {max} words" once the list is this close to the provider's limit. */
const NEAR_LIMIT = 10;

/**
 * DESIGN §15.5 Vocabulary (S3-10): names and words the transcription should spell right. Each
 * change saves the whole list; the API refuses a list the provider cannot take whole.
 */
export function Vocabulary() {
  const api = useApi();
  const loaded = useAsync(() => api.getGlossary(), []);
  const [terms, setTerms] = useState<string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = terms ?? loaded.data?.terms ?? [];
  const max = loaded.data?.maxTerms ?? 50;

  const save = async (next: string[]) => {
    const previous = list;
    setTerms(next);
    setError(null);
    const result = await api
      .saveGlossary(next)
      .catch(() => ({ ok: false, error: 'invalid' }) as const);
    if (result.ok) {
      setTerms(result.terms);
      return;
    }
    setTerms(previous);
    setError(
      result.error === 'too_long'
        ? 'That’s more than we can send with each recording. Remove a few words first.'
        : 'Words can’t contain commas and must be under 100 characters.',
    );
  };

  const add = () => {
    const word = draft.replace(/,/g, ' ').trim();
    if (word === '' || list.some((t) => t.toLowerCase() === word.toLowerCase())) {
      setDraft('');
      return;
    }
    setDraft('');
    void save([...list, word]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
  };

  return (
    <Card>
      <div className="vocab">
        <div>
          <h3 className="setting-title">Vocabulary</h3>
          <p className="meta">Used to improve spelling in future transcripts.</p>
        </div>
        <ul className="vocab-chips" aria-label="Names and words we should spell right">
          {list.map((term) => (
            <li key={term} className="vocab-chip">
              {term}
              <button
                type="button"
                aria-label={`Remove ${term}`}
                onClick={() => void save(list.filter((t) => t !== term))}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
        <input
          className="vocab-input"
          aria-label="Names and words we should spell right"
          placeholder="Names and words we should spell right (e.g. Razorpay, Sameer, INR)"
          value={draft}
          maxLength={100}
          disabled={list.length >= max}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
        {list.length >= max - NEAR_LIMIT && (
          <p className="meta small num">
            {list.length} of {max} words
          </p>
        )}
        {error !== null && <Banner tone="error">{error}</Banner>}
      </div>
    </Card>
  );
}
