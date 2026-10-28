# Synthetic OHLCV sample

`synthetic-ohlcv-sample.csv` is **simulated data**, not market history. It exists to demonstrate the Data
Studio import/validation flow and is useful for offline tests.

Columns: `Date,Open,High,Low,Close,Volume,Symbol`. Twenty-two business-day rows for the fictional symbol
`TEST`, generated deterministically by the project authors. Do not use it for research conclusions,
model evaluation, or any claim about real markets.

The default application data provider is Yahoo Finance (delayed/end-of-day). The `sample` provider used in
unit tests is separately labelled in the UI.
