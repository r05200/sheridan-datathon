# Bundled account history

Migrated from `datathon-fresh-run` for the Customer page's “What the account history shows” section. These are the source project's relabelled challenge CSV snapshots, not a new export of the live TigerData database.

- `customer_profiles.csv`: historical profile metrics and income/pension comparison groups.
- `monthly_summary.csv`: monthly flows, balances and historical signals.
- `loans.csv`: loan snapshot and the source feature's experimental relative ranking.

TigerData remains the source for baseline and planning amounts when configured. The historical section is explicitly labelled as snapshot data; reverse stress and buffer-ratio calculations receive the current baseline. Historical peer quartiles are separate from the Plan page's matched spending peers. Missing history does not prevent baseline or stress-test use.

`TANGERINE_DATA_DIR` can override the monthly-summary and loan directory. The bundled profile remains local. No database migration is required.
