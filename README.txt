Path + Source filter update
===========================

Folder layout expected:

thumbs/
  armors/{basename}.png
  weapons/
    majestica/{basename}.png
    nongkos/{basename}.png
    mjolnir/{basename}.png
    shield/{basename}.png
    trident/{basename}.png
    other/{basename}.png   (rare fallback)

models/  → same structure, .glb files

basename = Minecraft model JSON file name
  e.g. abominablegreatsaber, nocturne, crimson_trident

Install on GitHub site:
1. Replace data/database.json (and items.json optional)
2. Replace script.js
3. Put files in thumbs/ and models/ as above
4. Commit + Push

Source dropdown:
- All → every source
- Armor → only sources that appear on armor items
- Weapons → only sources that appear on weapon items
