# Module Reference

Reference for the engine modules in `packages/engine/src/modules/`. Each module exports one
`definition`; `type` matches the node `type` in `*.pipe.json`.

## fetch-feed

Summon (Fetch Feed). Fetches an RSS 2.0 or Atom 1.0 feed through the injected `Fetcher` and
emits its entries as items.

| Property     | Value                  |
| ------------ | ---------------------- |
| type         | `fetch-feed`           |
| category     | `sources`              |
| themedLabel  | `Summon (Fetch Feed)`  |
| plainLabel   | `Fetch Feed`           |
| input ports  | none                   |
| output ports | `out` (`Item[]`)       |

### Config

| Field | Type   | Description                                                                        |
| ----- | ------ | ---------------------------------------------------------------------------------- |
| `url` | string | `http:` or `https:` URL of the feed. Embedded credentials (`user:pass@`) are rejected. |

### Mapping

| Item field | RSS 2.0                                         | Atom 1.0                                |
| ---------- | ----------------------------------------------- | --------------------------------------- |
| `title`    | `title`                                         | `title` text                            |
| `link`     | `link`                                          | `link[@rel='alternate']/@href`          |
| `guid`     | `guid`, else `link`, else hash of title + date  | `id`, else `link`, else hash            |
| `date`     | `pubDate`                                       | `updated`, else `published`             |
| `content`  | `content:encoded`, else `description`           | `content`, else `summary`               |

A missing or unparseable date becomes `clock.now().toISOString()` and a warning with the item
count is logged. Fetch failures, non-2xx responses, invalid XML and documents that are neither
RSS nor Atom throw an error.

### Example

```json
{
  "id": "n1",
  "type": "fetch-feed",
  "config": { "url": "https://example.com/feed.xml" },
  "position": { "x": 0, "y": 0 }
}
```

## fetch-json

Summon (Fetch JSON). Fetches a JSON document through the injected `Fetcher`, selects candidate
items with a JSONPath and maps their fields to items.

| Property     | Value                  |
| ------------ | ---------------------- |
| type         | `fetch-json`           |
| category     | `sources`              |
| themedLabel  | `Summon (Fetch JSON)`  |
| plainLabel   | `Fetch JSON`           |
| input ports  | none                   |
| output ports | `out` (`Item[]`)       |

### Config

| Field      | Type                | Description                                                                                     |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| `url`      | string              | `http:` or `https:` URL. Embedded credentials are rejected.                                     |
| `itemsPath`| string              | JSONPath selecting the candidates, e.g. `$.results[*]`. A path that selects one array (`$.results`) uses that array's elements. |
| `fieldMap` | object, optional    | Item field (`title`, `link`, `guid`, `date`, `content`) to a JSONPath relative to each candidate. |
| `defaults` | object, optional    | Item field to a fallback string used when the mapped path matches nothing. `date` must parse.   |

### Behavior

- A missing `date` uses `defaults.date`, then `clock.now().toISOString()`. Numeric dates are epoch
  seconds (below 1e11) or milliseconds.
- `guid` comes from the mapped value, else `link`, else a hash of title and date.
- Top-level keys of the candidate that were not the direct source of a mapped field go to `extra`.
- Candidates that are not JSON objects are skipped and counted in a warning.
- An empty selection returns `[]`. Fetch failures, non-2xx responses, invalid JSON and invalid
  JSONPath expressions throw an error.

### Example

```json
{
  "id": "n2",
  "type": "fetch-json",
  "config": {
    "url": "https://api.example.com/releases",
    "itemsPath": "$[*]",
    "fieldMap": { "title": "$.name", "link": "$.html_url", "date": "$.published_at" },
    "defaults": { "title": "Untitled" }
  },
  "position": { "x": 0, "y": 120 }
}
```
