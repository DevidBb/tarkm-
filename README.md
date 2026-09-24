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
