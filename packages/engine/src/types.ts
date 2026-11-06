import type { z } from 'zod';

// Zod schemas and deriveGuid live in schema/ and are re-exported here so shared
// types and their schemas can be imported from one place.
export { ItemSchema, deriveGuid } from './schema/item.js';
export { PipelineGraphSchema } from './schema/pipeline.js';

/** Base item model: all operators produce and consume `Item[]`. */
export interface Item {
  title: string;
  link: string;
  guid: string;
  /** ISO 8601 date-time. */
  date: string;
  content?: string | undefined;
  /** Pass-through for custom fields. */
  extra?: Record<string, unknown> | undefined;
}

/** Feed-level metadata handed to the serializers. */
export interface FeedMeta {
  title: string;
  /** Site URL the feed represents (RSS `<link>`, Atom alternate link, JSON Feed `home_page_url`). */
  link: string;
  /** URL of the feed itself. Defaults to `link` when omitted. */
  feedUrl?: string | undefined;
}

/** Fetch response handed to modules by the injected `Fetcher`. */
export interface FetchResult {
  body: string;
  status: number;
  headers: Record<string, string>;
}

/** Injected network access. The engine itself performs no I/O. */
export interface Fetcher {
  fetch(url: string): Promise<FetchResult>;
}

/** Injected time source so execution stays deterministic. */
export interface Clock {
  now(): Date;
}

/** Module definition: each operator file exports one of these as `definition`. */
export interface ModuleDefinition<
  TConfig = unknown,
  TInput = Record<string, unknown>,
  TOutput = Record<string, unknown>,
> {
  /** Matches the node `type` in `*.pipe.json`, e.g. 'filter'. */
  type: string;
  /** Palette grouping in the UI. */
  category?: 'sources' | 'operators' | 'output';
  /** Halloween label, e.g. 'Banish'. */
  themedLabel: string;
  /** Plain name shown in parentheses next to the themed label, e.g. 'Filter'. */
  plainLabel: string;
  configSchema: z.ZodType<TConfig>;
  inputPorts: string[];
  outputPorts: string[];
  /** Must be pure apart from calls through `deps`. Keys are port names. */
  execute(inputs: TInput, config: TConfig, deps: ExecutionDeps): Promise<TOutput> | TOutput;
}

/** Injected dependencies for deterministic execution. */
export interface ExecutionDeps {
  fetcher: Fetcher;
  clock: Clock;
  registry: Map<string, ModuleDefinition>;
}

export interface PipelineNode {
  id: string;
  type: string;
  config: unknown;
  position: { x: number; y: number };
}

export interface PipelineEdge {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

/** Pipeline graph as stored in `*.pipe.json`. */
export interface PipelineGraph {
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  meta: {
    /** Slug: lowercase letters, digits and hyphens. */
    id: string;
    name: string;
  };
}

/** Per-node outcome of a run. */
export interface NodeResult {
  items: Item[];
  error?: { message: string; nodeId?: string; nodeType?: string } | undefined;
}

/** Result of a pipeline run: per-node items plus the final output. */
export interface PipelineRunResult {
  success: boolean;
  nodeResults: Record<string, NodeResult>;
  outputItems: Item[];
  /** Non-fatal notices, e.g. output truncation (Req 12.3). Omitted when empty. */
  warnings?: string[] | undefined;
}
