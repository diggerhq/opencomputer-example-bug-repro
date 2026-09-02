// A small billing module. Amounts are numbers in major currency units.

export function round2(value) {
  return Math.round(value * 100) / 100;
}

export function lineTotal({ unitPrice, quantity }) {
  return round2(unitPrice * quantity);
}

export function invoiceTotal(invoice, { taxRate = 0 } = {}) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const tax = round2(subtotal * taxRate);
  return round2(subtotal + tax);
}

// Returns a copy of the invoice with a percentage coupon applied to every
// line. Used by the checkout preview before the customer commits.
export function withCoupon(invoice, coupon) {
  const discounted = { ...invoice, coupon: coupon.code };
  discounted.lines.forEach((line) => {
    line.unitPrice = round2(line.unitPrice * (1 - coupon.percentOff / 100));
  });
  return discounted;
}
