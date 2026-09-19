# Deploy Final Permit Jurisdiction Fix (commit c146552)

## Current state (verified)
- The repository is already synced: HEAD is `c146552` ("Fix permit-lookup verification jurisdiction check and remove acronym fallback").
- The commit changes exactly: `supabase/functions/permit-lookup/index.ts`, `verification-logic.ts`, `verification-runtime.ts`, plus two frontend test files (`src/test/permit-verification-*.test.ts`) — no app code, no policies, no other functions.
- All three permit-lookup files are present on disk with the updated content.

## Steps
1. No sync needed — commit c146552 is already the repo HEAD (confirmed above).
2. Optionally run the existing vitest suite for the two permit-verification test files to confirm the new logic passes locally (no live lookups, no API calls — the tests are pure).
3. Deploy ONLY `permit-lookup` to the existing Lovable Cloud backend via the deploy tool.
4. Check the edge function deployment logs for errors and confirm the function boots.
5. Report deployment status and any errors.

## Explicitly out of scope
- No live permit lookups (waiting for user approval before testing).
- No changes to application code, other Edge Functions (ciq-lookup, PPR, ground-handling-quotes, etc.), database policies, data or credentials.
- No publishing of the website.
