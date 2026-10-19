# Geography catalog snapshot

Reduced reference data for G1: worldwide ISO countries, Mexico's INEGI subdivisions,
and postal-code-to-municipality pairs. No settlements, streets, or raw archives are
stored here. The API resolves only one postal code at a time.

## Snapshot and provenance

Downloaded **2026-10-19 UTC**. Counts exclude CSV headers; no names or codes were
invented. `sources.json` is the import manifest: published source date when available,
otherwise explicitly the retrieval date (not a claimed publication date).

| File | Rows | Source date | Source |
| --- | ---: | --- | --- |
| `countries.csv` | 249 | retrieved 2026-10-19 | ISO 3166-1 alpha-2 membership from [pycountry's ISO database](https://raw.githubusercontent.com/pycountry/pycountry/main/src/pycountry/databases/iso3166-1.json); names from Unicode CLDR [Spanish](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-localenames-full/main/es/territories.json) and [English](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-localenames-full/main/en/territories.json) |
| `mx_states.csv` | 32 | retrieved 2026-10-19 | [INEGI AGEEML geographical catalog](https://gaia.inegi.org.mx/wscatgeo/v2/mgee/) (`cve_ent`, `nomgeo`, `nom_abrev`) |
| `mx_municipalities.csv` | 2,478 | retrieved 2026-10-19 | [INEGI municipality service](https://gaia.inegi.org.mx/wscatgeo/v2/mgem/01), one request per state `01`–`32`; `cvegeo`, `cve_ent`, `nomgeo` |
| `mx_postal_codes.csv` | 31,867 | 2026-10-18, shown on source page | [SEPOMEX national download](https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx): select all states and TXT, submit the download form |

SEPOMEX raw TXT had **159,368 settlement rows**, reduced to **31,867 unique
`d_codigo,c_estado,c_mnpio` triples** (also 31,867 distinct postal codes in this
snapshot). **Zero** pairs were absent from INEGI. Multi-municipality postal codes
are nevertheless supported and tested. Leading zeros are retained. CLDR-only
exceptional/reserved territories are excluded by the ISO membership list.
The INEGI service also includes 2020 census statistics; these are **not** imported.

CSV headers are `country_code,name_es,name_en`, `state_code,name,abbreviation`,
`state_code,municipality_code,name`, and `d_codigo,c_estado,c_mnpio`, respectively.

Raw-source SHA-256 checksums (for auditing this snapshot, not automatic downloads):

| Source | SHA-256 |
| --- | --- |
| ISO JSON | `f01b812b57fba9f31ff621bf33e7c7570a01964dbeb5be2167e94decf538c89f` |
| CLDR es | `027b9c91d4e923d506b404415648691ef41ebde721aa454cee4d9f7f66b3ea62` |
| CLDR en | `158c1d575308f7e46912edbeda435c8fe2ef5dad280798231f3a432e406b1807` |
| INEGI states | `504d80452aa87d483ae5c927c3dad6f666f517e93a68ee09c2c076ac3422e8c6` |
| INEGI municipalities, concatenated state JSONs in ascending code order | `620034dfd60b156bf63166178fe884ae21998aa667e0d8fb1f190b81076fc5e8` |
| SEPOMEX national ZIP | `7b5a4420d5f75c985bb1703ca99a458fa1ca178fe5513957d2081bae13903730` |

## Licence and use notes

- Unicode CLDR: Unicode data licence; retain attribution to Unicode, Inc. and
  consult [Unicode's terms](https://www.unicode.org/copyright.html).
- ISO membership is sourced from pycountry's iso-codes-derived database; consult
  [the upstream licence](https://github.com/pycountry/pycountry/blob/main/LICENSE.txt).
- INEGI: attribution to INEGI; see [terms of use](https://www.inegi.org.mx/inegi/terminos.html).
- SEPOMEX's web page says: «El Catálogo Nacional de Códigos Postales, es elaborado
  por el Servicio Postal Mexicano y se proporciona en forma gratuita, no estando
  permitida su comercialización, total o parcial.»
- **Additional notice in the downloaded TXT:** «El Catálogo Nacional de Códigos
  Postales, es elaborado por Correos de México y se proporciona en forma gratuita
  para uso particular, no estando permitida su comercialización, total o parcial,
  ni su distribución a terceros bajo ningún concepto.» This is broader than the
  web-page notice. The reduced file is not a grant of redistribution rights;
  review this restriction before publishing/distributing the repository or data.
  S11 authorizes one-code-at-a-time autocomplete, **not** resale or bulk listing.
  The user explicitly accepted the documented SEPOMEX risk for G1; this does not
  change the source notices or grant additional rights.

## Optional SEPOMEX import

`make geo-import` imports all four datasets in one transaction. To import only
countries, states and municipalities, without reading the SEPOMEX CSV:

```sh
make geo-import GEO_ARGS=-skip-postal-codes
# Equivalent: go run ./cmd/geoimport -skip-postal-codes
```

In this mode `mx_postal_codes.csv` is not opened or validated and may be absent.
Its `sources.json` entry may also be absent; if present it is ignored. The isolated
postal upsert step is not invoked: no postal-table reads, locks, writes, postal
orphan checks, or SEPOMEX history row. Core orphan protection is unchanged, and
three source-history rows are appended instead of four.

A fresh database's postal table stays empty. Countries, states and municipalities
still import successfully and all three lookup endpoints work with their usual
cache headers. A well-formed postal lookup returns `404 postal_code_not_found`.
The flag does **not** clear existing postal data or disable the postal endpoint;
existing rows are left untouched. Default import can populate or refresh postal
codes later. This isolates the accepted SEPOMEX risk so the import can be omitted
without removing the ISO/INEGI catalog. The flag applies to import only, not
`geo-reduce`, which still regenerates the full four-file snapshot.

## Manual refresh

1. Download each source into its own new empty directory outside the repository;
   keep any scripts separately. Treat downloads as data, never executable content.
   If using Python for preparation, run it with `-I`. Do not commit raw downloads.
2. Assemble this raw directory layout (copies may remain outside the repository):

   ```text
   RAW/
     iso-countries/iso3166-1.json
     cldr-es/territories.json
     cldr-en/territories.json
     inegi-states/states.json
     inegi-municipalities-01/municipalities.json
     ...
     inegi-municipalities-32/municipalities.json
     sepomex/CPdescarga.zip                 # contains CPdescarga.txt
   ```

   Use the URLs above. For SEPOMEX, use the national TXT form, not a mirror;
   it returns a ZIP. `curl --ipv4 --tls-max 1.2` worked after intermittent TLS
   EOF failures. Never disable certificate verification. The reducer streams
   the named TXT member without extracting archive paths.
3. From `backend/`, run `make geo-reduce RAW=/absolute/path/to/RAW`. It emits only
   the four CSVs, reports rejected cross-source pairs, and sorts/deduplicates
   deterministically. INEGI owns subdivision identity; do not guess mismatches.
   TXT is pipe-delimited Latin-1, with literal quotes in some settlement names;
   only its ASCII code columns are retained.
4. Review diffs, source dates, counts, checksums, restrictions, and skipped pairs.
   Update this README, `sources.json`, and `TestVersionedCatalog`'s snapshot counts.
5. Apply migration 00030 through the existing goose workflow. Supply
   `DATABASE_URL` explicitly, then run `make geo-import`. The importer does **not**
   load `.env`, create databases, or migrate schemas. No database URL is logged.
6. Missing previously imported codes cause a transaction refusal, even if currently
   unreferenced (conservative guard). Review the listed codes; only explicitly
   approved retention should use `make geo-import GEO_ARGS=-allow-orphans`.
   Old codes are retained, never deleted, including with the override. Successful
   reimports upsert enabled data and append four source-history rows (three with
   `-skip-postal-codes`); API ETags change. Skipping postal codes does not orphan-check
   existing postal rows, because that dataset is outside the selected import.

See [API and import contract](../../docs/geo-catalog.md). Refresh is manual;
there is no scheduled synchronizer or bulk postal API.
