# Revenant — Yahoo Pipes, back from the dead

*Kiroween 2026 · Category: Resurrection*

## What died

Yahoo Pipes (2007) was a browser-based visual editor where you wired boxes together to remix the web's data. You dragged **source** modules (Fetch Feed, Fetch Data for JSON/CSV/XML, Fetch Page, Yahoo Query, Flickr…) onto a canvas and connected them to **operator** modules (Filter, Sort, Union, Unique, Regex, Loop, Rename, Truncate, Tail, Reverse, Split, Sub-element, Count, Location Extractor, String Builder, Web Service…), ending in a single **Pipe Output** that was published as a stable RSS/JSON URL. A live **debugger pane** under the canvas showed the items at every wire. No code, no server, free.

Yahoo announced on 4 June 2015 that Pipes would go read-only on 30 August and stop working on 30 September 2015, citing a refocus on "core Yahoo product experiences". There was no export format, no successor, and thousands of embedded feed URLs went dark. (Sources: Wikipedia "Yahoo Pipes"; Michael Tsai, "Yahoo Pipes Shuts Down"; ZKM Net Art Extinction Timeline.)

## What the modern world still lacks

| Today's option | Gap |
|---|---|
| Zapier / IFTTT | Per-item triggers, not "stream in, stream out"; one source feed per zap; no stable output feed |
| n8n / Node-RED / Logic Apps | Powerful but general-purpose and heavy; republishing a merged feed needs extra plumbing |
| Feed readers (Inoreader, Feedly) | Rules live inside a reader; output is a bundle, not a portable feed you own |
| CLI tools (FeedMeld, rss-funnel) | Config files, no visual canvas, no per-node debugging |
| pipes.digital, Mashups.io | Closest spiritual successors, but closed hosted services: same single-vendor risk that killed Pipes, and pipelines are not portable files |

Nobody ships all four of: **visual canvas + per-wire live preview + portable pipeline file + self-hostable stable output URLs.** Revenant does.

## Resurrection angle

Pipes died because the pipelines lived on someone else's server in someone else's format. Revenant makes a pipe a **plain JSON file** you own (`*.pipe.json`), executed by an open-source engine you can run on a laptop, a Raspberry Pi or a $5 VPS. If Revenant disappears, your pipes keep running with the CLI. The product is the grave-robbing of the idea; the licence and the file format are the stake through the heart of the failure mode.

## Who it is for

- Newsletter writers, researchers and OSINT / monitoring folks who live in RSS and want one curated feed ("every HN post mentioning Rust, plus these 5 blogs, deduped, no sponsored posts").
- Developers who want a tiny glue layer: JSON API → filtered/renamed feed, without writing a service.
- Nostalgic Pipes refugees.

## Halloween theme (useful first, spooky second)

Haunted-house UI: dark "crypt" canvas, modules are *Summon* (sources), *Banish* (filter), *Séance* (union), *Exorcise* (dedupe), *Transmute* (regex/rename), *Raise Output* (publish). The debugger pane is the **Ghost Inspector**. A pipe's output is a **Haunting** (a feed URL). Theme is skin-only: every module also shows its plain name ("Filter") so nothing is lost.

## MVP scope (the one spec)

1. **Engine** (pure TypeScript library, no I/O inside operators): typed item model (`title, link, guid, date, content, extra{}`), DAG validation (no cycles, one output, typed ports), deterministic execution, per-node error isolation.
2. **Sources:** Fetch Feed (RSS/Atom), Fetch JSON (JSONPath → items with field mapping).
3. **Operators:** Filter (contains / not contains / regex / date range, any|all), Sort, Union, Unique (by field), Regex (replace in field), Rename/Map fields, Truncate, Reverse.
4. **Output:** RSS 2.0, Atom and JSON Feed served at a stable `/h/<id>.xml|.atom|.json` URL with caching + conditional GET.
5. **Editor:** React Flow canvas, module palette, config side panel, Ghost Inspector showing items after each node (live preview with fetch cache), save/load `*.pipe.json`.
6. **Runtime:** one Node process serves API + editor + hauntings; file-based storage; SSRF-safe fetcher (block private ranges, size/time limits).
7. **Tests:** property-based tests for operators (Unique idempotent, Sort stable, Union count = sum, Filter ⊆ input), snapshot tests for feed serialisation, one end-to-end test.

## Stretch

- Loop module (apply a sub-pipe per item), Fetch Page (CSS selector scraping), String Builder.
- Import best-effort from archived Pipes JSON dumps (Wayback exports).
- OPML in/out; "Haunting" scheduler that pre-fetches on cron and pushes WebSub.
- CLI: `revenant run my.pipe.json > out.xml` (also the "your pipes survive us" story).
- Share a pipe as a gist-style URL / embed the canvas read-only.

## Non-goals (for the hackathon)

Auth / multi-tenant hosting, a marketplace, ML modules, a full Pipes bug-for-bug clone.

## How Kiro is used (the story for judges)

- **Steering** (`product.md`, `tech.md`, `structure.md`) pins the stack and the "pipes are plain files" principle.
- **Spec** (`.kiro/specs/revenant-mvp/`): EARS requirements → design → tasks, executed task-by-task.
- **Hooks**: tests on save; docs/module-reference refresh when a module file is created.
- **Property-based correctness** for the engine operators.
- Everything in `.kiro/` was authored by Kiro; see `KIRO-LOG.md` for the honest provenance trail.
