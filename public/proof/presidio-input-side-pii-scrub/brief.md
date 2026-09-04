# Task: Presidio input-side PII scrub

**Milestone**: m2-ingestion-pii-chunking
**Priority**: P2
**Size**: M
**Workflow**: self-implementation
**Dependencies**: M1 (spike: spaCy GO)

## Goal

Scrub high-confidence non-bibliographic PII from raw paragraph text before markdown assembly and before Qdrant, WITHOUT redacting author names needed for citations.

## Context

d-002/design §3.1. spaCy NER backend confirmed GO (f-020, 158MB/4ms). Policy = redact+log, never block (breaks pipeline for false positives). Input-side scoped to emails/phones/addresses — NOT generic PERSON (would redact every citable author name, f-007-adjacent).

## Scope

**IN**:
1. Presidio AnalyzerEngine + AnonymizerEngine on `Paragraph.text` in extract.py, tuned to emails/phones/physical-addresses.
2. Redact in place (`[EMAIL]` etc.), keep paragraph, log type+location (not the PII value).

**OUT**:
1. PERSON detection (that's the output-side job, M2-T2).
2. Blocking/failing on detection.

## Key Files

| File | Path | Change |
|------|------|--------|
| extract.py | ~/work/sources/the-saurus/pipeline/pipeline/ingestion/extract.py | Modify |

## Success Criteria

- [ ] Emails/phones/addresses redacted in raw text; author names preserved (verified on a paper with an acknowledgments section).
- [ ] Redaction logged (type + paragraph index), PII value never logged/stored.
- [ ] Pipeline continues on detection; no paper dropped.
