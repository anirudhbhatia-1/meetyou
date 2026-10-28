# DESIGN.md — End-to-End UI and UX Specification

| Field | Value |
|---|---|
| Purpose | Single source of truth for every surface, screen, component, state, token, and string of the product UI — mapped to requirements, features, and architecture |
| Status | Draft for implementation. Visual design is high fidelity; items marked **[SPEC]** are specified here but were not built in the prototype |
| Last updated | 2026-10-28 |
| Design source | Handoff package `~/design_handoff_minutes_app/` — `Minutes App v2.dc.html` (clickable prototype), `support.js` (prototype runtime), `DESIGN.md` (handoff spec). This document supersedes the handoff spec for this repository |
| Related | [PRD.md](PRD.md) · [FEATURES.md](FEATURES.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [AGENTS.md](../AGENTS.md) |

> **Rules for builders (human or agent).**
> 1. The prototype HTML is a **reference, not production code**. Rebuild screens in the target stack
>    (TypeScript, Chrome MV3 extension: side panel, content script overlay, extension pages; later a
>    web app — PRD §12.4, ARCHITECTURE §4, ADR-0002). Do not ship prototype markup or `support.js`.
> 2. Requirement IDs (`FR-…`, `UI-…`, `NFR-…`) refer to the PRD; feature IDs (`C4`, `F2`…) to
>    FEATURES.md; `§` numbers without a file name refer to this document.
> 3. "Minutes" is a **working name** (PRD D-09). Keep the product name in one constant.
> 4. Demo content in the prototype (Rahul, Neha, Sameer, "Q4 launch sync", "Vaibhav Sir") is sample
>    data. Real screens show real data; the greeting uses the signed-in user's first name.
> 5. Where this document differs from the handoff spec or prototype, **this document wins**. All
>    differences are listed in §19.

---

## Contents

1. [Design principles](#1-design-principles)
2. [Surfaces and how they map to the architecture](#2-surfaces-and-how-they-map-to-the-architecture)
3. [Information architecture and navigation](#3-information-architecture-and-navigation)
4. [End-to-end journeys](#4-end-to-end-journeys)
5. [Design tokens](#5-design-tokens)
6. [Shared components](#6-shared-components)
7. [Onboarding and sign-in](#7-onboarding-and-sign-in)
8. [In the call: Meet overlay, side panel, recording](#8-in-the-call-meet-overlay-side-panel-recording)
9. [Failure, recovery, and edge states](#9-failure-recovery-and-edge-states)
10. [Home](#10-home)
11. [Meetings library](#11-meetings-library)
12. [Meeting detail](#12-meeting-detail)
13. [Share, export, delete](#13-share-export-delete)
14. [Action items](#14-action-items)
15. [Settings](#15-settings)
16. [Empty, loading, error, offline, dark](#16-empty-loading-error-offline-dark)
17. [Screen → data → API → events map](#17-screen--data--api--events-map)
18. [Front-end state model](#18-front-end-state-model)
19. [Alignment changes and open design decisions](#19-alignment-changes-and-open-design-decisions)
20. [Accessibility](#20-accessibility)
21. [Copy deck and localization](#21-copy-deck-and-localization)
22. [Phase 2 and Phase 3 surfaces](#22-phase-2-and-phase-3-surfaces)
23. [Feature coverage map](#23-feature-coverage-map)
24. [Design QA checklist](#24-design-qa-checklist)

---

## 1. Design principles

1. **You press Start.** Nothing records without an explicit click (FR-DET-03). Every recording state
   is shown in colour **and** text (UI-02).
2. **Your words vs AI words.** User-written text is `ink`, AI-added text is `muted`, and every AI line
   carries a numbered citation chip (UI-01, FR-CIT-01). A legend sits at the top of every summary.
3. **Trust over polish.** Unverified AI content is visibly marked, never dressed up as fact (F4).
4. **Plain language.** Labels say what happens ("Post and start", "Delete meeting…"). Privacy settings
   state their effect in one sentence ("Audio is deleted 7 days after each meeting.").
5. **One accent.** Olive is the only action colour. Ember is reserved for the recording dot. Red is
   only for destructive actions.
6. **Glass only on the floating layer** (Meet prompt, recording pill, sticky toolbar, menus, toasts,
   sheets, alerts) — never on content cards. Solid fallback under reduced transparency (§5.6).
7. **Respect the host page.** Our UI inside Google Meet is minimal, isolated, movable, and never
   covers Meet's own controls (§8.2).
8. **Accessible by default.** WCAG 2.2 AA (§20).

---

## 2. Surfaces and how they map to the architecture

| Surface | Built from (ARCHITECTURE §4.1) | Where it renders | Purpose | Phase |
|---|---|---|---|---|
| **Toolbar icon + badge** | Service worker (`chrome.action`) | Chrome toolbar | Recording state at a glance; opens side panel | 1 |
| **Meet prompt** ("Take notes for this call?") | Content script (Meet adapter), **Shadow DOM** | Over `meet.google.com` | Offer to record when a call is detected (B1) | 1 |
| **Recording pill** | Content script, Shadow DOM | Over Meet, top-left, movable | Shows "Taking notes · mm:ss" / Paused / Reconnecting | 1 |
| **Consent notice** | Content script posts into **Meet's own chat** | Meet chat | Disclosure to participants (C3) — no UI of ours in chat | 1 |
| **Side panel** | Side panel page, **tab-specific** to the Meet tab | Chrome side panel | Live transcript, notes, recording controls, processing, ready | 1 |
| **Onboarding** | Extension page | New tab on install | Sign-in, mic permission, preferences, consent acknowledgement | 1 |
| **Library app** (Home, Meetings, Meeting detail, Action items, Settings) | Extension pages in alpha → web app in beta (D-07) | Full tab | Review, verify, share, manage data | 1 |
| **Chrome notification** | Service worker | OS notification | "Notes ready: {title}" | 1 (needs `notifications` permission — §19) |
| Offscreen document | Offscreen document | — | No UI (capture only) | 1 |
| Desktop window, web sharing pages, admin | Phase 2/3 | — | §22 | 2/3 |

**Implementation notes**
- The side panel is enabled **only for the Meet tab** (`sidePanel.setOptions` per tab), so switching
  tabs does not show a stale panel. Opening it programmatically requires a user gesture — verify
  which clicks qualify in the M1 spike (§19, item 10).
- The library app uses **the same component library** whether it runs as an extension page or a web
  app; only routing and auth bootstrapping differ.
- Content-script UI lives in a **closed Shadow DOM root** with its own styles and fonts so Meet's CSS
  cannot leak in and ours cannot leak out. Text read from Meet's DOM is untrusted and rendered as
  text only (ARCHITECTURE §4.6, §14).

---

## 3. Information architecture and navigation

```
Library app (full tab)
  Sidebar (248px)
  ├─ Home
  ├─ Meetings ──► Meeting detail ──┬─ Notes
  │                                └─ Transcript
  ├─ Action items
  ├─ Settings
  └─ [while recording] "Recording · mm:ss" ──► focuses the Meet tab

Overlays (library): Toast · Share sheet · Alert dialog · Popover menus · Consent-log sheet

In the call (Meet tab)
  Meet prompt ─► Side panel: Ready ─► Consent ─► Recording ⇄ Paused ─► Processing ─► Ready
  Recording pill · Toolbar badge · Chrome notification
```

- Sidebar always visible on ≥ 1100 px; current item highlighted; Meeting detail highlights
  **Meetings**.
- **Back** in Meeting detail returns to Meetings with the previous search and filter intact.
- `Esc` closes any overlay and cancels rename.
- The prototype's "Live side panel" sidebar item is a **preview/tutorial only**. In production it is
  replaced by the "Recording · mm:ss" item (visible only during a recording) plus a "How recording
  works" link in Home's setup card.

---

## 4. End-to-end journeys

Each journey follows PRD §8 and lists the screens involved.

| Journey | Steps → screens |
|---|---|
| **J1 First-time setup** | Install → §7.1 Welcome → Continue with Google → §7.2 Microphone → §7.3 Preferences → §7.4 Consent acknowledgement → §7.5 Done → Home setup card shows 2 of 3 |
| **J2 Recording a meeting** | Join Meet → §8.2 Meet prompt (≤ 5 s) → Start → side panel opens → §8.5 Consent step → Post and start → §8.6 Recording (transcript, notes, pause) |
| **J3 Ending a meeting** | Stop / leave / close tab → §8.7 Processing (3 steps) → Ready → Chrome notification → Open notes |
| **J4 Reviewing and verifying** | §12 Meeting detail → legend → anchored sections → hover chip (popover) → click (citation card) → Play from / Show in transcript → edit / reassign / regenerate |
| **J5 Sharing** | Share → §13.1 sheet → Markdown/Plain, Include times → Copy or Download (nothing sent automatically) |
| **J6 Managing data** | §15.3 Privacy & data → retention, export, sub-processors, delete meeting/account (alerts) |
| **J7 Failure during a meeting** | §9 states: reconnecting, mic lost, lane silent, transcript delayed, error, crash recovery, session limit, second tab |

---

## 5. Design tokens

### 5.1 Colour (light)

| Token | Hex | Use |
|---|---|---|
| `paper` | `#f6f5ef` | Page background |
| `paper-2` | `#fbfaf6` | Sidebar, inset areas, composer |
| `surface` | `#ffffff` | Cards, inputs |
| `ink` | `#11120e` | Primary text, user-written notes |
| `ink-2` | `#2a2b26` | Sidebar idle labels |
| `ink-3` | `#4a4b44` | Secondary body, table cells |
| `muted` | `#6b6b65` | Meta, AI-added text, captions, **interim transcript (italic)** — 5.4:1 on white |
| `hairline` | `#e4e3dc` | Card borders, dividers (decorative) |
| `hairline-2` | `#eeede6` | Row dividers, segmented track |
| `stroke` | `#d6d5cf` | Borders of buttons that carry a text label (decorative) |
| **`control-line`** | `#8a8a83` | **Boundaries that identify a control: text inputs, checkboxes, switch-off track border** — 3.5:1 on white (WCAG 1.4.11) |
| `stroke-off` | `#c9c8c1` | Switch-off track fill (always with `control-line` border), disabled send |
| `olive` | `#566a0a` | Primary fill, selected, links, progress |
| `olive-hover` | `#46570a` | Primary hover |
| `olive-ink` | `#3f4e05` | Text on olive tint, link hover |
| `olive-line` | `#7a8c1f` | Selected outlines, focus ring, highlighted card border |
| `olive-tint` | `#e7ebd2` | Selected nav, chips, "Ready" pill |
| `olive-wash` | `#f3f5e6` | Current setup step, info banners |
| `olive-hl` | `#eef2dc` | Cited transcript line highlight |
| `match-hl` | `#e2e8c4` | Search-match highlight, text selection |
| `ember` / `ember-line` / `ember-halo` | `#e0603f` / `#bd4a30` / `#f9dcd2` | Recording dot only |
| `warn-bg` / `warn-ink` | `#fdeee8` / `#9a3d26` | "Writing notes…", live timer |
| `amber-dot` / `amber-bg` / `amber-ink` | `#d48a1c` / `#fdf3e1` / `#7a4a05` | Degraded states (reconnecting, mic lost) |
| `danger` / `danger-hover` | `#b3412a` / `#9a3522` | Destructive text and buttons, error state |

**Changes from the handoff:** added `control-line` and `match-hl` as named tokens; interim text uses
`muted` italic instead of `#7a7a74` (which is only 4.3:1); the legend's AI swatch uses `muted`
instead of `#9a9a93`; checkbox border uses `control-line` instead of `#a9a9a2` (2.4:1). See §19.

**Status pills (meeting status only):** Recording `warn-bg`/`warn-ink` with ember dot ·
Writing notes… `warn-bg`/`warn-ink` · Ready `olive-tint`/`olive-ink` · Updated `olive-wash`/`olive-ink`
· Failed `#fbe7e2`/`danger` · Too short `hairline-2`/`ink-3`.
**Audio availability** is shown separately as a small meta label ("Audio 5 days left" / "Audio
deleted"), not as a status pill (§19, item 3).

### 5.2 Typography

| Role | Family | Size / line-height | Weight | Tracking |
|---|---|---|---|---|
| Display (page H1) | Newsreader | 50 / 1.05 | 400 | −0.02em |
| Meeting title H1 | Newsreader | 46 / 1.05 | 400 | −0.02em |
| Side-panel H3 | Newsreader | 24–26 | 400 | normal |
| Section H2 | Newsreader | 26 | 400 | normal |
| Note heading H3 | Newsreader | 25 | 400 | normal |
| Card title | Newsreader | 21–24 | 400 | normal |
| Citation quote | Newsreader | 19 / 1.4 | 400 | normal |
| Wordmark | Newsreader | 23 | 400 | −0.01em |
| Body | DM Sans | 15 / 1.55–1.6 | 400 | 0.01em |
| Summary overview | DM Sans | 16 / 1.6 | 400 | 0.01em |
| Live transcript (panel) | DM Sans | 14 / 1.5 | 400 | 0.01em |
| UI label / button | DM Sans | 13–15 | 400–500 | 0.01em |
| Meta / caption | DM Sans | 12–13 | 400 | 0.01em |
| Overline | DM Sans | 11–12 uppercase | 400 | 0.08em |
| Speaker label | DM Sans | 12 | 600 | 0.01em |

- Fonts: Newsreader (`ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,400`) and DM Sans
  (`opsz,wght@9..40,300..600`). **Bundle the font files with the extension** (MV3 pages cannot rely
  on remote stylesheets under a strict CSP); the web app may use Google Fonts.
- Times, durations, counts: `font-variant-numeric: tabular-nums`.
- Devanagari (UI-06): add Noto Sans Devanagari to the DM Sans stack and Noto Serif Devanagari to the
  Newsreader stack. Mixed Roman/Devanagari lines must not clip (test with `हिन्दी` and Hinglish).
- Serif is for display and citation quotes only — never for buttons or labels.

### 5.3 Spacing
Base 4 px. Scale: 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 72, 96.
Page padding 48 horizontal / 48 top / 96 bottom. Card padding 18–28 (summary card 32/36). Section
gap 24–36. Side panel padding 14–18.

### 5.4 Radius
Card 16 · inner card/step 12 · nav item, transcript row, composer input 10 · checkbox 7 · Meet prompt
18 · sheet 22 · alert 20 · menu 14 · menu item 9 · **buttons, pills, chips, switches, search: 999**.

### 5.5 Elevation
Cards: none (1 px `hairline`). Coach-mark tips: `0 8px 32px rgba(0,0,0,.25)`. Glass: §5.6.

### 5.6 Glass (floating layer only)
```
background: rgba(251,250,246,.62);          /* sheets & alerts: .78 */
backdrop-filter: blur(22px) saturate(1.7);
border: 1px solid rgba(255,255,255,.75);
box-shadow: 0 12px 40px rgba(17,18,14,.16), inset 0 1px 0 rgba(255,255,255,.7);
/* over Meet's dark UI: shadow 0 12px 40px rgba(0,0,0,.35) */
/* sticky toolbar: no shadow; border-bottom 1px rgba(17,18,14,.08) */
/* modal scrim: rgba(17,18,14,.28) + blur(3px) */
```
Reduced transparency (`prefers-reduced-transparency: reduce`): background `#fff`, no
`backdrop-filter`, border `#d6d5cf`, scrim without blur. Inside Meet, if blur hurts performance
(measure in M1), fall back to the solid style.

### 5.7 Motion
Hover/fill 150 ms · switch/tab/status 200 ms · progress widths 400 ms · regenerate fade (opacity
→ .35) 300 ms · recording dot pulse 1.6 s (`1 → .35 → 1`), processing dot 1.2 s. No entrance
animations. Everything disabled under `prefers-reduced-motion: reduce`.

### 5.8 Icons
Lucide, stroke 1.7–1.8, 16–18 px, `currentColor`: house, align-left, square-check, settings, search,
x, chevron-left/right, refresh-cw, more-horizontal, shield, download, arrow-up, check, play, pause,
mic, alert-triangle, wifi-off, pencil, star (Phase 2). Bundle as inline SVG.

---

## 6. Shared components

| # | Component | Specification |
|---|---|---|
| 6.1 | **Button** | Primary: `olive` bg, white 500, radius 999, height 36 / 40 / 44 (primary flows), padding 0 16–24, hover `olive-hover`. Secondary: white (or `rgba(255,255,255,.7)` on glass), 1 px `stroke`, `ink`; hover `#f3f2ec`. Ghost: `olive` text, hover `rgba(86,106,10,.08)`. Destructive: `danger` text inline, or filled `danger` in alerts. Icon: 36 px circle, 1 px `stroke`, `aria-label` required. Disabled: opacity .45, `not-allowed`. Focus: `2px solid olive-line`, offset 2, on `:focus-visible` |
| 6.2 | **Segmented control** | Track `hairline-2`, radius 999, padding 3, gap 2. Option height 32–36, 13–14 px. Selected: white, `ink`, `0 1px 3px rgba(0,0,0,.12)`. Idle: transparent, `#5a5b55`. `role="radiogroup"` / `role="radio"` + `aria-checked` |
| 6.3 | **Filter / tag chip** | Height 36 (filters) / 30 (note tags), radius 999. Idle white + `stroke` border. Selected `olive-tint`, `olive-line` border, `olive-ink`. Tag chips `aria-pressed` |
| 6.4 | **Switch** | 50×30 (settings) / 46×28 (sheet), padding 3, `role="switch"` + `aria-checked`. On: `olive` track. Off: `stroke-off` track **with 1 px `control-line` border**. Knob white 24/22 px |
| 6.5 | **Checkbox** | 24×24, radius 7, 1.5 px border. Unchecked: white, `control-line`. Checked: `olive` fill, white check. Done label: line-through + `muted`. `aria-label` "Mark as done" / "Mark as not done" |
| 6.6 | **Text input / textarea / search** | Height 44 (36 compact), radius 10 (search 999), **1 px `control-line` border**, white bg; placeholder `muted`; focus ring as buttons |
| 6.7 | **Toast** (O1) | Glass pill, padding `10 10 10 18`, 14 px, `role="status"`, optional **Undo** (primary, 32 px). Auto-dismiss 2.8 s, 5 s with Undo. One at a time. Library: bottom 28, centred over main (offset by sidebar). Side panel: bottom 16, full width minus 32 |
| 6.8 | **Popover menu** | Under trigger, width 220–250, glass, radius 14, padding 6; items height 40, radius 9; optional helper line; separators; outside click and `Esc` close; arrow keys move focus |
| 6.9 | **Sheet** | Scrim + panel `min(560px,100%)`, glass .78, radius 22, padding 22, gap 16; serif 26 title + round close (32 px). `role="dialog"`, labelled, focus trapped, returns focus to trigger |
| 6.10 | **Alert dialog** | Panel `min(380px,100%)`, radius 20, centred; serif 24 title; body 14 `ink-3`; equal **Cancel** (secondary) and destructive (filled `danger`). `role="alertdialog"`; initial focus on **Cancel** |
| 6.11 | **Card** | White, 1 px `hairline`, radius 16, no shadow; highlight variant border `olive-line` |
| 6.12 | **Status pill** | 12 px, padding `3 10`, radius 999, colours per §5.1 |
| 6.13 | **Citation chip** | Inline after AI text: 11 px, line-height 18, padding `0 7`, radius 999. Idle `olive-tint`/`olive-ink`; selected `olive`/white. `aria-label="Show source {n}"`. Min hit area 24×24 (padding via pseudo-element) |
| 6.14 | **Unverified chip** [SPEC] | `warn-bg`/`warn-ink`, ⚠ + "Not found in the transcript"; replaces the citation chip |
| 6.15 | **Banner** [SPEC] | Inline, radius 12, padding 12/16, icon + text + optional action + dismiss. Info `olive-wash`; warning `amber-bg`/`amber-ink`; error `#fbe7e2`/`danger` |
| 6.16 | **Level meter** [SPEC] | 4 px bars, `olive` on `stroke-off`, labelled "You" / "Meet tab"; `aria-hidden` (state also given as text) |
| 6.17 | **Skeleton row** [SPEC] | `hairline-2` bars, radius 6; no shimmer under reduced motion |
| 6.18 | **Coach-mark tip** | Tutorial only: dark (`ink`/`paper`) or white over Meet; radius 12; numbered 22 px circle; `pointer-events: none` |

---

## 7. Onboarding and sign-in

**[SPEC]** Full-page extension page that opens on install. Centred column, max width 560, `paper`
bg, progress dots (4) at top. Target: under 60 seconds (FEATURES A3).

### 7.1 Welcome (A1)
- H1 "Nothing joins your call."
- Body: "Minutes listens from inside Chrome. It records two lanes — your microphone and the Meet tab
  — and turns them into a transcript and notes."
- Three rows (icon + title + line): *Me — your microphone* · *Them — the Meet tab* ·
  *Never used for training*.
- Primary **Continue with Google** (Google mark per Google brand guidelines). Footnote "Only your name
  and email." (scopes `openid email profile` only — FR-ONB-02).
- Errors: "Sign-in didn't finish. Try again." with retry.

### 7.2 Microphone (FR-ONB-03)
- Card: mic icon, "Allow microphone", "Chrome can only ask on this page."
- Primary **Allow microphone** → calls `getUserMedia` on this visible page (the offscreen document
  cannot prompt).
- Granted: green-olive check + "Microphone ready" + auto-advance.
- Denied: "Microphone blocked — you can still record the other side of the call." · link
  "How to turn it on" · secondary **Record 'them' only** (continues; Home setup step 2 stays open).

### 7.3 Preferences (FR-ONB-04) — skippable via "Use defaults"
| Setting | Control | Default |
|---|---|---|
| What people speak | Segmented Auto · English · Hindi · Hinglish | Auto |
| Write my notes in | Segmented English · हिन्दी · Hinglish | English |
| Keep meeting audio | Segmented Delete after notes · 7 days · 30 days | **7 days** (D-02) |
| Tell people in Meet chat | Segmented One click · Automatic · Off | **One click** (FR-CON-01) |

### 7.4 Consent acknowledgement (FR-ONB-06)
Checkbox (required before first recording): "I'll tell people when I'm taking notes, and get consent
where required." + link to a short explainer. **Continue** disabled until checked.

### 7.5 Done
"Join a Google Meet call and press Start." · 3-step illustration (join → Start → notes) ·
**Close this tab**.

---

## 8. In the call: Meet overlay, side panel, recording

### 8.1 Recording state machine (shared by badge, prompt, pill, panel — C2, ARCHITECTURE §4.3)
```
idle ──Start──► starting ──► consent* ──Post and start / Skip──► recording ⇄ paused
  ▲                │                                               │   │
  │                └──error──► error                reconnecting ◄─┘   │ Stop / leave / tab closed
  │                                                                    ▼
  └────────────── ready ◄──────── processing ◄──────────────── stopping
* consent step shown when "Tell people in Meet chat" is One click; Automatic posts without the step;
  Off skips it.
```
Rules: one active recording (FR-REC-07); paused sends and stores nothing (FR-REC-03); 4 h limit with
warning at 3:45 (FR-REC-08); leaving the call or closing the tab = Stop (FR-REC-06); the state lives in
the service worker (persisted in `chrome.storage.session`) and every surface subscribes to it.

### 8.2 Meet prompt (B1, FR-DET-01..02)
- Rendered by the content script in Shadow DOM, absolute **top 18 / right 18** of the Meet viewport,
  width `min(300px, calc(100% − 36px))`, glass, radius 18, padding 16, gap 12. Must not overlap
  Meet's own controls or participant panel; if Meet's right-hand panel is open, shift left of it.
- Brand tile 26 px + "Take notes for this call?" (14/600).
- Body: "Nothing joins the call. Recording starts only when you press Start." (13, `#3a3b35`).
- **Start** (primary, flex 1, 40 px) · **Not now** (secondary on glass). "Not now" hides it for this
  call; the toolbar icon still starts recording.
- Appears ≤ 5 s after joining, never in the lobby or on the Meet home page. Hidden when the setting
  "Offer to take notes when I join a call" is off.
- Keyboard: focusable, `Esc` = Not now. Announced via `aria-live="polite"` once.

### 8.3 Toolbar badge
Idle: no badge. Recording: ember dot badge, tooltip "Minutes — taking notes {mm:ss}". Paused: grey
"II". Reconnecting: amber "!". Error: red "!". Click opens the side panel on the Meet tab.

### 8.4 Recording pill (over Meet)
- Glass pill top-left: 9 px ember dot (pulsing) + "Taking notes" + `mm:ss`. Paused: white dot, no
  pulse, "Paused". Reconnecting: amber dot, "Reconnecting — audio saved".
- **Draggable** to any corner; position remembered per user. Collapsible to just the dot.
- Click → focuses the side panel.
- Production does **not** restyle Meet's own tiles (the prototype's active-speaker ring on tiles is
  illustrative only — §19, item 9). Active speaker is shown in the panel transcript.

### 8.5 Side panel — Ready and Consent
Panel width: Chrome side panels are user-resizable; design for **320–480 px** (prototype 360–380).

**Header** (padding 14/16, bottom border): status dot + label (Not recording / About to start /
Recording / Paused / Reconnecting / Finishing up / Done) + timer · actions (§8.6) · overflow menu
(… → *Stop and delete this recording…*, *Consent log* after the call).

**Ready (idle):** H3 "Ready when you are" · "Your mic and the Meet tab are recorded as two separate
lanes, so you're always labelled correctly." · **Start taking notes** (primary 44 px).

**Consent step (C3, FR-CON-01..02):** H3 "Let everyone know?" · "We'll post this in Meet chat. You can
edit it first." · textarea (min-height 110, radius 12, `paper-2`, `control-line` border), prefilled:
> Hi all — I'm using Minutes to take notes on this call. Batayein agar aap comfortable nahi hain.

**Post and start** (primary) · **Skip** (secondary) · footnote "You're responsible for getting
consent where the law requires it."
- On success: toast "Posted in Meet chat"; consent log entry written.
- On DOM posting failure: banner "Couldn't post — copy this message" + **Copy** button; recording
  continues; log records "Note posted: No (failed)".

### 8.6 Side panel — Recording (D1, E1, E2)
- **Header actions:** **Pause/Resume** (secondary) · **Stop** (primary).
- **Lane health row [SPEC] (C1, FR-LIV-07):** two level meters "You" and "Meet tab" + connection text
  "Good connection" / "Slow" (amber) / "Offline" (red).
- **Tabs** (segmented, full width): Transcript · My notes · {count}.
- **Transcript list:**
  - Line: speaker (12/600; "You" in `olive`, others `ink`) + time (`muted`, tabular) + text 14/1.5.
  - **Interim** text (from `transcript.interim`) shows in `muted` italic and is replaced in place by
    the final segment (`transcript.segment`) in `ink` (FR-LIV-02).
  - **Script consistency:** if the provider's interim text arrives in Devanagari while finals are
    Roman (e.g. Sarvam `translit` mode — STT_PREFLIGHT §2.2), transliterate interim text to Roman
    on the client before display, so lines never flip script.
  - Unknown remote speakers show as "Speaker 1, 2…" until named (D5).
  - Empty: "Listening… the transcript appears as people speak."
  - Paused marker pill: "Paused — nothing is being recorded".
  - When the user scrolls up: glass pill "↓ Jump to live" bottom-centre (FR-LIV-04) [SPEC].
- **My notes list:** time (11, tabular, 38 px column) + tag (11/600 `olive`, e.g. DECISION) + text 14 +
  delete (28 px round ×, `aria-label="Delete note"`). Empty: "No notes yet. Type a few words below
  when something matters — each note becomes a heading in your summary."
- **Composer** (`paper-2`, top border): tag chips **Note · Decision · Action · Question** (single
  select, default Note) · input (44 px, radius 10, placeholder "Type a note and press Enter",
  `aria-label="New note"`) · 44 px send (olive with text, `stroke-off` empty).
  - Enter/send adds the note stamped with **session time** (ARCHITECTURE §5.5) and switches to My
    notes.
  - Typed prefixes `DECISION:`, `ACTION:`, `QUESTION:`, `IMPORTANT:` are recognised and converted to
    tags (FR-NOTE-03). Hinglish aliases are an open decision (§19, item 15).
  - Notes autosave every 2 s, are kept in IndexedDB while offline, and sync when back (FR-NOTE-01/05).
- Tutorial tip (first recording only): "Pick a tag, type a few words, press Enter. When you're done,
  press Stop."

### 8.7 Side panel — Processing and Ready (F1, NFR-PERF-03)
- **Processing:** H3 "Writing your notes…" + three steps whose 22 px circles fill in turn, mapped to
  pipeline jobs (ARCHITECTURE §9.2):
  1. *Finishing the transcript* → `finalize_transcript`
  2. *Finding decisions and to-dos* → `summarize`
  3. *Linking every point to what was said* → `validate_citations_and_owners`
  Progress comes from the meeting's processing step (§19, item 4). Target ≤ 60 s P95. The user may
  close the panel; a notification arrives when ready.
- **Ready:** 44 px `olive-tint` check · H3 "Your notes are ready" · "{mm:ss} recorded · {n} notes ·
  {m} action items" · **Open notes** (primary) → Meeting detail in the library tab. Chrome
  notification "Notes ready: {title}".
- **Too short** (< 2 min or < 50 words — FR-PROC-05): "Too short for a summary — here's the
  transcript." · **Open transcript**.
- **Failed:** "We couldn't write notes for this meeting." · **Try again** · "The transcript is saved."

---

## 9. Failure, recovery, and edge states

All states use colour **and** text (UI-02). Amber = degraded, red = stopped.

| State | Panel header | Recording pill | Body / action | Requirement |
|---|---|---|---|---|
| **Reconnecting** | amber dot + "Reconnecting" | "Reconnecting — audio saved" | Warning banner: "Your connection dropped. Audio is being saved on this computer and will upload when you're back online." | C4, FR-CAP-07 |
| **Back online** | normal | normal | Toast "Back online — catching up" (once) | C4 |
| **Mic lost** | amber + "Your mic stopped" | unchanged | Banner: "We can't hear your microphone. The rest of the call is still being recorded." + **Choose microphone** | FR-CAP-10 |
| **Meet tab silent ≥ 15 s** (while mic has signal) | — | — | Banner: "No sound from the Meet tab. Is the call muted?" | FR-CAP-10 |
| **Transcript delayed** (STT degraded) | amber + "Recording — transcript delayed" | unchanged | "We're still recording. The transcript will appear after the call." | NFR-REL-05 |
| **Consent post failed** | — | — | §8.5 failure banner | FR-CON-01 |
| **Error** | red + "Recording stopped" | red pill | "Something went wrong and recording stopped at {mm:ss}. Your audio so far is safe." **Start again** · **Get help** | NFR-REL |
| **Crash recovery** (next launch) | — | — | Library top banner: "A recording from {time} didn't finish. Recover it?" **Recover meeting** · **Discard** | FR-CAP-08 |
| **Session limit** | — | — | At 3:45:00 toast "Recording will stop in 15 minutes (4-hour limit)." | FR-REC-08 |
| **Second Meet tab** | — | — | Alert "You're already recording another call" · Cancel · **Stop that one and start here** | FR-REC-07 |
| **Stop and delete** | — | — | Alert "Stop and delete?" / "Recording stops and everything from this call is deleted. Use this if someone doesn't want to be recorded." · Cancel · **Stop and delete** | FR-CON-04 |
| **Signed out / token expired** | — | — | Panel: "Sign in again to keep your notes" · **Sign in** (recording keeps buffering locally) | ARCHITECTURE §13 |
| **Mic denied at start** | — | — | "Recording the Meet tab only. Turn on your mic to include your voice." · link | FR-ONB-03 |

---

## 10. Home

Purpose: orientation — finish setup, return to recent meetings, see my to-dos.
Layout: column, gap 36, max width 1080.

1. **Header:** date (13 `muted`, "Tuesday, 28 October"); H1 "Good {morning|afternoon|evening},
   {first name}" (morning < 12:00, afternoon < 17:00, else evening; user's time zone).
2. **Recovery banner** if any (§9).
3. **Setup card** (A3): H2 "Get set up in three steps" (→ "You're all set"), "{n} of 3 done",
   160×4 progress bar. Step tiles (`repeat(auto-fit,minmax(220px,1fr))`, gap 14, radius 12, padding 18):
   1. *Sign in with Google* — "Only your name and email. We don't read your calendar or Gmail."
   2. *Allow your microphone* — "So your own voice is in the notes, labelled as you."
   3. *Record your first meeting* — "Join any Google Meet call and press Start in the small prompt at
      the top right." + **How recording works** (opens the tutorial preview).
   Marker 26 px: done = olive fill + ✓; pending = olive outline + number. First incomplete step is
   "current" (`olive-line` border, `olive-wash` bg, shows CTA). Step 3 completes after the first
   recording reaches Ready. The card hides permanently 7 days after completion.
4. **Two columns** (`1.4fr / 1fr`, gap 28):
   - **Recent meetings:** H2 + "See all" → Meetings. 4 rows: title 15/500, status pill, meta
     "When · Length · People" 13 `muted`. Hover `#fafaf5`. Click → detail.
   - **Your to-dos:** H2 + "See all" → Action items. Up to 4 open items owned by the user: checkbox +
     text 14 + "{due} · from {meeting}" 12 `muted`. Empty: "You're all caught up."

---

## 11. Meetings library (H1, H2, FR-LIB-01..03)

1. Header: H1 "Meetings" + search (340 × 44, radius 999, `control-line`, icon left 14, placeholder
   "Search words, people, or decisions", `aria-label="Search meetings"`, clear button when non-empty).
2. Filter chips (single-select): All · General · Client call · Standup · Interview · 1:1.
3. Table card: header row (12 uppercase `muted`, .04em) Meeting · When · Length · Status; columns
   `minmax(0,1fr) 130px 90px 120px`, gap 16, padding 12/20. Row: title 15/500 + "{people} ·
   {template}" 13 `muted`; When 14 `ink-3`; Length tabular; Status pill; audio meta label under
   status when relevant. Rows are buttons. Newest first; paginate/infinite scroll at 50.
4. Empty search: "No meetings match "{query}"." + **Clear search**.
5. Search covers titles, people, templates, notes, summaries, and transcripts via Postgres FTS
   (ARCHITECTURE §11.5); Hinglish spelling normalized; script-insensitive search is P2 (ML-07).
   Results < 1 s (FR-LIB-03). Debounce 250 ms.
6. Rows in status **Recording** show a live dot and open the Meet tab instead of the detail.

---

## 12. Meeting detail (FR-LIB-02, F1–F4, F10)

### 12.1 Sticky glass toolbar
Padding `10 32`, glass (no shadow), bottom border. Left → right: **‹ Meetings** (ghost) · centred
title (14/500, ellipsis) · **Template** button (secondary, refresh icon + current template) → §12.2 ·
**Share** (primary) → §13.1 · **More** (round, "More actions") → Rename · Download as .md · Consent log
· — · Delete meeting… (danger).

### 12.2 Regenerate menu (F5, F6, FR-SUM-07)
Helper "Rewrite these notes as…" · General · Standup · Client call · Interview · 1:1 (✓ current).
On pick: summary card fades to 35 % while the job runs; when the new version returns, show an inline
banner **"New version ready · Keep · Go back"** — the previous version stays until the user chooses
(FR-SUM-07). User-edited items are preserved where possible (FR-SUM-08). Toast "Rewritten as {T}
notes" after Keep. Output language changes in Settings apply on the next regenerate.

### 12.3 Header and tabs
- Meta: "{When} · {Length} · {People} and you" + audio label ("Audio 5 days left" / "Audio deleted").
- H1 title (46). Double-click or More → Rename = inline input (same type, bottom border 1.5 px
  `olive-line`); Enter/blur saves (toast "Renamed"), `Esc` cancels. `aria-label="Meeting name"`.
- **Processing** status: replaces content with a centred card — pulsing olive dot, "Writing your
  notes…", "This usually takes under a minute. You can leave this page — we'll let you know when
  they're ready."
- **Improved transcript banner** (D2, after batch pass) [SPEC]: `olive-wash` — "We improved this
  transcript after the call. Your notes were updated to match." · **See what changed** · ×.
- **Tabs:** Notes · Transcript (44 px, 15 px; selected `ink` + 2 px olive underline).
- Content grid: `1.55fr / 1fr`, gap 28, `align-items: start`.

### 12.4 Notes tab (left card, padding 32/36, gap 26)
1. **Legend** (12 `muted`): `ink` swatch "You wrote this" · `muted` swatch "Added from the
   conversation" · chip "1" "Click to see who said it".
2. **Overview** 16/1.6 `muted` (2–4 sentences, FR-SUM-01), in the output language.
3. **Anchored sections** (F2) — one per user note, in note order:
   - H3 = the note **verbatim** (`ink`, serif 25) + "your note · 23:07" (12 `muted`, tabular).
   - Bullets: en-dash `#c1c1ba` + AI text (15/1.6 `muted`) + citation chip(s).
   - No supporting transcript: italic bullet "Nothing in the conversation matched this note yet."
     (no chip).
   - Without user notes: topic sections whose meta reads "added from the conversation" (FR-SUM-04).
4. **Decisions** [SPEC] (F3): serif H3; bullets with ✓ `olive` marker; each cited; only explicit
   agreement (AI-06).
5. **Open questions** [SPEC]: bullets with "?" marker; cited.
6. **Unverified items** [SPEC] (FR-SUM-02, FR-CIT-04): `muted` italic + unverified chip (§6.14);
   never a citation chip.
7. **Inline edit** [SPEC] (FR-SUM-08): hover an AI bullet → pencil; edit in place; saved items show a
   small "edited" label.
8. **Feedback** [SPEC] (FR-SUM-09): "Were these notes useful?" **Yes** / **No** (secondary, 32 px);
   No opens an optional comment field. Per-action-item Yes/No on hover.

### 12.5 Transcript tab (D6)
- Rows: grid `56px 1fr`, gap 12, padding 10/12, radius 10. Time (12 `muted`, tabular) · speaker
  (12/600; You = `olive`) · text 15/1.55. Lines cited by the selected citation: `olive-hl` (200 ms).
- **Speaker rename** [SPEC] (D5, FR-SPK-05): speaker label is a button → popover "Who is Speaker 3?"
  with participant suggestions from Meet + free text + **Apply to whole meeting**. Toast "Renamed
  Speaker 3 to Sameer K. everywhere." Never stores voiceprints (FR-SPK-06).
- **Search in transcript** [SPEC]: 36 px field at top; matches highlighted `match-hl`; "3 of 12" + ↑↓.
- **Echo-flagged lines** (ARCHITECTURE §8.1): hidden by default; "Show 2 possible echo lines" toggle
  reveals them in `muted` with a small "possible echo" label.
- Click a line → plays audio from that point (if retained) and highlights it while playing.
- Read-only in Phase 1; editing is Phase 2 (D6).

### 12.6 Right rail (sticky top 76)
**Citation popover and card** (F4, F10)
- **Hover/focus** a chip → popover within 200 ms with speaker + quote + time (FR-CIT-02).
- **Click** a chip → pins it in the citation card (border `olive-line`, radius 16, padding 20):
  filled chip + "Where this came from · {time range}" · one block per cited segment (speaker 12/600 +
  serif 19 quote in curly quotes) · **▶ Play from {mm:ss}** (toggles to **❚❚ Pause**, 3 px progress
  bar) · **Show in transcript** (ghost; switches tab and highlights).
- Footer: "Audio available for {n} more days" / "Audio was deleted after notes were written." If
  deleted, Play is disabled with the footer text as its description (no error toast).
- Chip numbers are per-summary display indices; each maps to one or more segment IDs from the
  summary payload (ARCHITECTURE §10). Audio uses a short-lived signed URL (SEC-04).

**Action items card:** serif 21 "Action items"; rows = checkbox + task 14 + "{owner} · {due}" 12
`muted`. Owner and due are tappable [SPEC] → popover pickers (owners = participants + Unassigned,
FR-SUM-03). Due shows the resolved date; if the meeting only gave a vague phrase ("this week"), show
the phrase as said.

---

## 13. Share, export, delete

### 13.1 Share sheet (G1, FR-EXP-01..04)
Title "Share notes" · "Nothing is sent automatically. Copy it and paste into Slack, WhatsApp or
email." · format segmented **Markdown / Plain text** · switch **Include times** · live preview
(`pre`, DM Sans 13/1.55, wrap, max-height 260, radius 14).
```
# {Title}                      (plain text: TITLE IN CAPS)
{When} · {Length}

## Summary
{overview}

## {Note heading}
- {AI bullet} [23:05]          (times only with "Include times")

## Decisions
- {decision} [23:10]

## Action items
- [ ] {task} — {owner}, {due}  (plain text: "- " prefix; [x] when done)

## Open questions
- {question}
```
Unverified items are excluded unless the user edited them. **Download file** (secondary; `.md`
named from the slugified title) · **Copy** (primary; clipboard, closes, toast "Copied as Markdown" /
"Copied as plain text"). Formatting must survive paste into Slack, WhatsApp, Gmail, and Notion.

### 13.2 Export
- More → **Download as .md**: same text as the share preview.
- Settings → **Download all my data** (FR-SET-04): starts an export job → toast "We're preparing your
  download. We'll let you know when it's ready." → notification + Settings row "Your export is ready
  · Download" (link valid 24 h). JSON + Markdown archive.

### 13.3 Delete meeting (FR-SET-02)
More → **Delete meeting…** → alert "Delete this meeting?" / "Its audio, transcript, notes and action
items will be removed. You can undo for a few seconds." · Cancel · **Delete** → back to Meetings, row
removed, toast "Meeting deleted" + **Undo** (5 s). The server holds a short grace period before the
deletion job runs (§19, item 5).

### 13.4 Consent log sheet [SPEC] (FR-CON-03)
Sheet "Consent log": time · mode (One click / Automatic / Off) · "Note posted: Yes / No / Failed" ·
text sent · **Export** (.txt). Read-only.

---

## 14. Action items

> Pulled forward from Phase 2 (H4) in the prototype; requires a small data-model addition (§19,
> item 2).

- H1 "Action items" + "Everything people agreed to do, from all your meetings. Tick it off when it's
  done."
- Segmented **Open / Done / All** (default Open).
- Rows (padding 16/20): checkbox 24 · task 15 · link "{owner} · from {meeting}" (13 `muted` → hover
  `olive`; opens the meeting) · due (13 `ink-3`, tabular, right).
- Check → toast "Marked done" + Undo. Empty: Open "Nothing left to do. Nice." · Done "Nothing ticked
  off yet."
- Sidebar count = open items owned by anyone in the user's meetings; Home "Your to-dos" = open items
  owned by the user.

---

## 15. Settings (A4, FR-SET-01..06)

Inset-list pattern: overline label above a white radius-16 card; rows min-height 56–60, padding
14/20, dividers `hairline-2`. Every change saves immediately (PATCH) with a quiet "Saved" toast only
on failure-recovery.

### 15.1 Recording
| Row | Helper | Default |
|---|---|---|
| Offer to take notes when I join a call | A small prompt appears in Meet. Recording never starts on its own. | On |
| Tell people in Meet chat | Segmented One click · Automatic · Off. **Off asks for confirmation** ("Are you sure? People won't be told notes are being taken.") | One click (FR-CON-01) |
| Consent message | Editable default text (English + Hinglish), "Reset to default" | Default text §8.5 |
| Pause my mic when I'm muted in Meet | Side comments stay off the record. | On (FR-CAP-11) |

### 15.2 Language (ML-01, ML-03, ML-05, F7)
- **What people speak:** Auto · English · Hindi · Hinglish (Auto).
- **Write my notes in:** English · हिन्दी · Hinglish (English) — applies to new meetings and on
  regenerate.
- **Show Hindi as** [SPEC, P1]: Roman (default, D-01) · Devanagari.

### 15.3 Privacy & data (L1–L3)
- **Keep meeting audio:** Delete after notes · **7 days** · 30 days, with an `olive` effect sentence:
  - 7/30: "Audio is deleted {n} days after each meeting. Notes and transcripts stay until you delete
    them."
  - Delete after notes: "Audio is deleted as soon as your notes are ready. You won't be able to replay
    quotes."
  Updates the sidebar privacy card and citation footers.
- **Download all my data** · ".json + .md" · download icon (§13.2).
- **Who processes my data** · "{n} providers · none train on it" · expands: Speech to text — {vendor
  once D-03 closes} · Writing summaries — {vendor once D-04 closes} · Hosting & storage — Google Cloud,
  Mumbai (ADR-0002); each "Never trains" in `olive` (FR-SET-06).
- **Product analytics** switch [SPEC]: "Share anonymous usage counts (never meeting content)" — On,
  can be turned off (PRD §19.6).
- **Delete my account and all data…** (danger) → alert "Delete your account?" / "Every meeting, note
  and recording will be permanently deleted within 30 days. This can't be undone." · Cancel · Delete
  account.

### 15.4 Notes & templates [SPEC]
Default template (General) · marker words (DECISION, ACTION, QUESTION, IMPORTANT + Hinglish aliases
once decided).

### 15.5 Vocabulary [SPEC] (D4)
Chip input "Names and words we should spell right" (e.g. Razorpay, Sameer, INR); removable chips;
helper "Used to improve spelling in future transcripts." Limit shown when near the provider's term
limit.

### 15.6 Account
Name, email (read-only), Sign out.

**Appearance:** follows system light/dark (UI-03); no in-app toggle in Phase 1.

---

## 16. Empty, loading, error, offline, dark

| Case | Design |
|---|---|
| Library empty | H2 "No meetings yet" · "Join a Google Meet call and press Start. Your notes will appear here." · **How recording works** |
| Loading lists | 3 skeleton rows (§6.17) |
| Loading detail | Skeleton title + 2 sections + rail card |
| Processing failed | Card "We couldn't write notes for this meeting." · **Try again** · transcript still available |
| Library offline | Top banner "You're offline. Showing meetings saved on this computer." Actions that need the server are disabled with a tooltip |
| API error (generic) | Inline banner "Something went wrong. Try again." with retry; never a blank screen |

**Dark appearance [SPEC] (UI-03):** paper `#141511`, paper-2 `#1a1b16`, surface `#1f201b`, ink
`#f2f1ea`, muted `#a5a59d`, hairline `#2e2f28`, stroke `#3a3b34`, control-line `#77776f`, olive fills
`#8aa12a` with `#11120e` text, olive-tint `#2a3112`, olive-ink `#d6e3a0`, glass `rgba(31,32,27,.6)`
with edge `rgba(255,255,255,.08)`. Verify every text pair ≥ 4.5:1 and control boundaries ≥ 3:1.
The Meet overlay always uses the light glass (Meet's UI is dark).

---

## 17. Screen → data → API → events map

| Screen / element | Data (PRD §13) | API (ARCHITECTURE §12) | Realtime / local |
|---|---|---|---|
| Onboarding sign-in | users, workspaces | `POST /v1/auth/google` | Tokens per ARCHITECTURE §13 |
| Onboarding preferences, consent ack | user_settings | `PATCH /v1/settings` | — |
| Meet prompt | — | — | Content script detector → service worker |
| Start recording | meetings, sessions | `POST /v1/sessions` | Stream token → WSS `hello`/`ready` |
| Consent step | consent_logs | (written by gateway/API on `event`) | Content script `chatNotice` result |
| Live transcript | transcript_segments | — | WSS `transcript.interim`, `transcript.segment`, `speaker.update` |
| Lane health | — | — | Local AudioWorklet levels + WSS `health` |
| My notes / composer | notes | `PUT /v1/meetings/{id}/notes` (debounced 2 s) | IndexedDB `notes_drafts` |
| Pause / Resume / Stop | sessions | `POST /v1/sessions/{id}/end` on Stop | WSS `control` |
| Processing steps | meetings (status, processing_step) | SSE `GET /v1/meetings/{id}/events` (fallback: poll `GET /v1/meetings/{id}`) | — |
| Notification "Notes ready" | — | — | Service worker `notifications` |
| Home recent / Meetings list | meetings | `GET /v1/meetings?cursor=&template=` | — |
| Search | segments, notes, summary_items | `GET /v1/search?q=` | — |
| Meeting detail header, rename | meetings | `GET/PATCH /v1/meetings/{id}` | — |
| Notes tab | summaries, summary_items, citations | `GET /v1/meetings/{id}/summary` | — |
| Regenerate | summaries (versioned) | `POST /v1/meetings/{id}/summary:regenerate` | Poll/SSE for new version |
| Inline edit, owner/due pickers | summary_items | `PATCH /v1/summary-items/{id}` | — |
| Feedback | feedback | `POST /v1/feedback` | — |
| Transcript tab | transcript_segments, speaker_clusters | `GET /v1/meetings/{id}/segments` | — |
| Speaker rename | speaker_clusters, participants | `PATCH /v1/meetings/{id}/speakers/{clusterId}` | — |
| Citation play | audio_assets | `GET /v1/meetings/{id}/audio` (signed URL) | — |
| Consent log sheet | consent_logs | `GET /v1/meetings/{id}/consent-log` | — |
| Share / Download .md | summary payload | none (client-side) | Clipboard |
| Delete meeting + Undo | meetings.deleted_at, deletion_requests | `DELETE /v1/meetings/{id}` + `POST /v1/meetings/{id}:restore` | — |
| Action items page, to-dos | summary_items (action_item: status, completed_at) | `GET /v1/action-items?status=&owner=` + `PATCH /v1/summary-items/{id}` | — |
| Settings | user_settings | `GET/PATCH /v1/settings` | — |
| Vocabulary | glossary_terms | `GET/PUT /v1/glossary` | — |
| Export all | exports | `POST /v1/exports`, `GET /v1/exports/{id}` | Notification when ready |
| Delete account | deletion_requests | `POST /v1/account:delete` | — |
| Crash recovery | sessions | `POST /v1/sessions/{id}/recover` | IndexedDB `audio_buffer` |
| Sub-processor list | static config | — | — |

---

## 18. Front-end state model

```ts
// Shared session state (service worker → badge, content script, side panel)
type RecordingState =
  | 'idle' | 'starting' | 'consent' | 'recording' | 'paused'
  | 'reconnecting' | 'stopping' | 'processing' | 'ready' | 'too_short' | 'error';

interface SessionState {
  state: RecordingState;
  sessionId?: string; meetingId?: string; tabId?: number;
  startedAt?: number; elapsedMs: number; pausedIntervals: Array<[number, number]>;
  lanes: { me: LaneHealth; them: LaneHealth }; connection: 'good' | 'slow' | 'offline';
  processingStep?: 0 | 1 | 2 | 3;            // §8.7
  consent: { mode: 'one_click' | 'automatic' | 'off'; posted?: boolean; failed?: boolean };
  error?: { code: string; retryable: boolean };
}
type LaneHealth = { level: number; silentForMs: number; available: boolean };

// Library app
type Screen = 'home' | 'meetings' | 'detail' | 'actions' | 'settings';
type MeetingStatus = 'recording' | 'processing' | 'ready' | 'updated' | 'failed' | 'too_short';

interface LibraryUIState {
  screen: Screen; meetingId?: string;
  detailTab: 'notes' | 'transcript'; selectedCitation?: number;
  library: { query: string; template: 'All' | TemplateId };
  actionsFilter: 'open' | 'done' | 'all';
  overlays: { menu: null | 'regen' | 'more'; share: boolean; consentLog: boolean;
              dialog: null | 'deleteMeeting' | 'deleteAccount' | 'stopAndDelete' | 'secondTab' };
  share: { format: 'markdown' | 'plain'; includeTimes: boolean };
  rename: { active: boolean; draft: string };
  toast: null | { message: string; undo?: () => void };
  reduceTransparency: boolean; reduceMotion: boolean;
}
type TemplateId = 'general' | 'standup' | 'client_call' | 'interview' | 'one_on_one';
```
- Server data (meetings, segments, summaries…) lives in a query cache keyed by workspace and ID; UI
  state above holds only view state.
- Live transcript and session state arrive over the session WebSocket via the offscreen document
  (ARCHITECTURE §4.2); the side panel never opens its own socket.
- Template labels in the UI: General · Standup · Client call · Interview · 1:1 (`client_call`
  = PRD "Client/Sales call").

---

## 19. Alignment changes and open design decisions

Differences between the handoff (spec + prototype) and the rest of the docs, and how this document
resolves them. Items marked **Needs update elsewhere** require a small change to the PRD or
architecture before implementation.

| # | Topic | Handoff | Resolution here | Needs update elsewhere |
|---|---|---|---|---|
| 1 | Contrast | Interim `#7a7a74` (4.3:1), checkbox `#a9a9a2` (2.4:1), switch-off track `#c9c8c1` (1.7:1), legend swatch `#9a9a93` | `muted` italic for interim; new `control-line #8a8a83` for control boundaries; legend uses `muted` | — |
| 2 | Action-item tracker in Phase 1 | Built (H4 is Phase 2 in FEATURES) | Keep as a lightweight Phase 1 page | ✅ Done: PRD FR-LIB-06, §7 scope, §13 `status`/`completed_at`/`due_phrase`; ARCHITECTURE §12.1 `GET /v1/action-items`, §9.3 status carry-over; FEATURES H4 |
| 3 | "Audio deleted" as a status | Status pill | Status pill = processing state only; audio availability is a separate meta label | — |
| 4 | Processing progress | Simulated timers | Steps mapped to pipeline jobs | ✅ Done: PRD FR-PROC-07, §13 `processing_step`; ARCHITECTURE §12.3 (SSE `GET /v1/meetings/{id}/events`, polling fallback), §9.3 |
| 5 | Delete with Undo | Client-side undo | Server grace period before deletion job | ✅ Done: PRD FR-SET-02 (10 s grace), §13 `deleted_at`, `execute_after`, `cancelled_at`; ARCHITECTURE §12.1 `:restore`, §16.6 |
| 6 | Vocabulary | Spec only | Settings → Vocabulary | ✅ Done: PRD FR-SET-07, §13 `glossary_terms`; ARCHITECTURE §12.1 `GET/PUT /v1/glossary` |
| 7 | Consent acknowledgement | Spec only | Onboarding §7.4 | ✅ Done: PRD FR-ONB-06, §13 `consent_acknowledged_at` (+ `consent_message`, `analytics_opt_out`) |
| 8 | Chrome notification | Mentioned | Kept ("Notes ready", export ready) | ✅ Done: PRD §18 `notifications` (+ `commands` note); ARCHITECTURE §4.7 |
| 9 | Speaker ring on Meet tiles | Drawn on tiles | Not in production; active speaker shown in panel only | — |
| 10 | Opening the side panel from the Meet prompt | Assumed | Must be verified (user-gesture rules) | ✅ Done: ARCHITECTURE §26.2 questions 7 (side panel gesture) and 8 (glass performance in Meet) |
| 11 | Interim script flip | Not covered | Client-side transliteration of interim text | — |
| 12 | Consent Off confirmation | Prototype toggles off directly | Off requires confirmation; three modes (FR-CON-01) | — |
| 13 | Meet overlay isolation | Not covered | Shadow DOM, movable pill, no overlap with Meet controls | — |
| 14 | Fonts in the extension | Google Fonts | Bundle font files in the extension | — |
| 15 | Hinglish marker aliases | Open | Still open (e.g. "faisla:", "kaam:", "sawaal:") | Tracked as PRD decision D-11 |
| 16 | "Live side panel" sidebar item | Preview page | Tutorial only; production shows "Recording · mm:ss" while recording | — |
| 17 | Toast placement in side panel | Library only | Separate placement (§6.7) | — |
| 18 | Export-all | Immediate JSON download | Async export job with notification (FR-SET-04) | — |

---

## 20. Accessibility (WCAG 2.2 AA — UI-04, UI-05)

- **Contrast:** text ≥ 4.5:1 (ink on white ≈ 18.9:1; muted on white ≈ 5.4:1, on paper ≈ 4.9:1;
  white on olive ≈ 6.1:1). Control boundaries and meaningful icons ≥ 3:1 (`control-line`).
- **Targets:** ≥ 44 px for primary controls; ≥ 32 px for compact chips; citation chips get a 24×24
  hit area.
- **Keyboard:** all controls reachable in a logical order; visible focus; `Esc` closes overlays; Enter
  adds a note / saves rename; arrow keys in menus and segmented controls.
- **Shortcuts** (via the `commands` API, user-changeable in Chrome): `Alt+Shift+R` start/stop,
  `Alt+Shift+P` pause/resume. Shown in Settings → Recording.
- **Screen readers:** switches `role="switch"`; segmented controls `radiogroup`; tag chips
  `aria-pressed`; toasts `role="status"`; dialogs labelled with focus trap and focus return; icon
  buttons labelled; live transcript region `aria-live="polite"` announcing **final** lines only
  (not interim) and rate-limited; recording state changes announced once.
- **Motion and transparency:** honour `prefers-reduced-motion` and `prefers-reduced-transparency`.
- **Language:** set `lang` on content (`en`, `hi`, or `hi-Latn` for Roman Hinglish) so screen readers
  pronounce text sensibly.
- **Scripts:** Devanagari and mixed-script lines render without clipping (UI-06).

---

## 21. Copy deck and localization

Sentence case everywhere. All strings in an i18n resource file from day one; Hinglish UI copy is P2
(UI-08). The product name comes from one constant.

| Context | Strings |
|---|---|
| Meet prompt | "Take notes for this call?" · "Nothing joins the call. Recording starts only when you press Start." · Start · Not now |
| Panel ready | "Ready when you are" · "Your mic and the Meet tab are recorded as two separate lanes, so you're always labelled correctly." · Start taking notes |
| Consent | "Let everyone know?" · "We'll post this in Meet chat. You can edit it first." · Post and start · Skip · "You're responsible for getting consent where the law requires it." |
| Consent default | "Hi all — I'm using Minutes to take notes on this call. Batayein agar aap comfortable nahi hain." |
| Recording | "Taking notes" · "Paused — nothing is being recorded" · "Listening… the transcript appears as people speak." · "Type a note and press Enter" |
| Processing / ready | "Writing your notes…" · "Finishing the transcript" · "Finding decisions and to-dos" · "Linking every point to what was said" · "Your notes are ready" · Open notes |
| Legend | "You wrote this" · "Added from the conversation" · "Click to see who said it" |
| Citation | "Where this came from · {time}" · "Play from {time}" · "Show in transcript" · "Audio available for {n} more days" · "Audio was deleted after notes were written." |
| Unverified | "Not found in the transcript" |
| Share | "Share notes" · "Nothing is sent automatically. Copy it and paste into Slack, WhatsApp or email." · Include times · Download file · Copy |
| Privacy card | "Private by default" · "No bot joins your calls. Audio is deleted after 7 days." (follows setting) |
| Toasts | "Marked done" · "Meeting deleted" · "Renamed" · "Rewritten as {T} notes" · "Copied as Markdown" / "Copied as plain text" · "Downloaded" · "Posted in Meet chat" · "Paused — nothing is being recorded" · "Recording resumed" · "Notes ready: {title}" · "Back online — catching up" |
| Destructive | "Delete this meeting?" · "Delete your account?" · "Stop and delete?" (bodies in §9, §13, §15) |

---

## 22. Phase 2 and Phase 3 surfaces

Same shell and components; add sidebar items only when a feature ships.

| Feature | UI |
|---|---|
| B2 Calendar sync | Settings → Connected apps "Google Calendar · Connect" (separate consent); Home "Up next" list above Recent |
| B3 Recording rules | Settings → Recording → Rules builder (when → Prompt / Auto-start); auto-start only for meetings you own with consent note on |
| B4 Pre-meeting brief | Side panel "Before you start" card; every line cites a past meeting |
| C5 File upload | Meetings → "Upload recording" sheet (drop zone, participant names, language); status "Transcribing…" |
| C6 Desktop app | Same panel UI in an always-on-top window; menu-bar/tray icon with state |
| C7 Cloud bot | Per-meeting "Send a notetaker instead" (opt-in, clearly branded) |
| E3 Highlights | ★ in composer + shortcut → IMPORTANT note |
| E4 Live Q&A | Panel tab "Ask" with cited answers; "Catch me up" chip |
| F8 Follow-up draft | Share sheet tab "Draft a follow-up"; "Open in Gmail" — never auto-send |
| F9 Chapters | Clickable timeline above the transcript |
| G2 Share links | Share sheet tab "Link": Summary only / + transcript · Specific people / Anyone with link · expiry · revoke |
| H3 Cross-meeting chat | Sidebar "Ask" — answers cite meetings and segments; "Not found" when unsure |
| I1 Slack / Notion / Docs | Share sheet destinations; Settings → Connected apps |
| I2 MCP server | Settings → Developer → "Connect AI assistants" (clients list, revoke) |
| I3–I5 API, CRM, automations | Settings → Integrations; Automations list with run log; "Review before push" diff |
| J1–J2 Analytics | Detail tab "Insights" (talk share by speaking time, questions — no emotion scores); Trackers page |
| K1–K2 Video & clips | Player above transcript; select range → "Make clip" |
| M Teams & admin | Workspace switcher; admin pages: members, roles, policies, audit log, SSO |
| N Plans & billing | Settings → Plan & usage (hours used bar, INR pricing, UPI) |

---

## 23. Feature coverage map

| Feature (FEATURES.md) | Status in prototype | Section |
|---|---|---|
| A1 Sign-in | SPEC | §7.1 |
| A3 Onboarding | Setup card built; onboarding SPEC | §7, §10 |
| A4 Settings | Built (+ SPEC groups) | §15 |
| B1 Meeting detection prompt | Built | §8.2 |
| C1 Two-lane capture (health) | SPEC | §8.6 |
| C2 Recording controls & indicator | Built | §8.1–§8.6 |
| C3 Consent notice / log / stop-and-delete | Notice built; log and stop-and-delete SPEC | §8.5, §9, §13.4 |
| C4 Resilience | SPEC | §9 |
| D1 Live transcript | Built (interim simulated) | §8.6 |
| D2 Improved transcript notice | SPEC | §12.3 |
| D3 Multilingual / Roman display | Settings built; script handling SPEC | §8.6, §15.2 |
| D4 Vocabulary | SPEC | §15.5 |
| D5 Speaker rename | SPEC | §12.5 |
| D6 Transcript viewer, search | Viewer built; search SPEC | §12.5 |
| E1 / E2 Live panel, notepad anchors | Built | §8.6 |
| F1 / F2 Summary, anchored notes | Built | §12.4 |
| F3 Decisions, action items, open questions | Action items built; others SPEC | §12.4, §12.6 |
| F4 Citations | Card built; hover popover + unverified SPEC | §12.6, §6.14 |
| F5 Templates | Built | §12.2 |
| F6 Edit, regenerate, feedback | Regenerate built; version banner, edit, feedback SPEC | §12.2, §12.4 |
| F7 Output language | Built | §15.2 |
| F10 Audio playback | Built (simulated) | §12.6 |
| G1 Copy and export | Built | §13 |
| H1 / H2 Library and search | Built | §11 |
| H4 Action-item tracker | Built (pulled forward) | §14 |
| L1–L3 Retention, deletion, export, sub-processors | Built | §15.3 |
| O1 Notifications | Toast built; Chrome notification SPEC | §6.7, §8.7 |
| Phase 2/3 features | SPEC (light) | §22 |

---

## 24. Design QA checklist

Run for every screen before merging UI work.

- [ ] Matches tokens (§5) — no ad-hoc colours, radii, or font sizes.
- [ ] User text vs AI text is distinguishable everywhere AI content appears (UI-01).
- [ ] Every AI claim has a citation chip or an unverified chip.
- [ ] Recording state visible in colour **and** text on every surface (UI-02).
- [ ] Empty, loading, error, and offline states implemented (UI-07).
- [ ] Keyboard-only walkthrough passes; focus visible; `Esc` behaviour correct.
- [ ] Screen reader labels on all icon buttons, switches, chips, dialogs.
- [ ] Contrast checked (text 4.5:1, controls 3:1) in light and dark.
- [ ] Reduced motion and reduced transparency honoured.
- [ ] Devanagari and Hinglish strings render without clipping (UI-06).
- [ ] Side panel works from 320 to 480 px wide; library from 1100 px (and icon-rail below).
- [ ] Meet overlay: Shadow DOM, never covers Meet controls, draggable pill, no layout shift in Meet.
- [ ] No transcript text, names, or titles in analytics events or logs (PRD §19.6).
- [ ] All strings come from the i18n file; product name from the constant.
- [ ] Requirement IDs referenced in the PR description.
