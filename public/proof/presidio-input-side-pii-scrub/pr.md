feat(pipeline): Presidio input-side PII scrub on raw paragraph text

## Summary

- Adds a Presidio (`AnalyzerEngine` + `AnonymizerEngine`, spaCy `en_core_web_sm` backend) PII redaction pass in `ingestion/extract.py`, running on every extracted `Paragraph.text` before markdown assembly and before anything reaches `paper_analyzer.py`/Qdrant.
- Scoped to `EMAIL_ADDRESS`, `PHONE_NUMBER`, `LOCATION` only — deliberately excludes `PERSON`, so author names stay intact for citations. `PERSON`-inclusive output-side scrubbing is a separate, already-scoped follow-up task (M2-T2).
- Policy: redact + log, never block — a detection redacts the matched span in place (`[EMAIL]`, `[PHONE]`, `[LOCATION]`) and logs entity type + paragraph page/index; the PII value itself is never logged or persisted. No paper is ever dropped due to a PII finding.
- Adds `presidio-analyzer`/`presidio-anonymizer` to `pyproject.toml` — live-verified against this repo's actual Python 3.14 target (a WebSearch claiming Presidio requires `<3.14` turned out to be stale metadata; a real install resolves cleanly and pins the same `spacy==3.8.13` already locked in from the M1 spike, no conflict).

## Design notes worth flagging in review

- Presidio has no dedicated street-address recognizer; "physical address" scope is approximated via the `LOCATION` entity (spaCy NER GPE/LOC labels). This means a legitimate author-affiliation city (e.g. "Palo Alto" in an affiliation line) can get redacted to `[LOCATION]`. This is accepted, not a bug — it's exactly the kind of low-cost false positive the design doc's "redact, don't block, log the type" policy is meant to absorb, and the brief's citation-preservation requirement is specifically about author *names*, not affiliation cities.
- `AnalyzerEngine`/`AnonymizerEngine` are lazily constructed once (module-level singleton) — building them loads the spaCy model, which must not happen per-paragraph or at import time.

## Test plan

- [ ] `uv add presidio-analyzer presidio-anonymizer` (updates `pyproject.toml` + `uv.lock`)
- [ ] `uv run pytest tests/test_ingestion.py -v` — new `TestPiiScrub` class + zero regressions in existing ingestion tests
- [ ] `uv run pytest tests/ -v` — full suite, no regressions
- [ ] `uv run ruff check pipeline/` / `uv run ruff format --check pipeline/`
