"""Build-time extracts of the two public datasets used by labs 5 and 6.

Both labs download their data on first run (5-lab/main.py URL, 6-lab/main.py URL).
The files are too big to fetch in a browser (the OWID CSV is ~185 MB, the Jena
archive unpacks to ~43 MB), so CI downloads them once and keeps only what the
labs read. The output goes to web/data/ (git-ignored) and is served with the page.

  python web/build_data.py [--owid owid.csv] [--jena jena.zip]

Pass local copies to skip the downloads. Standard library only.
"""
import argparse
import csv
import io
import os
import sys
import urllib.request
import zipfile

# 5-lab/main.py fetched https://covid.ourworldindata.org/data/owid-covid-data.csv, which OWID
# retired; the same series now live in the catalog's compact file (`location` is called `country`).
OWID_URL = 'https://catalog.ourworldindata.org/garden/covid/latest/compact/compact.csv'
# the countries listed in 5-lab/main.py, plus a few neighbours to compare
COUNTRIES = ['United Kingdom', 'Ukraine', 'United States', 'Afghanistan', 'Poland', 'Germany', 'France', 'Japan']
# 6-lab/main.py URL
JENA_URL = 'https://s3.amazonaws.com/keras-datasets/jena_climate_2009_2016.csv.zip'
JENA_FILE = 'jena_climate_2009_2016.csv'

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')


def fetch(url: str) -> bytes:
  print(f'downloading {url}', file=sys.stderr)
  req = urllib.request.Request(url, headers={'User-Agent': 'lab-showcase-build'})
  with urllib.request.urlopen(req, timeout=600) as r:
    return r.read()


def owid(src: str | None):
  raw = open(src, 'rb').read() if src else fetch(OWID_URL)
  rows = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8', newline=''))
  path = os.path.join(OUT, 'owid_covid.csv')
  kept = 0
  with open(path, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['location', 'date', 'total_cases', 'new_cases'])  # the columns 5-lab/dataset.py reads
    for r in rows:
      if r['country'] in COUNTRIES:
        w.writerow([r['country'], r['date'], r['total_cases'], r['new_cases']])
        kept += 1
  print(f'{path}: {kept} rows', file=sys.stderr)


def jena(src: str | None):
  raw = open(src, 'rb').read() if src else fetch(JENA_URL)
  with zipfile.ZipFile(io.BytesIO(raw)) as z, z.open(JENA_FILE) as fh:
    rows = csv.reader(io.TextIOWrapper(fh, encoding='utf-8', newline=''))
    head = next(rows)
    cols = [head.index(c) for c in ('Date Time', 'p (mbar)', 'VPdef (mbar)')]  # what 6-lab/dataset.py reads
    path = os.path.join(OUT, 'jena_climate_hourly.csv')
    kept = 0
    with open(path, 'w', newline='') as f:
      w = csv.writer(f)
      w.writerow([head[c] for c in cols])
      # the raw data is every 10 minutes; keep the full hour (5::6, as in the Keras/TF time-series tutorials)
      for i, r in enumerate(rows):
        if i % 6 == 5:
          w.writerow([r[c] for c in cols])
          kept += 1
  print(f'{path}: {kept} rows', file=sys.stderr)


if __name__ == '__main__':
  ap = argparse.ArgumentParser()
  ap.add_argument('--owid')
  ap.add_argument('--jena')
  a = ap.parse_args()
  os.makedirs(OUT, exist_ok=True)
  owid(a.owid)
  jena(a.jena)
