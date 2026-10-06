import initOxigraph, { Store, namedNode } from '../vendor/oxigraph.js';

// ── Named graph IRIs ──────────────────────────────────────────────────────────
const GRAPH_IRI = {
  catxSamm:     'urn:graph:catx-samm',
  catx:         'urn:graph:catx',
  mfgxAas:      'urn:graph:mfgx-aas',
  mfgx:         'urn:graph:mfgx',
  assembly:     'urn:graph:assembly',
  pmdcoOntology:'urn:graph:pmdco-ontology',
  ttoOntology:  'urn:graph:tto-ontology',
};

// ── Oxigraph store (initialised once) ────────────────────────────────────────
// namedNode() cannot be called until WASM is ready — create NamedNode objects
// inside storeReady, not at module-load time.
let store = null;
let GRAPH = {};
const storeReady = initOxigraph().then(() => {
  store = new Store();
  window._store = store;
  GRAPH = Object.fromEntries(
    Object.entries(GRAPH_IRI).map(([k, v]) => [k, namedNode(v)])
  );
});

// ── Cross-dataspace query ─────────────────────────────────────────────────────
// Both urn:graph:catx and urn:graph:mfgx (after PMDCO INSERT) follow the same PMDCO graph pattern:
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
FROM <urn:graph:assembly>
FROM <urn:graph:catx>
FROM <urn:graph:mfgx>
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

// ── Node C: SAMM → PMDCO INSERT (CatX) ───────────────────────────────────────
// Reads SAMM/RDF from any graph in the store (GRAPH ?dataGraph / ?schemaGraph),
// matches mat:Property values against the SAMM characteristic schema, and writes
// PMDCO quality individuals into urn:graph:catx.
const CATX_INSERT = `
PREFIX samm:   <urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#>
PREFIX samm-c: <urn:samm:org.eclipse.esmf.samm:characteristic:2.2.0#>
PREFIX mat:    <urn:samm:io.catenax.material_data:1.0.0#>
PREFIX qudt:   <https://qudt.org/schema/qudt/>
PREFIX unit:   <https://qudt.org/vocab/unit/>
PREFIX obo:    <http://purl.obolibrary.org/obo/>
PREFIX pmd:    <https://w3id.org/pmd/co/>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd:    <http://www.w3.org/2001/XMLSchema#>
PREFIX sunit:  <urn:samm:org.eclipse.esmf.samm:unit:2.2.0#>
PREFIX rdf:    <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

INSERT { GRAPH <urn:graph:catx> {

    ?material a      obo:BFO_0000040 ;
              rdfs:label ?matLabel .

    ?quality a              ?qualityClass ;
             rdfs:label     ?propLabel ;
             obo:RO_0000052 ?material ;
             obo:IAO_0000417 ?datum .

    ?material obo:RO_0000086 ?quality .

    ?datum a                obo:OBI_0001931 ;
           rdfs:label       ?propLabel ;
           obo:OBI_0001938  ?qv .

    ?qv a                  qudt:QuantityValue ;
        qudt:unit          ?qdtUnit ;
        qudt:numericValue  ?convertedValue ;
        rdfs:label         ?propLabel .

} }
WHERE {

    GRAPH ?dataGraph {
        ?dataEntity ?prop ?value .
        FILTER(isLiteral(?value))

        ?materialData a mat:MaterialData ;
                     ?groupProp ?dataEntity .
        FILTER(?groupProp != rdf:type)

        OPTIONAL {
            ?materialData mat:materialInformation ?matInfo .
            ?matInfo mat:materialName       ?matName ;
                     mat:materialIdentifier ?matId .
        }
    }

    GRAPH ?schemaGraph {
        ?prop a samm:Property ;
              samm:characteristic ?char .
        ?char samm-c:unit   ?sammUnit ;
              samm:dataType ?dtype .
        OPTIONAL {
            ?prop samm:preferredName ?propLabel .
            FILTER(LANG(?propLabel) = "en")
        }
    }

    FILTER(?dtype IN (
        xsd:float, xsd:double, xsd:decimal,
        xsd:integer, xsd:int, xsd:long,
        xsd:nonNegativeInteger, xsd:positiveInteger
    ))

    VALUES (?sammUnit ?qdtUnit ?factor) {
        ( sunit:megapascal              unit:MegaPA            1    )
        ( sunit:percent                 unit:PERCENT           1    )
        ( sunit:degreeCelsius           unit:DEG_C             1    )
        ( sunit:kilogramPerCubicMetre   unit:KiloGM-PER-M3     1    )
        ( sunit:percentWeight           unit:PERCENT           1    )
        ( sunit:percentPerDegreeCelsius unit:PERCENT-PER-DEG_C 1    )
        ( mat:kiloJoulePerSquareMeter   unit:J-PER-M2          1000 )
    }

    VALUES (?prop ?qualityClass) {
        ( mat:stressAtBreak                               pmd:PMD_0000952 )
        ( mat:flexuralStrength                            pmd:PMD_0000952 )
        ( mat:youngsModulus                               pmd:PMD_0000618 )
        ( mat:flexuralModulus                             pmd:PMD_0000618 )
        ( mat:strainAtBreak                               pmd:PMD_0000005 )
        ( mat:impactStrength                              pmd:PMD_0000518 )
        ( mat:density                                     pmd:PMD_0000597 )
        ( mat:meltingTemperature                          pmd:PMD_0000851 )
        ( mat:glassTransitionTemperature                  pmd:PMD_0000981 )
        ( mat:humidity                                    pmd:PMD_0000005 )
        ( mat:waterAbsorption                             pmd:PMD_0000005 )
        ( mat:linearThermalExpansionCoefficientParallel   pmd:PMD_0000981 )
        ( mat:linearThermalExpansionCoefficientTransverse pmd:PMD_0000981 )
    }

    BIND(xsd:decimal(?value) * ?factor AS ?convertedValue)
    BIND(IF(BOUND(?matName) && BOUND(?matId),
            CONCAT(STR(?matName), " (", STR(?matId), ")"),
            STR(?materialData)) AS ?matLabel)

    BIND(IRI(CONCAT("https://pmdx.materials-data.space/catx/", STRAFTER(STR(?materialData), "#"), "-material"))                                        AS ?material)
    BIND(IRI(CONCAT("https://pmdx.materials-data.space/catx/", STRAFTER(STR(?dataEntity),   "#"), "-qual-",  STRAFTER(STR(?prop), "#")))               AS ?quality)
    BIND(IRI(CONCAT("https://pmdx.materials-data.space/catx/", STRAFTER(STR(?dataEntity),   "#"), "-datum-", STRAFTER(STR(?prop), "#")))               AS ?datum)
    BIND(IRI(CONCAT("https://pmdx.materials-data.space/catx/", STRAFTER(STR(?dataEntity),   "#"), "-qv-",    STRAFTER(STR(?prop), "#")))               AS ?qv)
}`;

// ── Node C: AAS → PMDCO INSERT (MfgX) ───────────────────────────────────────
// Reads raw AAS RDF (admin-shell.io ontology, produced by py-aas-rdf) from the
// mfgx-aas staging graph and writes PMDCO triples into urn:graph:mfgx.
// Matches each aas:Property by its semanticId key value, extracts the numeric
// value and English display name, and emits the same quality/datum/qv pattern
// that urn:graph:catx uses — enabling the single cross-dataspace SPARQL query.
const AAS2KG_INSERT = `
PREFIX aas:   <https://admin-shell.io/aas/3/0/>
PREFIX aasP:  <https://admin-shell.io/aas/3/0/Property/>
PREFIX aasK:  <https://admin-shell.io/aas/3/0/Key/>
PREFIX aasR:  <https://admin-shell.io/aas/3/0/Reference/>
PREFIX aasSM: <https://admin-shell.io/aas/3/0/HasSemantics/>
PREFIX aasRf: <https://admin-shell.io/aas/3/0/Referable/>
PREFIX aasLS: <https://admin-shell.io/aas/3/0/AbstractLangString/>
PREFIX tto:   <https://w3id.org/pmd/tto/>
PREFIX pmd:   <https://w3id.org/pmd/co/>
PREFIX obo:   <http://purl.obolibrary.org/obo/>
PREFIX qudt:  <https://qudt.org/schema/qudt/>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>
PREFIX ex:    <http://www.example.org/#>

INSERT { GRAPH <urn:graph:mfgx> {

  ex:316-4401_material a pmd:PMD_0000000, obo:BFO_0000040 ;
    rdfs:label "316/4401 – 2R-2BB – Cold Rolled Stainless Steel" ;
    obo:RO_0000086 ex:316-4401_tensile_strength,
                   ex:316-4401_yield_strength,
                   ex:316-4401_elongation_after_fracture .

  ex:316-4401_tensile_strength a tto:TTO_0000053 ;
    obo:RO_0000052 ex:316-4401_material ;
    obo:IAO_0000417 ex:316-4401_tensile_strength_scalar_value_specification .
  ex:316-4401_tensile_strength_scalar_value_specification a obo:OBI_0001931 ;
    rdfs:label ?tensileLabel ;
    obo:OBI_0001938 ex:316-4401_tensile_strength_value .
  ex:316-4401_tensile_strength_value a qudt:QuantityValue ;
    qudt:unit qudt:MegaPA ;
    qudt:numericValue ?tensileValue ;
    rdfs:label ?tensileLabel .

  ex:316-4401_yield_strength a tto:TTO_0000009 ;
    obo:RO_0000052 ex:316-4401_material ;
    obo:IAO_0000417 ex:316-4401_yield_strength_scalar_value_specification .
  ex:316-4401_yield_strength_scalar_value_specification a obo:OBI_0001931 ;
    rdfs:label ?yieldLabel ;
    obo:OBI_0001938 ex:316-4401_yield_strength_value .
  ex:316-4401_yield_strength_value a qudt:QuantityValue ;
    qudt:unit qudt:MegaPA ;
    qudt:numericValue ?yieldValue ;
    rdfs:label ?yieldLabel .

  ex:316-4401_elongation_after_fracture a tto:TTO_0000033 ;
    obo:RO_0000052 ex:316-4401_material ;
    obo:IAO_0000417 ex:316-4401_elongation_after_fracture_scalar_value_specification .
  ex:316-4401_elongation_after_fracture_scalar_value_specification a obo:OBI_0001931 ;
    rdfs:label ?elongLabel ;
    obo:OBI_0001938 ex:316-4401_elongation_after_fracture_value .
  ex:316-4401_elongation_after_fracture_value a qudt:QuantityValue ;
    qudt:unit qudt:MegaPA ;
    qudt:numericValue ?elongValue ;
    rdfs:label ?elongLabel .

  ex:316-4401_chem_comp a pmd:PMD_0000551 ;
    obo:RO_0000080 ex:316-4401_material ;
    pmd:PMD_0000004 ex:316-4401_chem_comp_spec .
  ex:316-4401_chem_comp_spec a pmd:PMD_0025002 ;
    obo:RO_0002351 ex:316-4401_fraction_carbon, ex:316-4401_fraction_chromium,
                   ex:316-4401_fraction_manganese, ex:316-4401_fraction_molybdenum,
                   ex:316-4401_fraction_nickel, ex:316-4401_fraction_nitrogen,
                   ex:316-4401_fraction_phosphorus, ex:316-4401_fraction_silicon,
                   ex:316-4401_fraction_sulfur .

  ex:316-4401_some_carbon    a pmd:PMD_0020030 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_chromium  a pmd:PMD_0020029 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_manganese a pmd:PMD_0020078 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_molybdenum a pmd:PMD_0020034 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_nickel    a pmd:PMD_0020051 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_nitrogen  a pmd:PMD_0020038 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_phosphorus a pmd:PMD_0020047 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_silicon   a pmd:PMD_0020050 ; obo:BFO_0000050 ex:316-4401_material .
  ex:316-4401_some_sulfur    a pmd:PMD_0020059 ; obo:BFO_0000050 ex:316-4401_material .

  ex:316-4401_mass_proportion_carbon     a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_carbon    ; pmd:PMD_0000077 ex:316-4401_fraction_carbon .
  ex:316-4401_mass_proportion_chromium   a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_chromium  ; pmd:PMD_0000077 ex:316-4401_fraction_chromium .
  ex:316-4401_mass_proportion_manganese  a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_manganese ; pmd:PMD_0000077 ex:316-4401_fraction_manganese .
  ex:316-4401_mass_proportion_molybdenum a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_molybdenum ; pmd:PMD_0000077 ex:316-4401_fraction_molybdenum .
  ex:316-4401_mass_proportion_nickel     a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_nickel    ; pmd:PMD_0000077 ex:316-4401_fraction_nickel .
  ex:316-4401_mass_proportion_nitrogen   a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_nitrogen  ; pmd:PMD_0000077 ex:316-4401_fraction_nitrogen .
  ex:316-4401_mass_proportion_phosphorus a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_phosphorus ; pmd:PMD_0000077 ex:316-4401_fraction_phosphorus .
  ex:316-4401_mass_proportion_silicon    a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_silicon   ; pmd:PMD_0000077 ex:316-4401_fraction_silicon .
  ex:316-4401_mass_proportion_sulfur     a pmd:PMD_0020102 ; pmd:PMD_0025999 ex:316-4401_some_sulfur    ; pmd:PMD_0000077 ex:316-4401_fraction_sulfur .

  ex:316-4401_fraction_carbon     a pmd:PMD_0025997 ; obo:OBI_0001937 ?carbonValue    ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_chromium   a pmd:PMD_0025997 ; obo:OBI_0001937 ?chromiumValue  ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_manganese  a pmd:PMD_0025997 ; obo:OBI_0001937 ?manganeseValue ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_molybdenum a pmd:PMD_0025997 ; obo:OBI_0001937 ?molybdenumValue ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_nickel     a pmd:PMD_0025997 ; obo:OBI_0001937 ?nickelValue    ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_nitrogen   a pmd:PMD_0025997 ; obo:OBI_0001937 ?nitrogenValue  ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_phosphorus a pmd:PMD_0025997 ; obo:OBI_0001937 ?phosphorusValue ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_silicon    a pmd:PMD_0025997 ; obo:OBI_0001937 ?siliconValue   ; obo:IAO_0000039 obo:UO_0000163 .
  ex:316-4401_fraction_sulfur     a pmd:PMD_0025997 ; obo:OBI_0001937 ?sulfurValue    ; obo:IAO_0000039 obo:UO_0000163 .
} }
WHERE {
  GRAPH <urn:graph:mfgx-aas> {
    OPTIONAL {
      ?tensileP a aas:Property ; aasP:value ?tensileValue ;
        aasRf:displayName ?tdn ; aasSM:semanticId ?tss .
      ?tss aasR:keys ?tk . ?tk aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/TensileStrengthMean/1/0" .
      ?tdn aasLS:language "en" ; aasLS:text ?tensileLabel .
    }
    OPTIONAL {
      ?yieldP a aas:Property ; aasP:value ?yieldValue ;
        aasRf:displayName ?ydn ; aasSM:semanticId ?yss .
      ?yss aasR:keys ?yk . ?yk aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/YieldOrProofStrengthMean/1/0" .
      ?ydn aasLS:language "en" ; aasLS:text ?yieldLabel .
    }
    OPTIONAL {
      ?elongP a aas:Property ; aasP:value ?elongValue ;
        aasRf:displayName ?edn ; aasSM:semanticId ?ess .
      ?ess aasR:keys ?ek . ?ek aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/ElongationAfterFractureMean/1/0" .
      ?edn aasLS:language "en" ; aasLS:text ?elongLabel .
    }
    OPTIONAL { ?cP a aas:Property ; aasP:value ?carbonValue    ; aasSM:semanticId ?css  . ?css  aasR:keys ?ck  . ?ck  aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_C/1/0" . }
    OPTIONAL { ?crP a aas:Property ; aasP:value ?chromiumValue  ; aasSM:semanticId ?crss . ?crss aasR:keys ?crk . ?crk aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_Cr/1/0" . }
    OPTIONAL { ?mnP a aas:Property ; aasP:value ?manganeseValue ; aasSM:semanticId ?mnss . ?mnss aasR:keys ?mnk . ?mnk aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_Mn/1/0" . }
    OPTIONAL { ?moP a aas:Property ; aasP:value ?molybdenumValue ; aasSM:semanticId ?moss . ?moss aasR:keys ?mok . ?mok aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_Mo/1/0" . }
    OPTIONAL { ?niP a aas:Property ; aasP:value ?nickelValue    ; aasSM:semanticId ?niss . ?niss aasR:keys ?nik . ?nik aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_Ni/1/0" . }
    OPTIONAL { ?nP  a aas:Property ; aasP:value ?nitrogenValue  ; aasSM:semanticId ?nss  . ?nss  aasR:keys ?nk  . ?nk  aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_N/1/0" . }
    OPTIONAL { ?pP  a aas:Property ; aasP:value ?phosphorusValue ; aasSM:semanticId ?pss  . ?pss  aasR:keys ?pk  . ?pk  aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_P/1/0" . }
    OPTIONAL { ?siP a aas:Property ; aasP:value ?siliconValue   ; aasSM:semanticId ?siss . ?siss aasR:keys ?sik . ?sik aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_Si/1/0" . }
    OPTIONAL { ?sP  a aas:Property ; aasP:value ?sulfurValue    ; aasSM:semanticId ?suss . ?suss aasR:keys ?suk . ?suk aasK:value "https://admin-shell.io/idta/InspectionDocumentsOfSteelProducts/MassFraction_S/1/0" . }
  }
}`;

// ── Node data sources ─────────────────────────────────────────────────────────
// Use IRI strings here — namedNode() is called inside executeNode after WASM init
const NODE_TTL = {
  A: { url: 'assets/data/catx-samm.ttl',         graphIri: GRAPH_IRI.catxSamm,
       baseIri: 'https://dataportal.material-digital.de/dataset/f2bca6a2-04df-47cb-9439-589e46ba60e2/resource/6ffde9ce-f6c6-4214-8949-a60fb3123157/download/material_data_test_pa6gf30-joined.ttl' },
  A_model: { url: 'assets/data/catx-samm-model.ttl', graphIri: GRAPH_IRI.catxSamm },
  B: { url: 'assets/data/mfgx-aas.ttl',          graphIri: GRAPH_IRI.mfgxAas },
  D: { url: 'assets/data/assembly.ttl',           graphIri: GRAPH_IRI.assembly },
  C_pmdco: { url: 'assets/data/pmdco-ontology.ttl', graphIri: GRAPH_IRI.pmdcoOntology },
  C_tto:   { url: 'assets/data/tto-ontology.ttl',   graphIri: GRAPH_IRI.ttoOntology },
};

// ── KG inspector SPARQL counts ────────────────────────────────────────────────
const KG_QUERIES = {
  total:        `SELECT (COUNT(*) AS ?c) { { GRAPH ?g { ?s ?p ?o } } UNION { ?s ?p ?o } }`,
  catxSamm:     `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:catx-samm>          { ?s ?p ?o } }`,
  mfgxAas:      `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:mfgx-aas>           { ?s ?p ?o } }`,
  assembly:     `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:assembly>            { ?s ?p ?o } }`,
  pmdcoOntology:`SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:pmdco-ontology>      { ?s ?p ?o } }`,
  ttoOntology:  `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:tto-ontology>        { ?s ?p ?o } }`,
  catx:         `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:catx>                { ?s ?p ?o } }`,
  mfgx:         `SELECT (COUNT(*) AS ?c) { GRAPH <urn:graph:mfgx>                { ?s ?p ?o } }`,
};

// ── Node state ────────────────────────────────────────────────────────────────
const nodeState = { A: 'pending', B: 'pending', C: 'pending', D: 'pending' };
let lastOpenedNode = null;
let sparqlInFlight = false;

function setNodeState(id, state) {
  nodeState[id] = state;
  const el = document.getElementById('node-' + id);
  if (!el) return;
  el.classList.remove('done', 'running', 'error');
  if (state === 'done')    el.classList.add('done');
  if (state === 'running') el.classList.add('running');
  if (state === 'error')   el.classList.add('error');
  updateDAGConnectors();
}

async function resetAllNodes() {
  Object.keys(nodeState).forEach(id => setNodeState(id, 'pending'));
  sparqlInFlight = false;
  // Reset store
  await storeReady;
  store = new Store();
  window._store = store;
  // Reset result table
  const fullBody = document.querySelector('#result-table-full tbody');
  if (fullBody) fullBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem;">Use the Run button in the Knowledge Graph State panel to execute the query.</td></tr>';
  // Reset KG stats
  ['kg-total','kg-catx-samm','kg-mfgx-aas','kg-assembly','kg-pmdco-ontology','kg-tto-ontology','kg-catx','kg-mfgx'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.className = 'kg-stat-value'; }
  });
}

// ── Step-modal content ────────────────────────────────────────────────────────
const STEP_DURATION = 10000;
let stepTimer = null;
let stepCountdown = null;

const MODAL_STEPS = {
  A: [
    { title: 'EDC — Catalog query',
      body: 'The Eclipse Dataspace Connector (EDC) sends a catalog query to the Catena-X provider endpoint to discover available data assets. The PA6GF30 material data asset is located by its asset IRI.' },
    { title: 'EDC — Contract negotiation',
      body: 'EDC initiates a contract negotiation with the Catena-X provider connector. Usage policies are evaluated and a short-lived transfer token is issued.' },
    { title: 'EDC — SAMM JSON retrieval',
      body: 'The EDC data plane transfers the SAMM aspect document — a Catena-X-proprietary JSON payload. Field names like <code>stressAtBreak</code> are schema-specific and carry no cross-dataspace semantics.',
      code: '{\n  "materialInformation": { "materialName": "PA6GF30", "materialIdentifier": "Z1234" },\n  "mechanicalProperty":  { "impactStrength": 74, "youngsModulus": 9800 },\n  "thermophysicalProperty": { "meltingTemperature": 223 }\n}' },
    { title: 'YARRRML + RDF Converter — SAMM RDF document',
      body: 'A YARRRML mapping defines rules that bind the SAMM JSON structure to SAMM ontology IRIs. RDFConverter executes the mapping and produces a self-contained SAMM-conformant RDF document — SAMM entities, not yet PMDCO.' },
    { title: 'SAMM/RDF instance data loaded',
      body: 'The RDF document with material instance data (PA6GF30 measurements) is loaded into the Oxigraph triplestore as named graph <code>urn:graph:catx-samm</code>.' },
    { title: 'SAMM aspect model loaded — staging graph ready',
      body: 'The SAMM aspect model (<code>materialdataam3010.ttl</code>) is loaded into the same staging graph <code>urn:graph:catx-samm</code>. It defines the <code>samm:Property</code> descriptions, <code>samm:characteristic</code> links, and <code>samm-c:unit</code> annotations the PMDCO Transform INSERT uses to identify property semantics and units.',
      last: true },
  ],
  B: [
    { title: 'EDC — Catalog query',
      body: 'EDC queries the Manufacturing-X connector catalog to locate the AAS 3.0 inspection document for steel component 87654321.' },
    { title: 'EDC — Contract negotiation',
      body: 'Contract negotiation with the Manufacturing-X provider connector. Usage policies verified; transfer token issued for data plane access.' },
    { title: 'EDC — AAS 3.0 JSON retrieval',
      body: 'The EDC data plane returns an IDTA Asset Administration Shell 3.0 inspection document — a submodel tree with <code>idShort</code> references and EN 10204 section codes.',
      code: '{\n  "assetAdministrationShells": [{ "idShort": "InspectionDocumentsOfSteelProductsAAS" }],\n  "submodels": [{\n    "semanticId": { "keys": [{ "value": "https://admin-shell.io/idta/...InspectionDocumentsOfSteelProducts/1/0" }] },\n    "submodelElements": [ /* EN 10204 sections with tensile / yield / elongation values */ ]\n  }]\n}' },
    { title: 'AAS2KG — AAS-ontology RDF document',
      body: 'The AAS2KG tool converts the AAS JSON to a self-contained RDF document using admin-shell.io ontology IRIs. Submodel elements are identified by their <code>semanticId</code> — AAS structure, not yet PMDCO.' },
    { title: 'AAS/RDF loaded — staging graph ready',
      body: 'Raw AAS-ontology RDF is now in the staging graph <code>urn:graph:mfgx-aas</code>. The PMDCO mapping INSERT runs next as the <strong>PMDCO Transform</strong> step — the same INSERT that also processes the Catena-X SAMM graph.',
      last: true },
  ],
  C: [
    { title: 'Load PMDCO 3.0 ontology',
      body: 'The PMD Core Ontology (PMDCO 3.0) is loaded into the triplestore as named graph <code>urn:graph:pmdco-ontology</code>. It defines the quality class hierarchy (<code>pmd:PMD_0000618</code> elastic modulus, <code>pmd:PMD_0000851</code> melting point, …), the BFO/RO/OBI predicates used in the data pattern, and their <code>rdfs:label</code> annotations — so the triplestore can answer label lookups and, with inference enabled, subclass queries without hard-coded VALUES tables.' },
    { title: 'Load TTO ontology',
      body: 'The Tensile Test Ontology (TTO), aligned with PMDCO, is loaded into <code>urn:graph:tto-ontology</code>. It defines the mechanical property classes used for the steel inspection data: <code>tto:TTO_0000053</code> (tensile strength), <code>tto:TTO_0000009</code> (yield strength), <code>tto:TTO_0000033</code> (elongation at fracture). Both ontologies are now in the triplestore — the INSERT can mint typed individuals using their canonical class IRIs.' },
    { title: 'SPARQL INSERT — map both source graphs to PMDCO',
      body: 'One SPARQL INSERT reads both staging graphs. For <code>urn:graph:catx</code> it resolves SAMM property IRIs to TTO/PMDCO quality classes; for <code>urn:graph:mfgx-aas</code> it navigates the <code>aas:Property → semanticId → keys → value</code> chain to match IDTA IRI strings (e.g. <code>…TensileStrengthMean/1/0</code>) and writes PMDCO quality individuals with QUDT units into <code>urn:graph:mfgx</code>. One query — two dataspaces, two vocabularies, one output pattern.' },
    { title: 'Cross-dataspace alignment complete',
      body: 'All graphs are live: CatX SAMM/RDF, MfgX AAS/RDF, MfgX PMDCO output, company product KG, PMDCO ontology, and TTO ontology. A single SPARQL SELECT can now traverse across dataspaces — component → material → quality — using the canonical class IRIs the ontologies define.',
      last: true },
  ],
  D: [
    { title: 'Company knowledge about a product',
      body: 'This graph represents what the company knows about one of its own objects — the Tension Pulley. That knowledge exists independently of any dataspace; it simply states that this product consists of two components sourced from different data sources.' },
    { title: 'Connecting across data sources',
      body: 'Each component is identified by its IRI in its home dataspace. The graph does not copy any data — it records the part-whole relation and points to where each component\'s data lives.',
      code: 'ex:TensionPulley_001\n    a pmdco:Object ;\n    obo:BFO_0000051\n      <https://catena-x.net/edc/assets/urn:uuid:3f5a8c2d-…> ,\n      <https://mfg-x.2024.2de/dsp/assets/component-87654321> .' },
    { title: 'Load into Triplestore',
      body: 'The graph is loaded into Oxigraph as named graph <code>urn:graph:assembly</code>. Once present, a SPARQL query can traverse from the product through its parts into both dataspace subgraphs.',
      last: true },
  ],
};

function renderStep(modalEl, nodeId, idx) {
  const steps = MODAL_STEPS[nodeId];
  if (!steps) return;
  const step  = steps[idx];
  const total = steps.length;

  const pct = Math.round(((idx + 1) / total) * 100);
  const mount = modalEl.querySelector('.step-mount');
  if (mount) {
    mount.innerHTML = `
      <div class="step-header">
        <span class="step-counter">Step ${idx + 1} of ${total}</span>
        <div class="step-timer-bar">
          <div class="step-timer-fill"></div>
        </div>
      </div>
      <h4 class="step-title">${step.title}</h4>
      <p class="step-body-text">${step.body}</p>
      ${step.code ? `<pre class="code-block" style="margin-top:0.5rem;font-size:0.78rem">${escHtml(step.code)}</pre>` : ''}
    `;
    // Force layout flush so transition fires from 0% → pct%
    const fill = mount.querySelector('.step-timer-fill');
    if (fill) { void fill.offsetWidth; fill.style.width = pct + '%'; }
  }

  const nav = modalEl.querySelector('.step-nav');
  if (nav) {
    if (step.last) {
      nav.innerHTML = `<button type="button" class="step-complete-btn" data-complete="${nodeId}">✓ Mark complete</button>`;
      nav.querySelector('.step-complete-btn').addEventListener('click', async () => {
        clearStepTimer();
        closeModal();
        try {
          await executeNode(nodeId);
          setNodeState(nodeId, 'done');
        } catch (e) {
          setNodeState(nodeId, 'error');
          alert(`Node ${nodeId} failed: ${e.message}`);
        }
        refreshKGStats();
      }, { once: true });
    } else {
      nav.innerHTML = `
        <span class="step-skip-hint">auto-advances in <span class="step-sec">${STEP_DURATION / 1000}</span>s</span>
        <button type="button" class="step-skip-btn">Skip →</button>
      `;
      nav.querySelector('.step-skip-btn').addEventListener('click', () => {
        advanceStep(modalEl, nodeId, idx);
      }, { once: true });
      // Live countdown
      clearStepCountdown();
      let remaining = STEP_DURATION / 1000;
      const secEl = nav.querySelector('.step-sec');
      stepCountdown = setInterval(() => {
        remaining--;
        if (secEl) secEl.textContent = remaining;
        if (remaining <= 0) clearStepCountdown();
      }, 1000);
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
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = null; }
  stepTimer = setTimeout(() => advanceStep(modalEl, nodeId, idx), STEP_DURATION);
}

function clearStepCountdown() {
  if (stepCountdown) { clearInterval(stepCountdown); stepCountdown = null; }
}

function clearStepTimer() {
  clearStepCountdown();
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
  });
});

async function loadTtl(key) {
  const { url, graphIri, baseIri } = NODE_TTL[key];
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: ${resp.status}`);
  const ttl  = await resp.text();
  try {
    const opts = { format: 'text/turtle', to_graph_name: namedNode(graphIri) };
    if (baseIri) opts.base_iri = baseIri;
    store.load(ttl, opts);
  } catch (e) {
    console.error(`store.load failed for ${key}:`, e);
    throw e;
  }
}

async function executeNode(nodeId) {
  await storeReady;
  if (nodeId === 'C') {
    await loadTtl('C_pmdco');
    await loadTtl('C_tto');
    store.update(CATX_INSERT);
    store.update(AAS2KG_INSERT);
  } else if (nodeId === 'A') {
    await loadTtl('A');
    await loadTtl('A_model');
  } else if (nodeId in NODE_TTL) {
    await loadTtl(nodeId);
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

// ── Query buttons ─────────────────────────────────────────────────────────────
['run-query-btn', 'rerun-btn-full'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => { sparqlInFlight = false; triggerSPARQLQuery(); });
});

// ── Run All button ────────────────────────────────────────────────────────────
const runAllBtn = document.getElementById('run-all-btn');
if (runAllBtn) {
  runAllBtn.addEventListener('click', async () => {
    runAllBtn.disabled = true;
    runAllBtn.textContent = '⏳ Running…';
    await resetAllNodes();
    for (const nodeId of ['A', 'B', 'D', 'C']) {
      setNodeState(nodeId, 'running');
      try {
        await executeNode(nodeId);
        setNodeState(nodeId, 'done');
      } catch (e) {
        setNodeState(nodeId, 'error');
        console.error(`Run All: node ${nodeId} failed`, e);
        runAllBtn.disabled = false;
        runAllBtn.textContent = '▶▶ Run All';
        return;
      }
      refreshKGStats();
    }
    runAllBtn.disabled = false;
    runAllBtn.textContent = '▶▶ Run All';
    sparqlInFlight = false;
    triggerSPARQLQuery();
  });
}

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
    total:         'kg-total',
    catxSamm:      'kg-catx-samm',
    mfgxAas:       'kg-mfgx-aas',
    assembly:      'kg-assembly',
    pmdcoOntology: 'kg-pmdco-ontology',
    ttoOntology:   'kg-tto-ontology',
    catx:          'kg-catx',
    mfgx:          'kg-mfgx',
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
  }, 50);
}

const kgRefreshBtn = document.getElementById('kg-refresh-btn');
if (kgRefreshBtn) kgRefreshBtn.addEventListener('click', refreshKGStats);

// ── Source JSON retrieval query (Oxigraph, catx-samm graph) ───────────────────
// Reconstructs the original SAMM JSON payload from the triplestore via SPARQL
// CONCAT aggregation — mirrors the structure ingested by Node A before RDF conversion.
const RETRIEVE_JSON_QUERY = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX n1:  <urn:samm:io.catenax.material_data:1.0.0#>
PREFIX n3:  <urn:samm:org.eclipse.esmf.samm:meta-model:2.2.0#>

SELECT (CONCAT(
  '{',
    ?sectionsJson, ',',
    '"thermophysicalProperty":{', ?thermoScalarsJson,
      ',"linearThermalExpansionCoefficient":{', ?ltecJson, '}}',',',
    '"pvt":', ?pvtJson,
  '}'
) AS ?json)

FROM <urn:graph:catx-samm>
WHERE {

  {
    SELECT ?mat
      (CONCAT('[', GROUP_CONCAT(?pvtEntry ; SEPARATOR=','), ']') AS ?pvtJson)
    WHERE {
      {
        SELECT ?mat ?pvt
          (CONCAT('{', GROUP_CONCAT(
            CONCAT('"', STRAFTER(STR(?p), '#'), '":',
                   IF(REGEX(STR(?v), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
                      STR(?v),
                      CONCAT('"', STR(?v), '"')))
            ; SEPARATOR=',')
          , '}') AS ?pvtEntry)
        WHERE {
          ?mat a n1:MaterialData .
          ?mat n1:thermophysicalProperty/n1:pvt ?pvt .
          ?pvt ?p ?v .
          FILTER(isLiteral(?v) && ?p != rdf:type)
        }
        GROUP BY ?mat ?pvt
      }
    }
    GROUP BY ?mat
  }

  {
    SELECT ?mat
      (GROUP_CONCAT(
        CONCAT('"', STRAFTER(STR(?p), '#'), '":',
               IF(REGEX(STR(?v), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
                  STR(?v),
                  CONCAT('"', STR(?v), '"')))
        ; SEPARATOR=',') AS ?ltecJson)
    WHERE {
      ?mat a n1:MaterialData .
      ?mat n1:thermophysicalProperty/n1:linearThermalExpansionCoefficient ?ltec .
      ?ltec ?p ?v .
      FILTER(isLiteral(?v) && ?p != rdf:type)
    }
    GROUP BY ?mat
  }

  {
    SELECT ?mat
      (GROUP_CONCAT(
        CONCAT('"', STRAFTER(STR(?p), '#'), '":',
               IF(REGEX(STR(?v), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
                  STR(?v),
                  CONCAT('"', STR(?v), '"')))
        ; SEPARATOR=',') AS ?thermoScalarsJson)
    WHERE {
      ?mat a n1:MaterialData .
      ?mat n1:thermophysicalProperty ?thermo .
      ?thermo ?p ?v .
      FILTER(isLiteral(?v) && ?p != rdf:type)
    }
    GROUP BY ?mat
  }

  {
    SELECT ?mat (GROUP_CONCAT(?sectionJson ; SEPARATOR=',') AS ?sectionsJson)
    WHERE {
      {
        SELECT ?mat ?sectionName
          (CONCAT('"', ?sectionName, '":{',
            GROUP_CONCAT(
              CONCAT('"', STRAFTER(STR(?p), '#'), '":',
                     IF(REGEX(STR(?v), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
                        STR(?v),
                        CONCAT('"', STR(?v), '"')))
              ; SEPARATOR=','),
          '}') AS ?sectionJson)
        WHERE {
          ?mat a n1:MaterialData .
          n1:MaterialData n3:properties/rdf:rest*/rdf:first ?sectionProp .
          BIND(STRAFTER(STR(?sectionProp), '#') AS ?sectionName)
          FILTER(?sectionName != 'thermophysicalProperty')
          ?mat ?sectionProp ?sectionInst .
          ?sectionInst ?p ?v .
          FILTER(isLiteral(?v) && ?p != rdf:type)
        }
        GROUP BY ?mat ?sectionName
      }
    }
    GROUP BY ?mat
  }

}`;

// Deep-compare two JSON values after canonicalisation: objects sorted by key,
// arrays of objects sorted by their canonical JSON string (order-independent pvt check).
function canonicalize(v) {
  if (Array.isArray(v)) {
    const items = v.map(canonicalize);
    // sort arrays of objects so pvt entry order doesn't cause spurious mismatches
    if (items.length && typeof items[0] === 'object' && items[0] !== null) {
      items.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
    }
    return items;
  }
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonicalize(v[k])]));
  }
  // normalise numbers: coerce to Number so "223" === 223
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function diffKeys(a, b, path = '') {
  const mismatches = [];
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    mismatches.push(`${path}: type mismatch`);
    return mismatches;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) mismatches.push(`${path}[]: length ${a.length} vs ${b.length}`);
    return mismatches;
  }
  if (a !== null && typeof a === 'object') {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of allKeys) {
      if (!(k in a)) { mismatches.push(`${path}.${k}: missing in reconstructed`); continue; }
      if (!(k in b)) { mismatches.push(`${path}.${k}: missing in reference`); continue; }
      mismatches.push(...diffKeys(a[k], b[k], path ? `${path}.${k}` : k));
    }
    return mismatches;
  }
  if (a !== b) mismatches.push(`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  return mismatches;
}

async function triggerSourceJsonQuery() {
  const spinner  = document.getElementById('source-json-spinner');
  const badge    = document.getElementById('source-json-badge');
  const output   = document.getElementById('source-json-output');
  const assertEl = document.getElementById('source-json-assert');
  const section  = document.getElementById('source-json-result');

  if (spinner) spinner.style.display = 'inline';
  if (section) section.style.display = '';
  if (assertEl) assertEl.textContent = '';

  await storeReady;

  try {
    // 1. Reconstruct JSON from local Oxigraph (catx-samm graph)
    const results  = store.query(RETRIEVE_JSON_QUERY);
    const bindings = [...results];
    if (!bindings.length) {
      if (output)   output.textContent = '(no results — load Node A first)';
      if (badge)    { badge.className = 'badge-cached'; badge.textContent = 'No data'; }
      if (assertEl) assertEl.textContent = '⚠ Node A not loaded — run the pipeline first.';
      return;
    }

    const raw = bindings[0].get('json')?.value ?? '';
    let reconstructed;
    try { reconstructed = JSON.parse(raw); } catch (e) {
      if (output) output.textContent = 'Parse error: ' + e.message + '\n\nRaw:\n' + raw;
      if (badge)  { badge.className = 'badge-cached'; badge.textContent = 'Parse error'; }
      return;
    }

    // 2. Load reference JSON (original CatX payload)
    const refResp = await fetch('assets/data/material_data_test_pa6gf30.json');
    const reference = await refResp.json();

    // 3. Canonicalise both and compare
    const canRec = canonicalize(reconstructed);
    const canRef = canonicalize(reference);
    const mismatches = diffKeys(canRec, canRef);
    const match = JSON.stringify(canRec) === JSON.stringify(canRef);

    // 4. Show reconstructed JSON
    if (output) output.textContent = JSON.stringify(reconstructed, null, 2);
    if (badge)  { badge.className = 'badge-live'; badge.textContent = 'Live · Oxigraph in-browser'; }

    // 5. Show assertion result
    if (assertEl) {
      if (match) {
        assertEl.innerHTML = '<span class="assert-pass">✓ Round-trip verified — reconstructed JSON matches original CatX payload exactly.</span>';
      } else {
        assertEl.innerHTML = '<span class="assert-fail">✗ Mismatch detected:</span><ul>' +
          mismatches.slice(0, 20).map(m => `<li>${escHtml(m)}</li>`).join('') +
          (mismatches.length > 20 ? `<li>… and ${mismatches.length - 20} more</li>` : '') +
          '</ul>';
      }
    }

    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (output)   output.textContent = 'Error — see console';
    if (badge)    { badge.className = 'badge-cached'; badge.textContent = 'Error'; }
    if (assertEl) assertEl.textContent = '✗ ' + err.message;
    console.error('Source JSON query failed:', err);
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

const runSourceJsonBtn = document.getElementById('run-source-json-btn');
if (runSourceJsonBtn) runSourceJsonBtn.addEventListener('click', triggerSourceJsonQuery);

// ── MfgX source JSON retrieval query (Oxigraph, mfgx-aas graph) ──────────────
// Reconstructs mechanical test results and chemical composition from the
// AAS-ontology RDF loaded by Node B into urn:graph:mfgx-aas.
const RETRIEVE_MFGX_JSON_QUERY = `
PREFIX aas:    <https://admin-shell.io/aas/3/0/>
PREFIX aasP:   <https://admin-shell.io/aas/3/0/Property/>
PREFIX aasRf:  <https://admin-shell.io/aas/3/0/Referable/>
PREFIX aasSMC: <https://admin-shell.io/aas/3/0/SubmodelElementCollection/>

SELECT (CONCAT(
  '{',
    '"mechanicalTests":{', ?mechJson, '},',
    '"chemicalAnalysis":{', ?chemJson, '}',
  '}'
) AS ?json)

FROM <urn:graph:mfgx-aas>
WHERE {

  {
    SELECT (GROUP_CONCAT(
      CONCAT('"', ?idShort, '":',
        IF(REGEX(STR(?val), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
           STR(?val), CONCAT('"', STR(?val), '"')))
      ; SEPARATOR=',') AS ?mechJson)
    WHERE {
      ?mechSMC a aas:SubmodelElementCollection ;
               aasRf:idShort "MechanicalTests" ;
               aasSMC:value ?testRun .
      ?testRun a aas:SubmodelElementCollection ;
               aasSMC:value ?prop .
      ?prop a aas:Property ;
            aasRf:idShort ?idShort ;
            aasP:value ?val .
      FILTER(?val != "" && REGEX(STR(?val), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'))
    }
  }

  {
    SELECT (GROUP_CONCAT(
      CONCAT('"', ?idShort, '":',
        IF(REGEX(STR(?val), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'),
           STR(?val), CONCAT('"', STR(?val), '"')))
      ; SEPARATOR=',') AS ?chemJson)
    WHERE {
      ?chemSMC a aas:SubmodelElementCollection ;
               aasRf:idShort "ChemicalAnalysis" ;
               aasSMC:value ?prop .
      ?prop a aas:Property ;
            aasRf:idShort ?idShort ;
            aasP:value ?val .
      FILTER(?val != "" && REGEX(STR(?val), '^-?[0-9]+(\\\\.[0-9]+)?([eE][+-]?[0-9]+)?$'))
    }
  }

}`;

// Walk the AAS JSON and find a Property node by idShort, return its numeric value or null.
function aasPropertyValue(elements, idShort) {
  for (const el of elements ?? []) {
    if (el.idShort === idShort && el.modelType === 'Property') return Number(el.value);
    const nested = aasPropertyValue(el.value, idShort);
    if (nested !== null) return nested;
  }
  return null;
}

// Extract the ground-truth numeric values we expect the SPARQL to reconstruct.
// Reads directly from the original AAS JSON — not a hand-crafted reference.
function extractMfgxGroundTruth(aasDoc) {
  const elements = aasDoc?.submodels?.[0]?.submodelElements ?? [];
  const find = id => aasPropertyValue(elements, id);
  return {
    mechanicalTests: {
      TensileStrengthMean:        find('TensileStrengthMean'),
      YieldOrProofStrengthMean:   find('YieldOrProofStrengthMean'),
      ElongationAfterFractureMean:find('ElongationAfterFractureMean'),
    },
    chemicalAnalysis: {
      MassFraction_C:  find('MassFraction_C'),
      MassFraction_Cr: find('MassFraction_Cr'),
      MassFraction_Mn: find('MassFraction_Mn'),
      MassFraction_Mo: find('MassFraction_Mo'),
      MassFraction_N:  find('MassFraction_N'),
      MassFraction_Ni: find('MassFraction_Ni'),
      MassFraction_P:  find('MassFraction_P'),
      MassFraction_S:  find('MassFraction_S'),
      MassFraction_Si: find('MassFraction_Si'),
    },
  };
}

// Compare SPARQL reconstruction against ground-truth values; returns array of check results.
function assertMfgxValues(reconstructed, ground) {
  const checks = [];
  for (const [section, props] of Object.entries(ground)) {
    for (const [key, expected] of Object.entries(props)) {
      const got = reconstructed?.[section]?.[key];
      checks.push({ label: `${section}.${key}`, expected, got: Number(got), ok: Number(got) === expected });
    }
  }
  return checks;
}

async function triggerMfgxJsonQuery() {
  const spinner  = document.getElementById('mfgx-json-spinner');
  const badge    = document.getElementById('mfgx-json-badge');
  const output   = document.getElementById('mfgx-json-output');
  const assertEl = document.getElementById('mfgx-json-assert');
  const section  = document.getElementById('mfgx-json-result');

  if (spinner) spinner.style.display = 'inline';
  if (section) section.style.display = '';
  if (assertEl) assertEl.textContent = '';

  await storeReady;

  try {
    const results  = store.query(RETRIEVE_MFGX_JSON_QUERY);
    const bindings = [...results];
    if (!bindings.length) {
      if (output)   output.textContent = '(no results — load Node B first)';
      if (badge)    { badge.className = 'badge-cached'; badge.textContent = 'No data'; }
      if (assertEl) assertEl.textContent = '⚠ Node B not loaded — run the pipeline first.';
      return;
    }

    const raw = bindings[0].get('json')?.value ?? '';
    let reconstructed;
    try { reconstructed = JSON.parse(raw); } catch (e) {
      if (output) output.textContent = 'Parse error: ' + e.message + '\n\nRaw:\n' + raw;
      if (badge)  { badge.className = 'badge-cached'; badge.textContent = 'Parse error'; }
      return;
    }

    // Extract ground-truth values directly from the original AAS JSON (not a hand-crafted reference)
    const aasResp = await fetch('assets/data/inspectiondocument_316_4401_alloy.json');
    const aasDoc  = await aasResp.json();
    const ground  = extractMfgxGroundTruth(aasDoc);

    if (output) output.textContent = JSON.stringify(reconstructed, null, 2);
    if (badge)  { badge.className = 'badge-live'; badge.textContent = 'Live · Oxigraph in-browser'; }

    // Compare SPARQL output values against ground-truth values from original AAS
    const checks = assertMfgxValues(reconstructed, ground);
    const allPass = checks.every(c => c.ok);

    if (assertEl) {
      if (allPass) {
        assertEl.innerHTML = '<span class="assert-pass">✓ Data round-trip verified — all ' +
          checks.length + ' values from the original AAS inspection document match the SPARQL reconstruction.</span>' +
          '<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">Note: the SPARQL extracts data values, not the full AAS serialization format (nested semanticId/qualifier/displayName structures are not reproduced).</div>';
      } else {
        const fails = checks.filter(c => !c.ok);
        assertEl.innerHTML = '<span class="assert-fail">✗ ' + fails.length + ' value(s) do not match:</span><ul>' +
          fails.map(c => `<li>${escHtml(c.label)}: expected ${escHtml(String(c.expected))}, got ${escHtml(String(c.got))}</li>`).join('') +
          '</ul>';
      }
    }

    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (output)   output.textContent = 'Error — see console';
    if (badge)    { badge.className = 'badge-cached'; badge.textContent = 'Error'; }
    if (assertEl) assertEl.textContent = '✗ ' + err.message;
    console.error('MfgX JSON query failed:', err);
  } finally {
    if (spinner) spinner.style.display = 'none';
  }
}

const runMfgxJsonBtn = document.getElementById('run-mfgx-json-btn');
if (runMfgxJsonBtn) runMfgxJsonBtn.addEventListener('click', triggerMfgxJsonQuery);

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

  const spinner = document.getElementById('result-spinner');
  const badge   = document.getElementById('result-badge');

  if (spinner) spinner.style.display = 'inline';

  await storeReady;

  try {
    const results = store.query(SPARQL_QUERY);
    const bindings = [...results];

    if (badge) { badge.className = 'badge-live'; badge.textContent = `Live · Oxigraph in-browser`; }

    const fullCols = ['componentLabel', 'materialLabel', 'property', 'value', 'unitLabel'];
    showResultTable(bindings, 'result-table-full', fullCols);

    document.getElementById('result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    if (badge) { badge.className = 'badge-cached'; badge.textContent = 'Query error — check console'; }
    console.error('SPARQL query failed:', err);
  } finally {
    if (spinner) spinner.style.display = 'none';
    sparqlInFlight = false;
  }
}
