# Safety Policy

OpenMagicPointer uses explicit action risk levels:

- `low`: explain, summarize, translate, extract, compare.
- `medium`: fill, copy, open, click, type, scroll.
- `high`: submit, send, delete, purchase, shell, file write.
- `critical`: destructive or ambiguous multi-step actions.

Rules:

1. State-changing actions require an action preview.
2. `medium` and higher actions require confirmation.
3. `high` and `critical` actions require stronger confirmation.
4. LLM text is never executable by itself.
5. Tool output is treated as untrusted data.
6. API keys must stay in local environment variables or OS secure storage and must not be committed.
