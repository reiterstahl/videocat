# UI Redesign Plan

[Versión en español](UI_REDESIGN_PLAN.es.md)

The `v0.2.0` redesign modernizes the web app without changing the API or existing workflows. Each phase shipped with desktop and mobile interaction tests.

## Phases Delivered In v0.2.0

- **Phase 1 — Shell and themes.** Design tokens; light, dark, OLED or system appearance; six color schemes; comfortable or compact density; collapsible sidebar; sticky header; drive strip with usage; KPI strip; self-hosted Geist typography.
- **Phase 2 — Catalog.** Header search with `Ctrl K`; grid or list view; removable filter chips; sort menu; collapsible filters; side detail panel that becomes a drawer on narrow screens.
- **Phase 3 — Review.** Landing page with KPIs and cards; immersive session with frame viewer, keep/skip/delete, undo, numbered tags and a preloaded next video.
- **Phase 4 — Duplicates.** Groups with confidence and the recommended copy, per-group "Resolve", inline drive ranking and a full-screen A/B assisted comparison.
- **Phase 5 — Mobile.** Bottom tab bar, "More" sheet, filters and bulk actions docked at the bottom, single-row KPIs and long-press touch selection.

## Phase 6: Remaining Views — Delivered

Status: delivered in `v0.2.0`.

- [x] **To download.** Transfer panel with progress and speed in the new visual system; the queue as a compact list with states; random selection by GB in a side panel; queue actions in a bar consistent with the catalog.
- [x] **Usage map.** Folder map by size with level navigation, drive filters and a shortcut to the catalog filtered by folder.
- [x] **Audit.** Tabs for errors and the `ActionAudit` ledger with search, age/category/drive filters, pagination, repeated-error grouping and export (see Phases 3 and 7 in [ROADMAP.md](ROADMAP.md)).
- [x] **Administration.** Drive cards with physical and catalogued usage, paired Companions with tunnel status and revocation, and maintenance (retention) in its own section.
- [x] **Profile.** Separate sections for security (PIN and protected folders), local Companion (token), playback (Chromecast) and appearance and language.
- [x] **Technical debt.** Remove unused legacy styles, split `App.tsx` by view and bring the Playwright interaction tests used during the redesign into the repository.

Definition of done: every view uses the new system's components and tokens, works at 390 px without horizontal scrolling and is covered by interaction tests.

## Phase 6 Notes

- `App.tsx` went from about 7,700 lines to a state container: views live in `views/`, the shell and reusable components in `components/`, self-contained logic in `hooks/` and types and helpers in `lib/`.
- Playwright tests live in `e2e/` and run in CI against a demo catalog (`npm run seed:demo -w @videocat/server`).
- Left for a future iteration: moving catalog, review, duplicates and downloads state into their own hooks to shrink `App.tsx` further.
