import initOxigraph, { Store, namedNode } from '../vendor/oxigraph.js';

// ── Named graph IRIs ──────────────────────────────────────────────────────────
const GRAPH_IRI = {
  catx:     'urn:graph:catx',
  mfgx:     'urn:graph:mfgx',
  assembly: 'urn:graph:assembly',
  labels:   'urn:graph:pmdco-labels',
};

// ── Oxigraph store (initialised once) ────────────────────────────────────────
// namedNode() cannot be called until WASM is ready — create NamedNode objects
// inside storeReady, not at module-load time.
let store = null;
let GRAPH = {};
const storeReady = initOxigraph().then(() => {
  store = new Store();
  GRAPH = Object.fromEntries(
    Object.entries(GRAPH_IRI).map(([k, v]) => [k, namedNode(v)])
  );
});

// ── Cross-dataspace query ─────────────────────────────────────────────────────
// Both catx-data.ttl and mfgx-pmdco.ttl follow the same PMDCO graph pattern:
//   component → BFO_0000051 → material → RO_0000086 → quality
//                                         → IAO_0000417 → datum → OBI_0001938 → qv
// PMDCO as shared vocabulary makes this single query possible across two dataspaces.
const SPARQL_QUERY = `
PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
PREFIX obo:   <http://purl.obolibrary.org/obo/>
PREFIX pmd:   <https://w3id.org/pmd/co/>
PREFIX tto:   <https://w3id.org/pmd/tto/>
PREFIX qudt:  <https://qudt.org/schema/qudt/>
PREFIX ex:    <http://example.org/assembly/>

SELECT ?componentLabel ?materialLabel ?property ?value ?unitLabel
WHERE {
  ex:TensionPulley_001 obo:BFO_0000051 ?component .
  ?component rdfs:label ?componentLabel .
  ?component obo:BFO_0000051 ?mat .
  ?mat rdfs:label ?materialLabel .
  ?mat obo:RO_0000086 ?quality .
  ?quality a ?qualityType .
  ?quality obo:IAO_0000417 ?datum .
  ?datum obo:OBI_0001938 ?qv .
  ?qv qudt:numericValue ?value .
  OPTIONAL { ?qv qudt:unit ?unit . BIND(REPLACE(STR(?unit), "^.*/", "") AS ?unitLabel) }
  VALUES (?qualityType ?property) {
    (tto:TTO_0000009 "yield strength")
    (tto:TTO_0000033 "elongation at fracture")
    (tto:TTO_0000053 "tensile strength")
    (pmd:PMD_0000618 "elastic modulus")
    (pmd:PMD_0000851 "melting point")
    (pmd:PMD_0000518 "impact strength")
  }
}
ORDER BY ?componentLabel ?property`;

// ── Node C: PMDCO augmentation INSERT ────────────────────────────────────────
// Reads quality type IRIs from both graphs and writes human-readable rdfs:label
// annotations into the dedicated pmdco-labels named graph.
const PMDCO_INSERT = `
PREFIX tto:  <https://w3id.org/pmd/tto/>
PREFIX pmd:  <https://w3id.org/pmd/co/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

INSERT { GRAPH <urn:graph:pmdco-labels> { ?quality rdfs:label ?label . } }
WHERE {
  { GRAPH <urn:graph:catx> { ?quality a ?type } }
  UNION
  { GRAPH <urn:graph:mfgx> { ?quality a ?type } }
  VALUES (?type ?label) {
    (<https://w3id.org/pmd/tto/TTO_0000053> "tensile strength")
    (<https://w3id.org/pmd/tto/TTO_0000009> "yield strength")
    (<https://w3id.org/pmd/tto/TTO_0000033> "elongation at fracture")
    (<https://w3id.org/pmd/co/PMD_0000618>  "elastic modulus")
    (<https://w3id.org/pmd/co/PMD_0000851>  "melting point")
    (<https://w3id.org/pmd/co/PMD_0000518>  "impact strength")
  }
}`;

// ── Node data sources ─────────────────────────────────────────────────────────
// Use IRI strings here — namedNode() is called inside executeNode after WASM init
const NODE_TTL = {
  A: { url: 'assets/data/catx-data.ttl',  graphIri: GRAPH_IRI.catx },
  B: { url: 'assets/data/mfgx-pmdco.ttl', graphIri: GRAPH_IRI.mfgx },
  D: { url: 'assets/data/assembly.ttl',   graphIri: GRAPH_IRI.assembly },
};

// ── KG inspector SPARQL counts ────────────────────────────────────────────────
const KG_QUERIES = {
  total:    `SELECT (COUNT(*) AS ?c) { { GRAPH ?g { ?s ?p ?o } } UNION { ?s ?p ?o } }`,
  catx:     `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:catx>     { ?s ?p ?o } }`,
  mfgx:     `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:mfgx>     { ?s ?p ?o } }`,
  assembly: `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:assembly>  { ?s ?p ?o } }`,
  labels:   `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:pmdco-labels> { ?s ?p ?o } }`,
};

// ── Node state ────────────────────────────────────────────────────────────────
const nodeState = { A: 'pending', B: 'pending', C: 'pending', D: 'pending', F: 'pending' };
let lastOpenedNode = null;
let sparqlInFlight = false;

function setNodeState(id, state) {
  nodeState[id] = state;
  const el = document.getElementById('node-' + id);
  if (!el) return;
  el.classList.remove('done', 'running');
  if (state === 'done')    el.classList.add('done');
  if (state === 'running') el.classList.add('running');
  updateDAGConnectors();
}

async function resetAllNodes() {
  Object.keys(nodeState).forEach(id => setNodeState(id, 'pending'));
  sparqlInFlight = false;
  // Reset store
  await storeReady;
  store = new Store();
  // Reset result tables
  const fullBody = document.querySelector('#result-table-full tbody');
  if (fullBody) fullBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem;">Run the Cross-Dataspace Query node to fetch results.</td></tr>';
  const prevBody = document.querySelector('#result-table tbody');
  if (prevBody) prevBody.innerHTML = '';
  const preview = document.getElementById('kg-result-preview');
  if (preview) preview.style.display = 'none';
  const latest = document.getElementById('kg-latest');
  if (latest) { latest.textContent = 'Run a node to see live data.'; latest.className = 'kg-latest-result'; }
  // Reset KG stats
  ['kg-total','kg-catx','kg-mfgx','kg-assembly','kg-labels'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.className = 'kg-stat-value'; }
  });
}

// ── Step-modal content ────────────────────────────────────────────────────────
const STEP_DURATION = 20000;
let stepTimer = null;

const MODAL_STEPS = {
  A: [
    { title: 'EDC — Catalog query',
      body: 'The Eclipse Dataspace Connector (EDC) sends a catalog query to the Catena-X provider endpoint to discover available data assets. The PA6GF30 material data asset is located by its asset IRI.' },
    { title: 'EDC — Contract negotiation',
      body: 'EDC initiates a contract negotiation with the Catena-X provider connector. Usage policies are evaluated and a short-lived transfer token is issued.' },
    { title: 'EDC — SAMM JSON retrieval',
      body: 'The EDC data plane transfers the SAMM aspect document — a Catena-X-proprietary JSON payload. Field names like <code>stressAtBreak</code> are schema-specific and carry no cross-dataspace semantics.',
      code: '{\n  "materialInformation": { "materialName": "PA6GF30", "materialIdentifier": "Z1234" },\n  "mechanicalProperty":  { "impactStrength": 74, "youngsModulus": 9800 },\n  "thermophysicalProperty": { "meltingTemperature": 223 }\n}' },
    { title: 'YARRRML + RDF Converter — mapping to PMDCO',
      body: 'A YARRRML mapping file defines rules that bind SAMM field paths to PMDCO class IRIs and QUDT unit individuals. RDFConverter executes the mapping and emits PMDCO-conformant Turtle.' },
    { title: 'Load into Triplestore',
      body: 'The 80-triple Turtle graph is loaded into the Oxigraph in-browser triplestore as named graph <code>urn:graph:catx</code>.',
      last: true },
  ],
  B: [
    { title: 'EDC — Catalog query',
      body: 'EDC queries the Manufacturing-X connector catalog to locate the AAS 3.0 inspection document for steel component 87654321.' },
    { title: 'EDC — Contract negotiation',
      body: 'Contract negotiation with the Manufacturing-X provider connector. Usage policies verified; transfer token issued for data plane access.' },
    { title: 'EDC — AAS 3.0 JSON retrieval',
      body: 'The EDC data plane returns an IDTA Asset Administration Shell 3.0 inspection document — a submodel tree with <code>idShort</code> references and EN 10204 section codes that have no direct equivalent in the Catena-X schema.',
      code: '{\n  "assetAdministrationShells": [{ "idShort": "InspectionDocumentsOfSteelProductsAAS" }],\n  "submodels": [{\n    "semanticId": { "keys": [{ "value": "https://admin-shell.io/idta/...InspectionDocumentsOfSteelProducts/1/0" }] },\n    "submodelElements": [ /* EN 10204 sections with tensile / yield / elongation values */ ]\n  }]\n}' },
    { title: 'YARRRML mapping — AAS submodel to PMDCO',
      body: 'A YARRRML mapping translates the IDTA AAS submodel tree to PMDCO-conformant Turtle: tensile strength, yield strength, and elongation values are bound to TTO quality class IRIs with QUDT unit annotations.' },
    { title: 'Load into Triplestore',
      body: 'The 121-triple PMDCO Turtle graph is loaded into Oxigraph as named graph <code>urn:graph:mfgx</code>.',
      last: true },
  ],
  C: [
    { title: 'SPARQL INSERT — quality label annotation',
      body: 'A SPARQL INSERT queries both <code>urn:graph:catx</code> and <code>urn:graph:mfgx</code> for quality individuals typed with PMDCO/TTO classes, then writes human-readable <code>rdfs:label</code> values from the PMDCO/TTO vocabulary into the triplestore.' },
    { title: 'Labels written to Triplestore',
      body: '6 quality individuals receive labels — tensile strength, yield strength, elastic modulus, elongation at fracture, melting point, impact strength — stored in named graph <code>urn:graph:pmdco-labels</code>.',
      last: true },
  ],
  D: [
    { title: 'Company Product Knowledge Graph',
      body: 'The Tension Pulley graph is institutional knowledge — a hand-authored Turtle file that describes the product structure independently of any individual dataspace.' },
    { title: 'Part references by IRI',
      body: 'Each component is identified by its IRI <em>as it appears in its home dataspace document</em>. No data is copied — the CPG holds typed pointers (BFO hasPart) to external entities.',
      code: 'ex:TensionPulley_001\n    a pmdco:Object ;\n    obo:BFO_0000051\n      <https://catena-x.net/edc/assets/urn:uuid:3f5a8c2d-…> ,\n      <https://mfg-x.2024.2de/dsp/assets/component-87654321> .' },
    { title: 'Load into Triplestore',
      body: 'The CPG is loaded into Oxigraph as named graph <code>urn:graph:assembly</code>. The assembly entity now links to both dataspace component IRIs in a single queryable graph.',
      last: true },
  ],
};

function renderStep(modalEl, nodeId, idx) {
  const steps = MODAL_STEPS[nodeId];
  if (!steps) return;
  const step  = steps[idx];
  const total = steps.length;

  const mount = modalEl.querySelector('.step-mount');
  if (mount) {
    mount.innerHTML = `
      <div class="step-header">
        <span class="step-counter">Step ${idx + 1} of ${total}</span>
        <div class="step-timer-bar">
          <div class="step-timer-fill" style="animation-duration:${step.last ? 0 : STEP_DURATION}ms"></div>
        </div>
      </div>
      <h4 class="step-title">${step.title}</h4>
      <p class="step-body-text">${step.body}</p>
      ${step.code ? `<pre class="code-block" style="margin-top:0.5rem;font-size:0.78rem">${escHtml(step.code)}</pre>` : ''}
    `;
  }

  const nav = modalEl.querySelector('.step-nav');
  if (nav) {
    if (step.last) {
      nav.innerHTML = `<button type="button" class="step-complete-btn" data-complete="${nodeId}">✓ Mark complete</button>`;
      nav.querySelector('.step-complete-btn').addEventListener('click', async () => {
        clearStepTimer();
        closeModal();
        await executeNode(nodeId);
        setNodeState(nodeId, 'done');
        refreshKGStats();
      }, { once: true });
    } else {
      nav.innerHTML = `
        <span class="step-skip-hint">auto-advances in ${STEP_DURATION / 1000}s</span>
        <button type="button" class="step-skip-btn">Skip →</button>
      `;
      nav.querySelector('.step-skip-btn').addEventListener('click', () => {
        advanceStep(modalEl, nodeId, idx);
      }, { once: true });
    }
  }
}

function advanceStep(modalEl, nodeId, idx) {
  clearStepTimer();
  const steps = MODAL_STEPS[nodeId];
  if (!steps) return;
  const next = idx + 1;
  if (next < steps.length) {
    renderStep(modalEl, nodeId, next);
    if (!steps[next].last) startStepTimer(modalEl, nodeId, next);
  }
}

function startStepTimer(modalEl, nodeId, idx) {
  clearStepTimer();
  stepTimer = setTimeout(() => advanceStep(modalEl, nodeId, idx), STEP_DURATION);
}

function clearStepTimer() {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Modal system ──────────────────────────────────────────────────────────────
function openModal(id) {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.classList.add('open');

  const nodeId = id.replace('modal-', '');
  if (MODAL_STEPS[nodeId]) {
    clearStepTimer();
    renderStep(ov, nodeId, 0);
    if (!MODAL_STEPS[nodeId][0].last) startStepTimer(ov, nodeId, 0);
  }

  const f = ov.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])');
  if (f.length) f[0].focus();
}

function closeModal() {
  clearStepTimer();
  const ov = document.querySelector('.modal-overlay.open');
  if (!ov) return;
  ov.classList.remove('open');
  if (lastOpenedNode) {
    const btn = document.querySelector(`[data-node="${lastOpenedNode}"]`);
    if (btn) btn.focus();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key !== 'Tab') return;
  const ov = document.querySelector('.modal-overlay.open');
  if (!ov) return;
  const els = Array.from(ov.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])'));
  if (!els.length) return;
  const [first, last] = [els[0], els[els.length - 1]];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
});
document.querySelectorAll('.modal-close, .modal-close-btn').forEach(b => {
  b.addEventListener('click', closeModal);
});

// ── Run buttons ───────────────────────────────────────────────────────────────
document.querySelectorAll('.wf-run-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const nodeId  = btn.dataset.node;
    const modalId = btn.dataset.modal;
    lastOpenedNode = nodeId;
    setNodeState(nodeId, 'running');
    openModal(modalId);
  });
});

// ── Mark complete ─────────────────────────────────────────────────────────────
document.querySelectorAll('.modal-complete-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const nodeId = btn.dataset.complete;
    closeModal();
    await executeNode(nodeId);
    setNodeState(nodeId, 'done');
    refreshKGStats();
    if (nodeId === 'F') triggerSPARQLQuery();
  });
});

async function executeNode(nodeId) {
  await storeReady;
  if (nodeId in NODE_TTL) {
    const { url, graphIri } = NODE_TTL[nodeId];
    const resp = await fetch(url);
    const ttl  = await resp.text();
    store.load(ttl, { format: 'text/turtle', to_graph_name: namedNode(graphIri) });
  } else if (nodeId === 'C') {
    store.update(PMDCO_INSERT);
  }
}

// ── Tab toggle ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    const targetId = tabBtn.dataset.tab;
    const modal = tabBtn.closest('.modal-box');
    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    modal.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tabBtn.classList.add('active');
    const panel = document.getElementById(targetId);
    if (panel) panel.classList.add('active');
  });
});

// ── Reset ─────────────────────────────────────────────────────────────────────
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) resetBtn.addEventListener('click', resetAllNodes);

// ── Re-run query buttons ──────────────────────────────────────────────────────
['rerun-btn', 'rerun-btn-full'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => { sparqlInFlight = false; triggerSPARQLQuery(); });
});

// ── CSS connector state ───────────────────────────────────────────────────────
function updateDAGConnectors() {
  const connMap = { A: 'catx-line', B: 'mfgx-line', D: 'asm-line' };
  Object.entries(connMap).forEach(([nid, cls]) => {
    const line = document.querySelector(`.dag-conn-line.${cls}`);
    if (!line) return;
    line.classList.toggle('line-active', nodeState[nid] === 'done');
  });

  const mergeL = document.querySelector('#dag-merge-l');
  if (mergeL) mergeL.classList.toggle('line-active', nodeState.A === 'done');
  const mergeR = document.querySelector('#dag-merge-r');
  if (mergeR) mergeR.classList.toggle('line-active', nodeState.D === 'done');
  const anySource = ['A','B','D'].some(id => nodeState[id] === 'done');
  const stem = document.querySelector('#dag-conn-stem');
  if (stem) stem.classList.toggle('line-active', anySource);

  const mid = document.querySelector('#dag-conn-mid .dag-vert-line');
  if (mid) mid.classList.toggle('line-active', nodeState.A === 'done' || nodeState.B === 'done');

  const bot = document.querySelector('#dag-conn-bot .dag-vert-line');
  if (bot) bot.classList.toggle('line-active', nodeState.C === 'done');
}

// ── KG Inspector ──────────────────────────────────────────────────────────────
function sparqlCount(query) {
  if (!store) return 0;
  try {
    const results = store.query(query);
    const rows = [...results];
    return rows.length > 0 ? parseInt(rows[0].get('c')?.value ?? '0', 10) : 0;
  } catch { return 0; }
}

async function refreshKGStats() {
  await storeReady;
  const ids = {
    total:    'kg-total',
    catx:     'kg-catx',
    mfgx:     'kg-mfgx',
    assembly: 'kg-assembly',
    labels:   'kg-labels',
  };

  Object.entries(KG_QUERIES).forEach(([key, q]) => {
    const el = document.getElementById(ids[key]);
    if (!el) return;
    el.textContent = '…';
    el.className = 'kg-stat-value loading';
  });

  // Run all counts (synchronous Oxigraph, but wrap in setTimeout to allow repaint)
  setTimeout(() => {
    Object.entries(KG_QUERIES).forEach(([key, q]) => {
      const el = document.getElementById(ids[key]);
      if (!el) return;
      const n = sparqlCount(q);
      el.textContent = n.toLocaleString();
      el.className = 'kg-stat-value' + (n === 0 ? ' empty' : '');
    });
    const total = sparqlCount(KG_QUERIES.total);
    const latest = document.getElementById('kg-latest');
    if (latest && total > 0) {
      latest.textContent = `In-browser Oxigraph · ${total.toLocaleString()} total triples`;
      latest.className = 'kg-latest-result has-data';
    }
  }, 50);
}

const kgRefreshBtn = document.getElementById('kg-refresh-btn');
if (kgRefreshBtn) kgRefreshBtn.addEventListener('click', refreshKGStats);

// ── Cross-dataspace SPARQL query ──────────────────────────────────────────────
function showResultTable(bindings, tableId, cols) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  bindings.forEach(row => {
    const tr = document.createElement('tr');
    const lbl = row.get('componentLabel')?.value ?? '';
    tr.className = lbl.toLowerCase().includes('pulley') || lbl.toLowerCase().includes('wheel')
      ? 'row-catx' : 'row-mfgx';
    cols.forEach(col => {
      const td = document.createElement('td');
      td.textContent = row.get(col)?.value ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function triggerSPARQLQuery() {
  if (sparqlInFlight) return;
  sparqlInFlight = true;

  const preview        = document.getElementById('kg-result-preview');
  const spinnerInline  = document.getElementById('result-spinner-inline');
  const badgeInline    = document.getElementById('result-badge-inline');
  const spinner        = document.getElementById('result-spinner');
  const badge          = document.getElementById('result-badge');

  if (preview)       preview.style.display = 'block';
  if (spinnerInline) spinnerInline.style.display = 'block';
  if (spinner)       spinner.style.display = 'inline';

  await storeReady;

  try {
    const allGraphs = Object.values(GRAPH);
    const results = store.query(SPARQL_QUERY, { default_graph: allGraphs });
    const bindings = [...results];

    const liveText = `Live · Oxigraph in-browser`;
    if (badgeInline) { badgeInline.className = 'badge-live'; badgeInline.textContent = liveText; }
    if (badge)       { badge.className = 'badge-live';       badge.textContent = liveText; }

    const previewCols = ['componentLabel', 'property', 'value', 'unitLabel'];
    const fullCols    = ['componentLabel', 'materialLabel', 'property', 'value', 'unitLabel'];
    showResultTable(bindings, 'result-table',      previewCols);
    showResultTable(bindings, 'result-table-full', fullCols);

    const latest = document.getElementById('kg-latest');
    if (latest) {
      latest.textContent = `Query returned ${bindings.length} rows — Oxigraph in-browser.`;
      latest.className = 'kg-latest-result has-data';
    }
  } catch (err) {
    const errText = 'Query error — check console';
    if (badgeInline) { badgeInline.className = 'badge-cached'; badgeInline.textContent = errText; }
    if (badge)       { badge.className = 'badge-cached';       badge.textContent = errText; }
    console.error('SPARQL query failed:', err);
  } finally {
    if (spinnerInline) spinnerInline.style.display = 'none';
    if (spinner)       spinner.style.display = 'none';
    sparqlInFlight = false;
  }
}

// Auto-trigger query when result section scrolls into view and node F is done
const resultSection = document.getElementById('result');
if (resultSection) {
  const obs = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    if (nodeState.F === 'done') triggerSPARQLQuery();
  }, { threshold: 0.3 });
  obs.observe(resultSection);
}
