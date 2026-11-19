# Worker entry (worker.js runs this in Pyodide): need(name), fetch_all(name) and run(name, params) for the page, JSON in and out.
import asyncio
import json
import os
from pyodide.http import pyfetch
import pyodide_js
import showcase

# loaded on first use, so the labs that only need numpy and pandas start sooner
PACKAGES = dict(lab2=['scikit-learn'], lab4=['openpyxl'], lab5=['scikit-learn', 'xgboost'], lab6=['scikit-learn'],
                lab7=['openpyxl'], lab8=['scikit-learn', 'openpyxl'])
# build-time extracts made by build_data.py, fetched when the lab first runs
DATA = dict(lab5=['data/owid_covid.csv'], lab6=['data/jena_climate_hourly.csv'])
HOME = os.getcwd()
ready = set()
loading = {}  # package -> task, so a run and the background prefetch never install the same package twice


async def _install(pkg: str):
  if pkg == 'openpyxl':  # pure Python, from PyPI
    await pyodide_js.loadPackage('micropip')
    import micropip
    await micropip.install('openpyxl')
  else:
    await pyodide_js.loadPackage(pkg)
  ready.add(pkg)


async def load(pkg: str):
  if pkg in ready: return
  if pkg not in loading: loading[pkg] = asyncio.ensure_future(_install(pkg))
  try:
    await loading[pkg]
  except Exception:
    loading.pop(pkg, None)  # let the next run try again
    raise


async def prepare(name: str):
  name = str(name)
  for pkg in PACKAGES.get(name, []): await load(pkg)
  for path in DATA.get(name, []):
    path = os.path.join(HOME, path)
    if os.path.exists(path): continue
    rel = os.path.relpath(path, HOME)
    res = await pyfetch(f'./{rel}')
    if not res.ok: raise RuntimeError(f'Could not load {rel} (HTTP {res.status}). Run web/build_data.py first.')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f: f.write(await res.bytes())


async def prefetch():
  for pkg in dict.fromkeys(p for ps in PACKAGES.values() for p in ps):
    try:
      await load(pkg)
    except Exception:
      pass  # a lab that needs it reports the error when it runs


def plain(o):
  return o.item() if hasattr(o, 'item') else str(o)


async def run(name: str, params: str) -> str:
  try:
    await prepare(name)
    return json.dumps(dict(ok=True, data=showcase.RUNNERS[str(name)](**json.loads(str(params)))), default=plain)
  except Exception as e:  # surface failures in the UI instead of hanging it
    return json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'))


async def fetch_all(name: str) -> str:
  """prepare() for the page: an error message, or '' once the lab's packages and data are in place."""
  try:
    await prepare(name)
    return ''
  except Exception as e:
    return f'{type(e).__name__}: {e}'


async def need(name: str) -> str:
  """Packages and data a lab still has to download, so the page can say so."""
  name = str(name)
  todo = [p for p in PACKAGES.get(name, []) if p not in ready] + [os.path.basename(p) for p in DATA.get(name, []) if not os.path.exists(os.path.join(HOME, p))]
  return ', '.join(todo)
