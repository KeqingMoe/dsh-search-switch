/**
 * Host half of `dsh-search-switch`.
 *
 * The switch itself is a volatile field of the profile entry named `web`, but
 * the *catalogue* is not reachable through any published API: `WebRuntime` keeps
 * its provider registry in a TypeScript-private `Map` and its selection in a
 * TypeScript-private config reference, and it deliberately exposes neither. A
 * switcher that lists what is actually registered therefore has to read those
 * fields — see {@link WebRuntimeInternals} for the exact coupling and its guard.
 *
 * The Host owns both operations so the row never hardcodes an id:
 *
 * - `GET  /plugins/dsh-search-switch/state`  → registry + current selection
 * - `POST /plugins/dsh-search-switch/select` → validate against the registry,
 *   then persist through `ctx.settings` (the profile patch), or — in a
 *   deployment without a settings provider — commit the running reference
 *   directly.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';

import {
  type ProviderEntry,
  type ProviderError,
  type ProviderResponse,
  type ProviderState,
  SELECT_PATH,
  STATE_PATH,
} from './shared/api.ts';

/** Largest accepted select body: the payload is one short provider id. */
const MAX_BODY_BYTES = 2048;

/**
 * The Loader's write channel for volatile config references
 * (`cosmokit.volatile.write`). Used only when no settings provider is mounted,
 * because otherwise the profile patch is the durable source of truth.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

/** One volatile config reference, as the seam reads it. */
interface ConfigRef<T> {
  get(): T;
}

/** One registered provider, as the seam stores it. */
interface WebProvider {
  readonly id: string;
  available(): boolean;
}

/**
 * The private `WebRuntime` surface this plugin depends on.
 *
 * `@deepseek-ai/dsh-web` publishes `registerSearchProvider`, `search`, and
 * `fetch` — no enumeration and no selection accessor — so a provider switcher
 * has no public way to do its job. These four members are the whole coupling:
 * the two registries, the selection reference, and the startup env fallback.
 * Every read is shape-checked, so a future release that renames or hides them
 * degrades to `web-unavailable` instead of crashing the settings page.
 */
interface WebRuntimeInternals {
  readonly config: {
    readonly searchProvider: ConfigRef<string | undefined>;
    readonly fetchProvider: ConfigRef<string | undefined>;
  };
  /** `DSH_WEB_SEARCH_PROVIDER`, captured once when the seam instantiated. */
  readonly searchProviderEnv: string | undefined;
  /** `DSH_WEB_FETCH_PROVIDER`, captured at the same moment. */
  readonly fetchProviderEnv: string | undefined;
  readonly searchProviders: Map<string, WebProvider>;
  readonly fetchProviders: Map<string, WebProvider>;
}

/** The settings service surface this plugin writes through. */
interface SettingsService {
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>;
}

/** One exact-path web route registration. */
interface WebServerLike {
  register(route: {
    readonly kind: 'exact';
    readonly path: string;
    readonly handler: (
      req: IncomingMessage,
      res: ServerResponse,
    ) => void | Promise<void>;
  }): () => void;
}

/** Required services: without either, the plugin has nothing to serve. */
export const inject = ['web', 'webServer'];

/** Route paths, published so tools and tests can address them without guessing. */
export { ROUTE_PREFIX, SELECT_PATH, STATE_PATH } from './shared/api.ts';

export function apply(ctx: Context): void {
  const server = webServerOf(ctx);
  if (server === undefined) return;

  ctx.effect(
    () =>
      server.register({
        kind: 'exact',
        path: STATE_PATH,
        handler: (req, res) => handleState(ctx, req, res),
      }),
    'dsh-search-switch: state route',
  );
  ctx.effect(
    () =>
      server.register({
        kind: 'exact',
        path: SELECT_PATH,
        handler: (req, res) => handleSelect(ctx, req, res),
      }),
    'dsh-search-switch: select route',
  );
}

/** Read the registered providers and the current selection. */
async function handleState(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'GET') {
    send(res, 405, failure('method-not-allowed', 'GET is required'));
    return;
  }
  const internals = internalsOf(ctx);
  if (internals === undefined) {
    send(
      res,
      500,
      failure(
        'web-unavailable',
        'ctx.web no longer exposes its provider registry',
      ),
    );
    return;
  }
  send(res, 200, {
    ok: true,
    state: stateOf(internals, settingsOf(ctx) !== undefined),
  });
}

/** Apply one selection after checking it against the live registry. */
async function handleSelect(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    send(res, 405, failure('method-not-allowed', 'POST is required'));
    return;
  }
  const internals = internalsOf(ctx);
  if (internals === undefined) {
    send(
      res,
      500,
      failure(
        'web-unavailable',
        'ctx.web no longer exposes its provider registry',
      ),
    );
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    send(res, 400, failure('invalid-body', messageOf(error)));
    return;
  }

  const id =
    isRecord(body) && typeof body.searchProvider === 'string'
      ? body.searchProvider
      : undefined;
  if (id === undefined || id.length === 0) {
    send(
      res,
      400,
      failure('invalid-provider', 'searchProvider must be a non-empty string'),
    );
    return;
  }
  if (!internals.searchProviders.has(id)) {
    send(
      res,
      409,
      failure(
        'unknown-provider',
        `"${id}" is not a registered search provider`,
      ),
    );
    return;
  }

  const persist = settingsOf(ctx) !== undefined;
  try {
    if (persist) {
      // The profile patch is the documented editing surface; the Loader commits
      // the new value into the running reference before this resolves.
      await (settingsOf(ctx) as SettingsService).update('web', {
        searchProvider: id,
      });
    } else {
      writeVolatile(internals.config.searchProvider, id);
    }
  } catch (error) {
    send(res, 500, failure('select-failed', messageOf(error)));
    return;
  }

  send(res, 200, { ok: true, state: stateOf(internals, persist) });
}

/** Project the live runtime state into the wire shape. */
function stateOf(
  internals: WebRuntimeInternals,
  persist: boolean,
): ProviderState {
  const state: {
    providers: ProviderEntry[];
    configured?: string;
    env?: string;
    mode: 'settings' | 'memory';
  } = {
    providers: [...internals.searchProviders.values()]
      .map((provider) => ({
        id: provider.id,
        available: isAvailable(provider),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    mode: persist ? 'settings' : 'memory',
  };

  const configured = internals.config.searchProvider.get();
  if (typeof configured === 'string' && configured.length > 0)
    state.configured = configured;

  const env = internals.searchProviderEnv;
  if (typeof env === 'string' && env.length > 0) state.env = env;

  return state;
}

/** Resolve the private registry surface, or undefined when the seam changed. */
function internalsOf(ctx: Context): WebRuntimeInternals | undefined {
  const web = get(ctx, 'web');
  if (typeof web !== 'object' || web === null) return undefined;

  const candidate = web as Partial<WebRuntimeInternals>;
  if (!(candidate.searchProviders instanceof Map)) return undefined;
  if (typeof candidate.config !== 'object' || candidate.config === null)
    return undefined;
  if (typeof candidate.config.searchProvider?.get !== 'function')
    return undefined;

  return candidate as WebRuntimeInternals;
}

/** The mounted settings service, when the deployment has one. */
function settingsOf(ctx: Context): SettingsService | undefined {
  const service = get(ctx, 'settings');
  if (typeof service !== 'object' || service === null) return undefined;
  return typeof (service as SettingsService).update === 'function'
    ? (service as SettingsService)
    : undefined;
}

/** The mounted web server, when the deployment has one. */
function webServerOf(ctx: Context): WebServerLike | undefined {
  const service = get(ctx, 'webServer');
  if (typeof service !== 'object' || service === null) return undefined;
  return typeof (service as WebServerLike).register === 'function'
    ? (service as WebServerLike)
    : undefined;
}

/**
 * Commit one value into a volatile reference without the Loader.
 *
 * Only reached when no settings provider exists, where nothing else could apply
 * the choice. The value is a primitive, so it needs no snapshotting.
 */
function writeVolatile(ref: ConfigRef<unknown>, value: unknown): void {
  const writer = (
    ref as unknown as Record<symbol, ((next: unknown) => void) | undefined>
  )[VOLATILE_WRITE];
  if (typeof writer !== 'function')
    throw new Error('the web selection reference is not writable');
  writer(value);
}

/** A provider's own usability check never gets to fail the whole listing. */
function isAvailable(provider: WebProvider): boolean {
  try {
    return provider.available() === true;
  } catch {
    return false;
  }
}

/** Read one small JSON request body. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('request body is empty');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Write one JSON response; the route owns the full response lifecycle. */
function send(
  res: ServerResponse,
  status: number,
  body: ProviderResponse,
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/** Build the failure envelope once, so every route reports the same shape. */
function failure(
  code: ProviderError['code'],
  message: string,
): ProviderResponse {
  return { ok: false, error: { code, message } };
}

/** Read one service without depending on its type augmentation. */
function get(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(service: string): unknown }).get(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
