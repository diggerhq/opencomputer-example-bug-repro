# Bug reports against `fixture/`

Two reports, written the way they arrive. Both are real: the existing test
suite passes with both bugs present.

## Report 1 — tax off by one cent

> Some invoices are a cent short. Example from accounting: one line at 8.20
> with our 7.5% tax rate shows a total of 8.81. Their spreadsheet says 8.82.
> Most invoices are fine, so it is not every amount.

Repository: `https://github.com/diggerhq/opencomputer-example-bug-repro`,
path `fixture`.

## Report 2 — previewing a coupon changes the invoice

> In checkout, previewing a 10% coupon and then closing the preview without
> applying it leaves the invoice at the discounted price. Reloading does not
> restore the original amounts.

Repository: `https://github.com/diggerhq/opencomputer-example-bug-repro`,
path `fixture`.
