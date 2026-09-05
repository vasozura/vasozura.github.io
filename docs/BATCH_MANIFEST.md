# Batch manifest and recovery

```json
{
  "schema": "zura-song-batch/v1",
  "concurrency": 2,
  "packages": [
    { "path": "packages/synthetic-one", "expectedSlug": "synthetic-one" },
    { "path": "packages/synthetic-two", "expectedSlug": "synthetic-two", "resume": true }
  ]
}
```

Paths, slugs and cross-package content checksums must be unique. Concurrency is
limited to 1–4. All packages are validated before any production write. A failure is isolated to its package;
other workers can finish without sharing staged paths or database rows.

The checkpoint contains only the manifest checksum and completed slugs. It has
no credentials, tokens or signed URLs. Resume is rejected if the manifest
checksum changes. Existing published slugs are always blocked; an existing
draft requires `resume=true` and a reviewed `-Resume` command.

Recovery order:

1. Preserve the structured report.
2. If `phase=compensated`, fix the package and repeat dry-run.
3. If `phase=failed` after database finalization, inspect the private draft,
   existing objects and Learning processing error; do not delete it implicitly.
4. Resume only after checksums and exact slug ownership are confirmed.
5. Publish one reviewed song at a time. Batch publication is disabled by default.
