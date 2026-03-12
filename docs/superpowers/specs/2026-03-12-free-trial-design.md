# Free Trial System — Design Spec

## Problem

New users must provide an Anthropic API key before they can try the Assembly. This is a major friction point — most people won't go get an API key for a product they haven't experienced yet.

## Solution

Provide every new user with 1 free assembly + 5 follow-up interactions (any type), powered by a shared platform API key. After the trial, users must bring their own key to continue.

## Database Changes

```sql
-- Track free trial usage per user
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_trial_used BOOLEAN DEFAULT FALSE;

-- Mark which assembly is the free trial, and track interactions on it
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS is_free_trial BOOLEAN DEFAULT FALSE;
ALTER TABLE assemblies ADD COLUMN IF NOT EXISTS trial_interactions_used INTEGER DEFAULT 0;
```

- `free_trial_used`: flips to `true` when the user creates their first assembly without a BYOK key
- `is_free_trial`: marks the assembly so interaction limits are scoped to it
- `trial_interactions_used`: lives on the assembly (not the user) — increments on every interaction (follow-up, character chat, debate, library query), caps at 5

## Backend Changes

### Environment Variable

- `PLATFORM_API_KEY`: the shared Anthropic API key, set in Vercel (for interaction routes) and Railway (for the worker). Never stored in the DB. If missing, free trial is simply unavailable — `getApiKeyForUser` should throw a clear error ("Free trial unavailable — please add your API key") rather than crashing.

### API Key Resolution

New function `getApiKeyForUser(userId)` in a new `lib/trial.ts` (uses the shared `query` from `lib/db` so it works in both Vercel and Railway contexts):

1. Check if user has a BYOK key (`encrypted_api_key` is not null) → decrypt and return it
2. If no BYOK key, check `free_trial_used`:
   - `false` → return `PLATFORM_API_KEY` (after confirming env var exists)
   - `true` → throw error ("Free trial exhausted — add your API key to continue")

### Assembly Creation (`app/api/assemblies/route.ts`)

This adds a new gate that does not exist today (currently assemblies are queued without checking for an API key — the worker retrieves it later). The new check applies to both trial and BYOK users:

1. Check if user has BYOK key OR `free_trial_used = false`
2. If neither → return 403 with message
3. If using free trial → atomically claim the trial:

```sql
UPDATE users SET free_trial_used = true
WHERE id = $1 AND free_trial_used = false
RETURNING id
```

If zero rows returned, another request already claimed it → return 403. Otherwise, create the assembly with `is_free_trial = true`.

### Failed Free Trial Assemblies

If a free-trial assembly fails (worker sets `status = 'error'`), reset the user's trial so they can try again:

```sql
-- In worker error handler, when the failed assembly is a free trial:
UPDATE users SET free_trial_used = false WHERE id = $1;
DELETE FROM assemblies WHERE id = $2;
```

This way the user gets a real chance to experience the product, not a wasted trial on an infrastructure error.

### Worker (`worker/index.ts`)

- Replace `getUserApiKey(userId)` with `getApiKeyForUser(userId)` **only for assembly jobs**
- IC and CLO pipelines remain BYOK-only — keep using `getUserApiKey` for those
- The worker doesn't need to know whether it's a trial or BYOK — it just gets back a valid API key

### Interaction Routes (follow-ups, character chat, debate, library)

Before processing:
1. Look up the assembly — is it `is_free_trial`?
2. If yes, atomically increment and check:

```sql
UPDATE assemblies SET trial_interactions_used = trial_interactions_used + 1
WHERE id = $1 AND is_free_trial = true AND trial_interactions_used < 5
RETURNING trial_interactions_used
```

If zero rows returned → limit hit, return 403 with message.

3. If the assembly is not a free trial → normal BYOK flow, no limits

## Frontend Changes

### New Assembly Flow

- If user has no BYOK key and `free_trial_used = false`:
  - Allow access to "New Assembly" page (remove API key gate)
  - Show banner: "Free trial — 1 assembly + 5 interactions"
- If user has no BYOK key and `free_trial_used = true`:
  - Show gate: "You've used your free trial. Add your API key to continue."
  - Reuse existing "Connect your API key" page with updated copy

### Assembly View (free trial assembly)

- Show remaining interactions count (e.g., "3 of 5 interactions remaining")
- When exhausted, disable interaction inputs and show upgrade prompt

### Users with BYOK Key

- No visible changes. Free trial system is invisible to them.

## Abuse Protection

- One free trial per verified account (email/password or Google OAuth, already enforced)
- All trial state mutations use atomic SQL (no race conditions)
- No additional rate limiting or fingerprinting needed at this stage
- If multi-account abuse becomes a problem, add email domain restrictions or IP checks later

## Cost Estimate

- ~$2–5 per new user (one full assembly generation)
- Follow-up interactions are single API calls, negligible cost
- Total exposure is bounded: 1 assembly per account, period

## Scope Exclusions

- No credits/payments system
- No new pages (reuse existing API key page)
- BYOK flow unchanged
- IC and CLO products not affected (assembly only)
- `api_key_valid` column semantics unchanged (not applicable to trial users)
