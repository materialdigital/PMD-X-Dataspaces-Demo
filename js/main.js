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

// ── Modal system ──────────────────────────────────────────────────────────────
function openModal(id) {
  const ov = document.getElementById(id);
  if (!ov) return;
  ov.classList.add('open');
  const f = ov.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])');
  if (f.length) f[0].focus();
}

function closeModal() {
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
