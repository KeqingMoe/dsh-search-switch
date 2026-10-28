/**
 * Snapshot store over the Host's provider routes.
 *
 * The row renders from this store instead of fetching in the component, so one
 * refresh serves every mount and the request/response rules are testable without
 * a DOM.
 */
import {
  type ProviderResponse,
  type ProviderState,
  SELECT_PATH,
  STATE_PATH,
} from '../shared/api.ts';

/** Injected fetch, so tests can answer without a network. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** One immutable view of the store. */
export interface ProvidersSnapshot {
  readonly status: 'loading' | 'ready' | 'error';
  /** Host state, present once a response was accepted. */
  readonly state?: ProviderState;
  /** Failure text for the `error` status. */
  readonly error?: string;
  /** A selection is in flight. */
  readonly saving: boolean;
  /** The host refused the last selection. */
  readonly failed: boolean;
}

/** Where the two routes live; overridable so tests need no server. */
export interface ProvidersEndpoints {
  readonly state: string;
  readonly select: string;
}

const DEFAULT_ENDPOINTS: ProvidersEndpoints = {
  state: STATE_PATH,
  select: SELECT_PATH,
};

/** One shared, subscribable provider snapshot. */
export class ProvidersStore {
  private snapshot: ProvidersSnapshot = {
    status: 'loading',
    saving: false,
    failed: false,
  };
  private readonly listeners = new Set<() => void>();
  /** Bumped per request: a stale answer never overwrites a newer one. */
  private generation = 0;

  constructor(
    private readonly endpoints: ProvidersEndpoints = DEFAULT_ENDPOINTS,
    private readonly request: FetchLike = (input, init) => fetch(input, init),
  ) {}

  /** @returns the current immutable snapshot. */
  getSnapshot = (): ProvidersSnapshot => this.snapshot;

  /** @param listener - invoked after each snapshot replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Reload the registry and selection; safe to call on every mount. */
  refresh = (): void => {
    void this.load();
  };

  /** Read the Host's current view. */
  async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const response = await this.request(this.endpoints.state, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const payload = (await response.json()) as ProviderResponse;
      if (generation !== this.generation) return;
      if (!response.ok || payload.ok !== true) {
        this.publish({
          status: 'error',
          error: refusal(payload, response.status),
          saving: false,
          failed: false,
        });
        return;
      }
      this.publish({
        status: 'ready',
        state: payload.state,
        saving: false,
        failed: false,
      });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({
        status: 'error',
        error: messageOf(error),
        saving: false,
        failed: false,
      });
    }
  }

  /** Apply one provider id through the Host. */
  async choose(id: string): Promise<void> {
    this.generation += 1;
    this.publish({ ...this.snapshot, saving: true, failed: false });
    try {
      const response = await this.request(this.endpoints.select, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ searchProvider: id }),
      });
      const payload = (await response.json()) as ProviderResponse;
      if (!response.ok || payload.ok !== true) {
        this.publish({ ...this.snapshot, saving: false, failed: true });
        return;
      }
      this.publish({
        status: 'ready',
        state: payload.state,
        saving: false,
        failed: false,
      });
    } catch {
      this.publish({ ...this.snapshot, saving: false, failed: true });
    }
  }

  private publish(next: ProvidersSnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

function refusal(payload: ProviderResponse, status: number): string {
  return payload.ok ? `HTTP ${status}` : payload.error.message;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
