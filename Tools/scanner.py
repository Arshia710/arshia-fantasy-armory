"""
Arshia Fantasy Armory — Scanner
1) Scan resource pack items/*.json for custom names + models
2) categories_master.txt → type / works_on / rarity / source
3) Asset paths (thumbs + models) derived from model JSON path:
   - basename = JSON file name
   - subfolders from model path after namespace, skipping bare "item"
   Examples:
     minecraft:item/weapons/majestica/abominablegreatsaber
       → thumbs/weapons/majestica/abominablegreatsaber.png
       → models/weapons/majestica/abominablegreatsaber.glb
     fantasy_armor:item/crucible_knight_chestplate
       → thumbs/fantasy_armor/crucible_knight_chestplate.png
     minecraft:item/mjolnir
       → thumbs/mjolnir.png   (no empty "item" folder)
"""

import os
import json
import re
from collections import defaultdict

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_PATH = os.path.join(PROJECT_ROOT, "Source", "ResourcePack", "assets")
CATEGORIES_FILE = os.path.join(PROJECT_ROOT, "Website", "data", "categories_master.txt")
OUTPUT_FILE = os.path.join(PROJECT_ROOT, "Website", "data", "items.json")

PACK_FROM_MODEL = {
    "majestica": "majestica",
    "nongko": "nongko",
    "fantasy_armor": "fantasy_armor",
    "arshia_armory": "arshia",
}

PIECE_TYPES = [
    ("helmet", "Helmet"),
    ("chestplate", "Chestplate"),
    ("leggings", "Leggings"),
    ("boots", "Boots"),
]


def make_id(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def model_rel_dir_and_base(model: str) -> tuple:
    """
    From model id → (relative_dir, basename)
    relative_dir has no leading/trailing slash; may be "".
    Skips a lone leading "item" segment so we never get thumbs/item/foo.png
    but keeps item/weapons/... → weapons/...
    Also prefixes with namespace when not minecraft (e.g. fantasy_armor/...).
    """
    if not model:
        return "", ""
    if ":" in model:
        ns, path = model.split(":", 1)
    else:
        ns, path = "minecraft", model
    parts = [p for p in path.split("/") if p]
    if not parts:
        return "", ""
    base = parts[-1]
    dirs = parts[:-1]
    # drop only a solitary leading "item" (root items); keep item/weapons → strip "item" still
    # User asked: no "item" folder. Strip every leading "item" segment once.
    if dirs and dirs[0] == "item":
        dirs = dirs[1:]
    # non-minecraft namespaces: put ns as first folder so armors don't collide
    if ns and ns != "minecraft":
        dirs = [ns] + dirs
    rel = "/".join(dirs)
    return rel, base


def asset_names(model: str) -> dict:
    rel, base = model_rel_dir_and_base(model)
    if not base:
        return {"thumbnail": None, "gltf": None}
    if rel:
        thumb = f"thumbs/{rel}/{base}.png"
        gltf = f"models/{rel}/{base}.glb"
    else:
        thumb = f"thumbs/{base}.png"
        gltf = f"models/{base}.glb"
    return {"thumbnail": thumb, "gltf": gltf}


def pick_model_for_piece(models, piece: str) -> str:
    models = list(models or [])
    for m in models:
        if piece in m.lower():
            return m
    return models[0] if models else ""


def base_kind(filename: str) -> str:
    base = filename.replace(".json", "").lower()
    for kind in (
        "sword", "axe", "pickaxe", "shovel", "hoe", "spear", "trident", "mace",
        "shield", "bow", "crossbow", "helmet", "chestplate", "leggings", "boots",
    ):
        if base.endswith("_" + kind) or base.endswith(kind) or kind in base:
            return kind
    return base


def detect_pack(model: str) -> str:
    m = (model or "").lower()
    for key, val in PACK_FROM_MODEL.items():
        if key in m:
            return val
    return "other"


def extract_model(node):
    if not isinstance(node, dict):
        return None
    if node.get("type") == "minecraft:model" and isinstance(node.get("model"), str):
        return node["model"]
    for value in node.values():
        if isinstance(value, (dict, list)):
            r = extract_model(value)
            if r:
                return r
    if isinstance(node, list):
        for item in node:
            r = extract_model(item)
            if r:
                return r
    return None


def walk_cases(node, kind, bucket):
    if isinstance(node, dict):
        if node.get("component") == "minecraft:custom_name" and "cases" in node:
            for case in node.get("cases", []):
                if not isinstance(case, dict):
                    continue
                when = case.get("when")
                model = extract_model(case.get("model"))
                if not when or not model:
                    continue
                for name in (when if isinstance(when, list) else [when]):
                    if not isinstance(name, str):
                        continue
                    bucket[name]["models"].add(model)
                    bucket[name]["works_on_raw"].add(kind)
        for value in node.values():
            walk_cases(value, kind, bucket)
    elif isinstance(node, list):
        for item in node:
            walk_cases(item, kind, bucket)


def parse_categories_master(path: str) -> dict:
    cats = {}
    if not os.path.exists(path):
        print("WARNING: categories_master not found:", path)
        return cats
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("=") or line.startswith("-"):
                continue
            if line.startswith("##") or line.startswith("Format") or line.startswith("rarity:"):
                continue
            if line.startswith("works_on:") or line.startswith("When ") or line.startswith("END"):
                continue
            if "WEAPONS" in line or "ARMOR" in line:
                continue
            if "|" not in line:
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 3:
                continue
            name, typ, works = parts[0], parts[1], parts[2]
            if name.lower() == "name":
                continue
            rarity = parts[3].strip().lower() if len(parts) > 3 else "common"
            source = parts[4].strip() if len(parts) > 4 else ""
            works_on = [w.strip().lower() for w in works.split(",") if w.strip()]
            cats[name] = {
                "type": typ,
                "works_on": works_on,
                "rarity": rarity,
                "source": source,
            }
    return cats


def expand_armor_sets(items: list) -> list:
    out = []
    for item in items:
        if item.get("type") != "Full Set":
            out.append(item)
            continue
        models = item.get("models") or []
        chest = pick_model_for_piece(models, "chestplate") or item.get("model") or ""
        assets = asset_names(chest)
        full = dict(item)
        full["id"] = make_id(item["name"]) + "_full_set"
        full["type"] = "Full Set"
        full["works_on"] = ["helmet", "chestplate", "leggings", "boots"]
        full["pieces"] = list(full["works_on"])
        full["group"] = "armor"
        full["model"] = chest
        full["copy_name"] = item["name"]
        full["thumbnail"] = assets["thumbnail"]
        full["gltf"] = assets["gltf"]
        out.append(full)
        for piece, typ in PIECE_TYPES:
            mid = pick_model_for_piece(models, piece) or item.get("model") or ""
            a = asset_names(mid)
            row = dict(item)
            row["id"] = make_id(item["name"]) + "_" + piece
            row["name"] = item["name"] + " " + typ
            row["copy_name"] = item["name"]
            row["type"] = typ
            row["works_on"] = [piece]
            row["pieces"] = [piece]
            row["group"] = "armor"
            row["model"] = mid
            row["models"] = [mid] if mid else models
            row["thumbnail"] = a["thumbnail"]
            row["gltf"] = a["gltf"]
            out.append(row)
    return out


def scan_files():
    bucket = defaultdict(lambda: {"models": set(), "works_on_raw": set()})
    if not os.path.isdir(ASSETS_PATH):
        print("WARNING: assets path missing:", ASSETS_PATH)

    for root, _dirs, files in os.walk(ASSETS_PATH):
        for fn in files:
            if not fn.endswith(".json"):
                continue
            norm = root.replace("\\", "/")
            if "/items" not in norm and not norm.endswith("/items"):
                continue
            path = os.path.join(root, fn)
            kind = base_kind(fn)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception as e:
                print("Error", path, e)
                continue
            walk_cases(data, kind, bucket)

    cats = parse_categories_master(CATEGORIES_FILE)
    results = []
    unmatched = []

    for name in sorted(bucket.keys(), key=lambda s: s.lower()):
        entry = bucket[name]
        models = sorted(entry["models"])
        model = models[0] if models else ""
        pack = detect_pack(model)
        cat = cats.get(name)
        if not cat:
            for k, v in cats.items():
                if k.lower() == name.lower():
                    cat = v
                    break

        if cat:
            typ = cat["type"]
            works_on = cat["works_on"]
            rarity = cat["rarity"]
            source = cat["source"] or pack
        else:
            unmatched.append(name)
            typ = "Sword"
            works_on = sorted(entry["works_on_raw"])
            rarity = "common"
            source = pack

        group = "armor" if typ in ("Full Set", "Helmet", "Chestplate", "Leggings", "Boots") else "weapon"
        assets = asset_names(model)
        item = {
            "id": make_id(name),
            "name": name,
            "copy_name": name,
            "group": group,
            "type": typ,
            "works_on": works_on,
            "pack": pack,
            "source": source,
            "rarity": rarity,
            "thumbnail": assets["thumbnail"],
            "gltf": assets["gltf"],
            "model": model,
            "models": models,
            "namespace": model.split(":")[0] if ":" in model else "minecraft",
            "viewer": "armor" if group == "armor" else "3d_item",
        }
        if group == "armor":
            item["pieces"] = [w for w in works_on if w in ("helmet", "chestplate", "leggings", "boots")]
        results.append(item)

    results = expand_armor_sets(results)

    if unmatched:
        print("Not in categories_master (defaults used):", len(unmatched))
        for n in unmatched[:20]:
            print("  -", n)
        if len(unmatched) > 20:
            print("  ...")
    return results


def save(items):
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=4, ensure_ascii=False)
    print("Created:", OUTPUT_FILE)
    print("Total:", len(items))


if __name__ == "__main__":
    print("Scanning...")
    items = scan_files()
    save(items)
    from collections import Counter
    print("By type:", dict(Counter(i["type"] for i in items).most_common(15)))
    for i in items[:5]:
        print(" ", i["name"], "→", i.get("thumbnail"))
    print("Done.")
