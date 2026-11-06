# @meetyou/web — Library web app (D-07)

Home, Meetings, Meeting detail, Action items and Settings ([DESIGN.md](../docs/DESIGN.md) §10–§15),
built with **React + Vite** (decided 2026-11-06). Design sources: DESIGN.md, the Claude Code design
artifact and the handoff files (AGENTS §2); colours, type and radii come only from
`@meetyou/design-tokens`.

```bash
pnpm --filter @meetyou/web dev     # http://127.0.0.1:5173
pnpm --filter @meetyou/web build   # static files in web/dist (hosting: ADR-0006)
```

## Status

- Runs on a **mock API** (`src/api/mock.ts`, synthetic data) with the same shapes as
  `shared/contracts` (S4-01). TODO(S4-14): HTTP client for the S2-09 endpoints and sign-in (S4-03,
  ADR-0004 §4.5).
- Built: shell and sidebar with open-items count; Home (greeting, recent meetings, to-dos); Meetings
  (search with debounce, template chips, table, empty states); Meeting detail (sticky toolbar, Notes
  with legend, anchored sections, decisions, open questions and citation chips; Transcript with
  cited-line highlight; citation card; action items with Undo toast; processing state); Action
  items (Open / Done / All).
- Not yet: regenerate menu, share sheet, more menu, rename (S4-09/S4-10), video player and playback
  (S4-17), speaker rename and transcript search, settings (S4-12), setup card (S4-03), dark mode
  review and accessibility QA (S4-16), component render tests (needs a DOM test library — to be
  proposed).
