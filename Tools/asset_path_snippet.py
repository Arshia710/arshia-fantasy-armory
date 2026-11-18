# Drop into scanner asset_names() logic — user folder layout
def folder_for_model(model: str, group: str, typ: str, pack: str) -> str:
    ml = (model or "").lower()
    pack = (pack or "").lower()
    if group == "armor":
        return "armors"
    if typ == "Shield" or "shield" in ml:
        return "weapons/shield"
    if any(x in ml for x in ("mjolnir", "stormbreaker", "gow_mjolnir", "mcu_stormbreaker")):
        return "weapons/mjolnir"
    if typ == "Trident" or "/tridents/" in ml:
        return "weapons/trident"
    if "majestica" in ml or pack == "majestica":
        return "weapons/majestica"
    if "nongko" in ml or pack == "nongko":
        return "weapons/nongkos"
    return "weapons/other"
