import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validate } from '@revenant/engine';
import type { ModuleRegistry, PipelineGraph, ValidationError } from '@revenant/engine';

const PIPE_SUFFIX = '.pipe.json';
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Thrown when a pipeline fails schema/DAG validation on load or save. */
export class PipelineValidationError extends Error {
  constructor(
    message: string,
    readonly errors: ValidationError[],
  ) {
    super(message);
    this.name = 'PipelineValidationError';
  }
}

export interface PipeSummary {
  id: string;
  name: string;
}

export interface PipeStorage {
  loadPipe(id: string): Promise<PipelineGraph | null>;
  savePipe(graph: PipelineGraph): Promise<void>;
  listPipes(): Promise<PipeSummary[]>;
  deletePipe(id: string): Promise<boolean>;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/** Ids become file names, so anything but a slug is rejected (blocks path traversal). */
function isSlug(id: string): boolean {
  return SLUG_PATTERN.test(id);
}

function describe(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.path && e.path.length > 0 ? `${e.path.join('.')}: ${e.message}` : e.message))
    .join('; ');
}

/**
 * File-based pipeline storage under `dir` (default layout: `data/pipes/<id>.pipe.json`).
 * Pipelines are validated with the engine validator on load and on save.
 */
export function createPipeStorage(dir: string, registry: ModuleRegistry): PipeStorage {
  const fileFor = (id: string) => path.join(dir, `${id}${PIPE_SUFFIX}`);

  /** Returns the validated graph, or null if the file does not exist. */
  async function readGraph(id: string): Promise<PipelineGraph | null> {
    let text: string;
    try {
      text = await readFile(fileFor(id), 'utf8');
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PipelineValidationError(`Pipeline "${id}" is not valid JSON`, [
        { message: 'Invalid JSON' },
      ]);
    }
    const result = validate(json, registry);
    if (!result.success) {
      throw new PipelineValidationError(
        `Pipeline "${id}" is invalid: ${describe(result.errors)}`,
        result.errors,
      );
    }
    return result.graph;
  }

  return {
    async loadPipe(id) {
      if (!isSlug(id)) return null;
      return readGraph(id);
    },

    async savePipe(graph) {
      const result = validate(graph, registry);
      if (!result.success) {
        throw new PipelineValidationError(
          `Pipeline is invalid: ${describe(result.errors)}`,
          result.errors,
        );
      }
      const { id } = result.graph.meta;
      await mkdir(dir, { recursive: true });
      // Write to a temp file then rename so readers never observe a partial file.
      const target = fileFor(id);
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(result.graph, null, 2)}\n`, 'utf8');
        await rename(temp, target);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
    },

    async listPipes() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      const summaries: PipeSummary[] = [];
      for (const name of names.sort()) {
        if (!name.endsWith(PIPE_SUFFIX)) continue;
        const fileId = name.slice(0, -PIPE_SUFFIX.length);
        if (!isSlug(fileId)) continue;
        try {
          const meta = (
            JSON.parse(await readFile(path.join(dir, name), 'utf8')) as {
              meta?: { name?: unknown };
            }
          ).meta;
          if (typeof meta?.name === 'string') {
            summaries.push({ id: fileId, name: meta.name });
          }
        } catch {
          // Unreadable or malformed files are skipped so one bad file cannot break the listing.
        }
      }
      return summaries;
    },

    async deletePipe(id) {
      if (!isSlug(id)) return false;
      try {
        await rm(fileFor(id));
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
  };
}
