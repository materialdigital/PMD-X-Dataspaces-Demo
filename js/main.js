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
      # Structure A: separate material entity (Catena-X pipeline)
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
      # Structure B: qualities directly on component (AAS2KG v2 pipeline)
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
    BIND(COALESCE(
      ?instanceLabel,
      ?typeLabel,
      STRAFTER(STR(?quality), "-qual-")
    ) AS ?property)

    FILTER(str(?property) != "")
}
ORDER BY ?componentLabel ?property`;

const FETCH_TIMEOUT_MS = 10000;

// ── Result binding columns ──────────────────────────────────────────────────
const EXPECTED_BINDINGS = ['componentLabel', 'material', 'property', 'value', 'unitLabel'];

// ── State ───────────────────────────────────────────────────────────────────
let inFlight = false;
let lastOpenedStep = null;

// ── Modal system ─────────────────────────────────────────────────────────────
function openModal(stepId) {
  const overlay = document.getElementById('modal-' + stepId);
  if (!overlay) return;
  overlay.classList.add('open');
  overlay.removeAttribute('hidden');
  const focusable = overlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length) focusable[0].focus();
  lastOpenedStep = stepId;
}

function closeModal() {
  const open = document.querySelector('.modal-overlay.open');
  if (!open) return;
  open.classList.remove('open');
  // Restore focus to the step button that opened it
  if (lastOpenedStep) {
    const btn = document.querySelector('[data-step="' + lastOpenedStep + '"]');
    if (btn) btn.focus();
    lastOpenedStep = null;
  }
}

function openModalForDuration(stepId, ms) {
  return new Promise(resolve => {
    openModal(stepId);
    setTimeout(() => {
      closeModal();
      resolve();
    }, ms);
  });
}

// ── Focus trap inside modal ──────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const open = document.querySelector('.modal-overlay.open');
  if (!open) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.key !== 'Tab') return;

  const focusable = Array.from(open.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ));
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { e.preventDefault(); last.focus(); }
  } else {
    if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
  }
});

// Overlay click closes modal
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
});

// Close buttons
document.querySelectorAll('.modal-close, .modal-close-btn').forEach(btn => {
  btn.addEventListener('click', closeModal);
});

// ── Step state machine ───────────────────────────────────────────────────────
function activateStep(stepId) {
  const btn = document.querySelector('[data-step="' + stepId + '"]');
  if (!btn) return;
  btn.classList.remove('step-completed');
  btn.classList.add('step-active');
}

function completeStep(stepId) {
  const btn = document.querySelector('[data-step="' + stepId + '"]');
  if (!btn) return;
  btn.classList.remove('step-active');
  btn.classList.add('step-completed');
}

// Step button click handlers
document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const step = btn.dataset.step;
    activateStep(step);
    openModal(step);
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

// ── Run Workflow animation ───────────────────────────────────────────────────
const runBtn = document.getElementById('run-btn');
if (runBtn) {
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true;

    // Steps A + B activate simultaneously; A modal first then B
    activateStep('A');
    activateStep('B');
    await openModalForDuration('A', 2500);
    completeStep('A');
    await openModalForDuration('B', 2500);
    completeStep('B');

    // Steps C → D → E → F in sequence
    for (const step of ['C', 'D', 'E', 'F']) {
      activateStep(step);
      await openModalForDuration(step, 2500);
      completeStep(step);
    }

    // Scroll to result section
    const resultSection = document.getElementById('result');
    if (resultSection) {
      resultSection.scrollIntoView({ behavior: 'smooth' });
      resultSection.classList.add('highlighted');
      setTimeout(() => resultSection.classList.remove('highlighted'), 1500);
    }

    runBtn.disabled = false;
  });
}

// ── SPARQL fetch lifecycle ───────────────────────────────────────────────────
const resultSection  = document.getElementById('result');
const resultBadge    = document.getElementById('result-badge');
const resultSpinner  = document.getElementById('result-spinner');
const staticTable    = document.getElementById('result-table');
const rerunBtn       = document.getElementById('rerun-btn');

function showSpinner() {
  if (resultSpinner) resultSpinner.classList.add('visible');
}

function hideSpinner() {
  if (resultSpinner) resultSpinner.classList.remove('visible');
}

function showCachedBadge() {
  if (resultBadge) {
    resultBadge.className = 'badge-cached';
    resultBadge.textContent = 'Cached result';
  }
}

function showLiveBadge() {
  if (resultBadge) {
    const now = new Date();
    const hhmm = now.toUTCString().slice(17, 22);
    resultBadge.className = 'badge-live';
    resultBadge.textContent = 'Live · ' + hhmm + ' UTC';
  }
}

function renderResultTable(bindings) {
  // Check expected binding names
  if (bindings.length > 0) {
    const gotKeys = Object.keys(bindings[0]);
    const missing = EXPECTED_BINDINGS.filter(k => !gotKeys.includes(k));
    if (missing.length) {
      console.error('SPARQL response missing expected bindings:', missing);
    }
  }

  // Hide static fallback
  if (staticTable) staticTable.style.display = 'none';

  const table = document.createElement('table');
  table.className = 'result-table';
  table.id = 'result-table-live';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Component', 'Material', 'Property', 'Value', 'Unit'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  bindings.forEach(binding => {
    const tr = document.createElement('tr');
    const componentLabel = binding.componentLabel?.value ?? '';
    if (componentLabel.toLowerCase().includes('pulley') ||
        componentLabel.toLowerCase().includes('catena') ||
        componentLabel.toLowerCase().includes('wheel')) {
      tr.className = 'row-catx';
    } else {
      tr.className = 'row-mfgx';
    }
    const cols = ['componentLabel', 'material', 'property', 'value', 'unitLabel'];
    cols.forEach(col => {
      const td = document.createElement('td');
      td.textContent = binding[col]?.value ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const container = resultSection.querySelector('.container');
  if (container) {
    const existing = document.getElementById('result-table-live');
    if (existing) existing.remove();
    container.insertBefore(table, rerunBtn);
  }
}

async function triggerFetch() {
  if (inFlight) return;
  inFlight = true;
  showSpinner();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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

    clearTimeout(timeoutId);

    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const data = await resp.json();
    const bindings = data?.results?.bindings;
    if (!Array.isArray(bindings)) throw new Error('Unexpected SPARQL JSON shape');

    renderResultTable(bindings);
    showLiveBadge();
  } catch (err) {
    clearTimeout(timeoutId);
    // Show static fallback
    if (staticTable) staticTable.style.display = '';
    showCachedBadge();
    console.info('SPARQL fetch failed, showing cached result:', err.message);
  } finally {
    hideSpinner();
    inFlight = false;
  }
}

// Intersection Observer — fires once when result section is 30% visible
let observer = null;
if (resultSection) {
  observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    observer.disconnect();
    triggerFetch();
  }, { threshold: 0.3 });
  observer.observe(resultSection);
}

// Re-run button
if (rerunBtn) {
  rerunBtn.addEventListener('click', () => {
    inFlight = false;
    const live = document.getElementById('result-table-live');
    if (live) live.remove();
    if (staticTable) staticTable.style.display = 'none';
    triggerFetch();
  });
}
