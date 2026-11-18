# PyScript entry: exposes the labs to the page's JavaScript.
import json
import os
from pyscript import window
from pyodide.ffi import create_proxy
from pyodide.http import pyfetch
import pyodide_js
import showcase

# loaded on first use, so the labs that only need numpy and pandas start sooner
PACKAGES = dict(lab2=['scikit-learn'], lab4=['openpyxl'], lab5=['scikit-learn', 'xgboost'], lab6=['scikit-learn'],
                lab7=['openpyxl'], lab8=['scikit-learn', 'openpyxl'])
# build-time extracts made by build_data.py, fetched when the lab first runs
DATA = dict(lab5=['data/owid_covid.csv'], lab6=['data/jena_climate_hourly.csv'])
ready = set()


async def prepare(name: str):
  name = str(name)
  for pkg in PACKAGES.get(name, []):
    if pkg in ready: continue
    if pkg == 'openpyxl':  # pure Python, from PyPI
      await pyodide_js.loadPackage('micropip')
      import micropip
      await micropip.install('openpyxl')
    else:
      await pyodide_js.loadPackage(pkg)
    ready.add(pkg)
  for path in DATA.get(name, []):
    if os.path.exists(path): continue
    res = await pyfetch(f'./{path}')
    if not res.ok: raise RuntimeError(f'Could not load {path} (HTTP {res.status}). Run web/build_data.py first.')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f: f.write(await res.bytes())


def plain(o):
  return o.item() if hasattr(o, 'item') else str(o)


async def run(name: str, params: str) -> str:
  try:
    await prepare(name)
    return json.dumps(dict(ok=True, data=showcase.RUNNERS[str(name)](**json.loads(str(params)))), default=plain)
  except Exception as e:  # surface failures in the UI instead of hanging it
    return json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'))


async def need(name: str) -> str:
  """Packages and data a lab still has to download, so the page can say so."""
  name = str(name)
  todo = [p for p in PACKAGES.get(name, []) if p not in ready] + [os.path.basename(p) for p in DATA.get(name, []) if not os.path.exists(p)]
  return ', '.join(todo)


window.pyRun = create_proxy(run)
window.pyNeed = create_proxy(need)
window.dispatchEvent(window.CustomEvent.new('py-ready'))
