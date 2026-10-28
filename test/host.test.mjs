/**
 * Host-route tests: the whole surface the browser talks to, driven through the
 * real built entry with a fake Cordis context.
 *
 * The interesting part is the private coupling — these tests pin the shape the
 * plugin reads (`searchProviders`, `config.searchProvider`, `searchProviderEnv`)
 * and the two write paths (settings provider present, or the Loader's volatile
 * write channel).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, SELECT_PATH, STATE_PATH } from '../lib/index.js';

const WRITE = Symbol.for('cosmokit.volatile.write');

function provider(id, available = true) {
  return { id, available: () => available };
}

/** A WebRuntime stand-in exposing exactly the private fields the plugin reads. */
function fakeWeb({ providers, configured, env }) {
  const state = { configured };
  return {
    state,
    web: {
      config: {
        searchProvider: {
          get: () => state.configured,
          [WRITE]: (value) => {
            state.configured = value;
          },
        },
        fetchProvider: { get: () => undefined },
      },
      searchProviderEnv: env,
      fetchProviderEnv: undefined,
      searchProviders: new Map(providers.map((entry) => [entry.id, entry])),
      fetchProviders: new Map(),
    },
  };
}

/** A settings stand-in that models the Loader committing the new value. */
function fakeSettings(state) {
  return {
    calls: [],
    async update(ns, patch) {
      this.calls.push({ ns, patch });
      state.configured = patch.searchProvider;
    },
  };
}

/** Build the context, run `apply`, and return the registered routes by path. */
function mount({ web, settings }) {
  const routes = new Map();
  const server = {
    register: (route) => {
      routes.set(route.path, route);
      return () => {};
    },
  };
  const ctx = {
    effect: (operation) => operation(),
    get: (name) => {
      if (name === 'web') return web;
      if (name === 'settings') return settings;
      if (name === 'webServer') return server;
      return undefined;
    },
    webServer: server,
  };
  apply(ctx);
  return routes;
}

function response() {
  const out = { status: 0, headers: {}, body: '' };
  return {
    out,
    res: {
      writeHead(status, headers) {
        out.status = status;
        out.headers = headers;
      },
      end(text) {
        out.body = text;
      },
    },
  };
}

async function get(routes, path) {
  const { out, res } = response();
  await routes.get(path).handler({ method: 'GET', url: path }, res);
  return { ...out, json: JSON.parse(out.body) };
}

async function post(routes, path, body) {
  const { out, res } = response();
  const req = {
    method: 'POST',
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
  await routes.get(path).handler(req, res);
  return { ...out, json: JSON.parse(out.body) };
}

test('lists the registered providers with their own availability', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('deepseek-official'), provider('openai-codex', false)],
    configured: 'deepseek-official',
  });
  const routes = mount({ web, settings: fakeSettings(state) });

  const { status, json } = await get(routes, STATE_PATH);

  assert.equal(status, 200);
  assert.deepEqual(json.state.providers, [
    { id: 'deepseek-official', available: true },
    { id: 'openai-codex', available: false },
  ]);
  assert.equal(json.state.configured, 'deepseek-official');
  assert.equal(json.state.mode, 'settings');
});

test('reports the startup env fallback separately from the configured value', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('openai-codex')],
    configured: undefined,
    env: 'openai-codex',
  });
  const routes = mount({ web, settings: fakeSettings(state) });

  const { json } = await get(routes, STATE_PATH);

  assert.equal(json.state.configured, undefined);
  assert.equal(json.state.env, 'openai-codex');
});

test('persists a selection through the settings provider', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('deepseek-official'), provider('openai-codex')],
    configured: 'deepseek-official',
  });
  const settings = fakeSettings(state);
  const routes = mount({ web, settings });

  const { status, json } = await post(routes, SELECT_PATH, {
    searchProvider: 'openai-codex',
  });

  assert.equal(status, 200);
  assert.deepEqual(settings.calls, [
    { ns: 'web', patch: { searchProvider: 'openai-codex' } },
  ]);
  assert.equal(json.state.configured, 'openai-codex');
  assert.equal(json.state.mode, 'settings');
});

test('refuses an id that is not registered, without writing anything', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('deepseek-official')],
    configured: 'deepseek-official',
  });
  const settings = fakeSettings(state);
  const routes = mount({ web, settings });

  const { status, json } = await post(routes, SELECT_PATH, {
    searchProvider: 'made-up',
  });

  assert.equal(status, 409);
  assert.equal(json.error.code, 'unknown-provider');
  assert.deepEqual(settings.calls, []);
});

test('falls back to the volatile write when no settings provider is mounted', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('deepseek-official'), provider('openai-codex')],
    configured: undefined,
  });
  const routes = mount({ web });

  const { status, json } = await post(routes, SELECT_PATH, {
    searchProvider: 'openai-codex',
  });

  assert.equal(status, 200);
  assert.equal(state.configured, 'openai-codex');
  assert.equal(json.state.mode, 'memory');
});

test('rejects malformed bodies and wrong methods', async () => {
  const { web, state } = fakeWeb({
    providers: [provider('deepseek-official')],
    configured: 'deepseek-official',
  });
  const routes = mount({ web, settings: fakeSettings(state) });

  assert.equal(
    (await post(routes, SELECT_PATH, { searchProvider: '' })).status,
    400,
  );
  assert.equal((await post(routes, SELECT_PATH, { nope: true })).status, 400);
  assert.equal((await get(routes, SELECT_PATH)).status, 405);

  const selectViaGet = await get(routes, STATE_PATH);
  assert.equal(selectViaGet.status, 200);
});

test('reports web-unavailable instead of throwing when the seam changes', async () => {
  const routes = mount({ web: {}, settings: undefined });

  const { status, json } = await get(routes, STATE_PATH);

  assert.equal(status, 500);
  assert.equal(json.error.code, 'web-unavailable');
});
