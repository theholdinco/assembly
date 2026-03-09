#!/usr/bin/env python3
"""
Build lineage.json from tribes.json, families.json, graph.json, ancestry-overrides.json.

Produces a unified graph with nodes, edges, ancestry chains, and clusters.
"""

import json
from collections import defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"

ORIGIN_GROUPS = {
    "persian": {"id": "persian_origin", "name": "Persian/Iranian", "nodeType": "origin_group"},
    "hadrami": {"id": "hadrami_origin", "name": "Hadrami", "nodeType": "origin_group"},
    "indian": {"id": "indian_origin", "name": "Indian", "nodeType": "origin_group"},
    "other": {"id": "other_origin", "name": "Other", "nodeType": "origin_group"},
}

def _subs(tribe):
    """Extract subtribe IDs from a tribe's subTribes array (handles both dict and string elements)."""
    return [s["id"] if isinstance(s, dict) else s for s in (tribe.get("subTribes") or [])]


GRAPH_TYPE_MAP = {
    "sub_tribe": "descent",
    "offshoot": "branch",
    "claimed_descent": "claimed_descent",
    "family_of": "family_of",
    "alliance": "alliance",
    "rivalry": "rivalry",
    "intermarriage": "intermarriage",
    "shared_migration": "shared_migration",
    "trade_partnership": "trade_partnership",
    "vassalage": "vassalage",
}


def strength_to_confidence(strength):
    if isinstance(strength, str):
        return strength
    if strength >= 0.8:
        return "confirmed"
    if strength >= 0.5:
        return "oral_tradition"
    return "claimed"


def build_nodes(tribes, families, overrides, graph):
    """Build the full nodes array."""
    graph_links = graph["links"]
    graph_nodes_list = graph.get("nodes", [])
    nodes = []

    # Lineage root nodes
    nodes.append({"id": "adnani_root", "name": "Adnani Lineage", "type": "tribe", "nodeType": "lineage_root", "lineage": "adnani", "size": 200})
    nodes.append({"id": "qahtani_root", "name": "Qahtani Lineage", "type": "tribe", "nodeType": "lineage_root", "lineage": "qahtani", "size": 200})

    # Origin group nodes
    for og in ORIGIN_GROUPS.values():
        n = dict(og)
        n.setdefault("type", "tribe")
        n.setdefault("lineage", None)
        n.setdefault("size", 10)
        nodes.append(n)

    # Determine which tribe IDs are subtribes of another tribe
    subtribe_ids = set()
    for t in tribes:
        for sub_id in _subs(t):
            subtribe_ids.add(sub_id)
    for link in graph_links:
        if link["type"] == "sub_tribe":
            subtribe_ids.add(link["target"])

    # Tribe nodes
    for t in tribes:
        sub_count = len(_subs(t))
        conn_count = sum(
            1 for l in graph_links if l["source"] == t["id"] or l["target"] == t["id"]
        )

        if t.get("isConfederation"):
            node_type = "confederation"
        elif t["id"] in subtribe_ids:
            node_type = "section"
        else:
            node_type = "tribe"

        nodes.append({
            "id": t["id"],
            "name": t["name"],
            "type": "tribe",
            "nodeType": node_type,
            "lineage": t.get("lineageRoot"),
            "size": max(1, sub_count + conn_count),
        })

    # Family nodes
    for f in families:
        conn_count = sum(
            1 for l in graph_links if l["source"] == f["id"] or l["target"] == f["id"]
        )
        nodes.append({
            "id": f["id"],
            "name": f["name"],
            "type": "family",
            "nodeType": "family",
            "lineage": f.get("lineageRoot"),
            "isRuling": bool(f.get("isRuling")),
            "rulesOver": f.get("rulesOver"),
            "familyType": f.get("familyType"),
            "size": max(1, conn_count + len(f.get("notableFigures", []))),
        })

    # Add graph nodes that aren't in tribes.json or families.json (orphans)
    existing_ids = {n["id"] for n in nodes}
    graph_node_map = {n["id"]: n for n in graph_nodes_list}
    for gn in graph_nodes_list:
        if gn["id"] in existing_ids:
            continue
        conn_count = sum(
            1 for l in graph_links if l["source"] == gn["id"] or l["target"] == gn["id"]
        )
        gn_type = gn.get("type", "tribe")
        node_type = "family" if gn_type == "family" else "tribe"
        nodes.append({
            "id": gn["id"],
            "name": gn.get("name", gn["id"].replace("_", " ").title()),
            "type": gn_type,
            "nodeType": node_type,
            "lineage": gn.get("lineage"),
            "size": max(1, conn_count),
        })

    return nodes


def build_edges(tribes, families, graph, overrides):
    """Build the full edges array."""
    edges = []
    seen = set()

    def add_edge(source, target, edge_type, confidence="oral_tradition", note=None):
        key = (source, target, edge_type)
        if key in seen:
            return
        seen.add(key)
        edge = {"source": source, "target": target, "edgeType": edge_type, "confidence": confidence}
        if note:
            edge["note"] = note
        edges.append(edge)

    # From graph.json links
    for link in graph["links"]:
        src = link["source"]
        tgt = link["target"]
        if src == "<UNKNOWN>" or tgt == "<UNKNOWN>":
            continue
        edge_type = GRAPH_TYPE_MAP.get(link["type"], link["type"])
        confidence = strength_to_confidence(link.get("strength", 0.5))
        add_edge(src, tgt, edge_type, confidence)

    # From tribes.json subTribes arrays
    for t in tribes:
        for sub_id in _subs(t):
            add_edge(t["id"], sub_id, "descent", "oral_tradition")

    # From families.json tribeId
    for f in families:
        tribe_id = f.get("tribeId")
        if tribe_id and tribe_id != "<UNKNOWN>":
            add_edge(f["id"], tribe_id, "family_of", "oral_tradition")

    # From ancestry-overrides.json links
    for link in overrides.get("links", []):
        add_edge(
            link["child"],
            link["parent"],
            link["relationship"],
            link.get("confidence", "oral_tradition"),
            link.get("note"),
        )

    # From ancestry-overrides.json nonTribalOrigins
    for nto in overrides.get("nonTribalOrigins", []):
        origin = nto["origin"]
        origin_id = ORIGIN_GROUPS.get(origin, ORIGIN_GROUPS["other"])["id"]
        add_edge(nto["family"], origin_id, "origin", nto.get("confidence", "oral_tradition"), nto.get("note"))

    # From tribes with lineageRoot -> lineage root node
    for t in tribes:
        root = t.get("lineageRoot")
        if root == "adnani":
            add_edge(t["id"], "adnani_root", "lineage", "oral_tradition")
        elif root == "qahtani":
            add_edge(t["id"], "qahtani_root", "lineage", "oral_tradition")

    return edges


def build_ancestry_chains(nodes, edges):
    """For each leaf node, traverse parent edges upward to build ancestry chain."""
    # Build adjacency: child -> list of parent IDs (for "upward" edge types)
    upward_types = {"descent", "confederation", "family_of", "ruling_house", "branch", "lineage"}

    parent_of = defaultdict(list)
    for e in edges:
        if e["edgeType"] in upward_types:
            # source -> target means source is child of target
            parent_of[e["source"]].append(e["target"])

    # Find leaf nodes: nodes with no children
    all_ids = {n["id"] for n in nodes}
    has_children = set()
    for e in edges:
        if e["edgeType"] in upward_types:
            has_children.add(e["target"])

    leaf_ids = all_ids - has_children

    chains = {}
    for leaf_id in leaf_ids:
        chain = []
        visited = set()
        queue = [leaf_id]
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            chain.append(current)
            for parent_id in parent_of.get(current, []):
                if parent_id not in visited:
                    queue.append(parent_id)
        if len(chain) > 1:
            chains[leaf_id] = chain

    return chains


def build_clusters(tribes, overrides, edges):
    """Build confederation and origin group clusters."""
    # Confederations
    confederations = {}
    override_conf = {c["id"]: c for c in overrides.get("confederations", [])}

    for t in tribes:
        if not t.get("isConfederation"):
            continue
        entry = {"id": t["id"], "name": t["name"], "members": list(_subs(t))}
        if t["id"] in override_conf:
            oc = override_conf[t["id"]]
            if "formationTheories" in oc:
                entry["formationTheories"] = oc["formationTheories"]
        confederations[t["id"]] = entry

    # Origin groups
    origin_groups = defaultdict(list)
    for nto in overrides.get("nonTribalOrigins", []):
        origin = nto["origin"]
        origin_id = ORIGIN_GROUPS.get(origin, ORIGIN_GROUPS["other"])["id"]
        origin_groups[origin_id].append(nto["family"])

    return confederations, dict(origin_groups)


def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())
    graph = json.loads((DATA_DIR / "graph.json").read_text())
    overrides = json.loads((DATA_DIR / "ancestry-overrides.json").read_text())

    nodes = build_nodes(tribes, families, overrides, graph)
    edges = build_edges(tribes, families, graph, overrides)
    ancestry_chains = build_ancestry_chains(nodes, edges)
    confederations, origin_groups = build_clusters(tribes, overrides, edges)

    lineage = {
        "nodes": nodes,
        "edges": edges,
        "ancestryChains": ancestry_chains,
        "clusters": {
            "confederations": confederations,
            "originGroups": origin_groups,
        },
    }

    (DATA_DIR / "lineage.json").write_text(json.dumps(lineage, indent=2, ensure_ascii=False) + "\n")

    # Stats
    print(f"Total nodes:            {len(nodes)}")
    edge_types = defaultdict(int)
    for e in edges:
        edge_types[e["edgeType"]] += 1
    print("Edges by type:")
    for et, count in sorted(edge_types.items()):
        print(f"  {et}: {count}")
    print(f"Total edges:            {len(edges)}")
    print(f"Ancestry chains:        {len(ancestry_chains)}")
    print(f"Confederations:         {len(confederations)}")
    print(f"Origin groups:          {len(origin_groups)}")


if __name__ == "__main__":
    main()
