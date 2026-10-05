# PMD-X Cross-Dataspace Demo — Requirements

**Date:** 2026-10-05  
**Audience:** Technical evaluators, researchers, potential industry adopters of the PMD DataStack pipeline  
**Source dataset:** [dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo](https://dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo)

---

## 1. Goal

Build a static web demo that makes the PMD cross-dataspace interoperability concept tangible for an industry audience. Visitors should be able to understand — by clicking through a simulated pipeline — how PMDCO bridges incompatible industrial data schemas from two different dataspaces into a single queryable knowledge graph.

**Core message:** One physical assembly. Two dataspaces. Incompatible schemas. One SPARQL query that answers across both — because PMDCO is the shared semantic layer.

---

## 2. Concrete Scenario — Tension Pulley Assembly

The demo uses real PMD data. All file URLs are live on the PMD data portal.

### Assembly

A **tension pulley** (`ex:TensionPulley_001`) consists of two components sourced from different industrial dataspaces:

| Component | Material | Dataspace | Schema |
|-----------|----------|-----------|--------|
| Pulley Wheel | PA6GF30 (glass-fiber polyamide) | Catena-X | SAMM aspect model JSON (via EDC) |
| Tensioner Bracket | Steel 316/4401 (stainless) | Manufacturing-X | AAS 3.0 inspection document (EN 10204) |

The **assembly graph** (`tension_pully.ttl`) is institutional/company knowledge that links the two parts via BFO part-whole relations (`obo:BFO_0000051`).

### Source files (all live URLs)

| File | Role | URL |
|------|------|-----|
| `material_data_test_pa6gf30.json` | CatX source (SAMM JSON) | `dataportal.material-digital.de/.../material_data_test_pa6gf30.json` |
| `InspectionDocument_316_4401_alloy.json` | MfgX source (AAS 3.0) | `dataportal.material-digital.de/.../inspectiondocument_316_4401_alloy.json` |
| `tension_pully.ttl` | Assembly graph | `dataportal.material-digital.de/.../tension_pully.ttl` |
| `material_data_pa6gf30_pmdco.ttl` | CatX → PMDCO output | `dataportal.material-digital.de/.../material_data_pa6gf30_pmdco.ttl` |
| `InspectionDocument_316_4401_alloy_PMDCore.ttl` | MfgX → PMDCO output | `dataportal.material-digital.de/.../inspectiondocument_316_4401_alloy_pmdcore.ttl` |
| `pmdco-mapping-insert.sparql` | CatX → PMDCO transform query | `dataportal.material-digital.de/.../pmdco-mapping-insert.sparql` |
| `InspectionDocument_AAS2KG_mapping.sparql` | MfgX → PMDCO construct query | `dataportal.material-digital.de/.../inspectiondocument_aas2kg_mapping.sparql` |
| `cross_dataspace_query.sparql` | Final cross-dataspace SELECT | `dataportal.material-digital.de/.../cross_dataspace_query.sparql` |
| `pipeline-diagram.svg` | Existing pipeline diagram | `dataportal.material-digital.de/.../pipeline-diagram.svg` |

### Pipeline paths

**Catena-X (blue):**  
SAMM JSON (via EDC) → RDFConverter + YARRRML mapping → SAMM/RDF intermediate → `SPARQL INSERT` (13 properties, 7 units → PMDCO + QUDT) → `material_data_pa6gf30_pmdco.ttl`

**Manufacturing-X (purple):**  
AAS 3.0 JSON → py-aas-rdf → pyoxigraph store → `SPARQL CONSTRUCT` (AAS2KG mapping, mechanical properties + 9 chemical elements → PMDCO) → `InspectionDocument_316_4401_alloy_PMDCore.ttl`

**Convergence:**  
Both PMDCO graphs + assembly graph → Apache Jena Fuseki → cross-dataspace SPARQL UNION query → result table

### Live SPARQL endpoint

The PMD data portal hosts all graphs in its Apache Jena Fuseki integration. The cross-dataspace demo dataset exposes a live SPARQL endpoint:

```
https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql
```

The demo page executes `cross_dataspace_query.sparql` against this endpoint via HTTP POST (`Content-Type: application/x-www-form-urlencoded`, `Accept: application/sparql-results+json`). No pre-baked static data needed for the result table — it is fetched live.

**Pre-implementation check required:** Verify that the endpoint returns `Access-Control-Allow-Origin: *` before writing any fetch code. Test from a browser console: `fetch('https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql?query=ASK%7B%7D')`. If CORS is not enabled, escalate to portal administrators or implement a same-origin proxy.

Fallback: embed a static result snapshot for offline/demo contexts where the endpoint is unreachable.

### Expected query result (for fallback / offline use)

| Component | Material | Property | Value | Unit |
|-----------|----------|----------|-------|------|
| Pulley Wheel | PA6GF30 | tensile strength | 140 | MPa |
| Pulley Wheel | PA6GF30 | elastic modulus | 9800 | MPa |
| Pulley Wheel | PA6GF30 | impact strength | 74 | kJ/m² |
| Pulley Wheel | PA6GF30 | melting point | 223 | °C |
| Tensioner Bracket | Steel 316/4401 | tensile strength | ~580 | MPa |
| Tensioner Bracket | Steel 316/4401 | yield strength | ~280 | MPa |
| Tensioner Bracket | Steel 316/4401 | elongation at fracture | ~45 | % |

*(values confirmed from live endpoint before embedding fallback)*

---

## 3. Page Architecture

All static files — no server, no backend, no JavaScript framework.

```
index.html                  ← landing page (hero + pipeline simulator + result table)
detail-catena-x.html        ← deep dive: Catena-X PA6GF30 pipeline
detail-mfg-x.html           ← deep dive: Manufacturing-X Steel pipeline
detail-query.html           ← deep dive: cross-dataspace SPARQL query explained
css/style.css               ← all styles
js/main.js                  ← modal open/close + step animation (vanilla JS only)
assets/pipeline-diagram.svg ← existing SVG from data portal (reuse or adapt)
assets/tension-pulley.svg   ← schematic of the assembly (create or source)
```

### Content Security Policy

Each HTML page includes a `<meta http-equiv="Content-Security-Policy">` tag:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' https://dataportal.material-digital.de;
img-src 'self' data:;
```

`unsafe-inline` for style is required for the colored `<span>` token highlighting in code blocks. No inline scripts — all JS is in `js/main.js`.

---

## 4. Landing Page (`index.html`)

### 4.1 Hero section

Full-viewport-height opening panel.

- **Headline:** "One Assembly. Two Dataspaces. One Query."
- **Subhead:** "How PMDCO bridges incompatible industrial schemas across Catena-X and Manufacturing-X."
- Two "origin badges" below the headline: `[Catena-X]` `[Manufacturing-X]`. Badge anatomy: pill shape (`border-radius: 9999px`), `--catx-blue` / `--mfgx-purple` background, white text, `0.75rem` font size, `0.25rem 0.75rem` padding. No icon.
- A schematic assembly diagram (`assets/tension-pulley.svg`): `viewBox="0 0 640 200"`, two labeled component boxes connected by lines to a central assembly node. Left box: "Pulley Wheel / PA6GF30" with `--catx-blue` fill. Right box: "Tensioner Bracket / Steel 316/4401" with `--mfgx-purple` fill. Center node: "Tension Pulley Assembly". No engineering detail — colored boxes + labels only.
- CTA button: "See the demo ↓" — smooth-scrolls to the pipeline simulator

### 4.2 Problem statement (narrow centered column)

3–4 sentences. No bullet lists here — prose only, matching whitepaper register.

> Catena-X and Manufacturing-X each expose material data through their own schemas — SAMM aspect models for polymer properties, AAS 3.0 inspection documents for steel certifications. A conventional integration requires a bespoke adapter for every pair of schemas. The PMD approach is different: each dataspace's data is converted once into PMDCO-conformant RDF, loaded into a shared triplestore, and from that point forward is queryable together using SPARQL — regardless of the original format.

Below the prose: a compact N×M schema mismatch diagram showing the problem. Two approaches side by side:

```
Without PMDCO               With PMDCO
──────────────              ──────────────
CatX ──adapter──► MfgX      CatX ──► PMDCO ◄── MfgX
CatX ──adapter──► Lab             one shared layer
CatX ──adapter──► …               N queries possible
N schemas × M targets
= N×M adapters
```

Rendered as an inline SVG or styled `<pre>` block. No animation. Purpose: make the integration problem visceral before the pipeline simulator shows the solution.

### 4.3 Pipeline Simulator (main interactive section)

The visual centerpiece. Laid out as an annotated flow diagram with clickable nodes.

#### Layout

```
╔══════════════╗      ╔════════════════╗
║ Catena-X     ║──┐   ║ Manufacturing-X ║──┐
║ SAMM JSON    ║  │   ║ AAS 3.0 JSON    ║  │
╚══════════════╝  │   ╚════════════════╝  │
                  ▼                       ▼
           ╔══════════════╗      ╔════════════════╗
           ║ PMDCO        ║      ║ PMDCO          ║
           ║ Transform    ║      ║ Transform      ║
           ╚══════════════╝      ╚════════════════╝
                  │                       │
                  └──────────┬────────────┘
                             ▼
                    ╔════════════════╗
                    ║ Assembly Graph ║
                    ║ (tension_pully)║
                    ╚════════════════╝
                             │
                             ▼
                    ╔════════════════╗
                    ║ Apache Jena    ║
                    ║ Fuseki         ║
                    ╚════════════════╝
                             │
                             ▼
                    ╔════════════════╗
                    ║ Cross-Dataspace║
                    ║ SPARQL Query   ║
                    ╚════════════════╝
```

Each box is a `<button>` element. Clicking a button opens the corresponding modal.

There is also a "▶ Run Workflow" button that animates through all steps sequentially (2500ms per step — each step lights up and its modal auto-opens, then closes before advancing).

#### Step buttons and their modals

**Step A — Catena-X Source** (color: `--catx-blue`, `--catx-bg`)

- Button label: "Catena-X\nSAMM JSON"
- Modal title: "Catena-X — PA6GF30 Material Data"
- Modal content:
  - 2-sentence description: source is a SAMM aspect model for glass-fiber polyamide retrieved via Eclipse Dataspace Connector (EDC); schema is Catena-X proprietary, not interoperable with Manufacturing-X out of the box.
  - JSON code snippet (first ~20 lines of `material_data_test_pa6gf30.json`):
    ```json
    {
      "materialInformation": {
        "materialName": "PA6GF30",
        "materialIdentifier": "Z1234"
      },
      "mechanicalProperty": {
        "impactStrength": 74,
        "youngsModulus": 9800,
        "strainAtBreak": 3,
        "stressAtBreak": 140,
        "flexuralStrength": 210
      },
      "thermophysicalProperty": {
        "meltingTemperature": 223,
        "waterAbsorption": 6.5
      }
    }
    ```
  - Note: "Schema challenge: field names like `stressAtBreak` are Catena-X SAMM-specific. No shared unit annotation. No ontology link."
  - "View full pipeline →" link to `detail-catena-x.html`

**Step B — Manufacturing-X Source** (color: `--mfgx-purple`, `--mfgx-bg`)

- Button label: "Manufacturing-X\nAAS 3.0 JSON"
- Modal title: "Manufacturing-X — Steel 316/4401 Inspection Document"
- Modal content:
  - 2-sentence description: source is an AAS 3.0 inspection certificate for cold-rolled stainless steel following EN 10204; structure is fundamentally different from the Catena-X SAMM schema — a different ontology, different property naming, different unit representation.
  - JSON snippet (AAS 3.0 structure, first 20 lines)
  - Note: "Schema challenge: AAS submodel tree structure, `idShort` references, EN 10204 section codes — none of which align with the Catena-X SAMM keys."
  - "View full pipeline →" link to `detail-mfg-x.html`

**Step C — PMDCO Transformation** (color: `--pmdco-green`, `--pmdco-bg`)

- Button label: "PMDCO\nTransformation"
- Modal title: "Mapping to PMDCO — Common Semantic Ground"
- Modal content:
  - 2-sentence description: each dataspace's data is converted independently to PMDCO-conformant RDF; for Catena-X this uses YARRRML + RDFConverter + a SPARQL INSERT; for Manufacturing-X the AAS2KG tool produces RDF, then a SPARQL CONSTRUCT maps to PMDCO qualities and QUDT units.
  - Two-tab panel: **"Catena-X path"** | **"Manufacturing-X path"**
    - CatX tab: SPARQL INSERT snippet (key lines of `pmdco-mapping-insert.sparql`)
    - MfgX tab: SPARQL CONSTRUCT snippet (`InspectionDocument_AAS2KG_mapping.sparql`)
  - Note: "Both paths output PMDCO quality individuals with QUDT-typed values. The schemas disappear; the shared ontology remains."

**Step D — Assembly Graph** (color: `--pmdco-green`, `--surface-2` border; neutral — no dedicated stage color)

- Button label: "Assembly Graph\n(Company Knowledge)"
- Modal title: "Assembly Graph — Institutional Knowledge"
- Modal content:
  - 2-sentence description: the assembly graph (`tension_pully.ttl`) is company/institutional knowledge — it describes how the tension pulley is composed of its two parts, linking to assets in each dataspace via BFO part-whole relations.
  - Full `tension_pully.ttl` as a Turtle code block (it is small, ~20 triples)
  - Note: "This is the semantic glue at the institutional level. The graph knows what the assembly is made of — without caring which dataspace each part came from."

**Step E — Apache Jena Fuseki** (color: `--fuseki-amber`, `--fuseki-bg`)

- Button label: "Apache Jena\nFuseki"
- Modal title: "Unified Knowledge Graph in Fuseki"
- Modal content:
  - 2-sentence description: all three graphs are loaded into named graphs in a shared Fuseki triplestore; from this point the data is jointly queryable via SPARQL regardless of its origin schema.
  - Summary info box:
    ```
    Named graphs loaded:
      <catena-x>        PA6GF30 material (PMDCO)
      <manufacturing-x> Steel 316/4401 (PMDCO)
      <assembly>        Tension Pulley assembly
    
    Total: ~500 triples across 3 graphs
    SPARQL endpoint: dataportal.material-digital.de/.../fuseki/$/sparql
    ```
  - Note: "The three graphs are kept separate (named graphs) but are queryable together. The original source schemas are no longer relevant — only the PMDCO alignment matters."

**Step F — Cross-Dataspace SPARQL Query** (color: `--query-teal`, `--query-bg`; gradient accent `--catx-blue` → `--mfgx-purple` on header bar)

- Button label: "Cross-Dataspace\nSPARQL Query"
- Modal title: "Cross-Dataspace Query — SPARQL UNION"
- Modal content:
  - 2-sentence description: a single SPARQL SELECT with UNION handles the two different PMDCO graph patterns — one for Catena-X (material node → quality → datum → qv) and one for Manufacturing-X (quality directly on component); this is the query that could not exist without a shared ontology.
  - Full `cross_dataspace_query.sparql` as a code block
  - "↓ See live results below" button — smooth-scrolls to the §4.4 result section (no pre-baked table in the modal)
  - "Explore the full query →" link to `detail-query.html`

### 4.4 Result section (below pipeline)

A live query result section with heading:

> **Query result: components and material properties from both dataspaces**

On first scroll into the section (Intersection Observer, fires once): the page POSTs the query to the Fuseki SPARQL endpoint via `application/x-www-form-urlencoded` with `Accept: application/sparql-results+json`. The SPARQL query text is an inline constant in `js/main.js` — not fetched from the portal at runtime. Result is rendered into a table matching the SELECT columns:
`?componentLabel | ?material | ?property | ?value | ?unitLabel`

Styled with alternating row colors, component group highlighted in their respective dataspace color (blue rows for Pulley Wheel / CatX, purple rows for Tensioner Bracket / MfgX).

Loading state: spinner + "Querying Fuseki endpoint…" message. Error/timeout state: falls back to static embedded result snapshot and shows badge "Cached result". On successful live fetch: badge "Live · HH:MM" (UTC, formatted at render time) appears next to the table heading. A small "↻ Re-run query" button allows manual refresh (clears observer guard and re-fetches).

The Fuseki SPARQL endpoint URL and query content are configurable constants at the top of `js/main.js` — not hardcoded inline.

### 4.5 Footer

- Link to the source dataset on dataportal.material-digital.de
- Link to the white paper (if/when published)
- Link to Platform MaterialDigital
- "Built with: PMDCO · Apache Jena Fuseki · RDFConverter · YARRRML"

---

## 5. Detail Pages

Each detail page:
- Has a shared `<nav>` at the top linking all four pages: "Demo" · "Catena-X pipeline" · "Manufacturing-X pipeline" · "SPARQL query". Active page is visually indicated (bold or underline). Implemented as a single `<nav class="site-nav">` block, identical across all pages.
- Uses the same CSS as `index.html`
- Is self-contained (no pipeline simulator — just explanation + code)
- Links to the actual live files on dataportal.material-digital.de

### `detail-catena-x.html` — Catena-X Pipeline

Sections:
1. **Source: SAMM Aspect Model** — what the PA6GF30 JSON looks like, what SAMM is, why it is not interoperable by default
2. **Step 1: JSON → RDF (YARRRML + RDFConverter)** — YARRRML mapping snippet, link to mappings group at `futurecarproduction.materialsdata.space/group/mappings`
3. **Step 2: SAMM/RDF → PMDCO (SPARQL INSERT)** — full `pmdco-mapping-insert.sparql` with inline annotations explaining each clause
4. **Output** — TTL snippet showing a PMDCO quality individual with QUDT unit

### `detail-mfg-x.html` — Manufacturing-X Pipeline

Sections:
1. **Source: AAS 3.0 Inspection Document** — what AAS 3.0 / EN 10204 is, JSON snippet
2. **Step 1: AAS → RDF (py-aas-rdf + AAS2KG)** — tool chain description
3. **Step 2: AAS/RDF → PMDCO (SPARQL CONSTRUCT)** — `InspectionDocument_AAS2KG_mapping.sparql` with annotations, link to `steel-inspection-document-mapro` dataset
4. **Output** — TTL snippet showing steel properties as PMDCO qualities

### `detail-query.html` — Cross-Dataspace SPARQL

Sections:
1. **Why a UNION is needed** — explains the two different PMDCO graph patterns (CatX has intermediate material node; MfgX links quality directly to component)
2. **The full query** — `cross_dataspace_query.sparql` with line-by-line annotations
3. **The result** — the result table again, with column explanations
4. **Live SPARQL endpoint** — link to the Fuseki endpoint on dataportal.material-digital.de

---

## 6. Visual Design

### Color palette (CSS custom properties)

```css
:root {
  /* Brand */
  --pmd-blue:       #1565C0;
  --pmd-blue-light: #E3F2FD;

  /* Dataspaces */
  --catx-blue:    #1E40AF;
  --catx-bg:      #EFF6FF;
  --mfgx-purple:  #6D28D9;
  --mfgx-bg:      #F5F3FF;

  /* Pipeline stages */
  --pmdco-green:  #065F46;
  --pmdco-bg:     #ECFDF5;
  --fuseki-amber: #92400E;
  --fuseki-bg:    #FFFBEB;
  --query-teal:   #0E7490;
  --query-bg:     #F0F9FF;

  /* Neutrals */
  --surface:      #FFFFFF;
  --surface-2:    #F8FAFC;
  --border:       #E2E8F0;
  --text-primary: #0F172A;
  --text-muted:   #64748B;

  /* Code */
  --code-bg:      #0F172A;
  --code-fg:      #E2E8F0;
  --code-comment: #64748B;
  --code-keyword: #93C5FD;
  --code-string:  #86EFAC;
  --code-number:  #FCA5A5;

  /* Layout */
  --max-width:    1200px;
  --radius:       8px;
  --radius-lg:    16px;
}
```

### Typography

- Body: `system-ui, 'Segoe UI', -apple-system, sans-serif` — no web font download required
- Code: `ui-monospace, 'JetBrains Mono', 'Fira Code', monospace` — system monospace first; JetBrains Mono / Fira Code only if already installed on the visitor's machine. No web font download.
- Heading scale: 2.5rem (h1) / 1.75rem (h2) / 1.25rem (h3)
- Body: 1rem / 1.625 line-height — matches whitepaper readability

### Pipeline node styling

Each pipeline step button:
- Rounded card (`border-radius: var(--radius-lg)`)
- Colored left border (4px, dataspace or stage color)
- Background from stage's `--*-bg` variable
- Icon (SVG) + step label + short descriptor line
- `cursor: pointer`, hover: slight elevation (`box-shadow`)
- Active/selected state: colored border becomes full border, slight scale-up

### Modals

- Centered overlay, max-width 720px
- White background, large border-radius
- Header bar in the step's color
- Code blocks: full-bleed dark background within modal
- Scrollable body (max-height 60vh)
- Close button (×) top right
- Bottom row: "View full details →" link + close button

### Code blocks

Dark theme. No external syntax highlighter — hand-highlight key tokens with inline `<span>` elements to keep the page fully self-contained (no external dependency). Token classes and their palette mappings:

| Class | Color variable | Use |
|-------|---------------|-----|
| `.kw` | `--code-keyword` (`#93C5FD`) | SPARQL/Turtle keywords (`SELECT`, `WHERE`, `a`, `PREFIX`) |
| `.str` | `--code-string` (`#86EFAC`) | Quoted strings and IRI literals |
| `.num` | `--code-number` (`#FCA5A5`) | Numeric literals |
| `.cm` | `--code-comment` (`#64748B`) | Comments (`#`, `//`) |

Only the most semantically significant tokens per snippet are hand-highlighted — not every keyword. This keeps authoring cost low while still providing visual structure.

---

## 7. Interaction Behavior (JavaScript)

Vanilla JS only. No frameworks.

### Modal system

```
openModal(stepId)  → show overlay, render step content, trap focus
closeModal()       → hide overlay, restore focus
```

Overlay click or Escape key closes the modal.

### Step animation ("Run Workflow")

"▶ Run Workflow" button:
1. Disable button during run
2. Steps A and B activate simultaneously (both source nodes light up at once — reflecting the independent parallel nature of the two dataspace pipelines). Modal opens for Step A (Catena-X) for 2500ms, then closes. Step B (Manufacturing-X) modal opens for 2500ms, then closes. Both nodes remain in `active` state.
3. For each remaining step in order (C → D → E → F):
   - Add `active` class to step button
   - Open modal for that step
   - Wait 2500ms
   - Close modal
   - Move to next step
4. After last step: scroll to result table, highlight it briefly
5. Re-enable button

### Step state

Three visual states per button: default / active (currently selected) / completed (has been visited). Completed state persists until page reload. Clicking any step in any state opens its modal and sets it to active.

### SPARQL fetch lifecycle

The result section uses an Intersection Observer (`threshold: 0.3`) to trigger the fetch when the section enters the viewport. The observer is disconnected immediately after the first trigger (`observer.disconnect()`) — subsequent scrolls or the Run Workflow scroll-to-result do not re-trigger it. If a fetch is already pending, new triggers are no-ops.

Fetch uses `AbortController` with a **10-second timeout**. If the fetch does not complete within 10s (or the endpoint returns an error), the page falls back to the static embedded result snapshot and shows a small notice: "Live endpoint unreachable — showing cached result."

### SPARQL result rendering

Parse the SPARQL JSON response (`application/sparql-results+json`): iterate `data.results.bindings`, mapping each binding object's `.value` properties to table column values (`componentLabel`, `material`, `property`, `value`, `unitLabel`). All binding values must be inserted into table cells using `td.textContent = value` — never `innerHTML`. Treat all server-returned values as untrusted strings regardless of data source.

---

## 8. Content Guidelines

- All modal code snippets (Steps A–E) are hardcoded in the HTML source at authoring time — copied from live portal files, not fetched at runtime. Only the §4.4 result section makes a runtime network request.
- Prose matches whitepaper register: precise, no marketing language, no bullet-heavy lists in descriptive sections
- Acronyms always expanded on first use: PMDCO, SAMM, AAS, EDC, SPARQL, QUDT, BFO
- All code snippets are real (taken from actual files on dataportal.material-digital.de). Snippets are copied manually from live portal files during HTML authoring — before implementation begins and not at build time. If a source file changes after authoring, snippets must be updated manually.
- No simulated or invented data — all values trace to the live source files
- Result table values pulled from the actual SPARQL query result against the Fuseki endpoint

---

## 9. Out of Scope

- User authentication or accounts
- Data upload or file processing
- Responsive/mobile layout (desktop-first; mobile is nice-to-have)
- Internationalization
- JavaScript frameworks (React, Vue, etc.)
- CSS frameworks (Bootstrap, Tailwind)
- Build tooling (webpack, vite) — plain HTML/CSS/JS

---

## 10. Success Criteria

**Aspirational goal:** A technical evaluator unfamiliar with PMDCO should be able to describe the role of PMDCO in one sentence after completing the Run Workflow animation. Validate informally with one internal test session before first public demo.

1. Every pipeline step modal opens without errors and displays its correct content
2. Every pipeline step has a clickable modal with real data (actual TTL/JSON/SPARQL snippets from the live portal files)
3. The result table shows real property values for both assembly components
4. The SPARQL UNION pattern is explained clearly enough that a technical reader understands *why* the UNION is needed
5. "▶ Run Workflow" animation works end-to-end without errors
6. All four HTML files are deployable as a static site (GitHub Pages or equivalent). The live SPARQL result is shown when served over HTTP; the static fallback is shown when opening locally from the filesystem.
7. Detail pages link back to the live source files on dataportal.material-digital.de
8. All three detail pages render without errors and all code snippet blocks display the correct content sourced from the live portal files

---

## 11. References

- Dataset: [dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo](https://dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo)
- CatX pipeline detail: [dataportal.material-digital.de/dataset/cross-project-use-case](https://dataportal.material-digital.de/dataset/cross-project-use-case)
- MfgX pipeline detail: [dataportal.material-digital.de/dataset/steel-inspection-document-mapro](https://dataportal.material-digital.de/dataset/steel-inspection-document-mapro)
- SAMM mappings: [futurecarproduction.materialsdata.space/group/mappings](https://futurecarproduction.materialsdata.space/group/mappings)
- PMDCO: [w3id.org/pmd/co](https://w3id.org/pmd/co)
- White paper (in progress): `semantics-industry-whitepaper/whitepaper.md`
- DataPipeline docs: `DataPipeline/docs/`
