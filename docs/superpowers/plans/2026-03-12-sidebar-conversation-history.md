# Sidebar Conversation History Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a list of past assemblies to the assembly sidebar so users can switch between them without going home.

**Architecture:** Client-side fetch from an extended `/api/assemblies?sidebar=true` endpoint, rendered as a scrollable list below the Share button in the existing `assembly-nav.tsx` component.

**Tech Stack:** Next.js App Router, React (client component), PostgreSQL, vanilla CSS

**Spec:** `docs/superpowers/specs/2026-03-12-sidebar-conversation-history-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/app/api/assemblies/route.ts` | Modify | Add `?sidebar=true` query param support to GET handler |
| `web/app/assembly/[slug]/assembly-nav.tsx` | Modify | Add history section with fetch + render |
| `web/public/styles.css` | Modify | Add `.nav-history-*` styles |

---

## Chunk 1: API + Component + Styles

### Task 1: Extend GET /api/assemblies to support `?sidebar=true`

**Files:**
- Modify: `web/app/api/assemblies/route.ts:5-18`

- [ ] **Step 1: Update the GET handler to accept NextRequest and read query params**

Replace lines 5-18 of `web/app/api/assemblies/route.ts` with:

```typescript
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sidebar = request.nextUrl.searchParams.get("sidebar") === "true";

  if (sidebar) {
    const assemblies = await query(
      `SELECT * FROM (
        SELECT a.id, a.slug, a.topic_input, a.status, a.created_at
        FROM assemblies a WHERE a.user_id = $1
        UNION ALL
        SELECT a.id, a.slug, a.topic_input, a.status, a.created_at
        FROM assembly_shares s JOIN assemblies a ON s.assembly_id = a.id
        WHERE s.user_id = $1
      ) sub ORDER BY created_at DESC LIMIT 20`,
      [user.id]
    );
    return NextResponse.json(assemblies);
  }

  const assemblies = await query(
    `SELECT id, slug, topic_input, status, current_phase, created_at, completed_at
     FROM assemblies WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );

  return NextResponse.json(assemblies);
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd web && npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds (or at least no errors in the API route)

- [ ] **Step 3: Commit**

```bash
git add web/app/api/assemblies/route.ts
git commit -m "feat: add sidebar=true query param to GET /api/assemblies"
```

---

### Task 2: Add history section to assembly-nav.tsx

**Files:**
- Modify: `web/app/assembly/[slug]/assembly-nav.tsx`

- [ ] **Step 1: Add state and fetch logic**

At the top of the `AssemblyNav` function (after line 44, the existing `useState` calls), add:

```typescript
interface SidebarAssembly {
  id: string;
  slug: string;
  topic_input: string;
  status: string;
  created_at: string;
}

// Add inside AssemblyNav, after the existing useState lines:
const [history, setHistory] = useState<SidebarAssembly[]>([]);
const [historyLoaded, setHistoryLoaded] = useState(false);

useEffect(() => {
  fetch("/api/assemblies?sidebar=true")
    .then((r) => r.ok ? r.json() : Promise.reject())
    .then((data: SidebarAssembly[]) => {
      setHistory(data);
      setHistoryLoaded(true);
    })
    .catch(() => setHistoryLoaded(true));
}, []);
```

Note: Move the `SidebarAssembly` interface outside the component, above the `AssemblyNav` function.

- [ ] **Step 2: Add a `formatRelativeDate` helper**

Add this helper function above `AssemblyNav` (near the other helpers like `truncate`, `cleanTitle`):

```typescript
function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

- [ ] **Step 3: Add the history section JSX**

Insert the following right before the closing `</nav>` tag (line 170 in the current file, after the Share button block):

```tsx
        <div className="nav-divider" />
        <div className="nav-history-header">
          <span className="nav-section-title" style={{ padding: 0 }}>History</span>
          <Link href="/new" className="nav-history-new" onClick={closeNav}>+ New</Link>
        </div>
        <div className="nav-history-list">
          {!historyLoaded ? (
            <div className="nav-history-loading" />
          ) : history.length === 0 ? (
            <span className="nav-history-empty">No assemblies yet</span>
          ) : (
            history.map((a) => (
              <Link
                key={a.id}
                href={`/assembly/${a.slug}`}
                className={`nav-history-item${a.slug === slug ? " active" : ""}`}
                onClick={closeNav}
              >
                <span className="nav-history-title">{truncate(a.topic_input, 35)}</span>
                <span className="nav-history-date">{formatRelativeDate(a.created_at)}</span>
              </Link>
            ))
          )}
        </div>
```

- [ ] **Step 4: Verify the app still builds**

Run: `cd web && npx next build --no-lint 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add web/app/assembly/[slug]/assembly-nav.tsx
git commit -m "feat: add assembly history list to sidebar nav"
```

---

### Task 3: Add CSS styles for the history section

**Files:**
- Modify: `web/public/styles.css` (append after line 3524)

- [ ] **Step 1: Add history styles**

Append the following to the end of `web/public/styles.css`:

```css
/* ─── Sidebar History ─── */

.nav-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.65rem;
  margin-bottom: 0.35rem;
}

.nav-history-new {
  font-size: 0.72rem;
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 600;
  transition: opacity var(--transition);
}

.nav-history-new:hover {
  opacity: 0.7;
}

.nav-history-list {
  overflow-y: auto;
  max-height: 40vh;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.nav-history-list::-webkit-scrollbar {
  width: 3px;
}

.nav-history-list::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.nav-history-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.65rem;
  margin: 1px 0;
  text-decoration: none;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}

.nav-history-item:hover {
  background: var(--color-surface-hover);
}

.nav-history-item.active {
  background: var(--color-accent-subtle);
  border-left: 2px solid var(--color-accent);
  padding-left: calc(0.65rem - 2px);
}

.nav-history-title {
  font-size: 0.78rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-history-item.active .nav-history-title {
  color: var(--color-accent);
  font-weight: 600;
}

.nav-history-date {
  font-size: 0.65rem;
  color: var(--color-text-muted);
}

.nav-history-empty {
  display: block;
  padding: 0.5rem 0.65rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.nav-history-loading {
  height: 60px;
  margin: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--color-surface) 25%, var(--color-surface-hover) 50%, var(--color-surface) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

- [ ] **Step 2: Verify the styles render correctly**

Run: `cd web && npm run dev`
Open an assembly page in the browser. Verify:
- History section appears below Share button
- Current assembly is highlighted with accent left border
- Other assemblies are listed with title + date
- "+ New" button appears in header, links to `/new`
- List scrolls if many items
- Clicking an assembly navigates to it

- [ ] **Step 3: Commit**

```bash
git add web/public/styles.css
git commit -m "feat: add sidebar history list styles"
```
