# Lineage Explorer — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the shallow TreeView with a deep, interactive lineage explorer that visualizes tribal genealogy as a multi-layered graph — handling confederations, blood descent, political alliances, disputed connections, and non-tribal origins.

**Architecture:** D3 force-directed graph with semantic zoom levels, ancestry chain tracing, and confederation containers. Data from graph.json + ancestry-overrides.json + tribes/families.json.

**Tech Stack:** React 19 + TypeScript + D3.js + Tailwind v4. Data preprocessing script in Python.

---

## Core Concepts

### The Problem with Trees
Arabian tribal genealogy isn't a tree. It's a graph with:
- **Confederations** — political unions of unrelated groups (Bani Yas = 30+ sections, not a single bloodline)
- **Multiple ancestry paths** — a family can have blood descent AND confederation membership AND pre-confederation origins
- **Disputed/oral connections** — deeper genealogical links that aren't in academic sources
- **Non-tribal entities** — Persian merchants, Hadrami traders, Indian families with no tribal tree at all
- **Relationship types beyond parent-child** — rivalry, alliance, intermarriage, vassalage, trade

### The Data We Have
- **258 sub_tribe links** in graph.json (chains up to 5 levels deep)
- **145 offshoot links** (branch/split relationships)
- **29 tribes with subTribes arrays** (245 sub-entries)
- **157 shared_lineage relations** between tribes
- **129 families with tribalOrigin** (text name, not always ID)
- **200+ alliance/rivalry links**
- **ancestry-overrides.json** for deep/disputed connections and confederation formation theories

---

## 1. Data Preprocessing: `scripts/build-lineage.py`

Build a unified lineage graph from all sources:

### Input
- `tribes.json` — subTribes arrays, relations, lineageRoot
- `families.json` — tribeId, tribalOrigin, connections
- `graph.json` — sub_tribe, offshoot, claimed_descent, family_of links
- `ancestry-overrides.json` — manual deep connections, confederation metadata, non-tribal origins

### Output: `src/data/lineage.json`
```json
{
  "nodes": [
    {
      "id": "bani_yas",
      "name": "Bani Yas",
      "type": "confederation",
      "nodeType": "confederation|tribe|section|family|lineage_root|origin_group",
      "lineage": "adnani",
      "metadata": {
        "formationTheories": [...],
        "note": "..."
      }
    },
    {
      "id": "al_nahyan",
      "name": "Al Nahyan",
      "type": "family",
      "nodeType": "family",
      "lineage": "adnani",
      "isRuling": true,
      "rulesOver": "United Arab Emirates"
    },
    {
      "id": "persian_merchants",
      "name": "Persian/Iranian Merchants",
      "type": "origin_group",
      "nodeType": "origin_group"
    }
  ],
  "edges": [
    {
      "source": "al_nahyan",
      "target": "al_bu_falah",
      "edgeType": "ruling_house",
      "confidence": "confirmed",
      "label": "ruling house of"
    },
    {
      "source": "al_bu_falah",
      "target": "bani_yas",
      "edgeType": "confederation",
      "confidence": "confirmed",
      "label": "section of"
    },
    {
      "source": "al_bu_falah",
      "target": "al_dawasir",
      "edgeType": "pre_confederation_origin",
      "confidence": "oral_tradition",
      "label": "possible deeper roots"
    },
    {
      "source": "bani_yas",
      "target": "al_manasir",
      "edgeType": "rivalry",
      "confidence": "confirmed",
      "label": "historical rivalry"
    }
  ],
  "ancestryChains": {
    "al_nahyan": ["al_nahyan", "al_bu_falah", "bani_yas", "adnan"],
    "al_maktoum": ["al_maktoum", "al_bu_falasah", "bani_yas", "adnan"]
  },
  "clusters": {
    "confederations": {
      "bani_yas": {
        "sections": ["al_bu_falah", "al_bu_falasah", "mazrui", "qubaisi", "..."],
        "formationTheories": [...]
      }
    },
    "originGroups": {
      "persian_merchants": ["al_khoory", "al_bastaki", "al_rostamani"],
      "hadrami_traders": ["bin_laden"],
      "indian_merchants": []
    }
  }
}
```

### Logic
1. Start with graph.json sub_tribe/offshoot/claimed_descent links as primary hierarchy
2. Add families to their parent tribe via tribeId or fuzzy-match tribalOrigin to tribe names
3. Layer in ancestry-overrides.json (deep connections, confederation metadata, non-tribal origins)
4. Identify confederations: tribes with 10+ subTribes OR marked in overrides
5. Build ancestry chains by traversing parent links from each leaf node to root
6. Group non-tribal families by origin type (Persian, Hadrami, Indian, etc.)
7. Compute node sizes based on connection count + subtree size

---

## 2. Visualization: `src/views/LineageExplorer.tsx`

Replaces current TreeView.tsx (or lives alongside it).

### Layout

**Full-screen D3 canvas** with:
- **Left sidebar** — controls, search, filters, legend
- **Main area** — interactive graph
- **Bottom panel** — ancestry breadcrumb trail (when entity selected)
- **Right panel** — entity info card (reuse DetailPanel)

### Three Modes

#### Mode A: Galaxy View (default)
- Force-directed layout with clustering
- **Zoom level 1 (zoomed out):** Two mega-clusters — Adnani and Qahtani, plus an "Other Origins" cluster
- **Zoom level 2 (mid):** Confederations visible as bordered groups containing their sections. Major tribes as large nodes.
- **Zoom level 3 (zoomed in):** Individual sections, families, and all connection lines visible
- Semantic zoom: labels/details appear as you zoom in, clusters simplify as you zoom out

#### Mode B: Ancestry Trace (click any entity)
- Highlights the full ancestry chain from clicked entity to deepest known root
- Dims everything else
- Shows breadcrumb at bottom: `Al Nahyan → Al Bu Falah → Bani Yas → Adnani`
- Sibling entities at each level shown alongside (Al Maktoum next to Al Nahyan)
- Disputed links shown with pulsing dashed line + "?" badge
- Click "?" to see competing theories tooltip

#### Mode C: Relations Map (toggle)
- Overlay alliance/rivalry/intermarriage connections
- Color-coded: green=alliance, red=rivalry, purple=intermarriage, gold=trade
- Filter checkboxes for each type

### Visual Language

**Nodes:**
- **Lineage roots** (Adnan, Qahtan): Large circles, gold/teal
- **Confederations** (Bani Yas): Rounded rectangle containing member nodes, with dashed border
- **Tribes/Sections**: Circles, colored by lineage (Adnani=#C4643A, Qahtani=#1ABC9C)
- **Families**: Smaller diamonds, darker color. Crown icon if ruling.
- **Origin groups** (Persian, Hadrami): Distinct shape (hexagon?), different color palette

**Edges:**
- **Blood descent**: Solid line, 2px
- **Confederation membership**: Contained within group border (no explicit line)
- **Branch/split**: Solid line with arrow, 1.5px
- **Pre-confederation origin**: Dashed line, muted color
- **Claimed/oral tradition**: Dotted line with "?" marker
- **Ruling house**: Solid line with crown icon
- **Rivalry**: Red dashed line
- **Alliance**: Green solid line, thin
- **Intermarriage**: Purple double line

**Confidence indicators:**
- Confirmed: full opacity, solid
- Oral tradition: 70% opacity, dashed
- Claimed: 50% opacity, dotted
- Legendary: 30% opacity, dotted, italic label

### Interactions
- **Hover node**: Highlight all direct connections, show tooltip with name/type/lineage
- **Click node**: Enter Ancestry Trace mode, show info card
- **Double-click**: Open full DetailPanel
- **Click confederation border**: Show formation theories panel
- **Scroll**: Semantic zoom in/out
- **Drag**: Pan (on background) or move node (on node)
- **Search**: Find and zoom to entity, highlight chain

### Confederation Info Panel
When clicking a confederation (e.g., Bani Yas):
```
┌─────────────────────────────────┐
│ Bani Yas                        │
│ Confederation · Adnani          │
│                                 │
│ 33 sections · 12 ruling houses  │
│                                 │
│ How did Bani Yas form?          │
│ ┌─ ● Oral tradition             │
│ │  Political alliance against   │
│ │  the Manasir tribe            │
│ ├─ ○ Traditional genealogy      │
│ │  Descended from ancestor      │
│ │  Yas bin Amer                 │
│ └─ ◉ Most likely                │
│    Core kinship group that grew │
│    through alliances over time  │
│                                 │
│ [View all sections]             │
└─────────────────────────────────┘
```

---

## 3. Data Fixes: `scripts/fix-tribe-links.py`

Cleanup script to improve hierarchy quality before visualization:

1. **Resolve tribalOrigin strings to IDs** — fuzzy-match "Bani Yas" to `bani_yas`, "Al Dawasir" to `al_dawasir`, etc.
2. **Fix tribeId `<UNKNOWN>`** — use tribalOrigin or connections to infer
3. **Fix lineageRoot contradictions** — Al Bu Falah marked Qahtani but is under Bani Yas (Adnani). Inherit from parent confederation.
4. **Identify confederations programmatically** — tribes with 10+ subTribes get `isConfederation: true`
5. **Deduplicate subtribe ↔ graph links** — ensure subTribes arrays match graph.json sub_tribe links

---

## 4. Implementation Sequence

### Task 1: Data preprocessing
- Write `scripts/fix-tribe-links.py` — resolve IDs, fix contradictions
- Write `scripts/build-lineage.py` — build lineage.json from all sources
- Add TypeScript types for lineage data

### Task 2: Basic lineage explorer
- New `LineageExplorer.tsx` component
- D3 force-directed layout with nodes and edges
- Semantic zoom (3 levels)
- Node styling by type (confederation, tribe, family, origin group)
- Edge styling by type and confidence

### Task 3: Confederation containers
- Render confederations as bordered groups
- Sections positioned inside parent container
- Formation theories info panel

### Task 4: Ancestry trace mode
- Click entity → highlight full chain
- Breadcrumb bar at bottom
- Sibling entities shown
- Disputed links with "?" badge

### Task 5: Relations overlay
- Toggle alliance/rivalry/intermarriage connections
- Color-coded edge overlay
- Filter controls

### Task 6: Search & navigation
- Search bar with fuzzy matching
- Zoom-to-entity on select
- Integration with DetailPanel
- URL params for direct linking

### Task 7: Route integration
- Replace or add alongside `/tree` route
- "View in Lineage" button in DetailPanel
