import assert from 'node:assert/strict';
import test from 'node:test';

import { PolyPayCheckout, PolyPayClient } from '../dist/index.js';

test('browser Public Key client is disabled', () => {
  assert.throws(
    () => new PolyPayClient({ publicKey: 'pub_public_value' }),
    /Browser Public Key API mode has been disabled/
  );
});

test('browser signed Public Key checkout URL generation is disabled', () => {
  const checkout = new PolyPayCheckout();
  assert.throws(
    () =>
      checkout.buildHostedCheckoutUrl({
        publicKey: 'pub_public_value',
        amount: 100,
        timestamp: Date.now() + 86_400_000,
        signature: 'client_controlled_signature'
      }),
    /Public Key checkout URL generation is disabled/
  );
});
