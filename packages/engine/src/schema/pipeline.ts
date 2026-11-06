import { z } from 'zod';
import type { PipelineGraph } from '../types.js';

/**
 * Zod schema for the on-disk `*.pipe.json` structure (nodes, edges, meta).
 * Module-specific checks (known types, config, ports, cycles) belong to the DAG validator.
 */
export const PipelineGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      config: z.unknown(),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string().min(1),
      sourcePort: z.string().min(1),
      target: z.string().min(1),
      targetPort: z.string().min(1),
    }),
  ),
  meta: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'must be a slug: lowercase letters, digits and hyphens'),
    name: z.string().min(1),
  }),
});

/** Compile-time guarantee that parsed graphs satisfy the public `PipelineGraph` interface. */
export const _graphSchemaMatchesGraph = (
  parsed: z.output<typeof PipelineGraphSchema>,
): PipelineGraph => parsed;
