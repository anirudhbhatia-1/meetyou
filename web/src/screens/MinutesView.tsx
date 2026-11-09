import type { Segment, SummaryItem } from '@meetyou/contracts';

import type { Meeting, MeetingSummary, Participant } from '../api/types.ts';
import { formatDue, formatLength } from '../lib/format.ts';
import { Bullet } from './NotesTab.tsx';

/**
 * Minutes of meeting (template `minutes`): the same grounded notes laid out as formal minutes —
 * details, agenda, summary, discussion, decisions, action items, open questions. Every AI line
 * keeps its citation and inline edit (the Notes bullets); the user's notes head the discussion.
 */
export function MinutesView({
  meeting,
  people,
  summary,
  segments,
  numbers,
  selected,
  onSelect,
  onEdited,
}: {
  meeting: Meeting;
  people: Participant[];
  summary: MeetingSummary;
  segments: Segment[];
  numbers: Map<string, number>;
  selected: SummaryItem | null;
  onSelect: (item: SummaryItem) => void;
  onEdited: () => void;
}) {
  const started = new Date(meeting.startedAt);
  const owner = (id: string | null) => {
    const p = people.find((x) => x.id === id);
    return p === undefined ? 'Unassigned' : p.isSelf ? 'You' : p.displayName;
  };
  const bullet = (item: SummaryItem) => (
    <Bullet
      key={item.id}
      item={item}
      n={numbers.get(item.id)}
      selected={selected?.id === item.id}
      segments={segments}
      onSelect={() => onSelect(item)}
      onEdited={onEdited}
    />
  );
  const discussion = summary.sections.filter((s) => s.note !== null || s.items.length > 0);
  const agenda =
    summary.topics !== undefined && summary.topics.length > 0
      ? summary.topics
      : discussion.map((s) => s.note?.text ?? 'From the conversation');
  const none = <p className="ai-line italic">None recorded.</p>;

  return (
    <div className="mom">
      <p className="overline">Minutes of meeting</p>
      <dl className="mom-details">
        <div>
          <dt>Date</dt>
          <dd>
            {started.toLocaleDateString('en-GB', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">
            {started.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="num">{formatLength(meeting.startedAt, meeting.endedAt)}</dd>
        </div>
        <div className="mom-attendees">
          <dt>Attendees</dt>
          <dd>{[...meeting.participantNames, 'You'].join(', ')}</dd>
        </div>
      </dl>

      {agenda.length > 0 && (
        <section className="note-section">
          <h2 className="note-heading">Agenda</h2>
          <ol className="mom-list">
            {agenda.map((topic, i) => (
              <li key={`${i}-${topic}`}>{topic}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="note-section">
        <h2 className="note-heading">Summary</h2>
        <p className="overview">{summary.overview}</p>
      </section>

      {discussion.length > 0 && (
        <section className="note-section">
          <h2 className="note-heading">Discussion</h2>
          {discussion.map((s, i) => (
            <div key={s.note?.id ?? `topic-${i}`} className="mom-point">
              <h3 className={s.note === null ? 'mom-point-title muted' : 'mom-point-title'}>
                {i + 1}. {s.note?.text ?? 'From the conversation'}
              </h3>
              {s.items.length === 0 ? none : <ul className="bullets">{s.items.map(bullet)}</ul>}
            </div>
          ))}
        </section>
      )}

      <section className="note-section">
        <h2 className="note-heading">Decisions</h2>
        {summary.decisions.length === 0 ? (
          none
        ) : (
          <ol className="bullets decisions">{summary.decisions.map(bullet)}</ol>
        )}
      </section>

      <section className="note-section">
        <h2 className="note-heading">Action items</h2>
        {summary.actionItems.length === 0 ? (
          none
        ) : (
          <div className="mom-table-wrap">
            <table className="mom-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Action</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.actionItems.map((item, i) => (
                  <tr key={item.id}>
                    <td className="num">{i + 1}</td>
                    <td>
                      <ul className="bullets">{bullet(item)}</ul>
                    </td>
                    <td>{owner(item.ownerParticipantId)}</td>
                    <td>{formatDue(item)}</td>
                    <td>{item.status === 'done' ? 'Done' : 'Open'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {summary.questions.length > 0 && (
        <section className="note-section">
          <h2 className="note-heading">Open questions</h2>
          <ol className="bullets questions">{summary.questions.map(bullet)}</ol>
        </section>
      )}
    </div>
  );
}
