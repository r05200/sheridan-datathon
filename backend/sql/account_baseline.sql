-- Judges' definitions: medians for income / spending / household bills,
-- mean of the last 6 months of avg_daily_balance for the buffer.
-- Extras beyond the PRD starter (needed by the engine / backup plan):
--   months_of_history, and the medians of the three flexible-spending columns.
-- Run in Postgres (Tiger Data). Shock and runway math stays in backend code.
CREATE OR REPLACE VIEW account_baseline AS
WITH ranked AS (
  SELECT account_id, avg_daily_balance,
         ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY month DESC) AS rn
  FROM monthly_summary
)
SELECT m.account_id,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.money_in)         AS income,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.money_out)        AS spending,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.household_bills)  AS household_bills,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.household_bills + m.insurance + m.loan_payments) AS fixed_costs,
  (SELECT AVG(r.avg_daily_balance) FROM ranked r
    WHERE r.account_id = m.account_id AND r.rn <= 6)              AS buffer,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.card_withdrawals)           AS card_withdrawals,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.cash_withdrawals_genuine)   AS cash_withdrawals,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.transfers_out_other)        AS transfers_out_other,
  COUNT(*)                                                                  AS months_of_history
FROM monthly_summary m
GROUP BY m.account_id;
