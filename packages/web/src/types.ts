/** One entry of the `GET /api/modules` response (Req 9.8). */
export interface ModuleInfo {
  type: string;
  category?: 'sources' | 'operators' | 'output';
  themedLabel: string;
  plainLabel: string;
  inputPorts: string[];
  outputPorts: string[];
  configSchema: Record<string, unknown>;
}

/** A feed item as returned by the server (mirrors the engine's `Item`). */
export interface Item {
  title: string;
  link: string;
  guid: string;
  date: string;
  content?: string | undefined;
  extra?: Record<string, unknown> | undefined;
}

/** Per-node outcome of a preview run (Req 2.3). */
export interface NodeResult {
  items: Item[];
  error?: { message: string } | undefined;
}

/** Response of `POST /api/pipes/preview` (Req 9.7). */
export interface PreviewResult {
  success: boolean;
  nodeResults: Record<string, NodeResult>;
}

/** Unsaved pipeline definition sent to `POST /api/pipes/preview`. */
export interface PipelinePayload {
  meta: { id: string; name: string };
  nodes: {
    id: string;
    type: string;
    config: Record<string, unknown>;
    position: { x: number; y: number };
  }[];
  edges: { source: string; sourcePort: string; target: string; targetPort: string }[];
}

/** One entry of the `GET /api/pipes` response (Req 9.1). */
export interface PipeSummary {
  id: string;
  name: string;
}

/** A stored pipeline as returned by `GET /api/pipes/:id` and the save endpoints. */
export type PipelineDocument = PipelinePayload;
