// ── Configurable constants ──────────────────────────────────────────────────
const SPARQL_ENDPOINT =
  'https://dataportal.material-digital.de/dataset/203bde74-4e5f-4a74-a1d8-261e0f8ca84a/fuseki/$/sparql';

const SPARQL_QUERY = `PREFIX rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
PREFIX obo:   <http://purl.obolibrary.org/obo/>
PREFIX pmd:   <https://w3id.org/pmd/co/>
PREFIX tto:   <https://w3id.org/pmd/tto/>
PREFIX qudt:  <https://qudt.org/schema/qudt/>
PREFIX ex:    <http://example.org/assembly/>

SELECT ?componentLabel
       (COALESCE(?materialLabel, ?componentLabel) AS ?material)
       ?property ?value ?unitLabel
WHERE {
    ex:TensionPulley_001 obo:BFO_0000051 ?component .
    ?component rdfs:label ?componentLabel .
    {
      ?component obo:BFO_0000051 ?mat .
      ?mat rdfs:label ?materialLabel .
      ?mat obo:RO_0000086 ?quality .
      ?quality a ?qualityType .
      ?quality obo:IAO_0000417 ?datum .
      ?datum obo:OBI_0001938 ?qv .
      ?qv qudt:numericValue ?value .
      OPTIONAL { ?qv qudt:unit ?unit }
      BIND(STRAFTER(STR(?unit), "unit/") AS ?unitLabel)
    }
    UNION
    {
      ?component obo:RO_0000086 ?quality .
      ?quality a ?qualityType .
      ?quality obo:OBI_0001938 ?qv .
      ?qv pmd:PMD_0000006 ?value .
      OPTIONAL { ?qv obo:IAO_0000039 ?unit }
      BIND(STRAFTER(STR(?unit), "qudt/") AS ?unitLabel)
    }
    OPTIONAL { ?quality rdfs:label ?instanceLabel }
    OPTIONAL {
      VALUES (?qualityType ?typeLabel) {
        (tto:TTO_0000009  "yield strength")
        (tto:TTO_0000033  "elongation at fracture")
        (tto:TTO_0000053  "tensile strength")
        (pmd:PMD_0000618  "elastic modulus")
        (pmd:PMD_0000851  "melting point")
        (pmd:PMD_0000518  "impact strength")
      }
    }
    BIND(COALESCE(?instanceLabel, ?typeLabel, STRAFTER(STR(?quality), "-qual-")) AS ?property)
    FILTER(str(?property) != "")
}
ORDER BY ?componentLabel ?property`;

const FETCH_TIMEOUT_MS = 10000;

// KG inspector COUNT queries
const KG_QUERIES = {
  total:    'SELECT (COUNT(*) AS ?c) WHERE { ?s ?p ?o }',
  samm:     'SELECT (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a ?t . FILTER(STRSTARTS(STR(?t), "urn:samm:io.catenax")) }',
  aas:      'SELECT (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a ?t . FILTER(STRSTARTS(STR(?t), "https://admin-shell.io/")) }',
  pmdco:    'SELECT (COUNT(DISTINCT ?s) AS ?c) WHERE { ?s a ?t . FILTER(STRSTARTS(STR(?t), "https://w3id.org/pmd/")) }',
  assembly: 'SELECT (COUNT(*) AS ?c) WHERE { <http://example.org/assembly/TensionPulley_001> ?p ?o }',
};

// ── Node state ───────────────────────────────────────────────────────────────
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

function resetAllNodes() {
  Object.keys(nodeState).forEach(id => setNodeState(id, 'pending'));
  // reset result tables
  const full = document.getElementById('result-table-full');
  if (full) {
    const tbody = full.querySelector('tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem;">Run the Cross-Dataspace Query node to fetch live results.</td></tr>';
  }
  const preview = document.getElementById('result-table');
  if (preview) {
    const tbody = preview.querySelector('tbody');
    if (tbody) tbody.innerHTML = '';
  }
  document.getElementById('kg-result-preview').style.display = 'none';
  document.getElementById('kg-latest').textContent = 'Run a node to see live data.';
  document.getElementById('kg-latest').className = 'kg-latest-result';
  sparqlInFlight = false;
}

// ── Modal system ─────────────────────────────────────────────────────────────
function openModal(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  overlay.classList.add('open');
  const focusable = overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
  if (focusable.length) focusable[0].focus();
}

function closeModal() {
  const open = document.querySelector('.modal-overlay.open');
  if (!open) return;
  open.classList.remove('open');
  if (lastOpenedNode) {
    const btn = document.querySelector(`[data-node="${lastOpenedNode}"]`);
    if (btn) btn.focus();
  }
}

// Escape key + overlay click
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeModal();
});
document.querySelectorAll('.modal-overlay').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
});
document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
  btn.addEventListener('click', closeModal);
});

// Focus trap
document.addEventListener('keydown', e => {
  const open = document.querySelector('.modal-overlay.open');
  if (!open || e.key !== 'Tab') return;
  const focusable = Array.from(open.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

// ── Run buttons (per-node) ───────────────────────────────────────────────────
document.querySelectorAll('.wf-run-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const nodeId  = btn.dataset.node;
    const modalId = btn.dataset.modal;
    lastOpenedNode = nodeId;
    setNodeState(nodeId, 'running');
    openModal(modalId);
  });
});

// ── Mark complete buttons (inside modals) ────────────────────────────────────
document.querySelectorAll('.modal-complete-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const nodeId = btn.dataset.complete;
    closeModal();
    setNodeState(nodeId, 'done');
    refreshKGStats();
    if (nodeId === 'F') {
      triggerSPARQLFetch();
    }
  });
});

// ── Tab toggle in Step C modal ───────────────────────────────────────────────
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

// ── Reset ────────────────────────────────────────────────────────────────────
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) resetBtn.addEventListener('click', resetAllNodes);

// ── Re-run buttons ───────────────────────────────────────────────────────────
['rerun-btn', 'rerun-btn-full'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => {
    sparqlInFlight = false;
    triggerSPARQLFetch();
  });
});

// ── CSS connector state updates ───────────────────────────────────────────────
function updateDAGConnectors() {
  // Top funnel: each line lights up when its source node is done
  const connMap = { A: 'catx-line', B: 'mfgx-line', D: 'asm-line' };
  Object.entries(connMap).forEach(([nodeId, cls]) => {
    const line = document.querySelector(`.dag-conn-line.${cls}`);
    if (!line) return;
    line.classList.toggle('line-active', nodeState[nodeId] === 'done');
  });

  // Merge bar — active when any source is done
  const merge = document.querySelector('.dag-conn-merge');
  if (merge) {
    const anySource = ['A', 'B', 'D'].some(id => nodeState[id] === 'done');
    merge.style.background = anySource ? '#22c55e' : '';
  }

  // Mid connector (Fuseki → PMDCO): active when A or B done
  const mid = document.querySelector('#dag-conn-mid .dag-vert-line');
  if (mid) mid.classList.toggle('line-active', nodeState.A === 'done' || nodeState.B === 'done');

  // Bot connector (PMDCO → Query): active when C done
  const bot = document.querySelector('#dag-conn-bot .dag-vert-line');
  if (bot) bot.classList.toggle('line-active', nodeState.C === 'done');
}

// ── KG Inspector ─────────────────────────────────────────────────────────────
async function sparqlCount(query) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
      },
      body: 'query=' + encodeURIComponent(query),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) return null;
    const data = await resp.json();
    const val = data?.results?.bindings?.[0]?.c?.value;
    return val != null ? parseInt(val, 10) : null;
  } catch {
    clearTimeout(tid);
    return null;
  }
}

async function refreshKGStats() {
  const ids = { total: 'kg-total', samm: 'kg-samm', aas: 'kg-aas', pmdco: 'kg-pmdco', assembly: 'kg-assembly' };

  // Set loading state
  Object.values(ids).forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '…'; el.className = 'kg-stat-value loading'; }
  });

  const latestEl = document.getElementById('kg-latest');

  // Fire all queries in parallel
  const results = await Promise.all(
    Object.entries(KG_QUERIES).map(([key, q]) => sparqlCount(q).then(n => [key, n]))
  );

  const totalVal = results.find(([k]) => k === 'total')?.[1];

  results.forEach(([key, n]) => {
    const elId = ids[key];
    const el = document.getElementById(elId);
    if (!el) return;
    if (n === null) {
      el.textContent = totalVal == null ? '—' : '0';
      el.className = 'kg-stat-value' + (totalVal == null ? ' loading' : '');
    } else {
      el.textContent = n.toLocaleString();
      el.className = 'kg-stat-value';
    }
  });

  if (latestEl && totalVal != null) {
    latestEl.textContent = `Fuseki live · ${totalVal.toLocaleString()} total triples`;
    latestEl.className = 'kg-latest-result has-data';
  }
  // On failure: leave the "Run a node" placeholder — don't show an error
}

const kgRefreshBtn = document.getElementById('kg-refresh-btn');
if (kgRefreshBtn) kgRefreshBtn.addEventListener('click', refreshKGStats);

// ── SPARQL result fetch ───────────────────────────────────────────────────────
function showResultTable(bindings, tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  bindings.forEach(binding => {
    const tr = document.createElement('tr');
    const label = binding.componentLabel?.value ?? '';
    tr.className = label.toLowerCase().includes('pulley') || label.toLowerCase().includes('wheel')
      ? 'row-catx' : 'row-mfgx';

    // compact preview: skip material col
    const cols = tableId === 'result-table'
      ? ['componentLabel', 'property', 'value', 'unitLabel']
      : ['componentLabel', 'material', 'property', 'value', 'unitLabel'];

    cols.forEach(col => {
      const td = document.createElement('td');
      td.textContent = binding[col]?.value ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

async function triggerSPARQLFetch() {
  if (sparqlInFlight) return;
  sparqlInFlight = true;

  const preview = document.getElementById('kg-result-preview');
  const spinnerInline = document.getElementById('result-spinner-inline');
  const badgeInline = document.getElementById('result-badge-inline');
  const spinner = document.getElementById('result-spinner');
  const badge = document.getElementById('result-badge');

  if (preview) preview.style.display = 'block';
  if (spinnerInline) spinnerInline.style.display = 'block';
  if (spinner) spinner.style.display = 'inline';

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(SPARQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
      },
      body: 'query=' + encodeURIComponent(SPARQL_QUERY),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const bindings = data?.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error('Bad SPARQL JSON');

    const now = new Date();
    const hhmm = now.toUTCString().slice(17, 22);
    const liveText = `Live · ${hhmm} UTC`;

    if (badgeInline) { badgeInline.className = 'badge-live'; badgeInline.textContent = liveText; }
    if (badge) { badge.className = 'badge-live'; badge.textContent = liveText; }

    showResultTable(bindings, 'result-table');
    showResultTable(bindings, 'result-table-full');

    const latestEl = document.getElementById('kg-latest');
    if (latestEl) {
      latestEl.textContent = `Query returned ${bindings.length} rows — live from Fuseki.`;
      latestEl.className = 'kg-latest-result has-data';
    }
  } catch (err) {
    clearTimeout(tid);
    const cachedText = 'Cached result';
    if (badgeInline) { badgeInline.className = 'badge-cached'; badgeInline.textContent = cachedText; }
    if (badge) { badge.className = 'badge-cached'; badge.textContent = cachedText; }
    console.info('SPARQL fetch failed, fallback shown:', err.message);
  } finally {
    if (spinnerInline) spinnerInline.style.display = 'none';
    if (spinner) spinner.style.display = 'none';
    sparqlInFlight = false;
  }
}

// Intersection Observer on the full result section (auto-trigger if node F done)
const resultSection = document.getElementById('result');
if (resultSection) {
  const obs = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    if (nodeState.F === 'done') triggerSPARQLFetch();
  }, { threshold: 0.3 });
  obs.observe(resultSection);
}
