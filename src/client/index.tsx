/**
 * Client half of `dsh-search-switch`: one Settings > General row over the live
 * `ctx.web` search registry.
 *
 * The row deliberately knows no provider ids. It asks the Host's
 * `/plugins/dsh-search-switch/state` route, which enumerates the seam's private
 * registry, and posts the chosen id back to `/plugins/dsh-search-switch/select`.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';

import { type CopyKey, copy } from './copy.ts';
import { SearchProviderRow } from './row.tsx';
import { ProvidersStore } from './store.ts';
import { installStyles } from './styles.ts';

// Exported for the smoke test, which renders the row without a browser.
export { copy } from './copy.ts';
export { optionsOf, SearchProviderRow, selectedOf } from './row.tsx';
export { ProvidersStore } from './store.ts';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-search-switch': CopyKey;
  }
}

/** Locale namespace this plugin owns. */
const COPY_NS = 'dsh-search-switch';
/** Row key inside `settings.general.item`; a fresh id adds a row beside the shipped ones. */
const ROW_ID = 'search-provider';
/** Sits after `link-opening` (17) and before `composer-enter` (20). */
const ROW_ORDER = 18;

export const inject = ['slots', 'locale'];

export function apply(ctx: Context): void {
  ctx.effect(() => installStyles(), 'dsh-search-switch: styles');
  ctx.effect(
    () => ctx.locale.register(COPY_NS, copy),
    'dsh-search-switch: copy',
  );

  const t = ctx.locale.bind(COPY_NS);
  // One store per plugin instance: every mount of the row shares the loaded
  // registry instead of refetching it.
  const store = new ProvidersStore();

  ctx.effect(
    () =>
      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          { name: 'settings.general.item', id: ROW_ID, order: ROW_ORDER },
          () => <SearchProviderRow store={store} t={t} />,
        ),
      ),
    'dsh-search-switch: settings row',
  );
}
