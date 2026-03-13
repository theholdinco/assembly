# Sidebar Conversation History

## Problem

When viewing an assembly, users must navigate back to the home page to switch between assemblies. The sidebar has empty space below the Share button that could show past conversations for quick switching, similar to ChatGPT/Claude.

## Solution

Add a scrollable list of the user's assemblies (owned + shared) to the bottom of the assembly sidebar (`assembly-nav.tsx`), with a "+ New" button to start a new assembly without leaving the page.

## Architecture

### Data Fetching

- **Client-side fetch** in `assembly-nav.tsx` using `/api/assemblies?sidebar=true` on mount
- No polling needed — the list is relatively static and refreshes on navigation

### API Change

**`GET /api/assemblies`** — the default behavior (no query param) remains unchanged, returning only owned assemblies for backward compatibility.

When `?sidebar=true` is passed, return a unified list of owned + shared assemblies, limited to 20 most recent:

```sql
SELECT * FROM (
  SELECT a.id, a.slug, a.topic_input, a.status, a.created_at
  FROM assemblies WHERE user_id = $1
  UNION ALL
  SELECT a.id, a.slug, a.topic_input, a.status, a.created_at
  FROM assembly_shares s JOIN assemblies a ON s.assembly_id = a.id
  WHERE s.user_id = $1
) sub ORDER BY created_at DESC LIMIT 20
```

The `GET` function signature changes to accept `request: NextRequest` to read the query param.

### Component Changes

**`assembly-nav.tsx`** — add below the Share button section:

1. **Divider** — `nav-divider` class (existing)
2. **Header row** — "History" label (styled like `nav-section-title`) + a "+ New" link to `/new` on the right
3. **Assembly list** — scrollable container, each item showing:
   - Assembly `topic_input` as title (truncated to ~35 chars using existing `truncate()` helper)
   - Relative date (e.g. "2d ago", "Mar 5")
   - Active highlight for current assembly (using existing `nav a.active` styles)
   - Links to `/assembly/{slug}`
   - Calls `closeNav()` on click (mobile hamburger menu support)
4. **Loading state** — subtle opacity pulse while fetching
5. **Empty state** — small muted text "No other assemblies yet"
6. **Error state** — silently hide the history section on fetch failure
7. **Current assembly guarantee** — if the current slug is not in the top 20 results, append it to the list so it always appears highlighted

### Styling

All new styles go in `web/public/styles.css`:

- `.nav-history-header` — flex row with space-between, aligns "History" label and "+ New" button
- `.nav-history-list` — scrollable container using `flex: 1; min-height: 0; overflow-y: auto` (avoids fixed calc that breaks on small screens), thin scrollbar
- `.nav-history-item` — flex column with title and date, uses existing `nav a` base styles
- `.nav-history-item .nav-history-date` — muted, small font for the date
- `.nav-history-new` — small accent-colored link/button for "+ New"
- Current assembly gets the existing `active` class treatment (accent left border)

### Behavior

- On mount, fetch `/api/assemblies?sidebar=true`
- Current assembly (matched by slug) is highlighted
- Clicking another assembly navigates via Next.js `<Link>` and calls `closeNav()`
- "+ New" links to `/new` (assembly creation page)
- List is max 20 items — no "show more" needed for v1

## Files to Modify

1. **`web/app/api/assemblies/route.ts`** — support `?sidebar=true` query param with unified query
2. **`web/app/assembly/[slug]/assembly-nav.tsx`** — add history section with client-side fetch
3. **`web/public/styles.css`** — add history list styles

## Out of Scope

- Real-time updates / polling of the assembly list
- Search/filter within the sidebar list
- Drag-to-reorder or pinning
- Grouping by date (today, yesterday, last week)
- Creating a new assembly inline from the sidebar
