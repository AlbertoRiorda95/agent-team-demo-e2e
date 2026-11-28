// The table prefix in force (docs/design/viewer.md > Data and API,
// docs/design/persistence.md): the history reads `<prefix>launches` and
// `<prefix>trajectory_samples`. It comes from the latest `config.store.applied`
// and is empty (store's default) until one arrives. Kept in memory only: the
// consumer reads the latest message of the subject at start-up.

/** Empty, or the format of StoreConfig.table_prefix (proto/trajectory/v1/config.proto). */
export const TABLE_PREFIX = /^(?:[a-z][a-z0-9_]{0,15})?$/;

export function isTablePrefix(value: string): boolean {
  return TABLE_PREFIX.test(value);
}

export class TablePrefix {
  #current = '';

  /** Puts the prefix in force; throws when it does not have the format (never reaches SQL). */
  set(prefix: string): void {
    if (!isTablePrefix(prefix)) throw new Error(`invalid table prefix "${prefix}"`);
    this.#current = prefix;
  }

  get current(): string {
    return this.#current;
  }
}
