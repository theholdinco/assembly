#!/usr/bin/env python3
"""Rebuild graph.json by combining existing graph data with family connections and tribe+family relations."""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "src", "data")

RELATIONSHIP_MAP = {
    # Alliance-type
    "alliance": "alliance",
    "allied_with": "alliance",
    "allied_through_marriage": "intermarriage",
    "historic_alliance": "alliance",
    "historical_alliance": "alliance",
    "political_alliance": "alliance",
    "peer_group": "alliance",
    "connected_to": "alliance",
    "related": "alliance",
    "related_to": "alliance",
    "possible_connection": "alliance",
    "possible_historical_connection": "alliance",
    "historical_connection": "alliance",
    "family_connection": "alliance",
    "family_ties": "alliance",
    "first_cousins": "alliance",
    "advisors": "alliance",
    "education": "alliance",
    "teacher_student": "alliance",
    "leadership": "alliance",
    "established": "alliance",
    # Rivalry-type
    "rival": "rivalry",
    "conquered": "rivalry",
    "overthrew": "rivalry",
    "autonomous_from": "rivalry",
    # Intermarriage-type
    "marriage_alliance": "intermarriage",
    "married_into": "intermarriage",
    "maternal_connection": "intermarriage",
    # Trade / business
    "business_alliance": "trade_partnership",
    "business_partner": "trade_partnership",
    # Offshoot / descent
    "branch_of": "offshoot",
    "descended_from": "offshoot",
    "originated_from": "offshoot",
    "successor_branch": "offshoot",
    "ancestral_lineage": "offshoot",
    "community_origin": "offshoot",
    # Sub-tribe / clan membership
    "member_clan": "sub_tribe",
    "member_of": "sub_tribe",
    "members_of": "sub_tribe",
    "sub_clan_of": "sub_tribe",
    "subgroup_of": "sub_tribe",
    "subsection_of": "sub_tribe",
    "ruling_clan_of": "sub_tribe",
    "tribal_affiliation": "sub_tribe",
    "tribal_connection": "sub_tribe",
    "tribal_kinship": "sub_tribe",
    "tribal_origin": "sub_tribe",
    "affiliated_with": "sub_tribe",
    # Vassalage
    "vassal_of": "vassalage",
    "vassal_house": "vassalage",
    "governed_under": "vassalage",
    "served_as_regents": "vassalage",
    "succeeded_by": "vassalage",
}

STRENGTH_BY_TYPE = {
    "alliance": 0.9,
    "rivalry": 0.9,
    "intermarriage": 0.7,
    "trade_partnership": 0.5,
    "offshoot": 0.7,
    "sub_tribe": 0.7,
    "vassalage": 0.7,
    "shared_migration": 0.7,
    "family_of": 0.7,
    "claimed_descent": 0.7,
}


def load_json(filename):
    with open(os.path.join(DATA_DIR, filename)) as f:
        return json.load(f)


def map_relationship(rel_string):
    return RELATIONSHIP_MAP.get(rel_string, "alliance")


def strength_for_type(link_type):
    return STRENGTH_BY_TYPE.get(link_type, 0.7)


def make_link_key(source, target):
    return tuple(sorted([source, target]))


def main():
    graph = load_json("graph.json")
    tribes = load_json("tribes.json")
    families = load_json("families.json")

    print(f"Before: {len(graph['nodes'])} nodes, {len(graph['links'])} links")

    tribe_by_id = {t["id"]: t for t in tribes}
    family_by_id = {f["id"]: f for f in families}

    nodes_by_id = {n["id"]: n for n in graph["nodes"]}

    # Deduplicated links: key = (sorted source, target) -> link dict
    links_map = {}
    for link in graph["links"]:
        key = make_link_key(link["source"], link["target"])
        existing = links_map.get(key)
        if not existing or link.get("strength", 0) > existing.get("strength", 0):
            links_map[key] = link

    def ensure_node(entity_id, entity_type=None):
        if entity_id in nodes_by_id:
            return
        name = entity_id.replace("_", " ").title()
        node_type = "tribe"
        group = "unknown"

        if entity_id in tribe_by_id:
            name = tribe_by_id[entity_id].get("name", name)
            node_type = "tribe"
            lineage = tribe_by_id[entity_id].get("lineageRoot", "")
            if lineage == "adnani":
                group = "adnani"
            elif lineage == "qahtani":
                group = "qahtani"
            else:
                group = "unknown"
        elif entity_id in family_by_id:
            name = family_by_id[entity_id].get("name", name)
            node_type = "family"
            group = "family"
        else:
            if entity_type in ("family", "royal_family", "ruling_family", "family_group", "dynasty"):
                node_type = "family"
                group = "family"

        node = {
            "id": entity_id,
            "name": name,
            "type": node_type,
            "group": group,
            "color": None,
            "size": 1,
        }
        nodes_by_id[entity_id] = node

    def add_link(source, target, link_type, strength):
        key = make_link_key(source, target)
        existing = links_map.get(key)
        if not existing or strength > existing.get("strength", 0):
            links_map[key] = {
                "source": source,
                "target": target,
                "type": link_type,
                "strength": strength,
            }

    # Ensure all families have nodes
    for fam in families:
        ensure_node(fam["id"], "family")
        if fam["id"] in nodes_by_id:
            node = nodes_by_id[fam["id"]]
            if node["type"] != "family":
                node["type"] = "family"
                node["group"] = "family"

    # Process family connections
    for fam in families:
        for conn in fam.get("connections", []):
            entity_id = conn["entityId"]
            entity_type = conn.get("entityType", "")
            relationship = conn.get("relationship", "")

            ensure_node(entity_id, entity_type)

            link_type = map_relationship(relationship)
            strength = strength_for_type(link_type)
            add_link(fam["id"], entity_id, link_type, strength)

    # Process tribe+family relations
    for fam in families:
        if fam.get("entityClassification") != "tribe+family":
            continue
        for rel in fam.get("relations", []):
            target_id = rel.get("tribeId")
            if not target_id:
                continue
            ensure_node(target_id)
            rel_type = rel.get("type", "alliance")
            # relations use graph link types directly
            if rel_type not in STRENGTH_BY_TYPE:
                rel_type = map_relationship(rel_type)
            strength = strength_for_type(rel_type)
            add_link(fam["id"], target_id, rel_type, strength)

    # Update node sizes based on connection count
    connection_count = {}
    for link in links_map.values():
        connection_count[link["source"]] = connection_count.get(link["source"], 0) + 1
        connection_count[link["target"]] = connection_count.get(link["target"], 0) + 1

    for node_id, node in nodes_by_id.items():
        count = connection_count.get(node_id, 0)
        node["size"] = max(1, count)

    # Build final graph
    graph["nodes"] = sorted(nodes_by_id.values(), key=lambda n: n["id"])
    graph["links"] = sorted(links_map.values(), key=lambda l: (l["source"], l["target"]))

    print(f"After:  {len(graph['nodes'])} nodes, {len(graph['links'])} links")

    output_path = os.path.join(DATA_DIR, "graph.json")
    with open(output_path, "w") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    print(f"Written to {output_path}")


if __name__ == "__main__":
    main()
