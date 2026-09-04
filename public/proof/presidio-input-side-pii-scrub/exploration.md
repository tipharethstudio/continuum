# Exploration: presidio-input-side-pii-scrub

## Prior session

BRIEFING done, brief.md verified complete (goal/context/scope/success criteria). No code touched yet.

## Current extract.py architecture

`pipeline/pipeline/ingestion/extract.py`:
- `extract_pymupdf(pdf_bytes) -> IngestedPaper` and `extract_pdfplumber(pdf_bytes) -> IngestedPaper` — two independent extractors, each builds `Paragraph` objects (page, index, text, is_heading, heading_level) in its own loop.
- `ingest_pdf(pdf_bytes) -> IngestedPaper` — single public entry point: try pymupdf, quality-check (`_check_quality`, chars/page ≥ `QUALITY_THRESHOLD`), fallback to pdfplumber, raise `IngestionError` if both fail.
- Both extractors also parse `title` and `authors` (`_parse_authors`, comma/semicolon split) from page-1 blocks — these must stay untouched (author names feed citations).

**Choke point**: `pipeline/pipeline/api/routes.py:143` calls `ingest_pdf(pdf_bytes)`, then `:162` calls `result.to_annotated_markdown()` and writes it to disk — this markdown is what `paper_analyzer.py` and Qdrant ultimately see. Redaction must land on `Paragraph.text` somewhere between these two lines.

**Two placement options**:
1. Inside `ingest_pdf()`, right before `return result` on both the pymupdf-success and pdfplumber-fallback paths — single choke point, doesn't duplicate scrub logic across two extractors.
2. Inside each extractor's paragraph-construction loop — matches the design doc's literal wording ("in the paragraph-extraction loop") but duplicates the Presidio call site twice.

Option 1 is one call site instead of two and still runs before markdown assembly / Qdrant — functionally equivalent to the design intent. Leaning toward option 1; open question for RESEARCHING/PLANNING.

## models.py

`Paragraph(page, index, text, is_heading, heading_level)` — plain Pydantic model, no PII-redaction metadata field today. Design doc calls for logging "type + location, not value" — `page`+`index` already double as the location key, no model change needed, logging can happen at scrub-call time via existing `logger` in extract.py.

## Dependency state (verified live, not assumed)

```
$ uv run python -c "import presidio_analyzer"
ModuleNotFoundError: No module named 'presidio_analyzer'
```

`presidio-analyzer` / `presidio-anonymizer` are **not** in `pyproject.toml` or `uv.lock` — nothing installed. spaCy IS present and confirmed working:

```
spacy==3.8.13 (pinned — cp314 wheel constraint, per M1-T5 spike)
en-core-web-sm (installed via direct wheel URL, uv.sources)
```

```
$ uv run python -c "import spacy; nlp=spacy.load('en_core_web_sm'); print('ok')"
ok
```

So this task's scope implicitly includes adding `presidio-analyzer`+`presidio-anonymizer` to `pyproject.toml` — brief's Key Files table lists only `extract.py`, but the dependency addition is a prerequisite the brief didn't call out. Flagging for PLANNING.

## M1-T5 spike findings relevant to this task (`pipeline/spikes/local_model_viability.md` §2)

- **Verdict: GO.** spaCy NER footprint 107MB disk / 158MB peak RSS, P50 latency 4.0ms per paragraph-length text (20-repeat sample) — cheapest of the three spiked models.
- **Real caveat, not a blocker**: spaCy's NER tagged an email address (`j.rodriguez@example.edu`) as `PERSON`, alongside correctly tagging `"Jane Rodriguez"` → PERSON and `"Northwestern Memorial Hospital"` → ORG. Spike notes this is caught anyway because §3.1's design routes emails through Presidio's regex-based `EmailRecognizer`, not the NER model — **but flags "worth confirming during M2 implementation that Presidio's recognizer-priority resolves the conflict as expected rather than double-redacting."** This is a concrete verification task for this implementation, not just spike residue.

## Design doc scope (§3.1, `docs/signals/design-doc-safety-guardrails-hardening.md:97-115`)

- Attach point: `extract.py` paragraph-extraction loop, on `Paragraph.text`, before markdown assembly and before Qdrant.
- Policy: **redact + log, never block** — false-positive-safe by design (a literature-review pipeline doesn't need author names to synthesize claims, so redaction failure modes are cheap).
- Entity scope: **tuned down to high-confidence, clearly-non-bibliographic categories — emails, phone numbers, physical addresses.** Explicitly NOT generic `PERSON` (that's §3.2, output-side, a distinct task M2-T2, out of scope here).
- §3.2 (output-side, out of scope) is described as "genuinely distinct — a different failure mode (leak via generation vs. leak via raw upload)", confirming this task should NOT touch `theme_reviewer.py`/`aggregator.py`.

## Open question surfaced by design-doc re-read: address detection precision

Presidio's built-in address/location coverage isn't purely regex — the `LOCATION`/`ADDRESS`-family recognizers lean on the spaCy NER model's `GPE`/`LOC`/`FAC` entity tags plus context-word boosting, not a fixed-shape regex like `EMAIL_ADDRESS`/`PHONE_NUMBER`. Academic papers routinely contain **legitimate, citation-relevant institutional addresses** in author affiliations (e.g., "Stanford University, Palo Alto, CA") — a naive `LOCATION`-entity redaction risks stripping affiliation text the same way generic `PERSON` would strip author names, which the design doc explicitly says to avoid. Needs resolving in RESEARCHING/PLANNING: which specific Presidio recognizer(s)/entity type(s) count as "physical address" here, and whether affiliation-block paragraphs need the same author-name-style carve-out.

## Existing test conventions (`tests/test_ingestion.py`)

- Uses `reportlab` to generate synthetic PDFs in-memory (`_make_pdf` helper building title/author/heading/body blocks), not fixture files on disk.
- Test classes grouped by concern: `TestExtractPymupdf`, `TestExtractPdfplumber`, `TestTitleDetection`, `TestAuthorDetection`, `TestToMarkdown`, `TestIngestPdf`, `TestMultipage`, `TestQualityCheck`.
- A PII-redaction test suite should follow this pattern — synthetic PDF with an email/phone/address in body text plus an author-name/affiliation block, asserting the former is redacted and the latter survives verbatim. Matches brief's stated success criterion ("verified on a paper with an acknowledgments section").

## Config / observability conventions

- `pipeline/pipeline/config.py` uses `pydantic-settings` with `PIPELINE_` env prefix — no PII-related setting exists yet; none appears required by brief scope (policy is fixed: redact+log, never block, no toggle requested).
- `extract.py` already has a module-level `logger = logging.getLogger(__name__)` and uses `logger.info`/`logger.warning` — redaction logging should reuse this, matching the codebase's existing structured-logging style (no PII value in the log line, per success criteria).

## Confirmed out of scope (verified against sibling task, not assumed)

- M2-T2 (Presidio output-side, `theme_reviewer.py`/`aggregator.py`, PERSON-inclusive) — separate task, separate dependency, not touched here.
- M2-T3/T4 (chunking, Tier 1/Tier 2) — separate tasks, no dependency on this one per milestone table.
