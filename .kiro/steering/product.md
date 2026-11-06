---
inclusion: always
---

# Revenant — Product Steering

## Purpose
Resurrect Yahoo Pipes as a self-hostable, file-portable visual feed-mashup tool.
A pipeline is a plain `*.pipe.json` file the user owns; the engine runs anywhere.

## Target Users
- Newsletter writers and OSINT/monitoring folks who curate RSS feeds.
- Developers who need a lightweight JSON-API → filtered-feed glue layer.
- Pipes refugees who want the old workflow back.

## Key Features (MVP)
1. Visual canvas — drag-and-drop module graph with live per-wire preview.
2. Feed sources — RSS/Atom fetch, JSON fetch with JSONPath field mapping.
3. Operators — Filter, Sort, Union, Unique, Regex, Rename, Truncate, Reverse.
4. Stable output URLs — `/h/<id>.xml|.atom|.json` (a **Haunting**) with caching.
5. Ghost Inspector — debugger pane showing items after each node in real time.
6. Portable pipes — save/load `*.pipe.json`.

## Stretch Goals
Loop module, Fetch Page (CSS scraping), String Builder, OPML import/export,
WebSub scheduler, best-effort import of archived Pipes JSON dumps, share-as-gist,
headless CLI runner.

## Halloween Naming Convention
Every themed label **must** also show its plain name in parentheses.

| Themed label | Plain name |
|---|---|
| Summon | Source / Fetch |
| Summon (Fetch Feed) | Fetch Feed |
| Summon (Fetch JSON) | Fetch JSON |
| Banish | Filter |
| Séance | Union |
| Exorcise | Dedupe (Unique) |
| Transmute | Regex / Rename |
| Haunting | Output feed URL |
| Ghost Inspector | Debugger pane |
| Raise Output | Pipe Output node |

## Non-Goals
Auth, multi-tenant hosting, a module marketplace, ML modules, bug-for-bug Pipes
clone, any external service dependency beyond fetching user-supplied URLs.
