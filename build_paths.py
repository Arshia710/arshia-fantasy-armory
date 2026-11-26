#!/usr/bin/env python3
"""
build_paths.py  -  run it from the website folder (the one that contains index.html, data/, models/, thumbs/)

    python build_paths.py          writes data/paths.json and prints a report
    python build_paths.py --all    same, but never shortens the lists in the report

Run it again every time you add, move or rename a model (.bbmodel) or a thumbnail.
data/paths.json tells the website where each file lives, so you can organise the folders
however you like (e.g. weapons/majestica/x.bbmodel, armors/witcher/y.bbmodel) without touching
database.json, the scanner or the site code.

A file is found by its NAME (without the extension). For an item the site tries, in this order:
    models : Full Set -> item id (malenia_full_set)      others -> thumbnail name, model name, item id
    thumbs : thumbnail name, model name, item id
(a model name that two different items share, e.g. two "mjolnir" models, is skipped: those items are
identified by their thumbnail name / id instead)
So the model "thumbs/weapons/majestica/abominableblade.png" belongs to the item whose database
thumbnail is "thumbs/abominableblade.png" - folders are ignored, only the file name counts.
A name that exists twice (in two folders) is ambiguous: it is NOT written to paths.json and it is
reported, so a wrong model can never be shown.
"""
import base64
import collections
import json
import os
import re
import struct
import sys

try:
    sys.stdout.reconfigure(errors="replace")  # old Windows consoles
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(ROOT, "models")
THUMBS = os.path.join(ROOT, "thumbs")
DB_FILE = os.path.join(ROOT, "data", "database.json")
OUT_FILE = os.path.join(ROOT, "data", "paths.json")
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
# folders that must only contain creator / pack sub-folders (no files directly inside) - edit freely
NEED_SUBFOLDER = {"weapons/shield", "weapons/trident", "weapons/mjolnir"}
LIMIT = None if "--all" in sys.argv else 15


def scan(base, exts):
    """-> sorted list of relative paths (always with /) of files with one of the extensions"""
    found = []
    for folder, _dirs, files in os.walk(base):
        for f in files:
            if f.lower().endswith(exts):
                found.append(os.path.relpath(os.path.join(folder, f), base).replace(os.sep, "/"))
    return sorted(found)


def key_of(rel, kind):
    name = rel.rsplit("/", 1)[-1]
    if kind == "models":
        return re.sub(r"(\.geo)?\.bbmodel$", "", name, flags=re.I)
    return name.rsplit(".", 1)[0]


def build_index(paths, kind):
    by_key = collections.defaultdict(list)
    for p in paths:
        by_key[key_of(p, kind)].append(p)
    unique = {k: v[0] for k, v in by_key.items() if len(v) == 1}
    ambiguous = {k: v for k, v in by_key.items() if len(v) > 1}
    return unique, ambiguous, by_key


def last(s):
    return str(s or "").split("/")[-1]


def shared_model_stems(items):
    """in-game model names that more than one item points to (e.g. two different 'mjolnir' models)"""
    counts = collections.Counter(last(i.get("model")) for i in items if i.get("type") != "Full Set")
    return {k for k, n in counts.items() if n > 1}


def keys_for(item, kind, shared=frozenset()):
    thumb_stem = re.sub(r"\.[^.]+$", "", last(item.get("thumbnail")))
    model_stem = last(item.get("model"))
    if model_stem in shared:  # another item has the same model name: only the thumbnail name / id may identify this one
        model_stem = None
    if kind == "models" and item.get("type") == "Full Set":
        return [item["id"]]
    seen, keys = set(), []
    for k in (thumb_stem, model_stem, item.get("id")):
        if k and k not in seen:
            seen.add(k)
            keys.append(k)
    return keys


def show(title, rows):
    print("\n" + title)
    if not rows:
        print("   none")
        return
    shown = rows if LIMIT is None else rows[:LIMIT]
    for r in shown:
        print("   " + r)
    if len(shown) < len(rows):
        print("   ... +%d more (run with --all to see everything)" % (len(rows) - len(shown)))


def png_size(data_uri):
    try:
        raw = base64.b64decode(data_uri.split(",", 1)[1])[:24]
        return struct.unpack(">II", raw[16:24])
    except Exception:
        return None


def check_models(paths):
    """light sanity checks on every .bbmodel (the browser loader is stricter, this catches the obvious)"""
    bad_json, no_geo, non_cube, no_src, animated = [], [], [], [], 0
    for rel in paths:
        try:
            with open(os.path.join(MODELS, rel), encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception as e:
            bad_json.append("%s  (%s)" % (rel, str(e)[:60]))
            continue
        els = d.get("elements") or []
        if not els:
            no_geo.append(rel)
        types = {e.get("type", "cube") for e in els} - {"cube"}
        if types:
            non_cube.append("%s  (%s)" % (rel, ", ".join(sorted(types))))
        for t in d.get("textures") or []:
            if not t.get("source"):
                no_src.append("%s  (texture %s)" % (rel, t.get("name")))
                continue
            size = png_size(t["source"])
            uvw, uvh = t.get("uv_width") or 16, t.get("uv_height") or 16
            if size and size[1] >= size[0] * uvh / uvw * 1.999:
                animated += 1
    return bad_json, no_geo, non_cube, no_src, animated


def main():
    for d in (MODELS, THUMBS):
        if not os.path.isdir(d):
            print("folder not found: %s - run this script from the website folder" % d)
            return 1
    models = scan(MODELS, (".bbmodel",))
    thumbs = scan(THUMBS, IMG_EXT)
    m_unique, m_amb, _ = build_index(models, "models")
    t_unique, t_amb, _ = build_index(thumbs, "thumbs")

    items = []
    if os.path.isfile(DB_FILE):
        with open(DB_FILE, encoding="utf-8") as fh:
            items = json.load(fh)
    else:
        print("note: %s not found - skipping the database cross-check" % DB_FILE)

    # ---- write paths.json (unambiguous names only) ----
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump({"models": dict(sorted(m_unique.items())), "thumbs": dict(sorted(t_unique.items()))}, fh, separators=(",", ":"))

    print("== build_paths ==")
    print("models found : %d   thumbnails found : %d   database items : %d" % (len(models), len(thumbs), len(items)))

    # ---- database cross-check ----
    shared = shared_model_stems(items)
    if items:
        for kind, index, label in (("models", m_unique, "3D model"), ("thumbs", t_unique, "thumbnail")):
            missing, wanted = [], set()
            for it in items:
                keys = keys_for(it, kind, shared)
                wanted.update(keys)
                if not any(k in index for k in keys):
                    missing.append(it)
            have = len(items) - len(missing)
            print("\n%s: %d of %d items have one" % (label, have, len(items)))
            groups = collections.Counter((m.get("pack"), m.get("type")) for m in missing)
            if groups:
                print("   missing by pack/type: " + ", ".join("%s/%s=%d" % (p, t, n) for (p, t), n in sorted(groups.items(), key=lambda x: -x[1])[:12]))
            show("%s - items WITHOUT a file (id -> name looked for):" % label, ["%s -> %s" % (m["id"], " | ".join(keys_for(m, kind, shared))) for m in missing])
            index_all = m_unique if kind == "models" else t_unique
            orphans = sorted(set(index_all) - wanted)
            show("%s - files that match NO database item:" % label, [index_all[k] for k in orphans])

    # ---- naming / layout problems ----
    for kind, paths in (("models", models), ("thumbs", thumbs)):
        show("%s - name appears more than once (ambiguous, NOT used until you rename one):" % kind,
             ["%s -> %s" % (k, ", ".join(v)) for k, v in sorted((m_amb if kind == "models" else t_amb).items())])
        odd = [p for p in paths if p != p.lower() or " " in p or not p.isascii()]
        show("%s - paths with UPPER-CASE letters, spaces or non-ASCII characters (GitHub Pages is case-sensitive):" % kind, odd)
        loose = []
        for p in paths:
            parts = p.split("/")
            parent = "/".join(parts[:-1])
            if len(parts) < 3 or parent.lower() in NEED_SUBFOLDER:
                loose.append(p)
        show("%s - files NOT inside a creator/pack folder:" % kind, loose)

    # ---- model sanity ----
    bad_json, no_geo, non_cube, no_src, animated = check_models(models)
    print("\nmodel check: %d flipbook (animated) textures" % animated)
    show("models - invalid JSON:", bad_json)
    show("models - no elements (empty):", no_geo)
    show("models - element types the viewer does not draw (only cubes are supported):", non_cube)
    show("models - textures that are NOT embedded in the file:", no_src)

    print("\nwrote %s  (%d models, %d thumbnails)" % (os.path.relpath(OUT_FILE, ROOT), len(m_unique), len(t_unique)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
