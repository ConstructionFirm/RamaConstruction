# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**ConstructCo** is a client-side construction management single-page app. It tracks sites, workers, labour attendance, materials, and a cashbook, backed entirely by Supabase (Postgres + Auth). There is **no build step, no package manager, and no backend server** — everything runs in the browser from three static files loaded directly.

## Running / Developing

Open `index.html` in a browser, or serve the folder over any static server (needed for Supabase auth redirects to behave):

```
python -m http.server 8000      # then visit http://localhost:8000/index.html
```

There are no tests, linters, or build commands. Edits to `app.js`, `index.html`, or `style.css` take effect on browser refresh.

All third-party libraries load from CDN (declared in `<head>` of `index.html`): Supabase JS v2, Chart.js, SheetJS/xlsx (Excel export), and Lucide icons. There is nothing to `npm install`.

## Files

- **`index.html`** — the live, current markup (login screen + app shell + all modals). This is what `app.js` binds to. Loads `app.js` at the bottom.
- **`app.js`** — the entire application: auth, permissions, DB access, rendering, and a large self-contained "MOBILE UI REFRESH PATCH" IIFE near the end (starts ~line 2338) that regenerates card-style views on phones.
- **`style.css`** — all styling, theming via `data-theme` on `<body>`.
- **`index_updated.html`** — a **separate, older standalone variant** with its own inline `<script>` (does NOT load `app.js`). It is not part of the live app. Do not edit it when making changes to the main app unless explicitly asked; changes to the product go in `index.html` + `app.js`.

## Architecture

### Supabase is the single source of truth
Credentials are hardcoded at the top of `app.js` (`SUPABASE_URL`, `SUPABASE_KEY` = anon key). All persistence goes through Supabase tables. Access is centralized in four helpers — **use these rather than calling `sb.from(...)` directly** for CRUD:

- `dbGet(table)` — selects `*`, ordered by `created_at` desc, **and applies row-level site filtering** (see below).
- `dbInsert(table, obj)` — auto-stamps `user_id = currentUserId`.
- `dbUpdate(table, id, obj)` / `dbDelete(table, id)`.

Tables: `profiles`, `sites`, `workers`, `materials_master` (material catalog), `attendance`, `material_entries`, `cashbook`.

### Security model
The client-side `PERMISSIONS`/`allowedSiteIds` checks below are **UX only** — they can be bypassed with the anon key. The real enforcement is **Supabase Row Level Security**, defined in `supabase_rls.sql` (run it in the Supabase SQL editor). That script is the authoritative access model: it mirrors the permission matrix, scopes rows by site, and locks `profiles.role` so users can't self-promote. Keep it in sync when you add tables or change who-can-do-what. The `role` in `user_metadata` is cosmetic; `profiles.role` is the source of truth server-side.

### Role-based access control (two layers)
1. **Action permissions** — the `PERMISSIONS` object maps each role (`admin`, `supervisor`, `engineer`, `accountant`) to boolean capabilities (`canAddSite`, `canEditAttendance`, etc.). Gate every mutating action with `guard(action, label)` (shows a toast + returns false when denied) or check `can(action)`. `currentRole` is set at login.
2. **Row-level site filtering** — `allowedSiteIds` restricts which rows a user sees. `null` = unrestricted (admin/accountant). For supervisor/engineer, `loadAllowedSites()` computes the allowed site IDs by matching the user against `sites.supervisorid`/`sites.engineerids` (UUID match, with a legacy fallback to matching `sites.supervisor` by name text). `dbGet` then filters `sites`, `workers`, `attendance`, `material_entries`, and `cashbook` by these IDs.

`applyRoleVisibility()` hides/shows UI chrome based on role after login.

### App lifecycle
`window.onload` (~line 2327) checks for an existing Supabase session and calls `showApp(user)`, otherwise shows the login screen. `showApp` → sets `currentRole`, `loadAllowedSites`, `applyRoleVisibility`, `initDashboard`, then `renderAll`.

### Navigation & rendering
The app is a set of `.page` divs toggled by `showPage(id, el)` (desktop sidebar) / `showPageBnav(id)` (mobile bottom nav). Each page has a dedicated async render function that fetches from Supabase and rebuilds the DOM: `renderOverview`, `renderLabour`, `renderMaterials`, `renderCash`, `renderSites`, `renderWorkers` (plus `renderMatMaster`). `renderAll()` calls the relevant ones. Charts (`labChart2`, `siteChart2`, `trendChart2`) are Chart.js instances held in module-level vars and `.resize()`d after page switches.

Modals are plain hidden divs toggled by `openModal(id)` / `closeModal(id)`. A shared `editId` module var signals edit-vs-create mode across all the `save*`/`edit*` functions.

### Conventions to preserve
- Use `getToday()` for the current date — it is **IST/timezone-safe** (avoids the UTC-offset off-by-one). Do not use raw `new Date().toISOString()` for date strings.
- Past-date edits are blocked via `guardPastDate(dateStr, action)` / `isToday()`.
- User feedback goes through `toast(msg, ok)`. Currency/number formatting via `fmt()` / `fmtF()`.
- `HH:mm`-style HTML is built with template strings; escape user-supplied values (`escapeHTML` in main code, `esc` inside the mobile patch IIFE).
- Global site selector: `syncGlobalSite(sourceId)` keeps the multiple site dropdowns in sync; `populateAllDropdowns()` repopulates selects after data changes.
- Historical bug fixes are annotated inline with `BUG-XXX` comments in both `app.js` and `index.html` — keep these markers when touching that code.

### Mobile behavior
Below 600px width, the "MOBILE UI REFRESH PATCH" IIFE at the bottom of `app.js` swaps table views for card/`.mobile-alt-view` layouts. When changing a table's columns or data shape, check whether this patch also renders that data.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
