import { type ReactElement, useEffect, useSyncExternalStore } from 'react';

import type { ProviderState } from '../shared/api.ts';
import type { Translate } from './copy.ts';
import { type MenuOption, SelectMenu } from './menu.tsx';
import type { ProvidersSnapshot, ProvidersStore } from './store.ts';
import { CLASS } from './styles.ts';

export interface SearchProviderRowProps {
  readonly store: ProvidersStore;
  readonly t: Translate;
}

/**
 * Menu options for one state: every registered provider, unavailable ones kept
 * but disabled, plus the configured id when it is no longer registered so the
 * current value never silently changes.
 */
export function optionsOf(
  state: ProviderState | undefined,
  t: Translate,
): MenuOption[] {
  const options: MenuOption[] = (state?.providers ?? []).map((provider) => ({
    id: provider.id,
    label: provider.available
      ? provider.id
      : t('providerUnavailable', { id: provider.id }),
    disabled: !provider.available,
  }));
  const current = state?.configured ?? state?.env;
  if (
    current !== undefined &&
    !options.some((option) => option.id === current)
  ) {
    options.unshift({
      id: current,
      label: t('providerUnknown', { id: current }),
      disabled: true,
    });
  }
  return options;
}

/** What the seam will actually use: the configured id, else its env fallback. */
export function selectedOf(
  state: ProviderState | undefined,
): string | undefined {
  return state?.configured ?? state?.env;
}

/**
 * One Settings > General row: the live provider registry and the current
 * selection. The row draws its own label and control because this slot passes no
 * props and projects no label — the section only stacks rows.
 */
export function SearchProviderRow({
  store,
  t,
}: SearchProviderRowProps): ReactElement {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    store.refresh();
  }, [store]);

  const state = snapshot.state;
  const options = optionsOf(state, t);
  const value = selectedOf(state);
  const registered =
    state?.providers.some((provider) => provider.id === value) ?? false;
  const display =
    value === undefined
      ? snapshot.status === 'loading'
        ? t('stateLoading')
        : t('stateAuto')
      : registered
        ? value
        : t('providerUnknown', { id: value });
  const disabled =
    snapshot.saving || snapshot.status !== 'ready' || options.length === 0;
  const hint = hintOf(snapshot, state, t);

  return (
    <div className={CLASS.row}>
      <div className={CLASS.rowText}>
        <div className={CLASS.title}>{t('title')}</div>
        <div className={CLASS.desc}>{t('description')}</div>
        {hint === undefined ? null : <div className={CLASS.desc}>{hint}</div>}
        {snapshot.failed ? (
          <div role="alert" className={CLASS.error}>
            {t('stateFailed')}
          </div>
        ) : null}
      </div>
      <SelectMenu
        options={options}
        value={value}
        display={display}
        ariaLabel={t('title')}
        disabled={disabled}
        onSelect={(id) => {
          void store.choose(id);
        }}
      />
    </div>
  );
}

/**
 * The one line under the description, present only when it says something the
 * control does not: an in-flight read or write, a degraded deployment, a
 * fallback source, or a failure. A saved selection needs no caption.
 */
function hintOf(
  snapshot: ProvidersSnapshot,
  state: ProviderState | undefined,
  t: Translate,
): string | undefined {
  if (snapshot.saving) return t('stateSaving');
  if (snapshot.status === 'loading') return t('stateLoading');
  if (state === undefined)
    return t('stateError', { message: snapshot.error ?? '' });
  if (state.mode === 'memory') return t('stateMemory');
  if (state.configured === undefined && state.env !== undefined)
    return t('stateEnv', { id: state.env });
  return undefined;
}
