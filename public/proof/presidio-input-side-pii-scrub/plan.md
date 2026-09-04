# Plan: presidio-input-side-pii-scrub

## Prior session

exploration.md + research.md done. All open questions resolved with live-verified evidence (not assumptions):
- Python 3.14 / spaCy version compat: non-issue, live-confirmed.
- Email/PERSON NER overlap: resolved by `entities=` scoping (PERSON excluded), not a recognizer-priority mechanism.
- No dedicated address recognizer exists — `LOCATION` (spaCy NER GPE/LOC) is the only available proxy, and it does redact affiliation-adjacent city names.

## Decisions

### D1: LOCATION included as designed, no paragraph-position carve-out

§3.1 explicitly scopes input-side to "emails, phone numbers, physical addresses" (brief IN item 1: "tuned to emails/phones/physical-addresses"). `LOCATION` is the only available proxy for the third category (research.md Finding 2). Research demonstrated `LOCATION` will redact a legitimate affiliation city (e.g. "Palo Alto" in an author-affiliation line).

**Decision: include `LOCATION` uniformly across all paragraphs, no special-casing the title/author block.** Rationale: the design doc's own stated policy is exactly the safety valve for this — "redact + log, not block... a false-positive hazard that breaks the pipeline's core function for no real benefit... redact the matched span in place, keep the paragraph." The brief's success criteria require preserving **author names**, not affiliation cities — a redacted city string doesn't break citation attribution (citations key on author surname + year, not institutional city). Adding a title-block carve-out for `LOCATION` would be scope creep beyond what brief/design doc asked for (they carve out `PERSON`, not `LOCATION`), and duplicates page-1 heuristics already fragile in `extract.py`'s author-parsing logic. Not pursued.

### D2: score_threshold left at library default (no explicit threshold set)

Research Finding 5: `PhoneRecognizer` scored a realistic phone number at 0.40; a `score_threshold=0.5` silently dropped it. Presidio's `AnalyzerEngine.analyze()` defaults to `score_threshold=0` (no filtering) when the param is omitted.

**Decision: omit `score_threshold` (accept library default of 0).** Rationale: policy is redact+log/never-block — a missed real phone number (false negative) is worse than an extra low-confidence redaction (false positive), given the "keep the paragraph, just redact the span" safety net. Setting an explicit threshold would need tuning data this task doesn't have; the default is the documented, unmodified library behavior and matches the risk asymmetry the design doc states.

### D3: Redaction runs in `ingest_pdf()`, not inside each extractor

Two call sites (one after each of the two `_check_quality` successes in `ingest_pdf`), same helper function — not duplicated logic, just two invocations. Rationale (from exploration.md): avoids scrubbing text on the failed-quality path (that text gets discarded anyway), and avoids adding the Presidio call to both `extract_pymupdf` and `extract_pdfplumber` bodies separately.

### D4: Presidio engines lazily initialized, module-level singleton

`AnalyzerEngine`/`AnonymizerEngine` construction loads the spaCy model (research.md Finding 6) — must not happen per-paragraph or even at module import time (would add spaCy-load cost to every test/import of `pipeline.ingestion`, including tests that never call `ingest_pdf`). A private `_get_engines()` function lazily builds and caches both engines on first real use (import of `presidio_analyzer`/`presidio_anonymizer` deferred inside the function too, for the same reason).

### D5: pyproject.toml is a required additional Key File (deviation from brief)

Brief's Key Files table lists only `extract.py`. `presidio-analyzer`/`presidio-anonymizer` are not installed (exploration.md, confirmed via `ModuleNotFoundError` before any research) — this is a genuine gap in the brief, not a scope choice. Adding the two packages to `pyproject.toml` (`uv add presidio-analyzer presidio-anonymizer`, which also regenerates `uv.lock`) is a necessary prerequisite, surfaced explicitly here rather than silently expanded.

## Entity scope and redaction format

```python
_PII_ENTITIES = ["EMAIL_ADDRESS", "PHONE_NUMBER", "LOCATION"]
_PII_OPERATORS = {
    "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
    "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE]"}),
    "LOCATION": OperatorConfig("replace", {"new_value": "[LOCATION]"}),
}
```

No `PERSON` in `_PII_ENTITIES` — this is what keeps author names intact (D1 rationale) and is what makes the M1-spike-flagged email/PERSON overlap moot (research.md Finding 3).

## Implementation sketch (`pipeline/pipeline/ingestion/extract.py`)

```python
_analyzer = None
_anonymizer = None


def _get_engines():
    global _analyzer, _anonymizer
    if _analyzer is None:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        from presidio_anonymizer import AnonymizerEngine

        nlp_engine = NlpEngineProvider(
            nlp_configuration={
                "nlp_engine_name": "spacy",
                "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
            }
        ).create_engine()
        _analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
        _anonymizer = AnonymizerEngine()
    return _analyzer, _anonymizer


def _scrub_pii(paragraphs: list[Paragraph]) -> list[Paragraph]:
    from presidio_anonymizer.entities import OperatorConfig

    analyzer, anonymizer = _get_engines()
    operators = {
        "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
        "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE]"}),
        "LOCATION": OperatorConfig("replace", {"new_value": "[LOCATION]"}),
    }
    scrubbed: list[Paragraph] = []
    for p in paragraphs:
        results = analyzer.analyze(text=p.text, language="en", entities=_PII_ENTITIES)
        if not results:
            scrubbed.append(p)
            continue
        anonymized = anonymizer.anonymize(text=p.text, analyzer_results=results, operators=operators)
        for item in anonymized.items:
            logger.info(
                "PII redacted: type=%s page=%d paragraph=%d", item.entity_type, p.page, p.index
            )
        scrubbed.append(p.model_copy(update={"text": anonymized.text}))
    return scrubbed
```

Call sites in `ingest_pdf()`: replace each `if _check_quality(result): return result` with `if _check_quality(result): return _scrub_pii_paper(result)` where a tiny wrapper sets `result.paragraphs = _scrub_pii(result.paragraphs)` and returns `result` — or inline the two lines at each site. Exact inline-vs-wrapper choice is a mechanical IMPLEMENTING-time call, not a design decision.

## Files changed

| File | Change |
|------|--------|
| `pipeline/pipeline/ingestion/extract.py` | Add `_get_engines`, `_scrub_pii`, `_PII_ENTITIES`; call from both `ingest_pdf` success paths |
| `pipeline/pyproject.toml` | Add `presidio-analyzer`, `presidio-anonymizer` (D5) |
| `pipeline/uv.lock` | Regenerated by `uv add` |
| `pipeline/tests/test_ingestion.py` | New `TestPiiScrub` class |

No changes to `models.py` (no new `Paragraph` field needed — page/index already serve as the log location key, per exploration.md).

## Explicitly out of scope (unchanged from brief)

- `PERSON` detection — M2-T2, output-side.
- Blocking/failing on detection — never happens, redact+log only.
- Chunking (M2-T3/T4) — unrelated, no dependency either direction.
