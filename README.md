# PMD-X Cross-Dataspace Demo

A fully browser-based demo showing how [PMDCO](https://w3id.org/pmd/co) (PMD Core Ontology) bridges incompatible industrial data schemas across **Catena-X** and **Manufacturing-X** dataspaces — enabling a single SPARQL query to retrieve material properties from both.

**Live demo:** https://materialdigital.github.io/PMD-X-Dataspaces-Demo

---

## What it demonstrates

A Tension Pulley assembly has two components sourced from different dataspaces:

| Component | Dataspace | Format | Material |
|---|---|---|---|
| Pulley Wheel | Catena-X | SAMM aspect model (JSON) | PA6GF30 polymer |
| Tensioner Bracket | Manufacturing-X | AAS 3.0 inspection document (JSON) | Steel 316/4401 |

Each dataset is converted once into PMDCO-conformant RDF. From that point a **single SPARQL SELECT** — no UNION, no bespoke adapter — retrieves material properties from both sources using the shared PMDCO predicate pattern.

## Architecture

```
Catena-X source JSON
  → YARRRML mapping → SAMM/RDF (catx-samm.ttl)
  → SPARQL INSERT    → PMDCO graph (urn:graph:catx)

Manufacturing-X source JSON (AAS 3.0)
  → py-aas-rdf       → AAS/RDF (mfgx-aas.ttl)
  → SPARQL INSERT    → PMDCO graph (urn:graph:mfgx)

Assembly graph (assembly.ttl)  ─────────────┐
                                             ▼
                               Cross-dataspace SPARQL query
                               (FROM catx + FROM mfgx + FROM assembly)
```

Everything runs **in-browser** using [Oxigraph](https://github.com/oxigraph/oxigraph) compiled to WebAssembly — no server, no backend.

## Named graphs loaded at runtime

| Graph | Contents |
|---|---|
| `urn:graph:catx-samm` | CatX SAMM/RDF instance data + aspect model |
| `urn:graph:mfgx-aas` | MfgX AAS-ontology RDF (from py-aas-rdf) |
| `urn:graph:assembly` | Company product knowledge graph |
| `urn:graph:pmdco-ontology` | PMDCO 3.0 ontology |
| `urn:graph:tto-ontology` | Tensile Test Ontology |
| `urn:graph:catx` | PMDCO Transform output for CatX data |
| `urn:graph:mfgx` | PMDCO Transform output for MfgX data |

## Round-trip verification

Both input datasets are independently verified:

- **Catena-X**: a SPARQL SELECT over `urn:graph:catx-samm` reconstructs the full original SAMM JSON payload (including 547-entry PvT table) and asserts it against the reference file.
- **Manufacturing-X**: `store.dump({format:'application/ld+json', from_graph_name:…mfgx-aas})` exports the complete named graph as expanded JSON-LD (2102 nodes); 12 key values are located by IRI and asserted against the original AAS inspection document.

## Run locally

```bash
git clone https://github.com/materialdigital/PMD-X-Dataspaces-Demo.git
cd PMD-X-Dataspaces-Demo
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. A server is required because the demo fetches Turtle and JSON assets via `fetch()`.

## Source data

| Dataset | Source |
|---|---|
| PA6GF30 material data (CatX) | [material_data_test_pa6gf30.json](https://dataportal.material-digital.de/dataset/cross-project-use-case) |
| Steel 316/4401 inspection document (MfgX) | [inspectiondocument_316_4401_alloy.json](https://dataportal.material-digital.de/dataset/steel-inspection-document-mapro) |
| Full demo dataset | [PMD-X Cross-Dataspace Demo](https://dataportal.material-digital.de/dataset/pmd-x-cross-dataspace-demo) |

## Key technologies

- [PMDCO](https://w3id.org/pmd/co) — PMD Core Ontology (shared semantic layer)
- [Oxigraph WASM](https://github.com/oxigraph/oxigraph) — in-browser SPARQL triplestore
- [SAMM](https://eclipse-esmf.github.io/samm-specification/) — Catena-X Semantic Aspect Meta Model
- [AAS 3.0](https://industrialdigitaltwin.org/) — Asset Administration Shell (Manufacturing-X)
- [py-aas-rdf](https://github.com/admin-shell-io/aas-core3.0-python) / AAS2KG — AAS JSON → RDF conversion
- [YARRRML](https://rml.io/yarrrml/) — declarative RDF mapping for CatX SAMM data
- [Eclipse Dataspace Connector](https://github.com/eclipse-edc/) — simulated EDC data plane negotiation

## License

Apache 2.0 — see [LICENSE](LICENSE).
