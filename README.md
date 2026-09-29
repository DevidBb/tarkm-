# Tarkov Map AI

Interactive 3D maps of Escape from Tarkov: Streets of Tarkov, Interchange, Factory, Customs and Shoreline.

- 3D scenes built with three.js, floors and levels
- Extracts, keys, bosses, loot spawns, danger zones
- Quest guide with objectives on the map and progress tracking
- Walking routes with turn-by-turn steps
- LOCATE ME: find your position from an in-raid screenshot (EFT filename coordinates or Claude Vision)
- Inventory evaluation from a screenshot with tarkov.dev prices

No build step: React 18 UMD + htm. Serve the folder with any static server:

```
python3 -m http.server 8000
```

Map, quest and price data: tarkov.dev (see `data/customs/ATTRIBUTION.md`).

Woods, Reserve, Lighthouse and Ground Zero (`scripts/build_spt_maps.py`): plans by Shebuka (tarkov-dev-svg-maps,
CC BY-NC-SA 4.0), map config and labels from the tarkov-dev repository, relief and quest texts from the SPT server
database, and extracts, doors, switches, hazards, bosses, spawns and quest points from a snapshot of the tarkov.dev API
(`data-snapshot.js` of tarkovtaskmap/tarkovtaskmap.github.io, 2026-09-20).
