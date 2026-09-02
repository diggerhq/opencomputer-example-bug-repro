import { test } from "node:test";
import assert from "node:assert/strict";
import { invoiceTotal, lineTotal, withCoupon } from "../src/invoice.js";

test("lineTotal multiplies price by quantity", () => {
  assert.equal(lineTotal({ unitPrice: 2.5, quantity: 4 }), 10);
});

test("invoiceTotal sums lines without tax", () => {
  const invoice = {
    lines: [
      { unitPrice: 2.5, quantity: 4 },
      { unitPrice: 10, quantity: 1 },
    ],
  };
  assert.equal(invoiceTotal(invoice), 20);
});

test("invoiceTotal applies a tax rate", () => {
  const invoice = { lines: [{ unitPrice: 100, quantity: 1 }] };
  assert.equal(invoiceTotal(invoice, { taxRate: 0.2 }), 120);
});

test("withCoupon discounts every line", () => {
  const invoice = { lines: [{ unitPrice: 20, quantity: 1 }] };
  const preview = withCoupon(invoice, { code: "SAVE10", percentOff: 10 });
  assert.equal(invoiceTotal(preview), 18);
  assert.equal(preview.coupon, "SAVE10");
});
