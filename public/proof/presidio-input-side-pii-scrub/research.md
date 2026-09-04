# Research: presidio-input-side-pii-scrub

## Prior session

exploration.md done. Open items carried in: (1) presidio-analyzer/anonymizer not installed, pyproject gap; (2) redaction choke-point placement (`ingest_pdf()` vs per-extractor); (3) spike-flagged email/PERSON NER overlap needs verification; (4) LOCATION-entity redaction risk against author-affiliation text.

All findings below verified live in a scratch venv (`/tmp/presidio-spike`, gitignored, not `pipeline/pyproject.toml`/`uv.lock`), matching this repo's established spike convention of live-checking instead of trusting docs/search-result claims.

## Finding 1: Python 3.14 compatibility — WebSearch result was WRONG, live check overrides it

`WebSearch` for "presidio python 3.14 compatibility" returned: *"Presidio (version 2.2.363) requires Python <3.14, >=3.10 — Python 3.14 is not currently supported."*

**Live check contradicts this.** `uv venv --python 3.14 && uv pip install presidio-analyzer presidio-anonymizer` on this machine's Python 3.14.3 **succeeded cleanly**:

```
+ presidio-analyzer==2.2.364
+ presidio-anonymizer==2.2.364
+ spacy==3.8.13          # ← matches the version already pinned in pipeline/pyproject.toml from M1-T5
```

Same pattern the M1 spike called out for spaCy itself (`spacy==3.8.14` search-flagged as blocked, `3.8.13` patch-closed the gap) — package metadata / search-indexed docs lag actual PyPI releases. **Verdict: no Python-version blocker. presidio-analyzer==2.2.364 resolves spacy==3.8.13, identical to the pin already in `pyproject.toml` — no version conflict to reconcile.**

## Finding 2: No dedicated "address" recognizer — LOCATION is spaCy-NER-only, and it catches affiliation cities

Presidio's default English recognizer registry (`AnalyzerEngine.registry.recognizers`, live-inspected):

```
CreditCardRecognizer, CryptoRecognizer, DateRecognizer, EmailRecognizer, IbanRecognizer,
IpRecognizer, MacAddressRecognizer, MedicalLicenseRecognizer, NhsRecognizer, PhoneRecognizer,
SpacyRecognizer, UrlRecognizer, UsBankRecognizer, UsItinRecognizer, UsLicenseRecognizer,
UsPassportRecognizer, UsSsnRecognizer
```

**There is no `AddressRecognizer`.** `EmailRecognizer` and `PhoneRecognizer` are regex/pattern-based (fixed-shape, high-precision). Physical addresses are approximated only via `SpacyRecognizer`'s `LOCATION` entity type, which maps spaCy's NER labels (GPE/LOC/FAC) — i.e. **"address" detection here really means "city/region/facility name detection," not street-address parsing.**

Live test on a synthetic affiliation sentence confirms the exact risk exploration.md flagged as a question — it's now evidence, not a hypothesis:

```
Input: "...She works at Stanford University, Palo Alto, CA."
LOCATION match: 'Palo Alto'  (score 0.85)
```

`"Stanford University"` itself is NOT caught (tagged `ORGANIZATION`, not requested) — but `"Palo Alto"`, a legitimate part of a citable author-affiliation line, would be redacted to `[LOCATION]` under a literal reading of "physical addresses" scoped to the `LOCATION` entity type. This is a real, demonstrated tension with the design doc's own stated goal (§3.1: "preserve author names needed for citations") — an affiliation block is citation-adjacent content the same way an author name is, even though the design doc's carve-out language only explicitly names `PERSON`.

**No blocker** — policy is redact+log, never block, and a redacted city name doesn't break claim synthesis the way a redacted author surname would. But this is a real precision/recall tradeoff to make explicitly in PLANNING (options: include `LOCATION` as designed and accept affiliation-line noise; drop `LOCATION` entirely and scope input-side to `EMAIL_ADDRESS`+`PHONE_NUMBER` only, deferring "physical address" to a future dedicated recognizer; or restrict `LOCATION` redaction to paragraphs that aren't part of the detected author/title block).

## Finding 3: Email/PERSON NER overlap (M1 spike's open question) — resolved by entity scoping, not recognizer priority

M1 spike (§2) flagged: spaCy NER double-tagged an email address as both `EMAIL_ADDRESS`-shaped and `PERSON`, and asked to confirm "Presidio's recognizer-priority resolves the conflict as expected."

Live test, requesting `entities=['EMAIL_ADDRESS','PHONE_NUMBER','LOCATION','PERSON']` (PERSON included only to reproduce the spike's scenario):

```
PERSON          8  22  'Jane Rodriguez'            score=0.85
EMAIL_ADDRESS  26  49  'j.rodriguez@example.edu'   score=1.00
PERSON         26  49  'j.rodriguez@example.edu'   score=0.85   ← the overlap
PHONE_NUMBER   58  70  '555-123-4567'               score=0.40
LOCATION      106 115  'Palo Alto'                  score=0.85
PERSON        151 161  'John Smith'                 score=0.85
```

**`AnalyzerEngine.analyze()` does NOT auto-deduplicate overlapping spans across entity types by default** — both `EMAIL_ADDRESS` and `PERSON` results are returned for the same character span. There is no "recognizer priority" mechanism resolving this at the analyzer level the way the spike question implied.

**The actual resolution is upstream and simpler**: §3.1's task scope is explicitly non-`PERSON` (`EMAIL_ADDRESS`, `PHONE_NUMBER`, `LOCATION`). If `entities=` passed to `analyze()` never includes `PERSON`, the conflicting `PERSON`-labeled duplicate for the email span is never returned in the first place — confirmed by re-running with `entities=['EMAIL_ADDRESS','PHONE_NUMBER','LOCATION']` (no `PERSON`): only `EMAIL_ADDRESS` and `LOCATION` came back, no `PERSON` noise. **The overlap the spike worried about is a non-issue for this task specifically because PERSON is excluded by design — it only matters for §3.2 (output-side, out of scope), which does need to reason about this overlap.**

## Finding 4: Anonymization / redaction mechanics

`AnonymizerEngine.anonymize(text, analyzer_results, operators)` with `OperatorConfig('replace', {'new_value': '[EMAIL]'})` produces exactly the bracket-tag format the design doc and brief specify:

```python
operators = {
    "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
    "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE]"}),
    "LOCATION": OperatorConfig("replace", {"new_value": "[LOCATION]"}),
}
result = anonymizer.anonymize(text=text, analyzer_results=results, operators=operators)
# result.text: "Contact Jane Rodriguez at [EMAIL] or call 555-123-4567. She works at Stanford University, [LOCATION], CA."
# result.items: list of AnonymizedEntity(entity_type, start, end) — usable for the "log type + location" success criterion
```

`result.items` gives entity type + post-anonymization offsets directly — no manual span bookkeeping needed for the redaction log (log `entity_type` + the `Paragraph.page`/`.index` the paragraph already carries, not `result.items`' offsets, since offsets are into the redacted string and the success criterion wants paragraph-level location, not char-offset).

## Finding 5: score_threshold — phone numbers score low by default

`PhoneRecognizer` uses `phonenumbers` library validation; the sample `555-123-4567` (a fictitious NANP-format placeholder) scored only **0.40**. With `score_threshold=0.5` passed to `analyze()`, this phone number was silently dropped — not redacted. `EMAIL_ADDRESS` (1.0) and `LOCATION` (0.85) are unaffected at that threshold.

This is a real tuning decision, not a formality: `AnalyzerEngine.analyze()` defaults to `score_threshold=0` (no filtering) if the parameter is omitted — omitting it (or setting something low, e.g. 0.3–0.4) catches more real phone numbers at the cost of more false positives; the codebase's declared policy (redact+log, never block — false negatives are the worse failure mode for a "don't leak PII" job, false positives just redact a bit more) argues for leaving the threshold low/default rather than raising it.

`PhoneRecognizer.supported_regions` defaults to `('US', 'GB', 'DE', 'FR', 'IL', 'IN', 'CA', 'BR')` — reasonable default coverage for an international-authorship literature-review tool, no config needed unless a specific missing region surfaces later.

## Finding 6: Engine initialization cost — must be a singleton, not per-paragraph

`NlpEngineProvider(...).create_engine()` + `AnalyzerEngine(nlp_engine=...)` construction loads the spaCy model (`en_core_web_sm`) — this is the ~158MB-RSS, model-load cost the M1 spike measured. The spike's **4.0ms P50 latency figure is per-call inference on an already-loaded model**, not including load time. `extract.py`'s paragraph loop runs per-paragraph, potentially dozens of times per paper — the `AnalyzerEngine`/`AnonymizerEngine` instances must be created once (module-level or passed in) and reused across the whole paragraph loop, never re-instantiated per paragraph, or the 4ms number doesn't hold and model-load cost gets paid repeatedly.

## Alternatives considered, not pursued

- **Regex-only (no Presidio/spaCy), hand-rolled email/phone patterns**: would avoid the ~158MB RSS / dependency footprint entirely for the two regex-shaped categories (email, phone), since those don't need NER. Rejected as a full replacement because `LOCATION` (the "physical address" leg of scope) has no regex-shape and needs the NER model regardless — splitting the implementation into "regex for 2 categories, Presidio+spaCy for the 3rd" adds complexity for marginal footprint savings on a model M1's spike already gave a GO/cheap verdict to (107MB disk, 158MB RSS, 4ms/paragraph — cheapest of the three spiked models). Not worth the split.
- **`presidio` meta-package** (bundles analyzer+anonymizer+image-redactor) — unnecessary; this task needs text only, `presidio-analyzer`+`presidio-anonymizer` are the minimal two packages, matches how the design doc and M1 spike both refer to "AnalyzerEngine"/"AnonymizerEngine" as the two components in play.

## Confirmed non-blockers

- Python 3.14 compatibility (Finding 1) — search result was stale, live install succeeds.
- spaCy version conflict — presidio-analyzer resolves to spacy==3.8.13, identical to the existing pin, no re-pin needed.
- Email/PERSON overlap (Finding 3) — resolved by entities= scoping, not an engine-level conflict to configure around.
