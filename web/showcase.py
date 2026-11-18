"""Browser-side runner for the GitHub Pages showcase.

Every lab is run from its own, unchanged source files: main.py is executed as
`__main__`, and its sibling modules are imported normally from the lab folder.
To make that work in Pyodide:

- matplotlib.pyplot and seaborn are replaced by a recorder. Each `plt.plot`,
  `plt.hist`, `Series.plot` and `plt.show()` becomes a figure description that the
  page draws as an SVG chart, in the order the lab produced them. Printed text is
  captured the same way.
- The page's inputs replace the lab's constants (ARRAY_SIZE, `abnormal_percentage`,
  `n_estimators=...`) in the parsed source tree before it's compiled.
  Each runner below maps its inputs to the exact assignment or keyword they replace.
- TensorFlow isn't available in the browser, so `tensorflow` is a small stand-in
  whose `keras.Sequential` of Dense layers trains scikit-learn's MLPRegressor with
  the same layer sizes, activation, optimiser (Adam), learning rate, batch size
  and epochs.
- Pyodide has no threads: 2-lab's ThreadPoolExecutor runs the same jobs one by one.
- numpy 2 and pandas 3 dropped `np.bool8` and positional `series[int]` on a
  labelled index, which the labs use (they pinned numpy 1.24 / pandas 2.0); both
  are restored.

Datasets: labs 5 and 6 read their CSV from the path they'd cache the download at,
so the build-time extracts (build_data.py) are written there first. The Excel
inputs of labs 4, 7 and 8 aren't in the repo (git-ignored), so datagen.py
writes clearly labelled synthetic workbooks with the same layout.
"""
import ast
import contextlib
import importlib.abc
import importlib.machinery
import importlib.util
import io
import math
import os
import random
import sys
import time
import traceback
import types
import warnings
from concurrent.futures import Future

import numpy as np
import pandas as pd

import datagen

ROOT = os.path.abspath('labs')
POINT_LIMIT = 2400  # line series longer than this are thinned (min/max per bucket) for drawing

# ----------------------------------------------------------- compatibility --
if not hasattr(np, 'bool8'):
  np.bool8 = np.bool_  # removed in numpy 2.0; 8-lab/data_predictions.py uses it

_series_getitem = pd.Series.__getitem__


def _getitem_pandas2(self, key):
  # pandas < 3 fell back to position for `series[int]` when the index has labels
  # (8-lab/datasamples/utils.py reads `sample_max[j]`)
  if isinstance(key, (int, np.integer)) and not isinstance(key, bool) and self.index.dtype.kind not in 'iuf':
    try:
      return _series_getitem(self, key)
    except KeyError:
      return self.iloc[int(key)]
  return _series_getitem(self, key)


pd.Series.__getitem__ = _getitem_pandas2
sys.dont_write_bytecode = True


# ---------------------------------------------------------------- recorder --
class Recorder:
  def __init__(self): self.reset()

  def reset(self):
    self.events = []       # [{'type': 'text'|'figure', ...}] in the order the lab produced them
    self.text = []
    self.fig = None
    self.metrics = []      # every calc_metrics call: label + (median, variance, dispersion)
    self.spies = {}        # captured calls of selected lab functions
    self.tail = ''

  # text
  def write(self, s):
    self.text.append(s)
    self.tail = (self.tail + s)[-2000:]

  @property
  def last_line(self):
    lines = [ln.strip() for ln in self.tail.split('\n') if ln.strip()]
    return lines[-1] if lines else ''

  def flush_text(self):
    t = ''.join(self.text)
    self.text = []
    if t.strip():
      if self.events and self.events[-1]['type'] == 'text': self.events[-1]['text'] += t
      else: self.events.append(dict(type='text', text=t))

  # figures
  def current(self):
    if self.fig is None: self.fig = dict(title='', xlabel='', ylabel='', items=[], legend=False)
    return self.fig

  def show(self):
    if self.fig and self.fig['items']:
      self.flush_text()
      self.events.append(dict(type='figure', **self.fig))
    self.fig = None

  def finish(self):
    self.show()
    self.flush_text()


REC = Recorder()


class Out(io.TextIOBase):
  def write(self, s):
    REC.write(s)
    return len(s)


def num(v):
  v = float(v)
  return float(f'{v:.7g}') if math.isfinite(v) else None


def nums(a): return [num(v) for v in np.asarray(a, dtype=float).ravel().tolist()]


def as_x(x):
  """x values as (kind, list): 'date' (ms since epoch), 'num' or 'cat'."""
  if isinstance(x, (pd.DatetimeIndex, pd.Series)) and x.dtype.kind == 'M' or isinstance(x, np.ndarray) and x.dtype.kind == 'M':
    return 'date', pd.DatetimeIndex(x).as_unit('ms').asi8.astype(float).tolist()
  a = np.asarray(x)
  if a.dtype.kind == 'O' and len(a) and isinstance(a.flat[0], (pd.Timestamp, np.datetime64)):
    return 'date', pd.DatetimeIndex(pd.to_datetime(a)).as_unit('ms').asi8.astype(float).tolist()
  if a.dtype.kind in 'iufb': return 'num', nums(a)
  return 'cat', [str(v) for v in a.tolist()]


def thin(x, y):
  """Keep at most ~POINT_LIMIT points, preserving each bucket's min and max."""
  n = len(y)
  if n <= POINT_LIMIT: return x, y
  yy = np.array([np.nan if v is None else v for v in y])
  edges = np.linspace(0, n, POINT_LIMIT // 2 + 1).astype(int)
  keep = []
  for a, b in zip(edges[:-1], edges[1:]):
    seg = yy[a:b]
    if np.all(np.isnan(seg)): keep.append(a); continue
    i, j = a + int(np.nanargmin(seg)), a + int(np.nanargmax(seg))
    keep.extend(sorted({i, j}))
  return [x[i] for i in keep], [y[i] for i in keep]


def index_of(y):
  # matplotlib plots a pandas Series against its index (matplotlib.cbook.index_of)
  if hasattr(y, 'index') and hasattr(y, 'to_numpy') and not isinstance(y, np.ndarray):
    return y.index, y.to_numpy()
  y = np.asarray(y)
  return np.arange(len(y)), y


def add_line(x, y, label=None, color=None):
  kind, xs = as_x(x)
  ys = nums(y)
  if kind != 'cat': xs, ys = thin(xs, ys)
  REC.current()['items'].append(dict(kind='line', label=label, color=color, xtype=kind, x=xs, y=ys, n=len(np.asarray(y).ravel())))


def add_hist(values, bins=10, label=None, color=None):
  v = np.asarray(values, dtype=float).ravel()
  v = v[np.isfinite(v)]
  counts, edges = np.histogram(v, bins=bins)
  REC.current()['items'].append(dict(kind='hist', label=label, color=color, edges=nums(edges), counts=[int(c) for c in counts]))


def add_bars(cats, values, horizontal=False, label=None, color=None):
  REC.current()['items'].append(dict(kind='barh' if horizontal else 'bar', label=label, color=color,
                                     cats=[str(c) for c in cats], values=nums(values)))


# A stand-in for matplotlib.pyplot that records figures instead of drawing them.
plt = types.ModuleType('matplotlib.pyplot')


def _plot(*args, label=None, color=None, **_):
  args = [a for a in args if not isinstance(a, str)]  # drop format strings
  if len(args) == 1: x, y = index_of(args[0])
  else: x, y = args[0], args[1]
  add_line(x, y, label, color)


def _hist(x, bins=10, label=None, color=None, facecolor=None, **_):
  add_hist(x, bins, label, color or facecolor)


def _set(key):
  def f(value='', *_, **__): REC.current()[key] = str(value)
  return f


def _legend(*_, **__): REC.current()['legend'] = True


plt.plot, plt.hist = _plot, _hist
plt.title, plt.xlabel, plt.ylabel = _set('title'), _set('xlabel'), _set('ylabel')
plt.legend, plt.show = _legend, REC.show
def _noop(name):
  if name.startswith('__'): raise AttributeError(name)
  return lambda *a, **k: None


plt.__getattr__ = _noop  # xticks, figure, grid, ...

mpl = types.ModuleType('matplotlib')
mpl.__path__ = []  # a package, so `import matplotlib.pyplot` resolves
mpl.pyplot = plt
mpl.use = lambda *a, **k: None
seaborn = types.ModuleType('seaborn')
seaborn.set = lambda *a, **k: None

# pandas' `.plot()` goes through a plotting backend; this one records into the same figure
backend = types.ModuleType('showcase_plot_backend')


def _pandas_plot(data, kind='line', title=None, color=None, **_):
  frame = data.to_frame() if isinstance(data, pd.Series) else data
  for col in frame.columns:
    s = frame[col]
    label = None if isinstance(data, pd.Series) else str(col)
    if kind in ('bar', 'barh'): add_bars(s.index, s.to_numpy(), kind == 'barh', label, color)
    else: add_line(s.index, s.to_numpy(), label, color)
  if title: REC.current()['title'] = str(title)
  if isinstance(data, pd.DataFrame) and len(frame.columns) > 0: REC.current()['legend'] = True


backend.plot = _pandas_plot

requests = types.ModuleType('requests')


def _no_network(url, *a, **k):
  raise RuntimeError(f'downloads are disabled in the showcase (the data is bundled): {url}')


requests.get = _no_network


# --------------------------------------------------- TensorFlow stand-in --
class Dense:
  def __init__(self, units, activation=None, input_shape=None, **_):
    self.units, self.activation, self.input_shape = int(units), activation, input_shape


class Adam:
  def __init__(self, learning_rate=1e-3, **_): self.learning_rate = float(learning_rate)


class History:
  def __init__(self): self.history = dict(loss=[], val_loss=[])


class Sequential:
  """keras.Sequential([Dense(...), ..., Dense(1)]) trained by sklearn's MLPRegressor."""

  def __init__(self, layers):
    self.layers = list(layers)
    self.learning_rate = 1e-3
    self.net = None

  def compile(self, optimizer='adam', loss='mse', **_):
    if isinstance(optimizer, Adam): self.learning_rate = optimizer.learning_rate

  def _make(self, batch_size):
    from sklearn.neural_network import MLPRegressor
    hidden = self.layers[:-1]
    activation = (hidden[0].activation if hidden else None) or 'identity'
    return MLPRegressor(hidden_layer_sizes=tuple(l.units for l in hidden), activation=activation,
                        solver='adam', alpha=0.0, batch_size=batch_size, learning_rate_init=self.learning_rate,
                        max_iter=1, shuffle=True)

  def fit(self, x, y, epochs=1, batch_size=32, validation_split=0.0, validation_data=None, verbose=1, **_):
    x, y = np.asarray(x, dtype=float), np.asarray(y, dtype=float).ravel()
    if validation_data is not None:
      xv, yv = np.asarray(validation_data[0], dtype=float), np.asarray(validation_data[1], dtype=float).ravel()
    elif validation_split:
      cut = len(x) - int(len(x) * validation_split)  # keras holds out the last rows, unshuffled
      x, xv, y, yv = x[:cut], x[cut:], y[:cut], y[cut:]
    else:
      xv = yv = None
    self.net = self._make(min(batch_size, len(x)))
    hist = History()
    steps = math.ceil(len(x) / batch_size)
    for e in range(int(epochs)):
      self.net.partial_fit(x, y)  # one pass over the data in mini-batches
      loss = float(np.mean((self.net.predict(x) - y) ** 2))
      hist.history['loss'].append(loss)
      line = f'Epoch {e + 1}/{epochs}\n{steps}/{steps} - loss: {loss:.4f}'
      if xv is not None:
        val = float(np.mean((self.net.predict(xv) - yv) ** 2))
        hist.history['val_loss'].append(val)
        line += f' - val_loss: {val:.4f}'
      if verbose: print(line)
    REC.spies.setdefault('keras_fit', []).append(hist.history)
    return hist

  def evaluate(self, x, y, **_):
    mse = float(np.mean((self.predict(x).ravel() - np.asarray(y, dtype=float).ravel()) ** 2))
    print(f'evaluate - loss: {mse:.4f}')
    return mse

  def predict(self, x, **_):
    return self.net.predict(np.asarray(x, dtype=float)).reshape(-1, 1)

  def save(self, filepath=None, **_):
    pass  # nothing is kept between runs, so every run trains afresh

  def summary(self):
    shape = self.layers[0].input_shape
    prev = int(shape[0]) if shape else int(self.net.n_features_in_)
    rows, total = [], 0
    for i, l in enumerate(self.layers):
      params = (prev + 1) * l.units
      total += params
      rows.append((f'dense{"_" + str(i) if i else ""} (Dense)', f'(None, {l.units})', params))
      prev = l.units
    w = 33
    print('Model: "sequential" (MLPRegressor stand-in)')
    print('_' * 65)
    print(f'{"Layer (type)":<{w}}{"Output Shape":<20}Param #')
    print('=' * 65)
    for name, out, p in rows: print(f'{name:<{w}}{out:<20}{p}')
    print('=' * 65)
    print(f'Total params: {total:,}\nTrainable params: {total:,}\n' + '_' * 65)


def _load_model(path):
  raise FileNotFoundError(path)


tf = types.ModuleType('tensorflow')
tf.keras = types.SimpleNamespace(
  Sequential=Sequential,
  layers=types.SimpleNamespace(Dense=Dense),
  optimizers=types.SimpleNamespace(Adam=Adam),
  models=types.SimpleNamespace(load_model=_load_model),
)


class SerialExecutor:
  """ThreadPoolExecutor stand-in: Pyodide can't start threads, so jobs run in order."""

  def __init__(self, *a, **k): pass
  def __enter__(self): return self
  def __exit__(self, *a): return False

  def submit(self, fn, *args, **kw):
    f = Future()
    try: f.set_result(fn(*args, **kw))
    except BaseException as e: f.set_exception(e)
    return f


FAKES = {'matplotlib': mpl, 'matplotlib.pyplot': plt, 'seaborn': seaborn, 'tensorflow': tf,
         'requests': requests, 'showcase_plot_backend': backend}


# --------------------------------------------------- parameter overrides --
def literal(value) -> ast.expr:
  return ast.parse(repr(value), mode='eval').body


def target_name(t) -> str | None:
  if isinstance(t, ast.Name): return t.id
  if isinstance(t, ast.Tuple) and all(isinstance(e, ast.Name) for e in t.elts): return ','.join(e.id for e in t.elts)
  return None


def scope_of(node) -> str | None:
  match node:
    case ast.FunctionDef(name=name) | ast.ClassDef(name=name): return name
    case ast.Assign(targets=[t]): return target_name(t)
    case ast.If(test=ast.Compare(left=ast.Name(id='__name__'))): return '__main__'
  return None


def apply_overrides(tree: ast.Module, overrides: dict, path: str) -> ast.Module:
  """overrides: {'NAME': v} replaces a module-level `NAME = ...`;
  {'scope.name': v} replaces `name = ...` or the keyword `name=...` inside the top-level
  function / assignment / `if __name__ == '__main__'` block called scope."""
  used = set()
  for node in tree.body:
    scope = scope_of(node)
    if isinstance(node, ast.Assign) and scope in overrides:
      node.value = literal(overrides[scope]); used.add(scope)
    if scope is None: continue
    for sub in ast.walk(node):
      if isinstance(sub, ast.Assign) and len(sub.targets) == 1:
        key = f'{scope}.{target_name(sub.targets[0])}'
        if key in overrides: sub.value = literal(overrides[key]); used.add(key)
      elif isinstance(sub, ast.keyword) and f'{scope}.{sub.arg}' in overrides:
        key = f'{scope}.{sub.arg}'
        sub.value = literal(overrides[key]); used.add(key)
  missing = set(overrides) - used
  if missing: raise KeyError(f'{path}: no assignment or keyword for {sorted(missing)}')
  return ast.fix_missing_locations(tree)


def compile_lab(path: str, overrides: dict | None):
  src = open(path, encoding='utf-8').read()
  tree = ast.parse(src, path)
  if overrides: tree = apply_overrides(tree, overrides, path)
  return compile(tree, path, 'exec')


# ------------------------------------------------------------ lab imports --
class LabLoader(importlib.abc.Loader):
  def __init__(self, lab, path):
    self.lab, self.path = lab, path

  def create_module(self, spec): return None

  def exec_module(self, module):
    rel = os.path.relpath(self.path, self.lab.root)
    exec(compile_lab(self.path, self.lab.overrides.get(rel)), module.__dict__)
    self.lab.instrument(module.__dict__)


class LabFinder(importlib.abc.MetaPathFinder):
  """Imports a lab's own modules from its folder, applying the page's overrides."""

  def __init__(self, lab): self.lab = lab

  def find_spec(self, name, path=None, target=None):
    if name in FAKES:
      return importlib.util.spec_from_loader(name, FakeLoader(FAKES[name]))
    last = name.rsplit('.', 1)[-1]
    dirs = [self.lab.root] if path is None else [p for p in path if os.path.abspath(p).startswith(self.lab.root)]
    for d in dirs:
      file = os.path.join(d, last + '.py')
      if os.path.isfile(file):
        return importlib.util.spec_from_file_location(name, file, loader=LabLoader(self.lab, file))
      pkg = os.path.join(d, last)
      init = os.path.join(pkg, '__init__.py')
      if os.path.isfile(init):
        return importlib.util.spec_from_file_location(name, init, loader=LabLoader(self.lab, init), submodule_search_locations=[pkg])
      if os.path.isdir(pkg):  # namespace package (8-lab/datasamples has no __init__.py)
        spec = importlib.machinery.ModuleSpec(name, None, is_package=True)
        spec.submodule_search_locations = [pkg]
        return spec
    return None


class FakeLoader(importlib.abc.Loader):
  def __init__(self, module): self.module = module
  def create_module(self, spec): return self.module
  def exec_module(self, module): pass


def spy(d, name, key, keep=lambda args, kw, res: (args, kw, res)):
  fn = d[name]

  def wrapper(*args, **kw):
    res = fn(*args, **kw)
    REC.spies.setdefault(key, []).append(keep(args, kw, res))
    return res
  wrapper.__wrapped__ = fn
  d[name] = wrapper


class Lab:
  def __init__(self, folder, overrides=None, spies=()):
    self.root = os.path.join(ROOT, folder)
    self.overrides = overrides or {}
    self.spies = spies  # [(module name, function name, key, keep)]

  def instrument(self, d):
    if 'calc_metrics' in d and callable(d['calc_metrics']) and not hasattr(d['calc_metrics'], '__wrapped__'):
      spy(d, 'calc_metrics', 'metrics', lambda a, k, r: (REC.last_line.rstrip(':').strip(), [num(v) for v in r]))
    if d.get('ThreadPoolExecutor') is not None:
      d['ThreadPoolExecutor'], d['as_completed'] = SerialExecutor, lambda fs: list(fs)
    for mod, fn, key, *keep in self.spies:
      if d.get('__name__') == mod: spy(d, fn, key, *keep)

  def run(self, seed=None):
    purge()
    REC.reset()
    finder = LabFinder(self)
    sys.meta_path.insert(0, finder)
    sys.path.insert(0, self.root)
    cwd = os.getcwd()
    os.chdir(self.root)
    if seed is not None:
      np.random.seed(int(seed))
      random.seed(int(seed))
    started = time.perf_counter()
    error = None
    ns = dict(__name__='__main__', __file__=os.path.join(self.root, 'main.py'))
    try:
      pd.set_option('plotting.backend', 'showcase_plot_backend')
      with contextlib.redirect_stdout(Out()), contextlib.redirect_stderr(Out()), warnings.catch_warnings():
        warnings.simplefilter('ignore')
        np.set_printoptions(legacy='1.25')  # print scalars as the labs' numpy 1.24 did
        tree = ast.parse(open(ns['__file__'], encoding='utf-8').read(), ns['__file__'])
        tree = apply_overrides(tree, self.overrides.get('main.py') or {}, ns['__file__'])
        # definitions first, so main.py's own calc_metrics can be instrumented before its __main__ block runs
        body, entry = [n for n in tree.body if scope_of(n) != '__main__'], [n for n in tree.body if scope_of(n) == '__main__']
        exec(compile(ast.Module(body, []), ns['__file__'], 'exec'), ns)
        self.instrument(ns)
        exec(compile(ast.Module(entry, []), ns['__file__'], 'exec'), ns)
    except Exception:
      tb = traceback.format_exc().splitlines()
      error = '\n'.join(tb[-6:])
    finally:
      np.set_printoptions(legacy=False)
      os.chdir(cwd)
      sys.path.remove(self.root)
      sys.meta_path.remove(finder)
    REC.finish()
    return ns, dict(events=REC.events, metrics=[dict(label=l, median=m[0], variance=m[1], std=m[2]) for l, m in REC.spies.get('metrics', [])],
                    seconds=round(time.perf_counter() - started, 3), error=error)


def purge():
  for name, m in list(sys.modules.items()):
    f = getattr(m, '__file__', None) or ''
    p = list(getattr(m, '__path__', None) or [])
    if f.startswith(ROOT) or any(str(x).startswith(ROOT) for x in p): del sys.modules[name]
  for name in FAKES: sys.modules.pop(name, None)


def opt_seed(seed):
  return None if seed in (None, '') else int(seed)


# ------------------------------------------------------------------- labs --
def lab1(array_size, loc, scale, exp_scale, exp_offset, trend_scale, constant, seed=None):
  lab = Lab('1-lab', {'main.py': {
    'ARRAY_SIZE': int(array_size),
    'mk_normal_dist.loc': loc, 'mk_normal_dist.scale': scale,
    'mk_exponential_dist.scale': exp_scale,
    'mk_distribution_sets.offset': exp_offset,
    'mk_trend_sets.trend_scale': trend_scale, 'mk_trend_sets.constant': constant,
  }})
  _, res = lab.run(opt_seed(seed))
  return res


def control(array_size, loc, scale, step, x_stretch, y_stretch, seed=None):
  lab = Lab('control-work', {'main.py': {
    'ARRAY_SIZE': int(array_size),
    'mk_distribution_set.loc': loc, 'mk_distribution_set.scale': scale,
    'mk_trend_set.step': step, 'mk_trend_set.x_stretch': x_stretch, 'mk_trend_set.y_stretch': y_stretch,
  }})
  _, res = lab.run(opt_seed(seed))
  return res


def lab2(array_size, abnormal_percentage, quality_coef, learn, q_mnk, n_wind, seed=None):
  main = {'ARRAY_SIZE': int(array_size), '__main__.abnormal_percentage': abnormal_percentage,
          '__main__.quality_coef': quality_coef}
  if not learn: main['__main__.Q_MNK,n_Wind'] = (int(q_mnk), int(n_wind))  # the lab's commented-out `Q_MNK, n_Wind = 5, 10`
  lab = Lab('2-lab', {'main.py': main})
  ns, res = lab.run(opt_seed(seed))
  return dict(res, q_mnk=int(ns['Q_MNK']) if 'Q_MNK' in ns else None, n_wind=int(ns['n_Wind']) if 'n_Wind' in ns else None, abnormal=int(int(array_size) * abnormal_percentage))


def lab3(array_size, abnormal_percentage, quality_coef, m, trend_scale, seed=None):
  lab = Lab('3-lab', {
    'main.py': {'ARRAY_SIZE': int(array_size)},
    'anomalies_analysys.py': {'analyze_purified_vales.abnormal_percentage': abnormal_percentage,
                              'analyze_purified_vales.quality_coef': quality_coef,
                              'analyze_purified_vales.m': int(m)},
    'value_generators.py': {'mk_trend_sets.trend_scale': trend_scale},
  })
  _, res = lab.run(opt_seed(seed))
  return res


def lab4(module, table):
  folder = os.path.join(ROOT, '4-lab', 'tables')
  os.makedirs(folder, exist_ok=True)
  if module == 'routes': datagen.write_routes(os.path.join(folder, 'routes.xls'), table)
  else: datagen.write_pr1(os.path.join(folder, 'Pr1.xls'), table)
  lab = Lab('4-lab', {'main.py': {'MODULE': module}},
            spies=[(module, 'voronin', 'voronin', lambda a, k, r: (a[0], a[1], a[2], r[0], int(r[1])))])
  _, res = lab.run()
  out = dict(res)
  if REC.spies.get('voronin'):
    criteria, mask, coefs, integral, optimal = REC.spies['voronin'][0]
    out.update(integral=nums(integral), optimal=optimal)
  return out


OWID = 'data/owid_covid.csv'
JENA = 'data/jena_climate_hourly.csv'


def lab5(country, date_split, n_estimators, early_stopping_rounds, learning_rate):
  # 5-lab/dataset.py: fetch_dataset() reads DATASET_PATH when it exists, so the extract goes there
  data = pd.read_csv(OWID)
  data[data['location'] == country].to_csv(os.path.join(ROOT, '5-lab', 'stats.csv'), index=False)
  keep_model = lambda a, k, r: r
  lab = Lab('5-lab', {
    'main.py': {'COUNTRY': country, 'DATE_SPLIT': date_split},
    'time_series_forecasting.py': {'make_predictions_xgb.n_estimators': int(n_estimators),
                                   'make_predictions_xgb.early_stopping_rounds': int(early_stopping_rounds),
                                   'make_predictions_xgb.learning_rate': learning_rate},
  }, spies=[('time_series_forecasting', 'make_predictions_xgb', 'xgb', keep_model)])
  ns, res = lab.run()
  out = dict(res)
  if REC.spies.get('xgb'):
    model, pred = REC.spies['xgb'][0]
    dt = ns['dt']
    y = dt.y_test.to_numpy(dtype=float)
    out.update(
      importance=dict(zip([str(c) for c in model.feature_names_in_], nums(model.feature_importances_))),
      best_iteration=int(getattr(model, 'best_iteration', -1) if getattr(model, 'best_iteration', None) is not None else -1),
      rmse=num(np.sqrt(np.mean((pred - y) ** 2))), mae=num(np.mean(np.abs(pred - y))),
      train_rows=len(dt.train), test_rows=len(dt.test),
    )
  return out


def lab6(start, end, every, predict, epochs):
  # 6-lab/dataset.py: fetch_dataset() reads FILENAME when it exists, so the (hourly) extract goes there
  data = pd.read_csv(JENA)
  stamp = pd.to_datetime(data['Date Time'], format='%d.%m.%Y %H:%M:%S')
  part = data[(stamp >= pd.Timestamp(start)) & (stamp < pd.Timestamp(end) + pd.Timedelta(days=1))].iloc[::max(1, int(every))]
  if len(part) < 20: raise ValueError('Pick a longer date range: fewer than 20 rows are left.')
  part.to_csv(os.path.join(ROOT, '6-lab', 'jena_climate_2009_2016.csv'), index=False)
  lab = Lab('6-lab', {
    'main.py': {'generate_extrapolation.predict': predict},
    'nn.py': {'create_model.epochs': int(epochs)},
  }, spies=[('mnk', 'extrapolate', 'mnk', lambda a, k, r: nums(r[1])),
            ('nn', 'create_model', 'nn', lambda a, k, r: num(r[1]))])
  _, res = lab.run()
  out = dict(res, rows=len(part))
  if REC.spies.get('mnk'): out['coefs'] = REC.spies['mnk'][0]
  if REC.spies.get('nn'): out['mse'] = REC.spies['nn'][0]
  return out


def lab7(rows, seed, factor, predict):
  datagen.write_sales(os.path.join(ROOT, '7-lab', 'Data_Set_3.xls'), int(rows), int(seed))
  lab = Lab('7-lab', {'main.py': {'GENERALIZATION_FACTOR': factor, 'PREDICTION_PRECENTAGE': predict}},
            spies=[('mnk', 'flatten', 'flatten', lambda a, k, r: len(a[0]))])
  _, res = lab.run()
  sales = pd.read_excel(os.path.join(ROOT, '7-lab', 'Data_Set_3.xls'))
  sales['OrderDate'] = sales['OrderDate'].dt.strftime('%Y-%m-%d')
  return dict(res, sales=dict(columns=list(sales.columns), rows=sales.astype(object).values.tolist()))


def lab8(rows, seed, data_increase, epochs, fraud_barrier):
  folder = os.path.join(ROOT, '8-lab', 'input')
  datagen.write_scoring(folder, int(rows), int(seed))
  lab = Lab('8-lab', {
    'data_predictions.py': {'FRAUD_BARRIER': int(fraud_barrier)},
    'scoring_analysis/tools.py': {'DATA_INCREASE': int(data_increase), 'EPOCHS': int(epochs)},
  }, spies=[
    ('datasamples.utils', 'voronin', 'integro', lambda a, k, r: nums(r)),
    ('scoring_analysis.tools', 'flatten_data', 'flattened', lambda a, k, r: nums(r)),
    ('scoring_analysis.validation', 'validate_table', 'fraud', lambda a, k, r: ([int(v) for v in r[0]], [int(v) for v in r[1]])),
    ('scoring_analysis.scoring_predictor', 'predict', 'predicted', lambda a, k, r: (nums(r[0]), [int(v) for v in r[1]])),
  ])
  np.random.seed(int(seed))
  _, res = lab.run()
  s = REC.spies
  out = dict(res)
  if s.get('integro'): out['integro'] = s['integro'][0]
  if s.get('flattened'): out['flattened'] = s['flattened'][0]
  if s.get('fraud'): out['contradictions'], out['valid'] = s['fraud'][0]
  if s.get('predicted'): out['predicted'], out['predicted_valid'] = s['predicted'][0]
  if s.get('keras_fit'): out['history'] = s['keras_fit'][0]
  return out


RUNNERS = dict(lab1=lab1, lab2=lab2, lab3=lab3, lab4=lab4, lab5=lab5, lab6=lab6, lab7=lab7, lab8=lab8, control=control)
