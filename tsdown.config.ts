/**
 * Two artifacts, one package — the layout the Harness itself uses in
 * `packages/client/tsdown.client.ts` and that community plugins (dsh-codex,
 * dsh-better-sidebar) reproduce:
 *
 * - `lib/index.js` — the Host half: ESM for node, run by the Cordis Loader.
 * - `lib/client.js` — the browser half: CJS for the browser, wrapped in the
 *   `window.__ModuleLoader__.load({ id, factory })` registration the Web client
 *   expects. `require` inside that factory resolves against the frozen platform
 *   module table, so every Harness/React request stays external.
 *
 * The banner/intro/footer trio is load-bearing, not cosmetic: it turns the CJS
 * chunk into the closure factory. Change it and the bundle silently never
 * reaches the boot graph.
 */
import type { UserConfig } from 'tsdown';

/** Module id stamped into the registration; it must equal the package name. */
const PLUGIN_ID = 'dsh-search-switch';

/** Rows the browser resolves through the platform table instead of bundling. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  // Baseline platform module: the Web shell's frozen module table owns it, so the
  // bundle keeps a require() and the settings controls come from the host itself.
  '@deepseek-ai/dsh-client-ui-primitives',
] as const;

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: false,
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[];
