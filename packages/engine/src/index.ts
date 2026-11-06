// Public entry point of the pure engine library. Exports are added as the engine is built.
export { ItemSchema, PipelineGraphSchema, deriveGuid } from './types.js';
export { registerModule } from './registry.js';
export type { ModuleRegistry } from './registry.js';
export { MAX_NODES, validate } from './dag/validator.js';
export type { ValidationError, ValidationResult } from './dag/validator.js';
export { topologicalSort } from './dag/sort.js';
export { ABORTED_MESSAGE, MAX_OUTPUT_ITEMS, run } from './runner/run.js';
export { serializeRss } from './serializers/rss.js';
export { serializeAtom } from './serializers/atom.js';
export { JSON_FEED_VERSION, serializeJsonFeed } from './serializers/json-feed.js';
export type {
  Clock,
  ExecutionDeps,
  FeedMeta,
  FetchResult,
  Fetcher,
  Item,
  ModuleDefinition,
  NodeResult,
  PipelineEdge,
  PipelineGraph,
  PipelineNode,
  PipelineRunResult,
} from './types.js';
