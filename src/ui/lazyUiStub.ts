/**
 * Placeholder UI objects until lazy bundles mount real screens.
 * Any method/property access is a no-op; `.root` is a hidden div for append order.
 */

function noopChain(): unknown {
  const fn = () => undefined;
  return new Proxy(fn, {
    get: () => noopChain(),
    apply: () => undefined,
  });
}

export function lazyUiStub<T extends object>(): T {
  const root = document.createElement('div');
  root.hidden = true;
  root.dataset.lazyStub = '1';
  const bag: Record<string | symbol, unknown> = {};

  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'root') return root;
      if (prop in bag) return bag[prop];
      if (prop === 'visible') return false;
      return noopChain();
    },
    set(_t, prop, val) {
      bag[prop] = val;
      return true;
    },
  });
}
