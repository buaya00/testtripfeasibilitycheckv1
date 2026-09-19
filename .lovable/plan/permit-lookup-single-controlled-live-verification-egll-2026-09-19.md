# Permit Lookup — Single Controlled Live Verification (EGLL)

One live run of the newly deployed permit lookup, then a full report. No code, deployment, database or publishing changes.

## Test inputs

Exactly the inputs the existing workflow sends — nothing invented:

- Airport: `EGLL`
- Flight type: `private`
- Operator nationality: `United States` — a value from the app's existing country list used by the nationality selector. This will be stated in the report as the value used.

The app sends only these three fields (airport, flight type, operator nationality), so nothing else is supplied.

## How the test is run

1. Drive the real app in the preview: open it, enter EGLL as the leg airport, set flight type Private and operator nationality, and trigger the Permit lookup exactly as a user would.
2. Capture the function's response, the backend logs for that single invocation, and a screenshot of the permit panel.
3. Run once. No retries beyond the function's own internal retry logic.

## What will be reported

- Whether the call completed, and any runtime error, timeout or unexpected behaviour.
- The actual `permitRequired` value and confidence returned.
- Verification status and the trigger reason; whether focused verification actually ran.
- Whether real full-page evidence was retrieved or only a search snippet (`evidenceQuality`: `full_page` / `search_snippet` / `none`).
- Each source URL and what the evidence classification for it actually was (`supports` / `contradicts` / `insufficient`), stated as a model classification — not as official confirmation.
- Whether the on-screen label matched the status (for example "Verified against source" only for `confirmed`, the neutral note for `provisional`, the warning banner for `inconclusive` / `conflicting` / `unavailable`).

A 200 response alone will not be reported as success; the report will separate "the function ran" from "the determination is evidenced".

## Explicit non-actions

No code edits, no other function deployed or modified (CIQ, PPR, Ground Handling untouched), no database policy or data change, no publishing. Work stops after this single test.
