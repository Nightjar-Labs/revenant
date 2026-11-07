# Revenant

Revenant resurrects Yahoo Pipes as a self-hostable, file-portable visual feed-mashup tool. You
wire feed sources and operators together on a canvas, and the result is served at a stable URL
(a **Haunting**) as RSS, Atom or JSON Feed.

A pipeline is a plain `*.pipe.json` file that you own. The engine that runs it is a pure
TypeScript library, so if this server disappears your pipes still work.

## Who it is for

- Newsletter writers and OSINT or monitoring users who curate RSS feeds.
- Developers who need a small JSON-API-to-filtered-feed glue layer.
- Pipes refugees who want the old workflow back.

Not in scope: authentication, multi-tenant hosting, a module marketplace, ML modules, or a
bug-for-bug Pipes clone. Run Revenant on a trusted host or behind a reverse proxy.

## Naming

Themed names always appear together with the plain name, for example **Banish (Filter)**.

| Themed label    | Plain name      |
| --------------- | --------------- |
| Summon          | Source / Fetch  |
| Banish          | Filter          |
| Séance          | Union           |
| Exorcise        | Dedupe (Unique) |
| Transmute       | Regex / Rename  |
| Haunting        | Output feed URL |
| Ghost Inspector | Debugger pane   |
| Raise Output    | Output node     |

## Installation

Requirements: Node 22 or newer and npm.

```bash
npm install
npm run build
```

`npm run build` type-checks and compiles all three packages (`tsc` for engine and server,
`tsc` plus `vite build` for web).

## Quickstart

1. Start the server and the web editor in watch mode:

   ```bash
   npm run dev
   ```

   The API and Hauntings listen on <http://localhost:3000>. The Vite editor starts on
   <http://localhost:5173> (Vite's default port; check the terminal output) and proxies `/api` and
   `/h` to the server.

2. Open the editor in a browser. The palette is on the left, the canvas in the middle, the config
   panel on the right and the Ghost Inspector (Debugger pane) at the bottom.
3. Build a first pipeline:
   - Drag **Summon (Fetch Feed)** onto the canvas and set its `url`.
   - Drag **Raise Output (Output)** onto the canvas.
   - Connect the `out` port of the source to the `items` port of the output node.
   - Click **Run Preview** (or tick **Auto-preview**). Click a node to see its items in the Ghost
     Inspector.
4. Click **Save** and enter a name. The pipeline is written to `data/pipes/<slug>.pipe.json`.
5. The toolbar now shows the **Haunting (Output feed URL)** panel with three URLs. Subscribe to
   any of them in a feed reader:

   ```
   http://localhost:3000/h/<id>.xml     # RSS 2.0
   http://localhost:3000/h/<id>.atom    # Atom 1.0
   http://localhost:3000/h/<id>.json    # JSON Feed 1.1
   ```

Server settings are read from environment variables:

| Variable              | Default                      | Purpose                                                    |
| --------------------- | ---------------------------- | ---------------------------------------------------------- |
| `PORT`                | `3000`                       | Port of the API and Haunting server.                       |
| `REVENANT_DATA_DIR`   | `<repo>/data/pipes`          | Directory holding the `*.pipe.json` files.                 |
| `REVENANT_PUBLIC_URL` | `http://localhost:<PORT>`    | Absolute URL used for links inside served feeds.           |

Set `REVENANT_PUBLIC_URL` to the address your readers use when the server is behind a proxy. It is
configuration, not taken from the request, so a forged `Host` header cannot end up in a cached feed.

The server does not serve the built web assets in this MVP. Use `npm run dev` for the editor.

## Directory structure

```
packages/
  engine/    Pure TS library: DAG validation, topological sort, runner, operators,
             Zod schemas, RSS/Atom/JSON Feed serializers. No I/O; fetching is injected.
  server/    Hono app: pipeline API, Haunting routes, SSRF-safe fetcher, cache.
  web/       React 19 + Vite + @xyflow/react editor (canvas, palette, Ghost Inspector).
data/pipes/  Runtime storage: one <slug>.pipe.json per pipeline. No database.
docs/        Module reference.
scripts/     dev.mjs, which runs the server and Vite together.
```

`web` and `server` depend on `engine`, never the other way around, and `web` talks to the server
only through the HTTP API.

## Example pipeline: Hacker News, Rust only

`data/pipes/hacker-news-rust-only.pipe.json` ships with the repository. It keeps only the Hacker
News front-page entries whose title contains "Rust", newest first.

```
Summon (Fetch Feed) -> Banish (Filter) -> Arrange (Sort) -> Raise Output (Output)
```

| Node id                | Type         | Config                                                     | What it does                                  |
| ---------------------- | ------------ | ---------------------------------------------------------- | --------------------------------------------- |
| `summon-hn`            | `fetch-feed` | `url: https://news.ycombinator.com/rss`                    | Downloads and parses the RSS feed.            |
| `banish-not-rust`      | `filter`     | `mode: all`, rule `title contains "Rust"`                  | Drops every item whose title lacks "Rust".    |
| `arrange-newest-first` | `sort`       | `field: date`, `order: desc`                               | Puts the newest items first.                  |
| `raise-output`         | `output`     | none                                                       | Marks the items that become the Haunting.     |

To try it, run `npm run dev`, click **Load** in the editor and pick "Hacker News — Rust Only". Then
open <http://localhost:3000/h/hacker-news-rust-only.xml>. The server needs outbound internet access
to reach Hacker News. The response carries an `ETag` header; send it back as `If-None-Match` to get
`304 Not Modified`.

## Module reference

Each operator is one file in `packages/engine/src/modules/`. Edges connect an output port (usually
`out`) to an input port (usually `items`). Full details, including config schemas and examples,
are in [docs/module-reference.md](docs/module-reference.md).

| Type         | Editor label                  | Input ports           | Output | Config                                                                | Description                                                              |
| ------------ | ----------------------------- | --------------------- | ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `fetch-feed` | Summon (Fetch Feed)           | none                  | `out`  | `url`                                                                 | Fetches an RSS 2.0 or Atom 1.0 feed.                                     |
| `fetch-json` | Summon (Fetch JSON)           | none                  | `out`  | `url`, `itemsPath`, `fieldMap?`, `defaults?`                          | Fetches JSON and maps JSONPath selections to items.                      |
| `filter`     | Banish (Filter)               | `items`               | `out`  | `mode` (`all`/`any`), `rules[]` (`field`, `op`, `value`, `flags?`)    | Keeps items that match the rules.                                        |
| `sort`       | Arrange (Sort)                | `items`               | `out`  | `field`, `order` (`asc`/`desc`)                                       | Stable sort; `date` compares as time, missing values go last.            |
| `union`      | Séance (Union)                | `in1`..`in4`          | `out`  | none                                                                  | Concatenates the inputs in port order, no deduplication.                 |
| `unique`     | Exorcise (Dedupe)             | `items`               | `out`  | `field` (default `guid`)                                              | Keeps the first item for each distinct value.                            |
| `regex`      | Transmute (Regex)             | `items`               | `out`  | `field`, `pattern`, `replacement`, `flags` (default `g`)              | Replaces text in one field.                                              |
| `rename`     | Transmute (Rename)            | `items`               | `out`  | `map` (old name to new name)                                          | Renames keys in `extra`; core fields are never renamed.                  |
| `truncate`   | Truncate                      | `items`               | `out`  | `limit` (integer, 0 or more)                                          | Keeps the first `limit` items.                                           |
| `reverse`    | Rewind (Reverse)              | `items`               | `out`  | none                                                                  | Reverses the item order.                                                 |
| `output`     | Raise Output (Output)         | `items`               | `out`  | none                                                                  | The single output node of a pipeline.                                    |

An item has the required fields `title`, `link`, `guid` and `date` (ISO 8601), the optional
`content`, and an `extra` object for custom fields.

Limits: a pipeline may have at most 20 nodes and exactly one `output` node, and a Haunting serves at
most 500 items (a warning is recorded when output is cut).

## API reference

All bodies are JSON. Errors have the shape `{ "error": "<message>" }`. Request bodies are limited to
1 MiB.

### Pipelines

| Method and path              | Description                                                                                                                                   | Success | Errors                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------- |
| `GET /api/health`            | Liveness check, returns `{ "ok": true }`.                                                                                                     | 200     |                                              |
| `GET /api/modules`           | Registered module types with `type`, `category`, `themedLabel`, `plainLabel`, `inputPorts`, `outputPorts` and a JSON Schema `configSchema`.    | 200     |                                              |
| `GET /api/pipes`             | List of `{ id, name }` for every saved pipeline.                                                                                              | 200     |                                              |
| `POST /api/pipes`            | Validates and saves a pipeline. The `id` is generated from `meta.name` (`-2`, `-3` ... added on collision) and returned in `meta.id`.         | 201     | 400 invalid JSON, 413 too large, 422 invalid |
| `GET /api/pipes/:id`         | Returns the pipeline JSON.                                                                                                                    | 200     | 404                                          |
| `PUT /api/pipes/:id`         | Validates and overwrites the pipeline; the URL decides the id. Drops cached Haunting output for it.                                           | 200     | 400, 404, 413, 422                           |
| `DELETE /api/pipes/:id`      | Deletes the pipeline file and its cached output.                                                                                              | 204     | 404                                          |
| `POST /api/pipes/:id/run`    | Runs a saved pipeline and returns a run result.                                                                                               | 200     | 404                                          |
| `POST /api/pipes/preview`    | Validates and runs an unsaved pipeline body without writing it to disk.                                                                       | 200     | 400, 413, 422                                |

A run result looks like this. A node failure does not fail the request; it sets `success: false`
and fills `error` for that node.

```json
{
  "success": true,
  "nodeResults": {
    "summon-hn": { "items": [] },
    "raise-output": { "items": [] }
  },
  "outputItems": [],
  "warnings": ["Output truncated from 800 to 500 items"]
}
```

`warnings` is present only when something was cut. `nodeResults` keeps the uncapped items of each
node; `outputItems` is capped at 500. Runs are aborted after 30 seconds.

Example:

```bash
curl -s http://localhost:3000/api/pipes
curl -s -X POST http://localhost:3000/api/pipes/hacker-news-rust-only/run
```

### Hauntings

`GET /h/:id.xml`, `GET /h/:id.atom` and `GET /h/:id.json` run the saved pipeline `:id` and return
RSS 2.0, Atom 1.0 or JSON Feed 1.1.

- Output is cached for 5 minutes. Concurrent requests for the same URL share one pipeline run.
- Every response has an `ETag`. A matching `If-None-Match` returns `304` with an empty body.
- Saving or deleting the pipeline through the API drops its cached output.

| Status | Meaning                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| 404    | No such pipeline, or an unknown extension.                                         |
| 422    | The file exists but fails schema or graph validation.                              |
| 502    | A source node could not fetch or parse its upstream response.                      |
| 504    | The run exceeded 30 seconds (`Pipeline execution timeout`).                        |
| 500    | Any other execution failure.                                                       |

## Security

All outbound fetches go through an SSRF-safe fetcher: only `http:` and `https:` URLs, credentials
stripped from URLs, every resolved address checked against blocked ranges (private, loopback,
link-local including the cloud metadata address, CGNAT, multicast, reserved and IPv6 transition
ranges), the validated address pinned for the connection, redirects followed manually (5 at most)
with a re-check at each hop, a 5 MB response limit and a 10 second timeout. Error messages do not
include internal addresses. Details are in [docs/module-reference.md](docs/module-reference.md).

Do not put API keys or passwords in `*.pipe.json` files; they are plain files on disk. Regex-based
operators examine at most the first 64 KB of a field value and reject invalid patterns when the
pipeline is validated.

## Testing

```bash
npm test         # vitest run: unit, property-based (fast-check), integration and e2e tests
npm run lint     # eslint + prettier --check
npm run build    # tsc + vite build for all packages
```

Vitest is configured for at most 2 workers. Unit and property tests sit next to their sources;
server integration tests are in `packages/server/src/__tests__/`.

## License

MIT. See [LICENSE](LICENSE).
