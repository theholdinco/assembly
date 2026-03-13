# Saved Characters — Design Spec

Save character archetypes from completed assemblies and reuse them in new assemblies on different topics.

## Problem

Users form attachments to characters with strong voices and frameworks. Currently, every assembly generates a fully fresh cast. There's no way to bring a favorite character into a new topic.

## Solution

Save the "soul" of a character (framework, voice, biography, blind spot, heroes, debate style) and let the generation pipeline re-generate topic-specific positions when the character is injected into a new assembly.

## Data Model

### New table: `saved_characters`

```sql
CREATE TABLE saved_characters (
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
CREATE INDEX idx_saved_characters_user ON saved_characters(user_id);
CREATE INDEX idx_saved_characters_source ON saved_characters(source_assembly_id, name);
CREATE UNIQUE INDEX idx_saved_characters_dedup ON saved_characters(user_id, source_assembly_id, name);
```

- `source_assembly_id` uses SET NULL on delete — character survives if original assembly is deleted
- No `specificPositions` — regenerated per topic
- No `relationships` — relative to other characters in a specific assembly
- No `fullProfile` — raw markdown, can be reconstructed
- `heroes` as JSONB array (list of strings)

### New column on `assemblies`

```sql
ALTER TABLE assemblies
  ADD COLUMN IF NOT EXISTS saved_character_ids JSONB DEFAULT '[]';
```

Stores the IDs of saved characters selected at launch time. Informational/provenance only — stale IDs (from deleted saved characters) are harmless and ignored.

## API

### `POST /api/saved-characters`

Save a character from an existing assembly.

**Body:** `{ assemblyId: string, characterNumber: number }`

Pulls the character from the assembly's `parsed_data`, extracts archetype fields, writes to `saved_characters`. Returns the saved character. Validates that the assembly belongs to the authenticated user.

### `GET /api/saved-characters`

List all saved characters for the authenticated user. Used by the launcher to populate the picker.

### `DELETE /api/saved-characters/[id]`

Remove a saved character. No update endpoint — unsave and re-save from another assembly if needed.

## Assembly Launcher Changes

On the existing `/new` page, add a collapsible "Saved Characters" section using the same pattern as the GitHub repo picker (toggle button that expands).

When expanded:
- Shows saved characters as small chips/pills with avatar, name, and tag
- Click to toggle selection (highlighted when selected)
- Selected character IDs sent in `POST /api/assemblies` as `savedCharacterIds: string[]`. The API validates that all IDs exist and belong to the authenticated user

Placement: between the attachment widget and the GitHub repo section. No separate step or page.

## Character Generation Pipeline Changes

### Phase 1 (Domain Analysis)
No change. Still decides character count, debate structure, etc.

### Phase 2 (Character Generation)

**Data flow:** At pipeline start, the worker reads `saved_character_ids` from the assembly row, queries the `saved_characters` table, and passes the results through the pipeline config as `savedCharacters: SavedCharacter[]`.

The `characterGenerationPrompt` function gains a new optional parameter `savedCharacters?: SavedCharacter[]`. A new `SavedCharacter` type is added to `types.ts` (subset of `Character` without `number`, `specificPositions`, `relationships`, `fullProfile`).

If saved characters are present, the prompt is modified:

- Receives archetype data for each saved character (name, tag, biography, framework, blind spot, heroes, voice, debate style)
- Instructions: "The following N characters are PRE-EXISTING. Keep their identity intact. Generate specific positions for them on this topic. Then generate M additional characters to complement them — ensure the new characters fill any missing process roles (SKEPTIC, CRAFT, ACCESS, PRAGMATIST) and create productive tension with the pre-existing ones."
- `M = max(0, metadata.characterCount - N)` — if saved characters exceed the domain analysis count, no new characters are generated (the saved ones are sufficient)

### Phase 2.5 (Avatar Mapping)
Skip avatar generation for saved characters that already have an `avatarUrl`. Only generate avatars for new characters.

### Parsing
No change. Output markdown follows the same format — includes both pre-existing and new characters.

## Save Button on Character Profile

On `/assembly/[slug]/characters/[num]/page.tsx`, add a bookmark-style icon button in the header next to the character name and tag.

- Outline icon when unsaved, filled when saved
- Click calls `POST /api/saved-characters` or `DELETE /api/saved-characters/[id]`
- Check on page load whether character is already saved — match by `source_assembly_id` + `name`
- No toast or modal — icon toggles state

## What Gets Saved vs Regenerated

| Field | Saved | Regenerated |
|-------|-------|-------------|
| name | yes | — |
| tag | yes | — |
| biography | yes | — |
| framework / frameworkName | yes | — |
| blindSpot | yes | — |
| heroes | yes | — |
| rhetoricalTendencies | yes | — |
| debateStyle | yes | — |
| avatarUrl | yes | — |
| specificPositions | — | yes |
| relationships | — | yes |

## Constraints

- No cap on how many saved characters can be injected
- Character count is flexible (determined by domain analysis), not fixed at 6
