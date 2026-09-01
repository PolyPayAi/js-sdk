import assert from 'node:assert/strict';
import test from 'node:test';

import * as sdk from '../dist/index.js';

test('removed browser order APIs are not exported', () => {
  assert.equal('PolyPayClient' in sdk, false);
});

test('checkout helper requires a server-created URL', () => {
  const checkout = new sdk.PolyPayCheckout();
  assert.throws(() => checkout.redirect(''), /checkoutUrl is required/);
});
