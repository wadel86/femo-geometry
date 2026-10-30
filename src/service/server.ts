// The geometry service: the kernel, server-side, behind three plain HTTP routes.
//
// The platform calls it through its `GeometryGateway` port and caches what it answers by a hash
// of the definition, so this process keeps nothing but the kernel and the builder's caches —
// restart it at will. No framework: `node:http` and JSON, the kernel being the only dependency.
//
//   GET  /health   → {"status":"UP", "revision": ..., ...}
//   POST /resolve  {definition, mode?} → ResolvedGeometry
//   POST /step     {definition, mode?} → the STEP file (model/step), or 422 with the refusals
//
// Errors are RFC 7807 problem documents, as the platform's own are.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblyBuilder } from '../assembly/buildAssembly.ts';
import {
  GEOMETRY_FORMAT_VERSION,
  RefusedError,
  resolveGeometry,
  stepOf,
  type GeometryMode,
} from '../assembly/resolve.ts';
import type { AssemblyDefinition } from '../definition.ts';
import { createBrepjsKernel } from '../kernel/brepjsKernel.ts';

const PORT = Number(process.env.GEOMETRY_PORT ?? 8095);
const HOST = process.env.GEOMETRY_HOST ?? '127.0.0.1';
/** An assembly definition is a few kilobytes; anything past this is not one. */
const MAX_BODY = 8 * 1024 * 1024;

/**
 * Changes whenever the kernel would draw the same recipe differently: a hash of its own sources
 * and of the OpenCascade build under it. The platform puts it in every cache key.
 */
async function revisionOf(): Promise<string> {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const hash = createHash('sha256');
  const files = (await readdir(join(root, 'src'), { recursive: true }))
    .filter((file) => file.endsWith('.ts'))
    .sort();
  for (const file of files) {
    hash.update(file).update(await readFile(join(root, 'src', file)));
  }
  for (const name of ['brepjs', 'occt-wasm']) {
    const manifest = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    hash.update(`${name}@${manifest.version}`);
  }
  return hash.digest('hex').slice(0, 16);
}

const started = performance.now();
const revision = await revisionOf();
const kernel = await createBrepjsKernel();
const builder = new AssemblyBuilder(kernel);
console.log(`[geometry] revision ${revision}, OpenCascade loaded in ${(performance.now() - started).toFixed(0)} ms`);

class BadRequest extends Error {}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (error instanceof BadRequest) {
      problem(response, 400, 'Bad request', error.message);
    } else if (error instanceof RefusedError) {
      problem(response, 422, 'Not ready for analysis', error.message, { refusals: error.refusals });
    } else {
      console.error('[geometry]', error);
      problem(response, 500, 'Geometry failed', error instanceof Error ? error.message : String(error));
    }
  });
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (request.method === 'GET' && path === '/health') {
    json(response, 200, { status: 'UP', kernel: 'occt-wasm', revision, formatVersion: GEOMETRY_FORMAT_VERSION });
    return;
  }
  if (request.method === 'POST' && (path === '/resolve' || path === '/step')) {
    const { definition, mode } = parse(await body(request));
    const startedAt = performance.now();
    const model = builder.build(definition);
    if (path === '/resolve') {
      json(response, 200, resolveGeometry(definition, model, kernel, { mode }));
    } else {
      const step = stepOf(definition, model, kernel, mode);
      response.writeHead(200, { 'Content-Type': 'model/step', 'Content-Length': Buffer.byteLength(step) });
      response.end(step);
    }
    console.log(`[geometry] ${path} ${mode}, ${definition.components.length} components, ${(performance.now() - startedAt).toFixed(0)} ms`);
    return;
  }
  problem(response, 404, 'Not found', `No route ${request.method} ${path}`);
}

function parse(raw: string): { definition: AssemblyDefinition; mode: GeometryMode } {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new BadRequest('The body is not JSON');
  }
  const { definition, mode = 'display' } = (payload ?? {}) as { definition?: AssemblyDefinition; mode?: string };
  if (!definition || !Array.isArray(definition.components)) {
    throw new BadRequest('Expected {"definition": {"components": [...], "placements": {...}, "reversed": [...]}}');
  }
  if (mode !== 'display' && mode !== 'analysis') {
    throw new BadRequest(`Unknown mode "${mode}": display or analysis`);
  }
  return {
    definition: { components: definition.components, placements: definition.placements ?? {}, reversed: definition.reversed ?? [] },
    mode,
  };
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new BadRequest(`The body exceeds ${MAX_BODY} bytes`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const text = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  response.end(text);
}

function problem(response: ServerResponse, status: number, title: string, detail: string, extra: object = {}): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const text = JSON.stringify({ type: 'about:blank', title, status, detail, ...extra });
  response.writeHead(status, { 'Content-Type': 'application/problem+json', 'Content-Length': Buffer.byteLength(text) });
  response.end(text);
}

server.listen(PORT, HOST, () => console.log(`[geometry] listening on http://${HOST}:${PORT}`));
