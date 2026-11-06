import type {
  ModuleInfo,
  PipeSummary,
  PipelineDocument,
  PipelinePayload,
  PreviewResult,
} from './types.js';

/** Fetches the module registry from the server. Throws on a non-2xx or malformed response. */
export async function fetchModules(signal?: AbortSignal): Promise<ModuleInfo[]> {
  const response = await fetch('/api/modules', { signal });
  if (!response.ok) {
    throw new Error(`GET /api/modules failed with status ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error('GET /api/modules returned an unexpected payload');
  }
  return body as ModuleInfo[];
}

/** Largest number of validation messages shown for a rejected preview. */
const MAX_REPORTED_ERRORS = 3;

function describeFailure(status: number, body: unknown, request: string): string {
  if (typeof body === 'object' && body !== null) {
    const { error, errors } = body as { error?: unknown; errors?: unknown };
    if (Array.isArray(errors) && errors.length > 0) {
      const messages = errors
        .map((e: unknown) =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { message?: unknown }).message === 'string'
            ? (e as { message: string }).message
            : null,
        )
        .filter((m): m is string => m !== null);
      if (messages.length > 0) {
        const shown = messages.slice(0, MAX_REPORTED_ERRORS).join('; ');
        const more = messages.length - MAX_REPORTED_ERRORS;
        return more > 0 ? `${shown} (+${String(more)} more)` : shown;
      }
    }
    if (typeof error === 'string') return error;
  }
  return `${request} failed with status ${String(status)}`;
}

/**
 * Runs the unsaved pipeline through `POST /api/pipes/preview` (Req 9.7). Throws an Error with a
 * readable message on a non-2xx response (e.g. validation failure or timeout) or bad payload.
 */
export async function postPreview(
  pipeline: PipelinePayload,
  signal?: AbortSignal,
): Promise<PreviewResult> {
  const response = await fetch('/api/pipes/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(describeFailure(response.status, body, 'POST /api/pipes/preview'));
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { nodeResults?: unknown }).nodeResults !== 'object' ||
    (body as { nodeResults: unknown }).nodeResults === null
  ) {
    throw new Error('POST /api/pipes/preview returned an unexpected payload');
  }
  return body as PreviewResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPipelineDocument(value: unknown): value is PipelineDocument {
  return (
    isRecord(value) &&
    isRecord(value['meta']) &&
    typeof value['meta']['id'] === 'string' &&
    typeof value['meta']['name'] === 'string' &&
    Array.isArray(value['nodes']) &&
    Array.isArray(value['edges'])
  );
}

/** Lists saved pipelines via `GET /api/pipes` (Req 9.1). */
export async function fetchPipeList(signal?: AbortSignal): Promise<PipeSummary[]> {
  const response = await fetch('/api/pipes', { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(describeFailure(response.status, body, 'GET /api/pipes'));
  if (!Array.isArray(body)) throw new Error('GET /api/pipes returned an unexpected payload');
  return body as PipeSummary[];
}

/** Loads one saved pipeline via `GET /api/pipes/:id` (Req 9.2, 10.7). */
export async function fetchPipe(id: string, signal?: AbortSignal): Promise<PipelineDocument> {
  const request = `GET /api/pipes/${id}`;
  const response = await fetch(`/api/pipes/${encodeURIComponent(id)}`, { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(describeFailure(response.status, body, request));
  if (!isPipelineDocument(body)) throw new Error(`${request} returned an unexpected payload`);
  return body;
}

/**
 * Saves a pipeline (Req 10.6): `POST /api/pipes` when `id` is null (the server may adjust the
 * slug to keep it unique), otherwise `PUT /api/pipes/:id`. Returns the stored pipeline. Throws an
 * Error carrying the server's validation messages on a 422.
 */
export async function savePipe(
  id: string | null,
  pipeline: PipelinePayload,
  signal?: AbortSignal,
): Promise<PipelineDocument> {
  const method = id === null ? 'POST' : 'PUT';
  const path = id === null ? '/api/pipes' : `/api/pipes/${encodeURIComponent(id)}`;
  const request = `${method} ${path}`;
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(describeFailure(response.status, body, request));
  if (!isPipelineDocument(body)) throw new Error(`${request} returned an unexpected payload`);
  return body;
}
