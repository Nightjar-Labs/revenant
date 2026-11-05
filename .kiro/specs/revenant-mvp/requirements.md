# Revenant MVP — Requirements

## Introduction

Revenant resurrects the Yahoo Pipes concept as a self-hostable, file-portable visual feed-mashup tool. The core value proposition is **ownership**: a pipeline is a plain `*.pipe.json` file that the user controls, executed by an open-source engine that runs anywhere (laptop, VPS, or future CLI). If the hosted service disappears, the pipes survive.

The MVP delivers a complete visual pipeline editor with live debugging, a pure execution engine with comprehensive operator coverage, stable output feed URLs ("Hauntings") with HTTP caching, and SSRF-safe external fetching. The target users are newsletter writers, OSINT researchers, and feed curators who need to merge, filter, and transform RSS/Atom/JSON sources without writing code.

This specification covers the minimum viable product only. Stretch features (Loop module, OPML import/export, CLI runner, best-effort import of archived Pipes JSON) are out of scope.

---

## Requirement 1: Pipeline Schema and Validation

**As a** pipeline author,  
**I want** the system to validate my `*.pipe.json` file structure and graph constraints at load time,  
**So that** I receive clear errors for malformed pipelines before execution and can trust that valid pipelines are executable.

### Acceptance Criteria

1.1. WHEN the system loads a `*.pipe.json` file, THEN the system SHALL validate the JSON structure against a Zod schema that defines:
   - A `nodes` array where each node has `id` (string), `type` (string), `config` (object), and `position` (x, y coordinates).
   - An `edges` array where each edge has `source` (node ID), `sourcePort` (string), `target` (node ID), and `targetPort` (string).
   - A top-level `meta` object with `name` (string) and `id` (string, slug format).

1.2. WHEN the pipeline schema validation succeeds, THEN the system SHALL perform DAG validation that:
   - Detects cycles and returns a human-readable error listing the cycle path.
   - Verifies exactly one node has `type: 'output'` and returns an error if zero or more than one output node exists.
   - Confirms all edge `sourcePort` and `targetPort` values exist in the respective node's declared port lists.
   - Rejects edges where the source port type does not match the target port type (e.g., `items[]` cannot connect to `string`).

1.3. IF a node's `type` field references an unknown module type, THEN the system SHALL return an error message "Unknown module type: <type>" and list all registered module types.

1.4. WHEN all validations pass, THEN the system SHALL return a validated `PipelineGraph` object ready for execution.

---

## Requirement 2: Deterministic Engine Execution with Error Isolation

**As a** system operator,  
**I want** the engine to execute pipeline nodes in a deterministic topological order and isolate errors to individual nodes,  
**So that** a single failing module does not crash the entire pipeline and I can debug which node caused the failure.

### Acceptance Criteria

2.1. WHEN the engine receives a validated `PipelineGraph`, THEN the system SHALL compute a topological sort of the nodes and execute them in dependency order (upstream nodes before downstream nodes).

2.2. IF a node's `execute` function throws an error or rejects a promise, THEN the system SHALL:
   - Capture the error with the node ID, node type, and error message.
   - Mark the node's outputs as `{ error: true, message: string, items: [] }`.
   - Continue executing downstream nodes that have all required inputs available from non-failed nodes.
   - Propagate the error state to any node that depends solely on the failed node's output.

2.3. WHEN execution completes, THEN the system SHALL return a `PipelineRunResult` object containing:
   - `success: boolean` (false if any node failed).
   - `nodeResults: Record<nodeId, { items: Item[], error?: { message: string } }>`.
   - `outputItems: Item[]` (the output node's items, or empty array if the output node failed).

2.4. WHEN the same pipeline is executed multiple times with identical inputs and fetch responses, THEN the system SHALL produce identical `outputItems` order and content (deterministic execution). The engine SHALL accept an injected `Clock` interface (providing `now(): Date`) and the runner SHALL accept an injected `Fetcher` interface so that all side effects are controlled and runs are reproducible.

---

## Requirement 3: Item Model

**As a** module developer,  
**I want** a typed, validated item model shared across all operators,  
**So that** I can rely on consistent field names and types when transforming items.

### Acceptance Criteria

3.1. WHEN an operator processes items, THEN each item SHALL conform to a Zod schema `ItemSchema` with:
   - Required fields: `title` (string), `link` (string), `guid` (string), `date` (ISO 8601 string).
   - Optional fields: `content` (string, may be empty), `extra` (Record<string, any>, defaults to `{}`).

3.2. WHEN source modules produce items, THEN the system SHALL validate and coerce each item to `ItemSchema` and drop items that fail validation, logging the validation error.

3.3. WHEN operators transform items, THEN the system SHALL preserve all fields not explicitly modified and maintain `extra` as a pass-through object for custom fields.

3.4. WHEN an item is created or ingested, THEN the system SHALL ensure `guid` is stable across runs: derived from the source's `guid` or `id` field if present, else from `link` if present, else from a deterministic hash of `title` and `date` so that Unique deduplication and feed reader state tracking behave consistently.

---

## Requirement 4: Fetch Feed Source (RSS/Atom)

**As a** pipeline author,  
**I want** to fetch and parse RSS 2.0 and Atom 1.0 feeds into items,  
**So that** I can ingest blog posts, podcasts, and news feeds as pipeline inputs.

### Acceptance Criteria

4.1. WHEN a `fetch-feed` node executes with `config.url` set to an HTTP(S) URL, THEN the system SHALL:
   - Use the injected SSRF-safe fetcher to retrieve the URL.
   - Parse the response body as RSS 2.0 or Atom 1.0 using `fast-xml-parser`.
   - Map feed entries to `Item[]` where:
     - RSS: `title`, `link`, `guid` (or fallback to `link`), `pubDate` → `date`, `description` or `content:encoded` → `content`.
     - Atom: `title` (text content), `link[@rel='alternate']/@href`, `id`, `updated` → `date`, `content` or `summary` → `content`.

4.2. IF the fetch fails (network error, timeout, SSRF block), THEN the system SHALL throw an error with the node ID and the underlying error message.

4.3. IF the response body is not valid XML or is missing required feed elements, THEN the system SHALL throw a parsing error.

4.4. WHEN the feed contains entries with missing optional fields (e.g., no `pubDate`), THEN the system SHALL use a fallback value from the injected `Clock` interface (e.g., `clock.now().toISOString()` for `date`) and log a warning.

---

## Requirement 5: Fetch JSON Source with JSONPath Mapping

**As a** pipeline author,  
**I want** to fetch JSON APIs and map arbitrary JSON structures to items using JSONPath,  
**So that** I can ingest data from REST APIs, Mastodon, GitHub releases, or custom JSON endpoints.

### Acceptance Criteria

5.1. WHEN a `fetch-json` node executes, THEN the system SHALL:
   - Fetch `config.url` using the SSRF-safe fetcher.
   - Parse the response body as JSON.
   - Evaluate `config.itemsPath` (a JSONPath expression, e.g., `$.results[*]`) using `jsonpath-plus` to extract an array of candidate items.

5.2. WHEN `config.fieldMap` is provided (object mapping `Item` field names to JSONPath expressions relative to each candidate item), THEN the system SHALL:
   - For each candidate item, evaluate the JSONPath for `title`, `link`, `guid`, `date`, and `content`.
   - Construct an `Item` with the mapped values, falling back to `config.defaults` (object with field → value, e.g., `{ date: '<ISO string from injected Clock>' }`) if a path returns no match.
   - Store unmapped top-level keys from the candidate item in `extra`.

5.3. IF `config.itemsPath` returns zero results, THEN the system SHALL return an empty `items` array (not an error).

5.4. IF the fetch fails or the response is not valid JSON, THEN the system SHALL throw an error.

---

## Requirement 6: Core Operators (Filter, Sort, Union, Unique, Regex, Rename, Truncate, Reverse)

**As a** pipeline author,  
**I want** a complete set of transformation operators with precise, testable semantics,  
**So that** I can filter, deduplicate, reorder, and transform items without ambiguity.

### Acceptance Criteria

6.1. **Filter** — WHEN a `filter` node executes with `config.rules` (array of `{ field, op, value }`) and `config.mode` (`'all'` or `'any'`), THEN the system SHALL:
   - Support ops: `contains`, `notContains`, `equals`, `regex`, `dateBefore`, `dateAfter`.
   - IF `mode: 'all'`, include items where every rule matches; IF `mode: 'any'`, include items where at least one rule matches.
   - For `regex` op: validate the pattern at pipeline validation time and reject with the regex error message and position if invalid; cap field values at 64 KB before matching to limit ReDoS impact; support configurable flags (default `'g'`).
   - Return items in input order (stable).

6.2. **Sort** — WHEN a `sort` node executes with `config.field` and `config.order` (`'asc'` | `'desc'`), THEN the system SHALL:
   - Sort items by the specified field (string lexicographic or date comparison).
   - Preserve input order for items with equal sort keys (stable sort).

6.3. **Union** — WHEN a `union` node executes with inputs from multiple source ports, THEN the system SHALL:
   - Concatenate all input arrays in port declaration order.
   - Preserve the order within each input.
   - Return the concatenated array with no deduplication.

6.4. **Unique** — WHEN a `unique` node executes with `config.field`, THEN the system SHALL:
   - Keep the first occurrence of each distinct value for the specified field.
   - Preserve input order (stable).
   - IF `config.field` is `'guid'`, deduplicate by `guid`; IF omitted, default to `'guid'`.

6.5. **Regex** — WHEN a `regex` node executes with `config.field`, `config.pattern`, `config.replacement`, and optional `config.flags` (default `'g'`), THEN the system SHALL:
   - Validate the pattern at pipeline validation time and reject with the regex error message and position if invalid.
   - Cap field values at 64 KB before matching to limit ReDoS impact.
   - Apply `String.replace(new RegExp(pattern, flags), replacement)` to the specified field for each item.
   - Return items in input order.

6.6. **Rename** — WHEN a `rename` node executes with `config.map` (object mapping old field names to new field names), THEN the system SHALL:
   - Rename fields in `extra` if they exist; leave `title`, `link`, `guid`, `date`, `content` unchanged unless explicitly mapped.
   - Preserve input order.

6.7. **Truncate** — WHEN a `truncate` node executes with `config.limit` (integer), THEN the system SHALL return the first `limit` items in input order.

6.8. **Reverse** — WHEN a `reverse` node executes, THEN the system SHALL return items in reversed input order.

---

## Requirement 7: SSRF-Safe Fetcher

**As a** system operator,  
**I want** all external HTTP(S) fetches to be protected against SSRF, request smuggling, and resource exhaustion,  
**So that** users cannot abuse the fetch capability to scan internal networks or cause denial-of-service.

### Acceptance Criteria

7.1. WHEN the fetcher receives a URL, THEN the system SHALL:
   - Reject schemes other than `http:` and `https:` with an error "Unsupported scheme".
   - Strip any credentials (username:password) from the URL before resolving or connecting.
   - Resolve the hostname to IP addresses using DNS.
   - Reject any IP in RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast ranges, `0.0.0.0/8`, CGNAT (`100.64.0.0/10`), IPv6 unique-local (`fc00::/7`), IPv4-mapped IPv6 addresses representing private ranges (e.g., `::ffff:192.168.1.1`), and cloud metadata endpoints (e.g., `169.254.169.254`).
   - Pin the validated IP address for the actual HTTP connection to prevent DNS rebinding (TOCTOU) attacks.
   - Follow redirects up to a configurable limit (default 5) and revalidate the resolved IP at each redirect.

7.2. WHEN fetching a URL, THEN the system SHALL enforce:
   - A response body size limit (default 5 MB) and abort the request if the limit is exceeded, returning an error "Response too large".
   - A timeout (default 10 seconds) and abort the request if it exceeds the timeout, returning an error "Request timeout".

7.3. WHEN the fetcher encounters a network error, DNS resolution failure, or SSRF block, THEN the system SHALL return a descriptive error message without exposing internal IP addresses or network topology.

---

## Requirement 8: Output Serialization and Hauntings

**As a** pipeline author,  
**I want** my pipeline's output items to be served as RSS 2.0, Atom 1.0, or JSON Feed at a stable URL with HTTP caching,  
**So that** feed readers can subscribe to the URL and the server handles conditional GET efficiently.

### Acceptance Criteria

8.1. WHEN a client requests `/h/<id>.xml`, `/h/<id>.atom`, or `/h/<id>.json`, THEN the system SHALL:
   - Load the pipeline file `data/pipes/<id>.pipe.json`.
   - Execute the pipeline with the SSRF-safe fetcher.
   - Serialize `outputItems` to the requested format:
     - **RSS 2.0**: `<rss version="2.0"><channel>` with `<item>` elements for `title`, `link`, `guid`, `pubDate`, `description`.
     - **Atom 1.0**: `<feed xmlns="http://www.w3.org/2005/Atom">` with `<entry>` elements for `title`, `link`, `id`, `updated`, `content`.
     - **JSON Feed 1.1**: JSON object with `version`, `title`, `home_page_url`, `feed_url`, and `items` array.

8.2. WHEN the pipeline execution completes, THEN the system SHALL compute an ETag (hash of the output body) and include it in the `ETag` response header.

8.3. WHEN a client sends an `If-None-Match` header matching the current ETag, THEN the system SHALL return HTTP 304 Not Modified with an empty body.

8.4. WHEN the pipeline has been executed recently (within a configurable TTL, default 5 minutes), THEN the system SHALL serve the cached output body and ETag without re-executing the pipeline.

8.5. IF the pipeline file is not found, THEN the system SHALL return HTTP 404 with a JSON error body `{ error: "Pipeline not found" }`. IF the pipeline file exists but fails schema or DAG validation, THEN the system SHALL return HTTP 422 with a JSON error body `{ error: string }` containing the validation message. IF the pipeline execution fails because a source node's fetch failed, THEN the system SHALL return HTTP 502 with a JSON error body `{ error: string }` indicating the upstream fetch error. For other execution errors, THEN the system SHALL return HTTP 500 with a JSON error body `{ error: string }`.

---

## Requirement 9: Server API for Pipeline CRUD and Preview

**As a** web editor,  
**I want** RESTful HTTP endpoints to create, read, update, delete, and preview pipelines,  
**So that** the UI can persist changes and display per-node items without re-executing the entire pipeline on every keystroke.

### Acceptance Criteria

9.1. WHEN the server receives `GET /api/pipes`, THEN the system SHALL return a JSON array of all pipeline metadata (`id`, `name`) from `data/pipes/*.pipe.json`.

9.2. WHEN the server receives `GET /api/pipes/<id>`, THEN the system SHALL return the full `*.pipe.json` content for the given ID, or HTTP 404 if not found.

9.3. WHEN the server receives `POST /api/pipes` with a JSON body containing `meta.name`, `nodes`, and `edges`, THEN the system SHALL:
   - Validate the pipeline schema and DAG constraints (Requirement 1).
   - Generate a unique slug `id` from `meta.name`.
   - Write `data/pipes/<id>.pipe.json` to disk.
   - Return the created pipeline with HTTP 201.

9.4. WHEN the server receives `PUT /api/pipes/<id>` with a JSON body, THEN the system SHALL:
   - Validate the updated pipeline.
   - Write the updated content to `data/pipes/<id>.pipe.json`.
   - Invalidate any cached Haunting output for this pipeline.
   - Return the updated pipeline with HTTP 200.

9.5. WHEN the server receives `DELETE /api/pipes/<id>`, THEN the system SHALL delete `data/pipes/<id>.pipe.json` and return HTTP 204.

9.6. WHEN the server receives `POST /api/pipes/<id>/run`, THEN the system SHALL:
   - Execute the pipeline and return `PipelineRunResult` (Requirement 2) as JSON.
   - Include `nodeResults` so the client can inspect items at each node.

9.7. WHEN the server receives `POST /api/pipes/preview` with a JSON body containing an unsaved pipeline definition, THEN the system SHALL validate, execute, and return `PipelineRunResult` without persisting the pipeline to disk.

9.8. WHEN the server receives `GET /api/modules`, THEN the system SHALL return a JSON array of all registered module types with `type`, `category`, `themedLabel`, `plainLabel`, `inputPorts`, `outputPorts`, and a JSON Schema representation of `configSchema`.

---

## Requirement 10: Visual Editor with Ghost Inspector

**As a** pipeline author,  
**I want** a drag-and-drop visual canvas with a live debugger pane showing items after each node,  
**So that** I can build and debug pipelines interactively without writing JSON by hand.

### Acceptance Criteria

10.1. WHEN the editor loads, THEN the system SHALL display:
   - A **palette** on the left listing all available module types grouped by category (Sources, Operators, Output), with themed labels and plain names in parentheses (e.g., "Summon (Fetch Feed)", "Banish (Filter)").
   - A **canvas** using `@xyflow/react` where nodes can be dragged from the palette, positioned, and connected by dragging edges between ports.
   - A **config panel** on the right showing the selected node's configuration form (URL input for Fetch Feed, rule builder for Filter, etc.).
   - A **Ghost Inspector** pane at the bottom showing the items array for the last-selected node.

10.2. WHEN a user drags a module from the palette onto the canvas, THEN the system SHALL:
   - Create a new node with a generated unique ID and default configuration.
   - Render the node with input and output ports labeled by port name.
   - Focus the node and show its config panel.

10.3. WHEN a user connects an output port to an input port, THEN the system SHALL:
   - Validate that the port types match (both `items` or both `string`, etc.).
   - IF types mismatch, reject the connection and show a tooltip "Incompatible port types".
   - Add the edge to the pipeline graph.

10.4. WHEN a user clicks a node, THEN the system SHALL:
   - Highlight the node on the canvas.
   - Show the node's config panel.
   - Update the Ghost Inspector to show `nodeResults[nodeId].items` from the last preview/run.

10.5. WHEN a user clicks "Run" (or auto-preview is enabled and the graph changes), THEN the system SHALL:
   - Call `POST /api/pipes/preview` with the current canvas state.
   - Update the Ghost Inspector with the returned `nodeResults`.
   - IF any node has an error, render an error badge on the node and show the error message in the Ghost Inspector.

10.6. WHEN a user clicks "Save", THEN the system SHALL call `PUT /api/pipes/<id>` (or `POST /api/pipes` for new pipelines) and display a success toast.

10.7. WHEN a user clicks "Load", THEN the system SHALL call `GET /api/pipes/<id>`, deserialize the JSON, and render the nodes and edges on the canvas.

10.8. WHEN the canvas displays a module node, THEN the node label SHALL show both the themed name and plain name (e.g., "Banish (Filter)").

---

## Requirement 11: Property-Based and End-to-End Testing

**As a** maintainer,  
**I want** property-based tests for operator invariants and at least one end-to-end test for a complete pipeline,  
**So that** I can refactor operators and engine logic with confidence that correctness is preserved.

### Acceptance Criteria

11.1. WHEN the test suite runs, THEN the system SHALL include property-based tests (using `fast-check`) verifying:
   - **Unique**: `unique(unique(items)) === unique(items)` (idempotent).
   - **Unique**: The output is a subsequence of the input preserving order.
   - **Sort**: `sort(items).length === items.length` (no items lost).
   - **Sort**: For any two items `a`, `b` in sorted output where `a` appears before `b`, `compare(a, b) <= 0` (correctly ordered).
   - **Sort**: Applying sort twice produces the same result (idempotent for stable inputs).
   - **Union**: `union(A, B).length === A.length + B.length` (no deduplication).
   - **Filter**: Every output item is present in the input (subset property).
   - **Reverse**: `reverse(reverse(items)) === items` (involution).

11.2. WHEN the test suite runs, THEN the system SHALL include unit tests verifying:
   - Each operator's `execute` function with sample inputs and expected outputs.
   - The DAG validator rejects cycles, multiple output nodes, and invalid port connections.

11.3. WHEN the test suite runs, THEN the system SHALL include at least one end-to-end test that:
   - Loads a fixture pipeline JSON file.
   - Executes the pipeline with a mocked fetcher returning fixture RSS and JSON responses.
   - Asserts that the output items match a snapshot.
   - Serializes the output to RSS, Atom, and JSON Feed and validates the output against the respective format schemas.

11.4. WHEN `npm test` runs, THEN every operator listed in Requirement 6 SHALL have at least one fast-check property test, and a failing property SHALL fail the test run with a shrunk counterexample.

---

## Requirement 12: Hauntings Are Safe to Operate

**As a** system operator,  
**I want** Hauntings to have resource limits and request de-duplication,  
**So that** a popular feed URL or a malicious pipeline cannot exhaust server resources or cause cascading failures.

### Acceptance Criteria

12.1. WHEN a Haunting endpoint (`/h/<id>.*`) executes a pipeline, THEN the system SHALL enforce a per-pipeline execution timeout (default 30 seconds) and abort the run if exceeded, returning HTTP 504 with a JSON error body `{ error: "Pipeline execution timeout" }`.

12.2. WHEN the system validates a pipeline, THEN the system SHALL reject pipelines with more than 20 nodes, returning a validation error "Pipeline exceeds maximum node count (20)".

12.3. WHEN a pipeline's output node produces items, THEN the system SHALL truncate the output to a maximum of 500 items before serialization, and include a warning in the feed metadata if truncation occurred.

12.4. WHEN multiple concurrent requests arrive for the same Haunting URL within a single TTL window (Requirement 8.4), THEN the system SHALL de-duplicate execution using a single-flight mechanism: the first request triggers execution, and subsequent requests wait for the same result, so that only one pipeline run occurs per TTL window regardless of request concurrency.

---

## Out of Scope

The following are explicitly excluded from the MVP and deferred to future iterations or third-party extensions:

- **Authentication and authorization**: No user accounts, API keys, or access control. Pipes are assumed to be on a trusted host or behind a reverse proxy.
- **Multi-tenancy**: No per-user pipeline isolation or quotas beyond the global per-pipeline limits in Requirement 12.
- **Loop module**: Iterative fetch-and-paginate workflows.
- **Fetch Page (CSS scraping)**: HTML-to-items extraction.
- **OPML import/export**: Feed subscription list interchange.
- **WebSub (PubSubHubbub) scheduler**: Push-based feed updates.
- **CLI runner**: Headless pipeline execution from the command line (server-only for MVP).
- **Best-effort import of archived Yahoo Pipes JSON**: Compatibility layer for historical pipes.
- **Share-as-gist**: One-click publish to GitHub Gist or Pastebin.
- **Module marketplace or plugin system**: Third-party operator distribution.
- **Machine learning modules**: Sentiment analysis, classification, or NLP operators.
