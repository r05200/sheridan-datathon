-- Tables matching the competition CSVs (transactions only if a feature needs it).
CREATE TABLE IF NOT EXISTS accounts (
  account_id      INTEGER PRIMARY KEY,
  district_id     INTEGER,
  frequency       TEXT,
  account_opened  DATE
);

CREATE TABLE IF NOT EXISTS districts (
  district_id                INTEGER PRIMARY KEY,
  district_name              TEXT,
  region                     TEXT,
  inhabitants                INTEGER,
  municipalities_under_500   INTEGER,
  municipalities_500_1999    INTEGER,
  municipalities_2000_9999   INTEGER,
  municipalities_over_10000  INTEGER,
  num_cities                 INTEGER,
  urban_ratio_pct            NUMERIC,
  average_salary             NUMERIC,
  unemployment_rate_2022     NUMERIC,
  unemployment_rate_2023     NUMERIC,
  entrepreneurs_per_1000     INTEGER,
  crimes_2022                INTEGER,
  crimes_2023                INTEGER
);

CREATE TABLE IF NOT EXISTS loans (
  loan_id          INTEGER PRIMARY KEY,
  account_id       INTEGER,
  loan_start       DATE,
  amount           NUMERIC,
  duration_months  INTEGER,
  monthly_payment  NUMERIC,
  status           TEXT,
  status_meaning   TEXT,
  defaulted        INTEGER
);

CREATE TABLE IF NOT EXISTS monthly_summary (
  account_id                INTEGER,
  month                     TEXT,            -- YYYY-MM, sorts correctly as text
  money_in                  NUMERIC,
  money_out                 NUMERIC,
  cash_deposits             NUMERIC,
  transfers_in              NUMERIC,
  pension_in                NUMERIC,
  interest_in               NUMERIC,
  household_bills           NUMERIC,
  insurance                 NUMERIC,
  loan_payments             NUMERIC,
  bank_fees                 NUMERIC,
  cash_withdrawals_genuine  NUMERIC,
  card_withdrawals          NUMERIC,
  transfers_out_other       NUMERIC,
  month_end_balance         NUMERIC,
  min_balance               NUMERIC,
  avg_daily_balance         NUMERIC,
  days_below_zero           INTEGER,
  PRIMARY KEY (account_id, month)
);
CREATE INDEX IF NOT EXISTS monthly_summary_account_idx ON monthly_summary (account_id);
CREATE INDEX IF NOT EXISTS loans_account_idx ON loans (account_id);
