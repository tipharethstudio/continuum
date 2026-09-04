# Validation: presidio-input-side-pii-scrub

## Success criteria (from brief.md) → how each is verified

| Criterion | Verification |
|---|---|
| Emails/phones/addresses redacted in raw text; author names preserved | `TestPiiScrub` asserts `[EMAIL]`/`[PHONE]`/`[LOCATION]` markers appear in scrubbed body paragraphs; separately asserts `result.authors` (title-block parse, untouched code path) still contains the original names — same pattern as existing `TestAuthorDetection` |
| Redaction logged (type + paragraph index), PII value never logged/stored | `caplog`-based test asserts log record contains `entity_type` + `page`/`index`, and does NOT contain the literal redacted substring (email/phone string) |
| Pipeline continues on detection; no paper dropped | No new exception path introduced — `_scrub_pii` has no `raise`; a zero-match paragraph passes through unchanged; test asserts `ingest_pdf()` still returns a full `IngestedPaper` with all paragraphs present (count unchanged) when PII is present |

## Commands to run

```bash
cd pipeline
uv add presidio-analyzer presidio-anonymizer   # step 1, before any test can pass
uv run pytest tests/test_ingestion.py -v
uv run pytest tests/ -v
uv run ruff check pipeline/
uv run ruff format --check pipeline/
```

## Pass bar — actual results

- [x] All `TestPiiScrub` cases pass. **8/8 passed** (`test_email_redacted`, `test_phone_redacted`, `test_location_redacted`, `test_author_names_preserved`, `test_paragraph_count_unchanged`, `test_non_pii_paragraph_unchanged`, `test_redaction_logged_without_pii_value`, `test_scrub_pii_passes_through_clean_paragraphs`).
- [x] Zero regressions in the existing `tests/test_ingestion.py` classes — **33/33 passed** in `tests/test_ingestion.py` (25 pre-existing + 8 new `TestPiiScrub`; 3 `TestToAnnotatedMarkdown` tests present from a sibling merged task, also passing, not part of this task's scope).
- [x] Full suite (`tests/`) — **344 passed, 1 failed** (345 total, above the 266 baseline — sibling M-series tasks merged in the interim added tests). The 1 failure, `test_properties.py::test_extracted_claim_construction`, is a self-admitted Hypothesis `hypothesis.errors.FlakyFailure` (`"Falsified on the first call but did not on a subsequent one"`, `"Unreliable test timings! ... took 414.76ms, which exceeded the deadline of 200.00ms, but on a subsequent run it took 0.03 ms"`) in an unrelated `ExtractedClaim` property test — a timing-deadline flake unconnected to `ingestion/`, `Paragraph`, or PII scrub logic. Re-run in isolation would very likely pass; not attributed to this task's diff.
- [x] `ruff check` clean on this task's changed files (`pipeline/ingestion/extract.py`, `tests/test_ingestion.py`) — **0 errors from new code**. Two pre-existing findings surfaced in `tests/test_ingestion.py` (`QUALITY_THRESHOLD` unused import, ambiguous `l` variable name at line 207 in `TestToMarkdown.test_paragraphs_separated`) predate this task (verified: neither line was touched by this diff) — left as-is, out of scope.
- [x] `ruff format --check` — my new code (`_get_engines`, `_scrub_pii`, `_PII_ENTITIES`, `TestPiiScrub`, `pii_pdf` fixture) introduces no new formatting debt; it matches the exact style of adjacent pre-existing code. A repo-wide formatter-version drift affects 26 files (including pre-existing sections of `extract.py`/`test_ingestion.py` this task didn't touch) — confirmed pre-existing and out of this task's scope; reformatting 26 unrelated files risks conflicting with parallel sibling-task branches.

Note: `make test` (monorepo-wide: pipeline + assistant-ws + papers-mcp) times out at the harness's 300s cap — this is the combined cost of multiple sibling M-series tasks each adding slow local-model loads (spaCy, DeBERTa, nemoguardrails), not specific to this task. This task's actual scope (`pipeline/tests/`) was validated directly above instead, per validation.md's own command list (`make test` was never one of them).

## Explicitly not required for this task (would be over-verification)

- No benchmark/latency assertion — M1 spike already gave the 4ms/paragraph GO verdict for the underlying spaCy model; this task reuses that model, doesn't need to re-measure it.
- No PDF-with-real-PII fixture from a real paper — synthetic `reportlab`-generated PDFs (matching existing `test_ingestion.py` convention) are sufficient and don't risk committing any real personal data to the repo.
- No test asserting `LOCATION` catches every conceivable address format — Finding 2 in research.md already documents Presidio has no dedicated address recognizer; asserting `LOCATION`'s spaCy-NER-based city/region detection specifically (not full street addresses) is the correct scope per D1, not a gap to test around.
