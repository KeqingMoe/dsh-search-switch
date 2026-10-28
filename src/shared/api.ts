/**
 * Wire contract shared by the Host routes and the Client row.
 *
 * Both halves bundle this module independently (tsdown inlines it twice), so the
 * paths and the payload shapes cannot drift.
 */

/** Mount point of this plugin's routes on the Harness web server. */
export const ROUTE_PREFIX = '/plugins/dsh-search-switch';
/** `GET` — registered providers plus the current selection. */
export const STATE_PATH = `${ROUTE_PREFIX}/state`;
/** `POST` — apply one selection. */
export const SELECT_PATH = `${ROUTE_PREFIX}/select`;

/** One backend registered on the `ctx.web` search seam. */
export interface ProviderEntry {
  readonly id: string;
  /** The provider's own cheap local usability check. */
  readonly available: boolean;
}

/** Everything the row needs to render one snapshot. */
export interface ProviderState {
  /** Registered providers, sorted by id. */
  readonly providers: readonly ProviderEntry[];
  /** Value of the `web` entry's `searchProvider`, when one is configured. */
  readonly configured?: string;
  /**
   * `DSH_WEB_SEARCH_PROVIDER` as the running seam captured it at construction.
   * The seam falls back to it only while `searchProvider` is unset.
   */
  readonly env?: string;
  /** How the next selection is applied. */
  readonly mode: 'settings' | 'memory';
}

/** Machine-routable failure codes the Host returns. */
export type ProviderErrorCode =
  | 'invalid-body'
  | 'invalid-provider'
  | 'method-not-allowed'
  | 'select-failed'
  | 'unknown-provider'
  | 'web-unavailable';

export interface ProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
}

/** Response envelope of both routes. */
export type ProviderResponse =
  | { readonly ok: true; readonly state: ProviderState }
  | { readonly ok: false; readonly error: ProviderError };
