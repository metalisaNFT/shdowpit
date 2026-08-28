# Territory quality pass template

Use this after THE TOWER vertical slice is proven. Do not rebuild the whole map.

## Checklist per area

- Distant landmark readable from the approach
- Readable entrance / road gate
- Holder colour on banners (and one unique object: beacon, throne, pool, tree, nave)
- Combat identity from [src/data/areas.ts](../src/data/areas.ts) `combat` line, felt in layout
- One shortcut (use existing corridor locks + occupancy)
- One exploration discovery (cache or shrine)
- One environmental interaction
- One witnessed staged event (MultiEncounter / ambient)
- Extraction gate
- Persistent consequence when ownership changes (`Arena.applyOccupancy`)
- Named encounter arena (open plaza that stays open)

## Holder coupling

Update from `snapshotOccupancy` only:

- banners / beacon / throne accent
- patrol density (`World.gruntDelta`)
- formations / territory rule
- traps / locked shortcuts
- ambient behaviour
- local law copy

## Do not

- Duplicate simulation systems
- Let AI choose ownership or encounters
- Add unique high-detail meshes that break the modular style
