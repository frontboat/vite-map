# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun is the package manager (bun.lock).

- `bun install` — install dependencies
- `bun run dev` — start Vite dev server
- `bun run build` — typecheck (`tsc -b`) then build (`vite build`)
- `bun run lint` — ESLint
- `bun run preview` — serve the production build

There is no test runner configured.

## Stack

Vite + React 19 + TypeScript, Tailwind CSS v4 (configured in `src/index.css` via the `@tailwindcss/vite` plugin — there is no `tailwind.config`), shadcn/ui. The `@/` import alias maps to `src/` (defined in both `vite.config.ts` and `tsconfig`).

shadcn components live in `src/components/ui/` and are configured by `components.json` (style `radix-vega`, hugeicons icon library). A custom registry `@shadcn-map` (`http://shadcn-map.vercel.app/r/{name}.json`) is registered — the map component originates from it. Add components with `bunx shadcn add <name>`.

## Architecture

Single-page map app. `src/main.tsx` wraps `App` in a `next-themes` `ThemeProvider` (`attribute="class"`, default dark). `src/App.tsx` just composes the map UI declaratively from primitives exported by `src/components/ui/map.tsx`.

`src/components/ui/map.tsx` (~2,400 lines) is the heart of the codebase — a composable React wrapper around MapLibre GL + Terra Draw:

- **`Map`** creates the MapLibre instance and provides `MapContext` (consumed via `useMap()`). It is theme-aware: it resolves the theme from its `theme` prop, the document class (next-themes), or system preference, and swaps between Carto basemap styles (dark-matter / positron) on theme change. Custom styles can be passed per theme via the `styles` prop.
- **Marker/popup/route/cluster components** (`MapMarker`, `MarkerPopup`, `MapPopup`, `MapRoute`, `MapClusterLayer`, …) are children of `Map` that register themselves on the map instance through context and render React content into MapLibre DOM elements via portals.
- **Draw subsystem**: `MapDrawControl` instantiates TerraDraw with `terra-draw-maplibre-gl-adapter` and provides `DrawContext` (`useDrawContext()`). Mode children (`MapDrawPoint`, `MapDrawLine`, `MapDrawPolygon`, `MapDrawRectangle`, `MapDrawCircle`, `MapDrawFreehand`, `MapDrawSelect`) each register a Terra Draw mode; toolbar children (`MapDrawDelete`, `MapDrawDownload`, `MapDrawImport`, `MapDrawMapManager`) operate on drawn features. Only modes/tools rendered as children are enabled.
- **Persistence**: drawn features auto-save to IndexedDB (database `map-draw-features`) for session restore; `MapDrawMapManager` additionally saves/loads named maps to a second object store.

`src/components/ui/place-autocomplete.tsx` provides geocoding search backed by the public Photon API (`photon.komoot.io`).

### Presentation layer

The app doubles as a step-based presentation tool built on three sibling files that compose inside `<Map>`:

- **`map-timeline.tsx`** — `MapTimeline` provider holds the current step in a reducer; sources register their items (`registerItems(sourceId, items)`) and `maxStep` = max(item steps, section starts, `stepCount`). `stepCount` is the planned deck length — empty steps survive item deletion. Items are cumulative: visible when `step <= current` (null step = always visible). **Sections are cosmetic containers of steps** (`{id, name, start}`, spanning until the next section; persisted to their own IndexedDB, with auto-migration from the old per-step `labels` format): renaming/removing a section never moves items; `addStepToSection` inserts a step at the section's end (shifting later steps/sections/current-step up); `removeStep(at)` collapses a step (its items merge into the previous step, never to always-visible; a section whose only step dies is dropped). `MapTimelineControl` renders the prev/next bar (ArrowLeft/ArrowRight captured window-wide, current section name shown) plus the overview panel: every step 1..maxStep renders (even empty), nested under section headers. The reducer clamps the current step when sources shrink the timeline; registration effects must NOT unregister in their change cleanup (only on unmount) or the transient empty list clamps the step. Radix closes popovers on document-capture Escape — use `onEscapeKeyDown` + `preventDefault` for inputs inside them, not `stopPropagation`.
- **`map-assets.tsx`** — `MapAssetControl`: upload SVGs, click-to-place as draggable fixed-pixel markers, per-instance size/step/delete panel. Persists to its own IndexedDB database.
- **`map-slides.tsx`** — `MapSlideControl`: image URLs shown full-height in the right 40% as an overlay (`z-[5]`: above map/markers/drawings, below all `z-10` controls). A slide shows when its step matches the current step exactly; a step-less slide is an always-on fallback.

**Deck files**: the overview panel's Export/Import buttons serialize the whole presentation (drawings incl. hidden, assets + placements, slides, sections, `stepCount`) to one JSON file. Sources register `{exportData, importData}` via `registerPersistence(sourceId, handler)`; import is replace-all and rewinds to step 0 (draw features get fresh ids). This is separate from the draw toolbar's GeoJSON download and the named map manager, which remain features-only.

Draw-feature timeline support lives in `map.tsx`'s `MapDrawControl`: steps stored in `properties.step`, features beyond the current step are removed from terra draw and stashed in `hiddenFeatures` (merged back into session auto-save, saved maps, and GeoJSON export). Terra draw drops selection on `updateFeatureProperties` — `setFeatureStep` re-selects afterward.
