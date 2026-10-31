import test from 'node:test';
import assert from 'node:assert/strict';

let definition;
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value;
    },
  },
};

await import('../client.js');

/** Minimal React shim: enough to execute one render of the pill. */
function createReact() {
  const Fragment = Symbol('Fragment');
  const slots = [];
  let index = 0;
  const React = {
    Fragment,
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children };
    },
    useState(initial) {
      const at = index++;
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
      return [slots[at], () => {}];
    },
    useRef(initial) {
      const at = index++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect() {},
    useCallback(fn) {
      return fn;
    },
    useMemo(fn) {
      return fn();
    },
  };
  React.__reset = () => {
    index = 0;
    slots.length = 0;
  };
  return React;
}

function collectText(tree, out = []) {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return out;
  if (typeof tree === 'string' || typeof tree === 'number') {
    out.push(String(tree));
    return out;
  }
  if (Array.isArray(tree)) {
    for (const child of tree) collectText(child, out);
    return out;
  }
  for (const child of tree.children ?? []) collectText(child, out);
  return out;
}

test('client module declares the account Remote and registers one dock entry', () => {
  assert.equal(definition.id, 'dsh-balance-widget');
  assert.equal(typeof definition.factory, 'function');

  const React = createReact();
  const mod = definition.factory((id) => {
    if (id === 'react') return React;
    throw new Error(`unexpected require: ${id}`);
  });

  assert.deepEqual(mod.inject, ['slots', 'remote', 'remote.account', 'locale']);

  let registration;
  const ctx = {
    effect(body) {
      return body();
    },
    locale: {
      register() {
        return () => {};
      },
      getSnapshot() {
        return { active: 'zh-CN' };
      },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'conversation.composer.dock');
        install();
      },
      register(options, component) {
        registration = { options, component };
        return () => {};
      },
    },
  };

  mod.apply(ctx);
  assert.equal(registration.options.id, 'balance-widget');
  assert.equal(registration.options.name, 'conversation.composer.dock');
  assert.equal(registration.options.order, 2);
  assert.equal(registration.options.locale, 'balance-widget');
  assert.equal(typeof registration.component, 'function');
});

test('renders the loading balance and a peak/idle status without crashing', () => {
  const React = createReact();
  const mod = definition.factory(() => React);
  let registration;
  const ctx = {
    effect: (body) => body(),
    locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh-CN' }) },
    slots: {
      inject: (name, install) => install(),
      register: (options, component) => {
        registration = { options, component };
        return () => {};
      },
    },
  };
  mod.apply(ctx);

  React.__reset();
  const tree = registration.component({ t: (key) => key });
  const text = collectText(tree).join(' ');
  assert.match(text, /loading/);
  assert.match(text, /peak|idle/);
});
