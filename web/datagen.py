"""Synthetic Excel inputs for labs 4, 7 and 8.

The labs read workbooks that were never committed (they're in .gitignore):
4-lab/tables/routes.xls and Pr1.xls, 7-lab/Data_Set_3.xls and the three
8-lab/input/*.xlsx files. These functions write made-up data with the same
sheet layout (column names, value formats, min/max markers), so each lab's own
pd.read_excel call and the code after it run unchanged. The numbers are
synthetic, not the originals.

The files are saved as .xlsx content even where the lab's path ends in .xls:
pandas picks the reader from the file's bytes, and only openpyxl is available
for writing in the browser.
"""
import os
import numpy as np
import pandas as pd


def _save(frame: pd.DataFrame, path: str):
  os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
  frame.to_excel(path, index=False, engine='openpyxl')


# ------------------------------------------------------------------ 4-lab --
def write_routes(path: str, table: dict):
  """4-lab/routes.py reads columns 0 (criterion name), 'Критерій' (min/max),
  'Коефіцієнти переваги критеріїв' (weights) and one column per route."""
  routes = [str(r) for r in table['columns']]
  rows = table['rows']
  frame = pd.DataFrame({
    0: [r['name'] for r in rows],
    'Критерій': [r['criterion'] for r in rows],
    'Коефіцієнти переваги критеріїв': [float(r['coef']) for r in rows],
  })
  for i, route in enumerate(routes):
    frame[route] = [float(r['values'][i]) for r in rows]
  _save(frame, path)


def write_pr1(path: str, table: dict):
  """4-lab/example.py reads 9 criteria rows of 'Товар 1' … 'Товар 9' as text with a
  decimal comma, and 'Критерій' = 'мін' for minimised criteria."""
  rows = table['rows']
  # the page says min/max in English; the lab's workbook uses 'мін'/'макс'
  lab_criterion = {'min': 'мін', 'max': 'макс'}
  frame = pd.DataFrame({'Показник': [r['name'] for r in rows], 'Критерій': [lab_criterion.get(r['criterion'], r['criterion']) for r in rows]})
  for i in range(9):
    # two decimals with a comma, as the lab expects (`.replace(',', '.')`); a column of plain
    # integers would be read back as numbers and break that call
    frame[f'Товар {i + 1}'] = [f'{float(str(r["values"][i]).replace(",", ".")):.2f}'.replace('.', ',') for r in rows]
  _save(frame, path)


# ------------------------------------------------------------------ 7-lab --
REGIONS = ['East', 'Central', 'West']
REPS = {'East': ['Jones', 'Howard', 'Parent'], 'Central': ['Kivell', 'Smith', 'Morgan', 'Andrews'], 'West': ['Sorvino', 'Thompson']}
ITEMS = {'Pencil': (1.29, 4.99), 'Binder': (4.99, 19.99), 'Pen': (1.99, 19.99), 'Desk': (125.0, 275.0), 'Pen Set': (4.99, 16.99)}


def write_sales(path: str, rows: int = 43, seed: int = 7):
  """7-lab reads OrderDate (index), Region, Rep, Item, Units, Unit Cost and Total."""
  rng = np.random.default_rng(seed)
  dates = pd.Timestamp('2019-01-06') + pd.to_timedelta(np.cumsum(rng.integers(9, 26, rows)), unit='D')
  region = rng.choice(REGIONS, rows, p=[.35, .45, .2])
  item = rng.choice(list(ITEMS), rows, p=[.3, .25, .2, .1, .15])
  price = np.array([round(float(rng.uniform(*ITEMS[i])), 2) for i in item])
  units = rng.integers(2, 96, rows)
  units[item == 'Desk'] = rng.integers(2, 6, int((item == 'Desk').sum()))
  frame = pd.DataFrame({
    'OrderDate': dates,
    'Region': region,
    'Rep': [str(rng.choice(REPS[r])) for r in region],
    'Item': item,
    'Units': units,
    'Unit Cost': price,
    'Total': np.round(units * price, 2),
  })
  _save(frame, path)


# ------------------------------------------------------------------ 8-lab --
BORROWER = 'Указывает заемщик'
PRODUCT = 'параметры связанные с выданным продуктом'
BUREAU = 'Кредитное бюро'
SCORING = 'Вычисляется скоринговой системой'

# (field, description, where it's defined, in the sample?, Minimax)
FIELDS = [
  ('loan_amount', 'Requested loan amount', PRODUCT, True, 'min'),
  ('loan_days', 'Requested loan term, days', PRODUCT, True, 'min'),
  ('product_amount_from', 'Product: minimum amount', PRODUCT, True, ''),
  ('product_amount_to', 'Product: maximum amount', PRODUCT, True, ''),
  ('birth_date', 'Date of birth', BORROWER, True, ''),
  ('gender_id', 'Gender', BORROWER, True, ''),
  ('marital_status_id', 'Marital status', BORROWER, True, ''),
  ('children_count', 'Number of children', BORROWER, True, 'min'),
  ('education_id', 'Education level', BORROWER, True, ''),
  ('has_immovables', 'Owns real estate', BORROWER, True, ''),
  ('has_movables', 'Owns a car', BORROWER, True, ''),
  ('seniority_years', 'Work experience, years', BORROWER, True, 'max'),
  ('organization_type_id', 'Employer type', BORROWER, True, ''),
  ('organization_branch_id', 'Employer industry', BORROWER, True, ''),
  ('monthly_income', 'Monthly income', BORROWER, True, 'max'),
  ('monthly_expenses', 'Monthly expenses', BORROWER, True, 'min'),
  ('income_frequency_id', 'Income frequency', BORROWER, True, ''),
  ('income_source_id', 'Income source', BORROWER, True, ''),
  ('other_loans_active', 'Other active loans', BORROWER, True, 'min'),
  ('other_loans_about_current', 'Other loans: current debt', BORROWER, True, ''),
  ('other_loans_about_monthly', 'Other loans: monthly payment', BORROWER, True, 'min'),
  ('fact_addr_start_date', 'Living at the address since', BORROWER, True, ''),
  ('position_id', 'Job position', BORROWER, True, ''),
  ('employment_date', 'Employed since', BORROWER, True, ''),
  ('has_prior_employment', 'Had a previous job', BORROWER, True, ''),
  ('prior_employment_start_date', 'Previous job: start', BORROWER, True, ''),
  ('prior_employment_end_date', 'Previous job: end', BORROWER, True, ''),
  ('income_frequency_other', 'Income frequency (free text)', BORROWER, True, ''),
  ('passport_issued_by', 'Passport issued by', BORROWER, False, ''),
  ('phone_mobile_verified', 'Mobile phone verified', BORROWER, False, ''),
  ('bki_requests_30d', 'Credit bureau requests, 30 days', BUREAU, True, ''),
  ('bki_overdue_max', 'Credit bureau: longest overdue, days', BUREAU, True, ''),
  ('scoring_result', 'Final scoring decision', SCORING, True, ''),
]


def write_scoring(folder: str, rows: int = 200, seed: int = 8):
  """8-lab reads Pr15_sample_data.xlsx (one row per applicant), Pr15_data_description.xlsx
  (Field_in_data, Place_of_definition) and d_segment_data_description_cleaning_minimax.xlsx
  (the same plus Minimax = min/max for the scored criteria)."""
  rng = np.random.default_rng(seed)
  n = rows
  today = pd.Timestamp.now().normalize()
  age = rng.integers(21, 66, n)
  seniority = np.minimum(age - 20, rng.integers(0, 30, n))
  income = np.round(rng.lognormal(9.6, .45, n), -1)
  expenses = np.round(income * rng.uniform(.25, .8, n), -1)
  amount_from = rng.choice([1000, 2000, 5000], n)
  amount_to = amount_from + rng.choice([10000, 20000, 45000], n)
  loans_active = rng.choice([0, 0, 0, 1, 1, 2], n)
  monthly = np.where(loans_active > 0, np.round(rng.uniform(300, 3000, n), -1), 0)
  current = np.where(loans_active > 0, np.round(monthly * rng.uniform(3, 18, n), -1), 0)
  org_type, org_branch = rng.integers(1, 12, n), rng.integers(1, 40, n)
  freq, source = rng.integers(1, 5, n), rng.integers(1, 8, n)
  immovables = rng.choice([0, 1], n, p=[.6, .4])

  # about one applicant in eight gets several contradictions, the kind 8-lab's fraud_check counts
  fraud = rng.random(n) < .125
  for i in np.flatnonzero(fraud):
    for k in rng.choice(7, 3, replace=False):
      match k:
        case 0: age[i] = rng.integers(17, 20); seniority[i] = rng.integers(3, 10)
        case 1: seniority[i] = age[i] - 20 + rng.integers(3, 15)
        case 2: org_type[i] = rng.integers(101, 999)
        case 3: expenses[i] = income[i] * rng.uniform(1.2, 2)
        case 4: loans_active[i] = rng.integers(3, 7)
        case 5: monthly[i] = rng.uniform(2000, 5000); current[i] = monthly[i] * rng.uniform(.2, .9)
        case 6: amount_from[i] = amount_to[i] + 1000

  loan = np.round(np.clip(rng.lognormal(9.2, .6, n), amount_from, amount_to), -2)
  birth = today - pd.to_timedelta(age * 365 + rng.integers(1, 360, n), unit='D')
  employed = today - pd.to_timedelta(np.maximum(seniority, 1) * 365 * rng.uniform(.1, 1, n), unit='D')
  prior = rng.choice([0, 1], n)
  prior_start = pd.Series(employed - pd.to_timedelta(rng.integers(400, 3000, n), unit='D')).where(prior == 1)
  prior_end = pd.Series(employed - pd.to_timedelta(rng.integers(10, 300, n), unit='D')).where(prior == 1)
  other_text = pd.Series([None] * n, dtype=object)
  other_text[rng.random(n) < .05] = 'irregular'

  sample = pd.DataFrame({
    'applicant_id': np.arange(1, n + 1),
    'loan_amount': loan, 'loan_days': rng.choice([7, 14, 30, 60, 90, 180], n),
    'product_amount_from': amount_from, 'product_amount_to': amount_to,
    'birth_date': birth.strftime('%Y-%m-%d'),
    'gender_id': rng.integers(1, 3, n), 'marital_status_id': rng.integers(1, 5, n),
    'children_count': rng.choice([0, 0, 1, 1, 2, 3], n), 'education_id': rng.integers(1, 6, n),
    'has_immovables': immovables, 'has_movables': rng.choice([0, 1], n),
    'seniority_years': seniority, 'organization_type_id': org_type, 'organization_branch_id': org_branch,
    'monthly_income': income, 'monthly_expenses': expenses,
    'income_frequency_id': freq, 'income_source_id': source,
    'other_loans_active': loans_active, 'other_loans_about_current': current, 'other_loans_about_monthly': monthly,
    'fact_addr_start_date': (today - pd.to_timedelta(rng.integers(100, 9000, n), unit='D')).strftime('%Y-%m-%d'),
    'position_id': rng.integers(1, 30, n),
    'employment_date': pd.DatetimeIndex(employed).strftime('%Y-%m-%d'),
    'has_prior_employment': prior,
    'prior_employment_start_date': prior_start.dt.strftime('%Y-%m-%d'),
    'prior_employment_end_date': prior_end.dt.strftime('%Y-%m-%d'),
    'income_frequency_other': other_text,
    'bki_requests_30d': rng.poisson(1.5, n), 'bki_overdue_max': rng.choice([0, 0, 0, 5, 30, 90], n),
    'scoring_result': rng.choice(['approved', 'declined'], n, p=[.7, .3]),
  })
  description = pd.DataFrame({
    'Field_in_data': [f[0] for f in FIELDS],
    'Description_of_information': [f[1] for f in FIELDS],
    'Place_of_definition': [f[2] for f in FIELDS],
  })
  minimax = description.copy()
  minimax['Minimax'] = [f[4] for f in FIELDS]
  _save(sample, os.path.join(folder, 'Pr15_sample_data.xlsx'))
  _save(description, os.path.join(folder, 'Pr15_data_description.xlsx'))
  _save(minimax, os.path.join(folder, 'd_segment_data_description_cleaning_minimax.xlsx'))
