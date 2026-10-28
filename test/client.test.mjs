/**
 * Client tests: execute the built bundle the way the browser module loader does,
 * then drive its store and render its row with `react-dom/server`.
 *
 * The dropdown is closed on first paint, so the server render covers the row
 * chrome and the trigger; `optionsOf` covers the menu contents it would open.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);

/**
 * Stand-in for the platform module the real browser resolves from the shell's
 * frozen table: enough of `Menu` to render the anchor and, when open, rows.
 */
function FakeMenu({ open, anchor, items = [], selectedId, onSelect }) {
  if (!open) return createElement(Fragment, null, anchor);
  return createElement(
    Fragment,
    null,
    anchor,
    createElement(
      'div',
      { role: 'menu' },
      items
        .filter((item) => item.type === undefined)
        .map((item) =>
          createElement(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'menuitemradio',
              'aria-checked': item.id === selectedId,
              disabled: item.disabled === true,
              onClick: () => onSelect?.(item.id),
            },
            item.label,
          ),
        ),
    ),
  );
}

function FakeChevronDown(props) {
  return createElement('svg', { ...props, 'aria-hidden': 'true' });
}

function fakePrimitives() {
  return { Menu: FakeMenu, IconChevronDownOutlineRegular: FakeChevronDown };
}

/** Evaluate the built bundle against a fake loader and materialize its exports. */
async function loadBundle() {
  let registration;
  const window = {
    __ModuleLoader__: {
      load(definition) {
        registration = definition;
      },
    },
  };
  const code = await readFile(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  new Function('window', code)(window);
  assert.ok(
    registration,
    'the bundle never called window.__ModuleLoader__.load',
  );
  assert.equal(registration.id, 'dsh-search-switch');
  const platform = fakePrimitives();
  return registration.factory((id) =>
    id === '@deepseek-ai/dsh-client-ui-primitives' ? platform : require(id),
  );
}

/** Translation over the bundle's own dictionaries. */
function translate(copy, locale = 'zh') {
  return (key, params) => {
    const template = copy[locale][key] ?? key;
    if (params === undefined) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      String(params[name] ?? match),
    );
  };
}

/** One accepted `ProviderState`. */
function state(overrides = {}) {
  return {
    providers: [
      { id: 'deepseek-official', available: true },
      { id: 'openai-codex', available: false },
    ],
    configured: 'deepseek-official',
    mode: 'settings',
    ...overrides,
  };
}

/** A fake fetch that records calls and answers the next queued payload. */
function scriptedFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected request');
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { calls, fetchImpl };
}

test('registers exactly one General row', async () => {
  const plugin = await loadBundle();
  const rows = [];
  const ctx = {
    effect: (operation) => operation(),
    locale: {
      register: () => () => {},
      bind: () => translate(plugin.copy),
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh', locales: [], revision: 1 }),
    },
    slots: {
      inject: (_key, register) => register(),
      register: (options, component) => {
        rows.push({ options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);

  assert.deepEqual(plugin.inject, ['slots', 'locale']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].options.name, 'settings.general.item');
  assert.equal(rows[0].options.id, 'search-provider');
  assert.equal(rows[0].options.order, 18);
});

test('renders the host menu trigger instead of a native select', async () => {
  const plugin = await loadBundle();
  const { fetchImpl } = scriptedFetch([
    { status: 200, body: { ok: true, state: state() } },
  ]);
  const store = new plugin.ProvidersStore(
    { state: '/state', select: '/select' },
    fetchImpl,
  );
  await store.load();

  const html = renderToStaticMarkup(
    createElement(plugin.SearchProviderRow, {
      store,
      t: translate(plugin.copy),
    }),
  );

  assert.match(html, /网页搜索提供方/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />deepseek-official<\/span>/);
  assert.doesNotMatch(html, /<select/);
  assert.doesNotMatch(html, /profile/);
});

test('marks unavailable providers disabled and keeps an unknown current id', async () => {
  const plugin = await loadBundle();
  const t = translate(plugin.copy);

  const options = plugin.optionsOf(state(), t);
  assert.deepEqual(options, [
    { id: 'deepseek-official', label: 'deepseek-official', disabled: false },
    { id: 'openai-codex', label: 'openai-codex（不可用）', disabled: true },
  ]);

  const unknown = plugin.optionsOf(
    state({ configured: 'someone-elses-search' }),
    t,
  );
  assert.deepEqual(unknown[0], {
    id: 'someone-elses-search',
    label: 'someone-elses-search（未注册）',
    disabled: true,
  });
  assert.equal(
    plugin.selectedOf(state({ configured: undefined, env: 'openai-codex' })),
    'openai-codex',
  );
});

test('posts the chosen id and adopts the state the host returns', async () => {
  const plugin = await loadBundle();
  const { calls, fetchImpl } = scriptedFetch([
    { status: 200, body: { ok: true, state: state() } },
    {
      status: 200,
      body: { ok: true, state: state({ configured: 'openai-codex' }) },
    },
  ]);
  const store = new plugin.ProvidersStore(
    { state: '/state', select: '/select' },
    fetchImpl,
  );
  await store.load();

  await store.choose('openai-codex');

  const post = calls.at(-1);
  assert.equal(post.url, '/select');
  assert.equal(post.init.method, 'POST');
  assert.equal(JSON.parse(post.init.body).searchProvider, 'openai-codex');
  assert.equal(store.getSnapshot().state.configured, 'openai-codex');
  assert.equal(store.getSnapshot().saving, false);
});

test('keeps the previous selection and flags a refused write', async () => {
  const plugin = await loadBundle();
  const { fetchImpl } = scriptedFetch([
    { status: 200, body: { ok: true, state: state() } },
    {
      status: 409,
      body: { ok: false, error: { code: 'unknown-provider', message: 'nope' } },
    },
  ]);
  const store = new plugin.ProvidersStore(
    { state: '/state', select: '/select' },
    fetchImpl,
  );
  await store.load();

  await store.choose('ghost');

  assert.equal(store.getSnapshot().failed, true);
  assert.equal(store.getSnapshot().state.configured, 'deepseek-official');
});

test('surfaces a refused read with its message', async () => {
  const plugin = await loadBundle();
  const { fetchImpl } = scriptedFetch([
    {
      status: 500,
      body: {
        ok: false,
        error: { code: 'web-unavailable', message: 'registry is gone' },
      },
    },
  ]);
  const store = new plugin.ProvidersStore(
    { state: '/state', select: '/select' },
    fetchImpl,
  );

  await store.load();

  assert.equal(store.getSnapshot().status, 'error');
  assert.equal(store.getSnapshot().error, 'registry is gone');
});

test('marks an env fallback and an in-memory deployment in the copy', async () => {
  const plugin = await loadBundle();
  const { fetchImpl } = scriptedFetch([
    {
      status: 200,
      body: {
        ok: true,
        state: state({
          configured: undefined,
          env: 'openai-codex',
          mode: 'memory',
        }),
      },
    },
  ]);
  const store = new plugin.ProvidersStore(
    { state: '/state', select: '/select' },
    fetchImpl,
  );
  await store.load();

  const html = renderToStaticMarkup(
    createElement(plugin.SearchProviderRow, {
      store,
      t: translate(plugin.copy),
    }),
  );

  assert.match(html, /当前部署没有 settings 服务/);
  assert.match(html, />openai-codex<\/span>/);
});
