# TODO: presidio-input-side-pii-scrub

1. [ ] `pipeline/pyproject.toml`: add `presidio-analyzer`, `presidio-anonymizer` to `dependencies`, with a comment mirroring the existing spacy/AlignScore comment style (cite research.md's live Python 3.14 + spacy==3.8.13 compat confirmation). Run `uv add presidio-analyzer presidio-anonymizer` from `pipeline/` to update `pyproject.toml` + `uv.lock` together.
2. [ ] `pipeline/pipeline/ingestion/extract.py`: add module-level `_analyzer`/`_anonymizer` globals + `_get_engines()` lazy singleton (D4).
3. [ ] `pipeline/pipeline/ingestion/extract.py`: add `_PII_ENTITIES = ["EMAIL_ADDRESS", "PHONE_NUMBER", "LOCATION"]` and `_scrub_pii(paragraphs: list[Paragraph]) -> list[Paragraph]` (D1/D2 — no `score_threshold` override, no `PERSON`).
4. [ ] `pipeline/pipeline/ingestion/extract.py`: wire `_scrub_pii` into both success-return paths of `ingest_pdf()` (D3) — pymupdf-success and pdfplumber-fallback-success.
5. [ ] `pipeline/pipeline/ingestion/extract.py`: log redaction as `logger.info("PII redacted: type=%s page=%d paragraph=%d", ...)` — entity type + `Paragraph.page`/`.index` only, never the matched text/PII value.
6. [ ] `pipeline/tests/test_ingestion.py`: add `TestPiiScrub` class, reusing the existing `_make_pdf` reportlab helper:
   - synthetic PDF with a body paragraph containing an email + phone number + a city name, plus the existing author-line fixture pattern.
   - assert email/phone/location paragraphs are redacted to `[EMAIL]`/`[PHONE]`/`[LOCATION]`.
   - assert `result.authors` (parsed from the title-block) is unaffected — same assertion style as `TestAuthorDetection`.
   - assert paragraph count unchanged pre/post scrub (redaction doesn't drop or merge paragraphs).
   - assert non-PII paragraphs pass through byte-for-byte unchanged.
   - assert redaction is logged (`caplog`) with entity type + page/index, and that the log message does NOT contain the raw email/phone string.
7. [ ] Run `uv run pytest tests/test_ingestion.py -v` — new tests pass, no existing `test_ingestion.py` test regresses.
8. [ ] Run `uv run pytest tests/ -v` — full 266-test pipeline suite, confirm no cross-module regression (e.g. anything importing `pipeline.ingestion` eagerly).
9. [ ] Run `uv run ruff check pipeline/` and `uv run ruff format pipeline/` — lint/format clean.
10. [ ] Manual smoke check (optional but cheap given `make log-pipeline` + `pipeline-test-client` already exist): run one test-case PDF through the real server, confirm no exception from the new Presidio call path and pipeline still completes (existing test PDFs are academic papers, unlikely to contain real PII — this is a smoke check for "doesn't crash the pipeline," not a PII-detection functional test, that's covered by unit tests in step 6-7).
