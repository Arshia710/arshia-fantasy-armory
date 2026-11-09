"""Expand Full Set into 5 rows. After scanner builds items:
    from expand_armor import expand_armor_sets
    results = expand_armor_sets(results)
"""
import re

PIECE_TYPES = [
    ("helmet", "Helmet"),
    ("chestplate", "Chestplate"),
    ("leggings", "Leggings"),
    ("boots", "Boots"),
]

def make_id(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

def pick_model(models, piece):
    models = models or []
    for m in models:
        if piece in m.lower():
            return m
    return models[0] if models else ""

def expand_armor_sets(items):
    out = []
    for item in items:
        if item.get("type") != "Full Set":
            out.append(item)
            continue
        models = item.get("models") or []
        full = dict(item)
        full["id"] = make_id(item["name"]) + "_full_set"
        full["type"] = "Full Set"
        full["works_on"] = ["helmet", "chestplate", "leggings", "boots"]
        full["pieces"] = list(full["works_on"])
        full["group"] = "armor"
        full["model"] = pick_model(models, "chestplate") or item.get("model")
        full["copy_name"] = item["name"]
        out.append(full)
        for piece, typ in PIECE_TYPES:
            row = dict(item)
            row["id"] = make_id(item["name"]) + "_" + piece
            row["name"] = item["name"] + " " + typ
            row["copy_name"] = item["name"]
            row["type"] = typ
            row["works_on"] = [piece]
            row["pieces"] = [piece]
            row["group"] = "armor"
            row["model"] = pick_model(models, piece) or item.get("model")
            row["models"] = [row["model"]] if row["model"] else models
            out.append(row)
    return out
