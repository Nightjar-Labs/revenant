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

## SSRF protection for fetch-feed and fetch-json

The engine never opens connections. Both source modules call the `Fetcher` that the host injects,
and the Revenant server injects `SSRFFetcher` (`packages/server/src/fetcher.ts`). It enforces:

- **Schemes**: only `http:` and `https:`; anything else fails with `Unsupported scheme`.
- **Credentials**: `user:pass@` is stripped from the URL before DNS resolution. The module config
  schemas also reject URLs that contain credentials. Do not store secrets in `*.pipe.json`.
- **Blocked addresses**: every address the hostname resolves to is checked, not only the first.
  Blocked ranges are RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), loopback, link-local (including
  the cloud metadata address `169.254.169.254`), `0.0.0.0/8`, CGNAT (`100.64/10`), multicast, IPv6
  unique-local (`fc00::/7`), reserved and documentation ranges, and the IPv6 transition ranges that
  embed IPv4 addresses (NAT64, 6to4, Teredo, IPv4-compatible). IPv4-mapped IPv6 addresses are
  matched against the IPv4 rules.
- **DNS pinning**: the validated addresses are the only ones the socket may connect to, so a second
  DNS answer cannot redirect the connection to an internal host (DNS rebinding).
- **Redirects**: followed manually, at most 5, and the new host is resolved and validated at every
  hop.
- **Limits**: responses over 5 MB fail with `Response too large`; the whole request, including
  redirects and body download, fails with `Request timeout` after 10 seconds.

A blocked request fails the node with the message `SSRF attempt detected: address is in a blocked
range`. The message does not include the address. In a Haunting, a failed source node produces an
HTTP 502 response; in the editor it shows as an error badge and in the Ghost Inspector.

## filter

Banish (Filter). Keeps the items that match a list of rules.

| Property     | Value               |
| ------------ | ------------------- |
| type         | `filter`            |
| category     | `operators`         |
| themedLabel  | `Banish`            |
| plainLabel   | `Filter`            |
| input ports  | `items`             |
| output ports | `out` (`Item[]`)    |

### Config

| Field   | Type                | Description                                                              |
| ------- | ------------------- | ------------------------------------------------------------------------ |
| `mode`  | `"all"` or `"any"`  | `all`: every rule must match. `any`: at least one rule must match.       |
| `rules` | array of rule       | Rules to evaluate.                                                       |

Rule fields:

| Field   | Type     | Description                                                                                          |
| ------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `field` | string   | `title`, `link`, `guid`, `date`, `content`, or a key in `extra`.                                     |
| `op`    | enum     | `contains`, `notContains`, `equals`, `regex`, `dateBefore`, `dateAfter`.                             |
| `value` | string   | Text to compare, a regular expression for `regex`, or a date for `dateBefore` and `dateAfter`.       |
| `flags` | string, optional | Regex flags, only for `regex`. Default `g`.                                                  |

### Behavior

- Output keeps the input order.
- A missing field is treated as an empty string. A `dateBefore` or `dateAfter` rule never matches an
  item whose field is not a parsable date.
- With no rules, `all` keeps every item and `any` keeps none.
- Text is cut to its first 64 KB before matching (ReDoS mitigation).
- Invalid regular expressions and unparsable dates are rejected when the pipeline is validated, with
  the error message and the path of the rule.

### Example

```json
{
  "id": "banish-not-rust",
  "type": "filter",
  "config": {
    "mode": "all",
    "rules": [
      { "field": "title", "op": "contains", "value": "Rust" },
      { "field": "date", "op": "dateAfter", "value": "2025-01-01T00:00:00Z" }
    ]
  },
  "position": { "x": 300, "y": 80 }
}
```

## sort

Arrange (Sort). Orders items by one field.

| Property     | Value               |
| ------------ | ------------------- |
| type         | `sort`              |
| category     | `operators`         |
| themedLabel  | `Arrange`           |
| plainLabel   | `Sort`              |
| input ports  | `items`             |
| output ports | `out` (`Item[]`)    |

### Config

| Field   | Type                | Description                                    |
| ------- | ------------------- | ---------------------------------------------- |
| `field` | string              | Field to sort by (core field or `extra` key).  |
| `order` | `"asc"` or `"desc"` | Sort direction.                                |

### Behavior

- The sort is stable: items with equal keys keep their input order, also for `desc`.
- `date` is compared as a point in time. Numbers compare numerically. Other values compare as
  strings by UTF-16 code unit, which does not depend on the locale.
- Items with a missing or unparsable value always come last, in both directions.

### Example

```json
{ "id": "n3", "type": "sort", "config": { "field": "date", "order": "desc" }, "position": { "x": 600, "y": 80 } }
```

## union

Séance (Union). Merges several item lists into one.

| Property     | Value                      |
| ------------ | -------------------------- |
| type         | `union`                    |
| category     | `operators`                |
| themedLabel  | `Séance`                   |
| plainLabel   | `Union`                    |
| input ports  | `in1`, `in2`, `in3`, `in4` |
| output ports | `out` (`Item[]`)           |

### Config

None (`{}`).

### Behavior

Concatenates the connected inputs in port order (`in1`, then `in2`, ...) and keeps the order inside
each input. Unconnected ports count as empty. There is no deduplication; add an `unique` node after
it if needed.

### Example

```json
{ "source": "feed-a", "sourcePort": "out", "target": "seance", "targetPort": "in1" }
```

## unique

Exorcise (Dedupe). Removes duplicates.

| Property     | Value               |
| ------------ | ------------------- |
| type         | `unique`            |
| category     | `operators`         |
| themedLabel  | `Exorcise`          |
| plainLabel   | `Dedupe`            |
| input ports  | `items`             |
| output ports | `out` (`Item[]`)    |

### Config

| Field   | Type   | Description                                                       |
| ------- | ------ | ----------------------------------------------------------------- |
| `field` | string | Field whose value identifies an item. Default `guid`.             |

### Behavior

Keeps the first item for each distinct value and preserves the input order. Values of different
types are distinct (the number `1` and the string `"1"`). An item that has no value for the field is
always kept.

### Example

```json
{ "id": "n4", "type": "unique", "config": { "field": "link" }, "position": { "x": 450, "y": 80 } }
```

## regex

Transmute (Regex). Rewrites the text of one field with a regular expression.

| Property     | Value                 |
| ------------ | --------------------- |
| type         | `regex`               |
| category     | `operators`           |
| themedLabel  | `Transmute (Regex)`   |
| plainLabel   | `Regex`               |
| input ports  | `items`               |
| output ports | `out` (`Item[]`)      |

### Config

| Field         | Type   | Description                                                                |
| ------------- | ------ | -------------------------------------------------------------------------- |
| `field`       | string | Core field or `extra` key to rewrite.                                      |
| `pattern`     | string | JavaScript regular expression source.                                      |
| `replacement` | string | Replacement text; `$1`, `$&` and the other `String.replace` patterns work. |
| `flags`       | string | Regex flags. Default `g`.                                                  |

### Behavior

- Applies `String.prototype.replace` to the field of every item and keeps the input order.
- Only string values are rewritten; missing and non-string values pass through unchanged.
- Only the first 64 KB of the value is matched; any remainder is kept as it is.
- An invalid pattern or flags is rejected when the pipeline is validated, with the error message.

### Example

```json
{
  "id": "n5",
  "type": "regex",
  "config": { "field": "title", "pattern": "^\\[(.*?)\\]\\s*", "replacement": "" },
  "position": { "x": 450, "y": 80 }
}
```

## rename

Transmute (Rename). Renames custom fields.

| Property     | Value                 |
| ------------ | --------------------- |
| type         | `rename`              |
| category     | `operators`           |
| themedLabel  | `Transmute (Rename)`  |
| plainLabel   | `Rename`              |
| input ports  | `items`               |
| output ports | `out` (`Item[]`)      |

### Config

| Field | Type                      | Description                                                       |
| ----- | ------------------------- | ----------------------------------------------------------------- |
| `map` | object of string to string | Old key to new key. Applies to keys in `extra` only.              |

### Behavior

- `title`, `link`, `guid`, `date` and `content` are never renamed. Mapping a key to one of those
  names is rejected when the pipeline is validated.
- All renames apply at once, so `{ "a": "b", "b": "a" }` swaps two keys.
- A renamed value wins over an existing key with the same new name.

### Example

```json
{
  "id": "n6",
  "type": "rename",
  "config": { "map": { "author_name": "author" } },
  "position": { "x": 450, "y": 80 }
}
```

## truncate

Truncate. Keeps the first items.

| Property     | Value               |
| ------------ | ------------------- |
| type         | `truncate`          |
| category     | `operators`         |
| themedLabel  | `Truncate`          |
| plainLabel   | `Truncate`          |
| input ports  | `items`             |
| output ports | `out` (`Item[]`)    |

### Config

| Field   | Type    | Description                              |
| ------- | ------- | ---------------------------------------- |
| `limit` | integer | Number of items to keep, `0` or more.    |

### Behavior

Returns the first `limit` items in input order. A limit larger than the input returns everything.
The Haunting output has its own hard cap of 500 items.

### Example

```json
{ "id": "n7", "type": "truncate", "config": { "limit": 10 }, "position": { "x": 750, "y": 80 } }
```

## reverse

Rewind (Reverse). Flips the item order.

| Property     | Value               |
| ------------ | ------------------- |
| type         | `reverse`           |
| category     | `operators`         |
| themedLabel  | `Rewind`            |
| plainLabel   | `Reverse`           |
| input ports  | `items`             |
| output ports | `out` (`Item[]`)    |

### Config

None (`{}`).

### Behavior

Returns a reversed copy of the input. Applying it twice gives the original order.

### Example

```json
{ "id": "n8", "type": "reverse", "config": {}, "position": { "x": 750, "y": 80 } }
```

## output

Raise Output (Output). The final node of a pipeline.

| Property     | Value                    |
| ------------ | ------------------------ |
| type         | `output`                 |
| category     | `output`                 |
| themedLabel  | `Raise Output`           |
| plainLabel   | `Output`                 |
| input ports  | `items`                  |
| output ports | `out` (`Item[]`)         |

### Config

None (`{}`).

### Behavior

Passes its input through unchanged. A pipeline must contain exactly one `output` node. Its items are
the pipeline's `outputItems`, which a Haunting serializes as RSS, Atom or JSON Feed. At most 500
items are served; when output is cut, a warning is added to the run result.

### Example

```json
{ "id": "raise-output", "type": "output", "config": {}, "position": { "x": 900, "y": 80 } }
```
