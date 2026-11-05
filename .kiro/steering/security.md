---
inclusion: fileMatch
fileMatchPattern: ["packages/server/**/*.ts", "packages/engine/src/modules/fetch-*.ts"]
---

# Revenant — Security Steering

## SSRF Protection
Implement defenses per #[[file:.kiro/specs/revenant-mvp/requirements.md]] Requirement 7.
Use Node `net.BlockList` to reject RFC 1918, loopback, link-local, cloud metadata IPs.
Validate **every** resolved IP before connecting; pin IP to prevent DNS rebinding.
Follow redirects manually (up to 5), revalidating IP at each hop.
Enforce size cap (5 MB) and timeout (10 s) on all fetches.

## Secrets in Pipelines
Never store API keys, passwords, or tokens in `*.pipe.json` (plain files on disk).
If credentials are required for a fetch, strip them from URLs before DNS resolution.

## Regex ReDoS Mitigation
Cap field values at 64 KB before regex matching (Filter, Regex operators).
Validate patterns at pipeline validation time; reject invalid patterns with position.

## Logging Hygiene
Never log full URLs with embedded credentials or query params containing secrets.
Never echo internal IP addresses or network topology in user-facing error messages.
Per #[[file:.kiro/specs/revenant-mvp/requirements.md]] Requirement 7.3 and 12.1.
