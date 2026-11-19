// Web Worker that runs the labs' Python (Pyodide) off the page's main thread, so training never freezes the UI.
// Messages in: {id, type: 'need' | 'prepare' | 'run', name, params}. Messages out: {type: 'ready'} | {type: 'failed', error} | {id, result}.
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/pyodide.mjs';  // the Pyodide PyScript 2026.7.3 uses

const HOME = '/home/pyodide';
const boot = (async () => {
  const py = await loadPyodide();
  const toml = await (await fetch('./pyodide.toml')).text();
  py.FS.writeFile(`${HOME}/pyodide.toml`, toml);
  const cfg = py.runPython(`import json, tomllib; json.dumps(tomllib.load(open('pyodide.toml', 'rb')))`);
  const { packages = [], files = {} } = JSON.parse(cfg);
  const fetched = Promise.all(Object.entries(files).map(async ([src, dest]) => {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Could not load ${src} (HTTP ${res.status})`);
    const path = `${HOME}/${dest.replace(/^\.\//, '')}`;
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
    py.FS.writeFile(path, new Uint8Array(await res.arrayBuffer()));
  }));
  await Promise.all([py.loadPackage(packages), fetched]);
  const res = await fetch('./bridge.py');
  if (!res.ok) throw new Error(`Could not load bridge.py (HTTP ${res.status})`);
  py.runPython(`import sys\nif '${HOME}' not in sys.path: sys.path.insert(0, '${HOME}')`);
  await py.runPythonAsync(await res.text());
  return py.globals;
})();

boot.then((g) => {
  postMessage({ type: 'ready' });
  g.get('prefetch')();  // the other labs' packages download in the background, after the first lab can run
}, (e) => postMessage({ type: 'failed', error: String(e?.message || e) }));

onmessage = async ({ data: { id, type, name, params } }) => {
  const g = await boot;
  const fn = { need: 'need', prepare: 'fetch_all', run: 'run' }[type];
  const result = await g.get(fn)(...(type === 'run' ? [name, params] : [name]));
  postMessage({ id, result });
};
