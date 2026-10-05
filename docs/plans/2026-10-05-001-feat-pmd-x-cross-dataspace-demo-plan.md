---
title: "feat: Build PMD-X Cross-Dataspace Demo static site"
type: feat
status: active
date: 2026-10-05
origin: docs/brainstorms/cross-dataspace-demo-requirements.md
---

# feat: Build PMD-X Cross-Dataspace Demo static site

## Overview

Build a fully static, framework-free web demo that makes the PMD cross-dataspace interoperability concept tangible for an industry audience. The demo simulates the pipeline that uses PMDCO as a semantic glue layer to bridge Catena-X (SAMM JSON) and Manufacturing-X (AAS 3.0 JSON) material data, loads both into Apache Jena Fuseki, and executes a live cross-dataspace SPARQL UNION query against the real PMD data portal endpoint.

Four pages: a landing page with an interactive pipeline simulator, and three detail deep-dives. All code snippets are hardcoded from live portal files at authoring time. One runtime network request (the SPARQL fetch) with a 10s timeout and static fallback.

## Problem Frame

Industrial dataspaces (Catena-X, Manufacturing-X) expose material data through incompatible schemas — SAMM aspect models for polymer properties, AAS 3.0 inspection documents for steel. The conventional N×M adapter problem is solved by converting each dataspace's data once into PMDCO-conformant RDF and loading it into a shared Fuseki triplestore. This demo makes that concept tangible by walking visitors through the real Tension Pulley Assembly use case with clickable modals, animated workflow, and a live SPARQL result table.

(see origin: `docs/brainstorms/cross-dataspace-demo-requirements.md` §1–§2)

## Requirements Trace

- R1. Pipeline simulator with 6 clickable step buttons, each opening a modal with real code snippets (§4.3, SC#1, SC#2)
- R2. "▶ Run Workflow" animation: A+B simultaneously, then C→D→E→F at 2500ms/step (§7, SC#5)
- R3. Live SPARQL result table fetched from the PMD Fuseki endpoint via POST, with static fallback (§4.4, SC#3)
- R4. Result table shows live/cached badge; 10s AbortController timeout falls back to static snapshot (§7)
- R5. Cross-dataspace SPARQL UNION pattern explained (§5, detail-query.html, SC#4)
- R6. All 4 HTML files deployable to GitHub Pages; live result on HTTP, static fallback on file:// (§3, SC#6)
- R7. Three detail pages with back/cross nav, all linked to live portal source files (§5, SC#7, SC#8)
- R8. CSS custom property design system — no frameworks, no web font downloads (§6, §9)
- R9. XSS-safe SPARQL result rendering — `textContent` only (§7)
- R10. Content Security Policy meta tag on all pages; `connect-src` restricted to self + Fuseki origin (§3)

## Scope Boundaries

- No server, no backend, no JavaScript framework (React, Vue, etc.)
- No CSS framework (Bootstrap, Tailwind)
- No build tooling (webpack, vite)
- No web font downloads — system-ui / ui-monospace stacks only
- No external syntax highlighter — hand-highlight with 4 token span classes only
- No mobile/responsive layout (desktop-first; mobile is nice-to-have, out of scope)
- No user authentication, data upload, or i18n

### Deferred to Separate Tasks

- Mobile/responsive CSS: separate PR after initial landing
- If CORS is not enabled on the Fuseki endpoint: same-origin proxy implementation in a separate task

## Context & Research

### Relevant Code and Patterns

- No existing code in this repo — greenfield. All patterns established by this implementation.
- All design decisions are fully specified in `docs/brainstorms/cross-dataspace-demo-requirements.md`.
- Token class table (§6): `.kw` / `.str` / `.num` / `.cm` for hand-highlighted code spans.
- Modal API surface (§7): `openModal(stepId)` / `closeModal()` — keep this minimal.

### Institutional Learnings

- No `docs/solutions/` exists yet. Post-implementation: use `ce-compound` to capture CORS behavior, Observer + animation interaction, and GitHub Pages deployment notes.

### External References

- Requirements doc: `docs/brainstorms/cross-dataspace-demo-requirements.md`
- Live source files on PMD data portal (all URLs listed in requirements §2)
- SPARQL endpoint: `https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql`

## Key Technical Decisions

- **Vanilla HTML/CSS/JS only**: no framework means no dependency churn, maximum portability, and GitHub Pages serving without any build step. (see origin §9)
- **Inline SPARQL query constant in `js/main.js`**: avoids a second runtime fetch and removes the race condition between fetching the `.sparql` file and posting it. (see origin §7)
- **Intersection Observer fires once, then disconnects**: prevents double-fetch when "Run Workflow" scrolls to the result section. In-flight guard provides an additional layer. (see origin §7)
- **AbortController with 10s timeout + static fallback**: infinite spinner is unacceptable in a demo context; the static snapshot is pre-validated against the live endpoint. (see origin §7)
- **Hand-highlighted syntax (4 classes)**: keeps the page fully self-contained with no external dependencies. CSP requires `style-src 'unsafe-inline'` for the colored `<span>` elements. (see origin §6)
- **All modal snippet content hardcoded at authoring time**: simplifies CSP (no fetch of snippet files), removes runtime failure modes from the modal system. (see origin §8)
- **Step D (Assembly Graph) uses neutral styling**: `--pmdco-green` border + `--surface-2` background, since no dedicated color token is meaningful for institutional/company knowledge. (see origin §4.3)

## Open Questions

### Resolved During Planning

- **CORS on Fuseki endpoint**: Unknown — marked as mandatory pre-implementation check in requirements (§2). If blocked, escalate to portal admins or implement a same-origin proxy in a separate task. The plan accounts for this via the static fallback and the deployment unit gating.
- **HTTP method for SPARQL**: POST with `application/x-www-form-urlencoded`. (see origin §2)
- **Run Workflow timing**: 2500ms per step, auto-advance. (see origin §7)
- **Step F modal**: no pre-baked table — links/scrolls to result section. (see origin §4.3)

### Deferred to Implementation

- Exact tab switching implementation for Step C modal (CatX path / MfgX path): any approach (radio buttons, JS toggle, CSS :checked) is acceptable; keep it dependency-free.
- Whether `pipeline-diagram.svg` from the portal can be embedded as-is or requires adaptation — determine when fetching the file.
- SPARQL result column order and exact binding names — verify against live endpoint during Unit 4.

## Output Structure

```
pmd-x-spaces-demo/
├── index.html
├── detail-catena-x.html
├── detail-mfg-x.html
├── detail-query.html
├── .nojekyll                        ← prevents Jekyll on GitHub Pages
├── css/
│   └── style.css
├── js/
│   └── main.js
├── assets/
│   ├── tension-pulley.svg           ← create from spec (viewBox 640×200)
│   └── pipeline-diagram.svg        ← fetch/adapt from data portal
└── docs/
    ├── brainstorms/
    │   └── cross-dataspace-demo-requirements.md
    └── plans/
        └── 2026-10-05-001-feat-pmd-x-cross-dataspace-demo-plan.md
```

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### JS interaction system — key lifecycle interactions

```
Page load
  └─► IntersectionObserver registered on #result-section
        (threshold 0.3, fires once, then observer.disconnect())

User clicks "▶ Run Workflow"
  ├─► button.disabled = true
  ├─► Steps A + B: add .active to both buttons simultaneously
  │     open A modal → wait 2500ms → close A modal
  │     open B modal → wait 2500ms → close B modal
  ├─► Steps C → D → E → F: add .active → open modal → 2500ms → close
  │     (each button also gains .completed after its modal closes)
  ├─► scrollIntoView(#result-section)
  │     └─► IntersectionObserver fires → fetch() triggered (if not already)
  └─► button.disabled = false

User scrolls naturally to #result-section
  └─► IntersectionObserver fires → fetch() triggered (if not already fired)

fetch() lifecycle:
  ├─► inFlight = true
  ├─► AbortController timeout = 10s
  ├─► POST to SPARQL_ENDPOINT with SPARQL_QUERY
  │     Success → render live table (textContent), show "Live · HH:MM" badge
  │     Error/timeout → reveal static fallback table, show "Cached result" badge
  └─► inFlight = false (on completion or error)

"↻ Re-run" button: reset inFlight = false, re-call fetch()
```

### Step button state machine

```
default ──[click / Run Workflow reaches this step]──► active
active  ──[Run Workflow advances past this step]──► completed
completed ──[click]──► active  (completed persists until page reload)
```

## Implementation Units

- [ ] **Unit 1: CSS foundation**

**Goal:** Establish the complete design system — all custom properties, typography, base reset, layout utilities, modal styles, pipeline node button styles, badge styles, nav styles, and code block styles — that all four HTML pages will import.

**Requirements:** R8

**Dependencies:** None

**Files:**
- Create: `css/style.css`

**Approach:**
- Define all 22 CSS custom properties in `:root` exactly as specified in requirements §6
- Base reset: `box-sizing: border-box`, `margin: 0`, sensible defaults for `body`
- Typography: `system-ui` stack for body, `ui-monospace` stack (first) for code
- Layout: `.container` with `max-width: var(--max-width)` and horizontal padding
- `site-nav`: horizontal link list, active page indicated with font-weight + underline
- Origin badges: `.badge-catx` / `.badge-mfgx` — pill shape, `border-radius: 9999px`, dataspace colors, white text, `0.75rem`, `0.25rem 0.75rem` padding
- Pipeline step buttons: card style with colored left border (4px), `--*-bg` background, hover elevation, three state classes: `.step-default` (implicit) / `.step-active` / `.step-completed`
- Modal overlay: fixed fullscreen, centered content div `max-width: 720px`, scrollable body `max-height: 60vh`, colored header bar using current step color, close button top-right
- Code blocks: `background: var(--code-bg)`, `color: var(--code-fg)`, token classes `.kw` / `.str` / `.num` / `.cm` with their respective palette colors
- Result table: alternating row colors; `.row-catx` / `.row-mfgx` for dataspace-colored rows
- Live/cached badge: `.badge-live` (teal) / `.badge-cached` (amber), inline next to table heading
- No media queries needed (desktop-first per scope)

**Patterns to follow:**
- Requirements §6 is the authoritative CSS specification — follow it exactly

**Test scenarios:**
- Test expectation: none — this unit produces only a stylesheet with no interactive behavior. Visual correctness verified in Unit 3 when HTML is added.

**Verification:**
- CSS file loads without parse errors in browser DevTools
- All custom properties resolve correctly when inspected in DevTools `:root`

---

- [ ] **Unit 2: SVG assets + source data collection**

**Goal:** Create the `tension-pulley.svg` assembly schematic, obtain `pipeline-diagram.svg` from the portal, and collect all code snippets from live portal files that will be hardcoded into modal content in Unit 3.

**Requirements:** R1, R2 (visual assets), R9 (snippets must be real data)

**Dependencies:** None (parallel with Unit 1)

**Files:**
- Create: `assets/tension-pulley.svg`
- Create/fetch: `assets/pipeline-diagram.svg`
- No code file — collected snippets are embedded directly into `index.html` in Unit 3

**Approach:**
- `tension-pulley.svg`: inline SVG, `viewBox="0 0 640 200"`. Two labeled component boxes (left: "Pulley Wheel / PA6GF30" filled `--catx-blue` #1E40AF; right: "Tensioner Bracket / Steel 316/4401" filled `--mfgx-purple` #6D28D9) connected by lines to a central "Tension Pulley Assembly" node. Colored boxes + text labels only — no engineering detail. Simple `<rect>` + `<text>` + `<line>` elements.
- `pipeline-diagram.svg`: fetch from the data portal resource URL. Inspect whether it can be used as-is or needs color adaptation to match the CSS palette. If it conflicts, adapt fill/stroke attributes.
- **CORS verification** (blocking for Unit 4): From a browser console on any HTTP-served page, run `fetch('https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql?query=ASK%7B%7D')`. If `Access-Control-Allow-Origin: *` is absent, stop — do not proceed to Unit 4's live fetch implementation. File a proxy task.
- Snippet collection — fetch each file from the portal and extract:
  - Step A modal: first ~20 lines of `material_data_test_pa6gf30.json`
  - Step B modal: first ~20 lines of `InspectionDocument_316_4401_alloy.json` (AAS 3.0 structure)
  - Step C CatX tab: key lines of `pmdco-mapping-insert.sparql` (PREFIX + INSERT WHERE core)
  - Step C MfgX tab: key lines of `InspectionDocument_AAS2KG_mapping.sparql`
  - Step D modal: full `tension_pully.ttl` (~20 triples)
  - Step F modal: full `cross_dataspace_query.sparql`
  - Detail pages: relevant TTL output snippets from `material_data_pa6gf30_pmdco.ttl` and `InspectionDocument_316_4401_alloy_PMDCore.ttl`
- Verify fallback table values against live endpoint (run `cross_dataspace_query.sparql` manually if endpoint is accessible) so the embedded static snapshot is accurate

**Patterns to follow:**
- Requirements §2 for all portal file URLs
- Requirements §8: snippets sourced from live files, not invented

**Test scenarios:**
- Test expectation: none — this unit is authoring/asset work. Correctness validated when HTML is rendered in Unit 3.

**Verification:**
- `tension-pulley.svg` renders correctly in browser (two colored boxes, labels, connecting lines)
- `pipeline-diagram.svg` renders without broken paths or missing elements
- All collected code snippets are saved locally and verified as real data from the portal
- CORS check result documented (pass → proceed to Unit 4 live fetch; fail → implement static-only fallback and file proxy task)

---

- [ ] **Unit 3: `index.html` — landing page**

**Goal:** Build the complete landing page: page shell with CSP, shared nav, hero section, problem statement with N×M visual, pipeline simulator with all 6 step buttons, all 6 modal HTML blocks with hardcoded snippets and hand-highlighted tokens, result section with fallback table, and footer.

**Requirements:** R1, R2, R3, R6, R8, R9, R10

**Dependencies:** Unit 1 (CSS), Unit 2 (SVGs and collected snippets)

**Files:**
- Create: `index.html`

**Approach:**
- Page shell: `<!DOCTYPE html>`, `lang="en"`, `<meta charset="UTF-8">`, viewport meta, CSP meta (exactly as specified in requirements §3), `<link rel="stylesheet" href="css/style.css">`, `<script defer src="js/main.js">` at end of `<head>`
- `<nav class="site-nav">`: four links — "Demo" (active, `aria-current="page"`), "Catena-X pipeline", "Manufacturing-X pipeline", "SPARQL query"
- Hero: `<section id="hero">` — h1 "One Assembly. Two Dataspaces. One Query.", subhead, origin badges, `<img src="assets/tension-pulley.svg">`, CTA `<a href="#pipeline">` button
- Problem statement: `<section id="problem">` — three prose sentences, then the N×M comparison as a `<div class="comparison-grid">` with two columns: "Without PMDCO" (N×M adapters) / "With PMDCO" (one shared layer). Render as styled `<pre>` or simple two-column `<div>` — whichever is cleaner without extra CSS.
- Pipeline simulator: `<section id="pipeline">` — CSS grid layout matching the diagram in requirements §4.3. Six `<button class="step-btn" data-step="A">` elements with `aria-label`. "▶ Run Workflow" `<button id="run-btn">` below the grid.
- Modal HTML: one `<div class="modal" id="modal-A">` per step, all hidden (`display:none` or `hidden` attribute). Each modal has: header bar (step color via inline style or data attribute), title, scrollable body with description + code block, footer row with "View full details →" link and close button. Hand-highlighted code snippets using `.kw`, `.str`, `.num`, `.cm` spans — only the most semantically significant tokens.
  - Step C modal: include two-tab structure for CatX/MfgX paths (radio-button toggle or JS-toggled buttons — defer exact mechanism to Unit 4)
  - Step F modal: "↓ See live results below" button with `href="#result"`, no pre-baked table
- Result section: `<section id="result">` — heading "Query result: components and material properties from both dataspaces", `<div id="result-status">` (spinner markup, hidden by default), `<span id="result-badge">` (Live/Cached — empty until JS populates), static fallback `<table id="result-table">` with the 7 pre-validated rows from requirements §2, "↻ Re-run query" button
- Footer: links to dataset, Platform MaterialDigital, white paper placeholder; "Built with" credits
- All interactive elements (`<button>`, modal close, "↻ Re-run") have `type="button"` to prevent accidental form submit

**Patterns to follow:**
- Requirements §4 entirely — every subsection maps to a page section
- CSP meta exactly as specified in requirements §3

**Test scenarios:**
- Test expectation: none — HTML structure only; all interactive behavior implemented in Unit 4. Visual correctness verified by opening the page in a browser after Unit 4.

**Verification:**
- Page renders without console errors when opened locally (file://) — CSS loads, SVGs display, modal divs present in DOM
- All 6 step buttons are present with correct `data-step` attributes
- Result section contains the static fallback table with 7 rows

---

- [ ] **Unit 4: `js/main.js` — interaction layer**

**Goal:** Implement the complete JavaScript layer: modal open/close with focus trap, three-state step management, "Run Workflow" animation, SPARQL fetch lifecycle with Intersection Observer and AbortController, live/cached badge rendering, and XSS-safe result table construction.

**Requirements:** R1, R2, R3, R4, R9

**Dependencies:** Unit 3 (HTML must exist for DOM queries)

**Files:**
- Create: `js/main.js`

**Approach:**
- **Constants block at top** (configurable section):
  - `SPARQL_ENDPOINT` — the full Fuseki URL
  - `SPARQL_QUERY` — the full text of `cross_dataspace_query.sparql` as a template literal
  - `FETCH_TIMEOUT_MS = 10000`
- **Modal system**: `openModal(stepId)` finds `#modal-{stepId}`, removes `hidden`, moves focus to first focusable element inside, sets `aria-modal="true"`. `closeModal()` restores focus to the button that opened the modal. Overlay click and Escape key both call `closeModal()`. Focus trap cycles through focusable elements within the modal only.
- **Step state**: each step button tracks state via CSS classes. `activateStep(stepId)` removes `.step-completed` if present, adds `.step-active`. `completeStep(stepId)` removes `.step-active`, adds `.step-completed`. Clicking any button in any state calls `activateStep` then `openModal`.
- **Step C tab toggle**: `<button data-tab="catx">` / `<button data-tab="mfgx">` inside the modal; click toggles visibility of the two code panels. Keep state in a simple variable — no framework needed.
- **Run Workflow**:
  ```
  1. runBtn.disabled = true
  2. activateStep('A'); activateStep('B')
     await openModalForDuration('A', 2500)
     completeStep('A')
     await openModalForDuration('B', 2500)
     completeStep('B')
  3. for step of ['C','D','E','F']:
       activateStep(step)
       await openModalForDuration(step, 2500)
       completeStep(step)
  4. document.querySelector('#result').scrollIntoView({behavior:'smooth'})
  5. runBtn.disabled = false
  ```
  `openModalForDuration(stepId, ms)` returns a Promise that resolves after `ms` ms.
- **SPARQL fetch lifecycle**:
  - `let inFlight = false`
  - `const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting || inFlight) return; observer.disconnect(); triggerFetch(); }, { threshold: 0.3 })`
  - `triggerFetch()`: set `inFlight = true`, show spinner, create `AbortController`, `setTimeout(controller.abort, FETCH_TIMEOUT_MS)`, POST to `SPARQL_ENDPOINT` with `body: 'query=' + encodeURIComponent(SPARQL_QUERY)`, `Accept: application/sparql-results+json`
  - On success: parse JSON, call `renderResultTable(data.results.bindings)`, show Live badge with `new Date().toUTCString().slice(17,22) + ' UTC'`
  - On abort/error: reveal static fallback table, show Cached badge, set `inFlight = false`
- **Result table rendering**: `renderResultTable(bindings)` — hide static table, build new `<table>` with `<thead>` row, then for each binding: create `<tr>`, for each column (`componentLabel`, `material`, `property`, `value`, `unitLabel`): create `<td>`, set `td.textContent = binding[col]?.value ?? ''`. Add `.row-catx` or `.row-mfgx` class based on component label value. Append to `#result`. Never use `innerHTML` on binding values.
- **Re-run button**: click handler resets `inFlight = false` and calls `triggerFetch()` directly (observer already disconnected)

**Patterns to follow:**
- Requirements §7 entirely — every behavioral specification maps directly to this unit

**Test scenarios:**
- Happy path — modal open: click Step A button → modal A visible, focus inside modal, Escape closes modal, focus returns to Step A button
- Happy path — step state: after clicking Step A, button has `.step-active`; after Run Workflow passes Step A, button has `.step-completed`
- Happy path — Run Workflow: clicking "▶ Run Workflow" disables the button, A+B activate simultaneously, modals open/close in sequence, page scrolls to result section, button re-enables
- Happy path — SPARQL fetch (live): Intersection Observer fires when result section is 30% visible, spinner shows, table renders with `textContent` values, Live badge shows timestamp
- Happy path — Re-run: clicking "↻ Re-run" triggers a new fetch regardless of prior result
- Edge case — scroll double-trigger: Run Workflow scroll + natural scroll overlap → observer already disconnected after first fire → no double fetch
- Edge case — modal tab toggle (Step C): clicking "Manufacturing-X path" tab shows MfgX code panel, hides CatX panel; clicking "Catena-X path" reverses
- Error path — SPARQL timeout: fetch takes >10s → AbortController fires → static fallback table visible → Cached badge shows
- Error path — SPARQL network error: fetch rejects → same fallback behavior as timeout
- Error path — malicious SPARQL binding value containing `<script>`: value rendered via `textContent` → appears as literal text, not executed
- Integration — binding name check: on first successful live fetch, confirm the response JSON contains the expected binding names (`componentLabel`, `material`, `property`, `value`, `unitLabel`); if any are missing, `renderResultTable` should log a clear console error identifying which names are absent before falling back gracefully

**Verification:**
- All test scenarios pass manually in browser
- DevTools Network shows correct POST request with form-urlencoded body and `Accept: application/sparql-results+json` header
- DevTools console shows no errors during full workflow run
- Simulating 10s timeout (via DevTools throttling or a modified constant) shows fallback table, not a spinner stuck indefinitely

---

- [ ] **Unit 5: Detail pages**

**Goal:** Build the three detail pages — Catena-X pipeline, Manufacturing-X pipeline, and cross-dataspace SPARQL query — each with the shared nav, back link, deep-dive sections, and links to live portal source files.

**Requirements:** R5, R7, R8, R10, SC#8

**Dependencies:** Unit 1 (CSS), Unit 2 (snippets), Unit 3 (nav pattern established)

**Files:**
- Create: `detail-catena-x.html`
- Create: `detail-mfg-x.html`
- Create: `detail-query.html`

**Approach:**
- All three pages share the same page shell as `index.html` (CSP meta, CSS link, no JS needed on detail pages unless Step C tab toggle is desired)
- `<nav class="site-nav">`: same four links; set `aria-current="page"` on the active link for each page
- Each page has a `<a href="index.html">← Back to demo</a>` below the nav
- **`detail-catena-x.html`** — four sections per requirements §5:
  1. Source: SAMM Aspect Model — PA6GF30 JSON snippet, explanation of SAMM and why it is not interoperable by default
  2. Step 1: JSON → RDF — YARRRML mapping snippet, link to `futurecarproduction.materialsdata.space/group/mappings`
  3. Step 2: SAMM/RDF → PMDCO — full `pmdco-mapping-insert.sparql` with annotated comments explaining each clause
  4. Output — TTL snippet from `material_data_pa6gf30_pmdco.ttl` showing a PMDCO quality individual with QUDT unit
- **`detail-mfg-x.html`** — four sections per requirements §5:
  1. Source: AAS 3.0 Inspection Document — JSON snippet, explanation of AAS 3.0 / EN 10204
  2. Step 1: AAS → RDF — py-aas-rdf + AAS2KG tool chain description
  3. Step 2: AAS/RDF → PMDCO — `InspectionDocument_AAS2KG_mapping.sparql` with annotations; link to `steel-inspection-document-mapro` dataset
  4. Output — TTL snippet showing steel properties as PMDCO qualities
- **`detail-query.html`** — four sections per requirements §5:
  1. Why a UNION is needed — explains the two different PMDCO graph patterns (CatX has intermediate material node; MfgX links quality directly to component)
  2. The full query — `cross_dataspace_query.sparql` with line-by-line annotations
  3. The result — static result table (same 7-row data as index.html fallback) with column explanations
  4. Live SPARQL endpoint — link to Fuseki endpoint on dataportal.material-digital.de
- All external links to dataportal.material-digital.de use `target="_blank" rel="noopener noreferrer"`
- Code blocks use the same hand-highlighted token classes as `index.html`; no JS needed on detail pages

**Patterns to follow:**
- Nav and page shell pattern established in `index.html` (Unit 3)
- Requirements §5 — section structure for each page

**Test scenarios:**
- Happy path — nav: clicking each nav link from each detail page reaches the correct page; active page is visually indicated
- Happy path — back link: "← Back to demo" on all three detail pages returns to `index.html`
- Happy path — external links: all "View on data portal" links have `rel="noopener noreferrer"` and `target="_blank"`
- Happy path — code blocks: all code snippet blocks render with correct hand-highlighted spans, no escaped HTML entities visible
- Integration — `detail-query.html` result table: shows the same 7 rows as the `index.html` fallback, column headers match SPARQL binding names

**Verification:**
- All three pages render without console errors
- Nav correctly marks the active page on each
- All code snippets display correct, real content from the portal files (not placeholder text)
- All links to dataportal.material-digital.de are working (verify manually)

---

- [ ] **Unit 6: Deployment + end-to-end verification**

**Goal:** Prepare the repo for GitHub Pages deployment, verify all relative paths are correct, and run the complete end-to-end success criteria check.

**Requirements:** R6, SC#6 (live on HTTP; static fallback on file://)

**Dependencies:** Units 1–5 complete

**Files:**
- Create: `.nojekyll` (empty file — prevents GitHub Pages from running Jekyll on the repo)

**Approach:**
- Add `.nojekyll` to repo root — required for GitHub Pages to serve directories and files with underscores without Jekyll interference
- Verify all `<link>`, `<script>`, `<img src>`, `<a href>` references in all 4 HTML files use relative paths (no absolute paths, no `file://` prefixes)
- Verify CSP meta tag on all 4 pages — `connect-src` must include the Fuseki origin; `script-src 'self'` must be present
- GitHub Pages deployment: push to `main` branch, enable Pages in repo settings (source: root of `main`). The demo URL will be `https://<org>.github.io/pmd-x-spaces-demo/`
- **End-to-end success criteria check** (against requirements §10):
  - SC#1: open each step modal — all 6 open without errors, correct content displayed
  - SC#2: each modal contains real TTL/JSON/SPARQL snippets (not placeholder text)
  - SC#3: result table shows live SPARQL result from Fuseki (if CORS passes)
  - SC#4: `detail-query.html` explains why UNION is needed with the two graph patterns
  - SC#5: "▶ Run Workflow" completes end-to-end without JS errors
  - SC#6: live result on GitHub Pages URL; static fallback when opened via `file://`
  - SC#7: detail pages link to live dataportal.material-digital.de source files
  - SC#8: all three detail pages render without errors, code blocks show correct content

**Test scenarios:**
- Happy path — local file://: open `index.html` directly from filesystem → static fallback table shown (no CORS possible), all modals still work
- Happy path — GitHub Pages HTTP: load from deployed URL → live SPARQL result fetches, Live badge shows timestamp, no CSP violations in DevTools console
- Edge case — CSP: DevTools console shows zero Content Security Policy violations when loading the deployed page and triggering the SPARQL fetch

**Verification:**
- All 8 success criteria pass as described above
- DevTools console clean (no errors, no warnings, no CSP violations) on GitHub Pages URL

---

## System-Wide Impact

- **Interaction graph:** The Intersection Observer and the Run Workflow animation both trigger the result section scroll — the `observer.disconnect()` on first fire prevents double-fetch regardless of which path fires first.
- **Error propagation:** SPARQL fetch failures surface only in the result section — they do not affect the modal system or the Run Workflow animation. Errors are caught and show the static fallback gracefully.
- **State lifecycle risks:** Step state (active/completed) lives in CSS classes on DOM elements. No persistent state outside the page — a reload resets all steps. Re-run button correctly resets `inFlight` flag without resetting step visual states.
- **API surface parity:** The SPARQL result table appears in both `index.html` (live fetch + static fallback) and `detail-query.html` (static only). The column structure must be identical. The static fallback data in `index.html` must match `detail-query.html`'s table.
- **Integration coverage:** The Run Workflow scroll-to-result → Intersection Observer → fetch chain is the primary integration scenario that unit-level testing cannot easily cover. Verify end-to-end in a browser as specified in Unit 4 verification.
- **Unchanged invariants:** The PMD data portal Fuseki endpoint is external infrastructure — this plan does not change it. All data it serves is read-only from this demo's perspective.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| CORS not enabled on Fuseki endpoint | Pre-implementation check required (Unit 2). If blocked: implement static-only path, file proxy task separately. Demo degrades gracefully via static fallback. |
| Live portal files change after snippet collection | Snippets are hardcoded at authoring time. If portal files change, HTML must be manually updated. Low risk for a demo; note in `docs/solutions/` post-landing. |
| `tension-pulley.svg` complexity underestimated | Spec defines minimal colored boxes + labels only. Simple SVG `<rect>` + `<text>` + `<line>` — no engineering drawing required. |
| `pipeline-diagram.svg` from portal needs color adaptation | Inspect when fetching. Fall back to creating a custom diagram if portal SVG is unsuitable. |
| Fuseki endpoint goes offline during a live demo | Static fallback table shows automatically after 10s. For important demos, pre-verify endpoint availability. |
| GitHub Pages CSP `unsafe-inline` for syntax spans | `unsafe-inline` is required because token spans use a class-based approach — the class *rule* in the stylesheet is served from `'self'`, which is safe. No actual inline `style` attributes are on SPARQL-derived content. Risk is design-time, not data-injection. |

## Sources & References

- **Origin document:** [`docs/brainstorms/cross-dataspace-demo-requirements.md`](docs/brainstorms/cross-dataspace-demo-requirements.md)
- Dataset: `dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo`
- SPARQL endpoint: `https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql`
- CatX pipeline detail: `dataportal.material-digital.de/dataset/cross-project-use-case`
- MfgX pipeline detail: `dataportal.material-digital.de/dataset/steel-inspection-document-mapro`
- SAMM mappings: `futurecarproduction.materialsdata.space/group/mappings`
