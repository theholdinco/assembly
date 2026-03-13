# Saved Characters Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save character archetypes from completed assemblies and reuse them in new assemblies, where their topic-specific positions get regenerated.

**Architecture:** New `saved_characters` table stores archetype fields. Save/unsave via API from character profile page. Launcher gets an inline picker. Pipeline prompt is extended to accept pre-existing characters and generate complementary new ones.

**Tech Stack:** Next.js API routes, PostgreSQL, Anthropic Claude API (existing pipeline)

**Spec:** `docs/superpowers/specs/2026-03-13-saved-characters-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `web/lib/schema.sql` | Add `saved_characters` table + `saved_character_ids` column |
| Create | `web/app/api/saved-characters/route.ts` | GET (list) + POST (save) endpoints |
| Create | `web/app/api/saved-characters/[id]/route.ts` | DELETE (unsave) endpoint |
| Modify | `web/lib/types.ts` | Add `SavedCharacter` interface |
| Modify | `web/app/api/assemblies/route.ts` | Accept `savedCharacterIds` in POST |
| Modify | `web/worker/index.ts` | Fetch saved characters, pass to pipeline |
| Modify | `web/worker/pipeline.ts` | Accept saved characters in config, adjust Phase 2 |
| Modify | `web/worker/prompts.ts` | Extend `characterGenerationPrompt` for pre-existing characters |
| Modify | `web/app/assembly/[slug]/characters/[num]/page.tsx` | Save/unsave bookmark button |
| Modify | `web/app/new/page.tsx` | Saved character picker section |

---

## Chunk 1: Database + Types

### Task 1: Add saved_characters table and assemblies column

**Files:**
- Modify: `web/lib/schema.sql`
- Modify: `web/lib/types.ts`

- [ ] **Step 1: Add migration SQL to schema.sql**

Append to the end of `web/lib/schema.sql`:

```sql
-- ============================================================
-- Saved Characters
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_assembly_id UUID REFERENCES assemblies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  biography TEXT NOT NULL,
  framework TEXT NOT NULL,
  framework_name TEXT NOT NULL,
  blind_spot TEXT NOT NULL,
  heroes JSONB DEFAULT '[]',
  rhetorical_tendencies TEXT NOT NULL,
  debate_style TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_characters_user ON saved_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_characters_source ON saved_characters(source_assembly_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_characters_dedup ON saved_characters(user_id, source_assembly_id, name);

ALTER TABLE assemblies
  ADD COLUMN IF NOT EXISTS saved_character_ids JSONB DEFAULT '[]';
```

- [ ] **Step 2: Add SavedCharacter type to types.ts**

Add after the `Character` interface in `web/lib/types.ts`:

```typescript
export interface SavedCharacter {
  id: string;
  name: string;
  tag: string;
  biography: string;
  framework: string;
  frameworkName: string;
  blindSpot: string;
  heroes: string[];
  rhetoricalTendencies: string;
  debateStyle: string;
  avatarUrl?: string;
  sourceAssemblyId?: string;
  createdAt: string;
}
```

- [ ] **Step 3: Run migration against database**

Run: `psql $DATABASE_URL -f web/lib/schema.sql`
Expected: Tables created without error (IF NOT EXISTS makes it safe to re-run).

- [ ] **Step 4: Commit**

```bash
git add web/lib/schema.sql web/lib/types.ts
git commit -m "feat: add saved_characters table and SavedCharacter type"
```

---

## Chunk 2: API Routes

### Task 2: Create saved-characters API routes

**Files:**
- Create: `web/app/api/saved-characters/route.ts`
- Create: `web/app/api/saved-characters/[id]/route.ts`

- [ ] **Step 1: Create GET + POST route**

Create `web/app/api/saved-characters/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query(
    `SELECT id, name, tag, biography, framework, framework_name, blind_spot,
            heroes, rhetorical_tendencies, debate_style, avatar_url,
            source_assembly_id, created_at
     FROM saved_characters WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assemblyId, characterNumber } = await request.json();
  if (!assemblyId || characterNumber == null) {
    return NextResponse.json({ error: "assemblyId and characterNumber are required" }, { status: 400 });
  }

  const assemblies = await query<{ parsed_data: { characters: Array<{ number: number; name: string; tag: string; biography: string; framework: string; frameworkName: string; blindSpot: string; heroes: string[]; rhetoricalTendencies: string; debateStyle: string; avatarUrl?: string }> } }>(
    `SELECT parsed_data FROM assemblies WHERE id = $1 AND user_id = $2`,
    [assemblyId, user.id]
  );

  if (!assemblies.length) {
    return NextResponse.json({ error: "Assembly not found" }, { status: 404 });
  }

  const characters = assemblies[0].parsed_data?.characters;
  const character = characters?.find((c) => c.number === characterNumber);

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const rows = await query(
    `INSERT INTO saved_characters (user_id, source_assembly_id, name, tag, biography, framework, framework_name, blind_spot, heroes, rhetorical_tendencies, debate_style, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (user_id, source_assembly_id, name) DO NOTHING
     RETURNING *`,
    [user.id, assemblyId, character.name, character.tag, character.biography, character.framework, character.frameworkName || "", character.blindSpot, JSON.stringify(character.heroes || []), character.rhetoricalTendencies || character.debateStyle || "", character.debateStyle || "", character.avatarUrl || null]
  );

  if (!rows.length) {
    const existing = await query(
      `SELECT * FROM saved_characters WHERE user_id = $1 AND source_assembly_id = $2 AND name = $3`,
      [user.id, assemblyId, character.name]
    );
    return NextResponse.json(existing[0]);
  }

  return NextResponse.json(rows[0], { status: 201 });
}
```

- [ ] **Step 2: Create DELETE route**

Create `web/app/api/saved-characters/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const rows = await query(
    `DELETE FROM saved_characters WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, user.id]
  );

  if (!rows.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
```

- [ ] **Step 3: Test the API routes manually**

Run the dev server: `cd web && npm run dev`

Test GET (should return empty array):
```bash
curl -s http://localhost:3000/api/saved-characters -H "Cookie: <session>" | jq
```

- [ ] **Step 4: Commit**

```bash
git add web/app/api/saved-characters/
git commit -m "feat: add saved-characters API routes (GET, POST, DELETE)"
```

---

### Task 3: Accept savedCharacterIds in assembly creation

**Files:**
- Modify: `web/app/api/assemblies/route.ts:38-84`

- [ ] **Step 1: Modify the POST handler**

In `web/app/api/assemblies/route.ts`, after extracting `githubRepoBranch` (line 74), add extraction and validation of `savedCharacterIds`:

```typescript
  const savedCharacterIds: string[] = Array.isArray(body.savedCharacterIds) ? body.savedCharacterIds : [];

  if (savedCharacterIds.length > 0) {
    const owned = await query<{ id: string }>(
      `SELECT id FROM saved_characters WHERE id = ANY($1) AND user_id = $2`,
      [savedCharacterIds, user.id]
    );
    if (owned.length !== savedCharacterIds.length) {
      return NextResponse.json({ error: "Invalid saved character selection" }, { status: 400 });
    }
  }
```

Then modify the INSERT query to include the new column:

```sql
INSERT INTO assemblies (id, user_id, slug, topic_input, status, github_repo_owner, github_repo_name, github_repo_branch, is_free_trial, saved_character_ids)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, slug
```

Parameter array becomes 9 values: `[user.id, slug, topicInput, initialStatus, githubRepoOwner, githubRepoName, githubRepoBranch, isTrialAssembly, JSON.stringify(savedCharacterIds)]` — `isTrialAssembly` stays at `$8`, `savedCharacterIds` is `$9`.

- [ ] **Step 2: Commit**

```bash
git add web/app/api/assemblies/route.ts
git commit -m "feat: accept savedCharacterIds in assembly creation"
```

---

## Chunk 3: Pipeline Integration

### Task 4: Pass saved characters through the pipeline

**Files:**
- Modify: `web/worker/index.ts:85-93` (job query)
- Modify: `web/worker/index.ts:115-125` (processJob type)
- Modify: `web/worker/index.ts:167-193` (runPipeline call)
- Modify: `web/worker/pipeline.ts:30-41` (PipelineConfig)
- Modify: `web/worker/pipeline.ts:217-269` (buildParsedTopic)
- Modify: `web/worker/pipeline.ts:299-311` (Phase 2)
- Modify: `web/worker/prompts.ts:80-195` (character generation prompt — done first to avoid compile error)

- [ ] **Step 1: Add saved_character_ids to job query**

In `web/worker/index.ts`, line 93, the RETURNING clause. Add `saved_character_ids` to the end:

```sql
RETURNING id, topic_input, user_id, raw_files, attachments, slug, github_repo_owner, github_repo_name, github_repo_branch, saved_character_ids
```

- [ ] **Step 2: Update processJob type and fetch saved characters**

In `web/worker/index.ts`, add `saved_character_ids: string[]` to the `processJob` parameter type (line 115-125).

After line 162 (after the attachments block), add the saved character fetch:

```typescript
  let savedCharacters: Array<{
    name: string; tag: string; biography: string; framework: string;
    frameworkName: string; blindSpot: string; heroes: string[];
    rhetoricalTendencies: string; debateStyle: string; avatarUrl?: string;
  }> | undefined;

  const savedIds: string[] = Array.isArray(job.saved_character_ids) ? job.saved_character_ids : [];
  if (savedIds.length > 0) {
    const result = await pool.query(
      `SELECT name, tag, biography, framework, framework_name, blind_spot,
              heroes, rhetorical_tendencies, debate_style, avatar_url
       FROM saved_characters WHERE id = ANY($1)`,
      [savedIds]
    );
    savedCharacters = result.rows.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      tag: r.tag as string,
      biography: r.biography as string,
      framework: r.framework as string,
      frameworkName: r.framework_name as string,
      blindSpot: r.blind_spot as string,
      heroes: (r.heroes || []) as string[],
      rhetoricalTendencies: r.rhetorical_tendencies as string,
      debateStyle: r.debate_style as string,
      avatarUrl: (r.avatar_url || undefined) as string | undefined,
    }));
    console.log(`[worker] Assembly ${job.id}: ${savedCharacters.length} saved character(s)`);
  }
```

Then pass `savedCharacters` into the `runPipeline` call (add after `attachments`):

```typescript
  await runPipeline({
    // ... existing fields ...
    savedCharacters,
  });
```

- [ ] **Step 3: Add savedCharacters to PipelineConfig**

In `web/worker/pipeline.ts`, add to the `PipelineConfig` interface (after `attachments`):

```typescript
  savedCharacters?: Array<{
    name: string; tag: string; biography: string; framework: string;
    frameworkName: string; blindSpot: string; heroes: string[];
    rhetoricalTendencies: string; debateStyle: string; avatarUrl?: string;
  }>;
```

- [ ] **Step 4: Extend characterGenerationPrompt (must happen before Step 5)**

**Important:** This step modifies `web/worker/prompts.ts` to add the `savedCharacters` parameter. It must be done before Step 5 which calls the function with 5 arguments.

Update the function signature at line 80 of `web/worker/prompts.ts`:

```typescript
export function characterGenerationPrompt(
  topic: string,
  domainAnalysis: string,
  characterCount: number,
  codeContext?: string,
  savedCharacters?: Array<{
    name: string; tag: string; biography: string; framework: string;
    frameworkName: string; blindSpot: string; heroes: string[];
    rhetoricalTendencies: string; debateStyle: string;
  }>
): string {
```

After the `codeSection` variable (line 88), add:

```typescript
  const savedSection = savedCharacters?.length
    ? `\n\n## Pre-Existing Characters\n\nThe following ${savedCharacters.length} character(s) are PRE-EXISTING from previous assemblies. Keep their identity (name, tag, biography, framework, blind spot, heroes, rhetorical tendencies, debate style) intact EXACTLY as provided. Generate SPECIFIC POSITIONS for them on this new topic, and include them in the tension map.\n\n${savedCharacters.map((c, i) => `### Saved Character ${i + 1}: ${c.name} [TAG: ${c.tag}]\n\n**Biography:** ${c.biography}\n\n**Framework:** ${c.framework}\n\n**Blind Spot:** ${c.blindSpot}\n\n**Heroes:** ${c.heroes.join("; ")}\n\n**Rhetorical Tendencies:** ${c.rhetoricalTendencies}\n\n**Debate Style:** ${c.debateStyle}`).join("\n\n---\n\n")}\n\n---\n\nGenerate ${characterCount} NEW characters to complement these pre-existing ones. Ensure new characters fill any missing process roles (SKEPTIC, CRAFT, ACCESS, PRAGMATIST) and create productive tension with the pre-existing characters.\n`
    : "";
```

Update the opening line and Socrate number:

```typescript
  const totalCount = characterCount + (savedCharacters?.length ?? 0);
  return `You are a character architect creating a diverse intellectual assembly of ${totalCount} domain experts plus a moderator (Socrate) to debate a topic.${codeSection}${savedSection}
```

Update the Socrate line (currently `## Character ${characterCount + 1}`) to:

```typescript
## Character ${totalCount + 1}: Socrate [TAG: MODERATOR]
```

- [ ] **Step 5: Modify Phase 2 in pipeline.ts**

In `web/worker/pipeline.ts`, replace the Phase 2 block (lines 299-311):

```typescript
  // Phase 2: Character Generation
  if (!rawFiles["characters.md"]) {
    await updatePhase("character-generation");
    const savedCount = savedCharacters?.length ?? 0;
    const newCount = Math.max(0, metadata.characterCount - savedCount);
    const result = await callClaude(
      client,
      characterGenerationPrompt(topic, rawFiles["domain-analysis.md"], newCount, codeContext, savedCharacters),
      `Generate characters for the assembly on: ${topic}`,
      8192
    );
    rawFiles["characters.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic));
  }
```

Destructure `savedCharacters` from config at the top of `runPipeline` alongside the other fields.

- [ ] **Step 6: Modify buildParsedTopic to preserve saved character avatars**

The existing `attachAvatars` function expects the avatar mapping JSON to be an **array** of objects (not a record/object). Keep this format intact. Instead, after `attachAvatars` runs, overwrite avatar URLs for saved characters with their original saved URLs.

In `web/worker/pipeline.ts`, leave the Phase 2.5 block (lines 313-327) unchanged. Instead, modify `buildParsedTopic` (line 217) to accept an optional `savedCharacters` parameter:

```typescript
function buildParsedTopic(
  rawFiles: Record<string, string>,
  slug: string,
  topic: string,
  savedCharacters?: Array<{ name: string; avatarUrl?: string }>
): Topic {
```

At the end of `buildParsedTopic`, after `attachAvatars` runs (line 223), add:

```typescript
  // Restore saved character avatar URLs (they already have avatars)
  if (savedCharacters) {
    const savedAvatarMap = new Map(
      savedCharacters.filter((sc) => sc.avatarUrl).map((sc) => [sc.name.toLowerCase(), sc.avatarUrl!])
    );
    for (const char of characters) {
      const savedUrl = savedAvatarMap.get(char.name.toLowerCase());
      if (savedUrl) char.avatarUrl = savedUrl;
    }
  }
```

Update all call sites of `buildParsedTopic` in `runPipeline` to pass through `savedCharacters`:

```typescript
await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
```

Also add `savedCharacters` to the destructuring at the top of `runPipeline` (line 273):

```typescript
const { topic, slug, apiKey, codeContext, attachments, savedCharacters, initialRawFiles, updatePhase, updateRawFiles, updateParsedData } = config;
```

- [ ] **Step 7: Commit**

```bash
git add web/worker/index.ts web/worker/pipeline.ts web/worker/prompts.ts
git commit -m "feat: pass saved characters through pipeline, extend prompt for pre-existing characters"
```

---

## Chunk 4: Frontend — Save Button

### Task 6: Add save/unsave button to character profile

**Files:**
- Modify: `web/app/assembly/[slug]/characters/[num]/page.tsx:35-137`

- [ ] **Step 1: Add save state and handlers**

At the top of `CharacterProfilePage` (after the existing state/hooks around line 40), add:

```typescript
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/saved-characters`)
      .then((r) => r.json())
      .then((chars: Array<{ id: string; source_assembly_id: string; name: string }>) => {
        const match = chars.find(
          (c) => c.source_assembly_id === assemblyId && c.name === character?.name
        );
        if (match) setSavedId(match.id);
      })
      .catch(() => {});
  }, [assemblyId, character?.name]);

  async function toggleSave() {
    if (!character || saving) return;
    setSaving(true);
    if (savedId) {
      await fetch(`/api/saved-characters/${savedId}`, { method: "DELETE" });
      setSavedId(null);
    } else {
      const res = await fetch("/api/saved-characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assemblyId, characterNumber: character.number }),
      });
      const data = await res.json();
      setSavedId(data.id);
    }
    setSaving(false);
  }
```

Note: add `import { useState, useEffect } from "react";` at the top of the file (it currently has no React import — it only imports from next/link, next/navigation, marked, and local modules).

- [ ] **Step 2: Add bookmark button to profile header**

In the profile header section (line 119-136), add a save button next to the character info. After the closing `</div>` of the `profile-meta` div (line 135), add:

```tsx
          <button
            onClick={toggleSave}
            disabled={saving}
            className="save-character-btn"
            title={savedId ? "Remove from saved characters" : "Save character for reuse"}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "0.35rem 0.65rem",
              cursor: "pointer",
              fontSize: "0.82rem",
              color: savedId ? "var(--color-accent)" : "var(--color-text-secondary)",
              marginTop: "0.5rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            {savedId ? "\u2605" : "\u2606"} {savedId ? "Saved" : "Save"}
          </button>
```

- [ ] **Step 3: Test visually**

Open a completed assembly's character profile page in the browser. Verify:
- The save button appears below the tag/framework name
- Clicking it saves (star fills, text changes to "Saved")
- Clicking again unsaves
- Refreshing the page preserves the saved state

- [ ] **Step 4: Commit**

```bash
git add web/app/assembly/[slug]/characters/[num]/page.tsx
git commit -m "feat: add save/unsave button on character profile page"
```

---

## Chunk 5: Frontend — Launcher Picker

### Task 7: Add saved character picker to assembly launcher

**Files:**
- Modify: `web/app/new/page.tsx:80-320`

- [ ] **Step 1: Add state for saved characters**

In `NewAssemblyPage`, after the existing state declarations (around line 95), add:

```typescript
  const [savedCharsExpanded, setSavedCharsExpanded] = useState(false);
  const [savedChars, setSavedChars] = useState<Array<{ id: string; name: string; tag: string; avatar_url: string | null }>>([]);
  const [selectedSavedIds, setSelectedSavedIds] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/saved-characters")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setSavedChars(data); })
      .catch(() => {});
  }, []);

  function toggleSavedChar(id: string) {
    setSelectedSavedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
```

- [ ] **Step 2: Add savedCharacterIds to the submit payload**

In `handleSubmit` (line 139), after the `hasFiles` assignment, add:

```typescript
    if (selectedSavedIds.length > 0) {
      payload.savedCharacterIds = selectedSavedIds;
    }
```

Note: update the `payload` type from `Record<string, string | boolean>` to `Record<string, string | boolean | string[]>`.

- [ ] **Step 3: Add the picker UI**

In the JSX, after the `AttachmentWidget` (line 220) and before the GitHub repo section (line 222), add:

```tsx
            {savedChars.length > 0 && (
              <div className="repo-section">
                <button
                  type="button"
                  className="repo-toggle"
                  onClick={() => setSavedCharsExpanded(!savedCharsExpanded)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  Reuse saved characters ({selectedSavedIds.length}/{savedChars.length} selected)
                  <span style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                    {savedCharsExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </button>

                {savedCharsExpanded && (
                  <div className="repo-picker" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem" }}>
                    {savedChars.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => toggleSavedChar(sc.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: "0.35rem 0.7rem",
                          borderRadius: "999px",
                          border: selectedSavedIds.includes(sc.id)
                            ? "1.5px solid var(--color-accent)"
                            : "1px solid var(--color-border)",
                          background: selectedSavedIds.includes(sc.id)
                            ? "var(--color-accent-bg, rgba(99,102,241,0.08))"
                            : "transparent",
                          cursor: "pointer",
                          fontSize: "0.82rem",
                          color: "var(--color-text)",
                        }}
                      >
                        {sc.avatar_url && (
                          <img src={sc.avatar_url} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} />
                        )}
                        {sc.name}
                        <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>{sc.tag}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 4: Test the full flow**

1. Save a character from a completed assembly
2. Go to `/new`
3. Verify the "Reuse saved characters" section appears
4. Select one or more characters
5. Launch an assembly
6. Verify the pipeline generates positions for saved characters and complements with new ones

- [ ] **Step 5: Commit**

```bash
git add web/app/new/page.tsx
git commit -m "feat: add saved character picker to assembly launcher"
```
