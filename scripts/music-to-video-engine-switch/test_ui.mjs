import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const target = process.argv[2] || 'D:/Prog/MusicToVideo/Program';
for (const file of ['ui.html', 'designer.html']) {
  const html = readFileSync(resolve(target, file), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  for (const source of scripts) new vm.Script(source, { filename: file });
  assert.equal([...html.matchAll(/id="generationEngine"/g)].length, 1);
  assert.match(html, /value="minimax_h3" disabled/);
  const source = scripts.find(script => script.includes('mtvGenerationEngine'));
  for (const saved of ['ltx23', 'wan22', 'unknown', null]) {
    const store = new Map([['mtvGenerationEngine', saved]]);
    const events = {};
    const control = { value: 'wan22', addEventListener: (name, fn) => events[name] = fn };
    const backend = { checked: false, dispatchEvent() {} };
    vm.runInNewContext(source, {
      document: { getElementById: () => control, querySelector: () => backend },
      localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
      Event: class Event {},
    });
    assert.equal(control.value, saved === 'ltx23' ? 'ltx23' : 'wan22');
    control.value = 'ltx23';
    events.change();
    assert.equal(store.get('mtvGenerationEngine'), 'ltx23');
    assert.equal(backend.checked, true);
  }
  console.log(`${file}: JavaScript syntax, single selector, deferred H3, persisted preference and generation routing passed`);
}
