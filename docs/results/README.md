# Live AI report results

Exported from the Azure deployment, with no report text and no secret, so the figures in the project description can
be checked:

- `live-reports.json`: every sealed live report. For each step of the crew it gives the role, the verdict code, the
  rejection reason, the tokens and the cost.
- `crew-job-executions.json`: start, end and status of every Container Apps job execution.
- `summarize_live_reports.py`: recomputes the figures.

```bash
python docs/results/summarize_live_reports.py
```

The first live reports ran with `crew-verifier-4`. From `crew-verifier-5` (26 October), short names are written as
recorded before verification and a possessive on a full name is accepted. That was the most common rejection reason.
