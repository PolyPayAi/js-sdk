import assert from 'node:assert/strict';
import test from 'node:test';
import { polypayX402 } from '../dist/index.js';

const resource = {
  resource: 'https://merchant.example.com/api/premium-data',
  method: 'GET',
  price: '$0.01',
  network: 'eip155:8453',
  payTo: '0x1111111111111111111111111111111111111111',
  description: 'Premium market data',
  mimeType: 'application/json'
};

test('x402 v2 advertises a standard PAYMENT-REQUIRED header', () => {
  const helper = polypayX402({ apiKey: 'test-key', resource });
  const response = helper.requirementResponse();
  const encoded = response.headers.get('PAYMENT-REQUIRED');

  assert.equal(response.status, 402);
  assert.ok(encoded);
  const required = decodeHeader(encoded);
  assert.equal(required.x402Version, 2);
  assert.equal(required.resource.url, resource.resource);
  assert.equal(required.accepts[0].amount, '10000');
  assert.equal(required.accepts[0].asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  assert.equal(required.accepts[0].extra.assetTransferMethod, 'eip3009');
});

test('x402 v2 sends structured facilitator payload and returns PAYMENT-RESPONSE', async () => {
  const requests = [];
  const fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const isVerify = requests.length === 1;
    return Response.json({
      code: 0,
      message: '',
      data: isVerify
        ? { isValid: true, payer: '0x2222222222222222222222222222222222222222' }
        : {
            success: true,
            transaction: '0xabc',
            network: 'eip155:8453',
            payer: '0x2222222222222222222222222222222222222222',
            amount: '10000'
          }
    });
  };
  const helper = polypayX402({ apiKey: 'test-key', resource, fetch });
  const paymentPayload = {
    x402Version: 2,
    accepted: decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED')).accepts[0],
    payload: { signature: '0xsignature', authorization: {} }
  };
  const request = new Request(resource.resource, {
    headers: { 'PAYMENT-SIGNATURE': encodeHeader(paymentPayload) }
  });

  const result = await helper.verifyAndSettle(request);

  assert.equal(result.paid, true);
  assert.equal(result.shouldFulfill, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].x402Version, 2);
  assert.deepEqual(requests[0].paymentPayload, paymentPayload);
  assert.equal(requests[0].payment, undefined);
  const settlement = decodeHeader(result.responseHeaders['PAYMENT-RESPONSE']);
  assert.deepEqual(settlement, {
    success: true,
    transaction: '0xabc',
    network: 'eip155:8453',
    payer: '0x2222222222222222222222222222222222222222',
    amount: '10000'
  });
});

test('settled payment replay is paid but must not run fulfillment twice', async () => {
  let call = 0;
  const fetch = async () => Response.json({
    code: 0,
    message: '',
    data: ++call === 1
      ? { isValid: true }
      : {
          success: true,
          transaction: '0xabc',
          network: 'eip155:8453',
          paymentId: 'X402-123',
          replayed: true,
          extensions: { polypay: { paymentId: 'X402-123', replayed: true } }
        }
  });
  const helper = polypayX402({ apiKey: 'test-key', resource, fetch });
  const required = decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED'));
  const payment = encodeHeader({
    x402Version: 2,
    accepted: required.accepts[0],
    payload: { signature: '0xsignature', authorization: {} }
  });

  const result = await helper.verifyAndSettle(new Request(resource.resource, {
    headers: { 'PAYMENT-SIGNATURE': payment }
  }));

  assert.equal(result.paid, true);
  assert.equal(result.shouldFulfill, false);
  assert.equal(result.fulfillmentKey, 'X402-123');
});

test('x402 v1 remains an explicit migration option', async () => {
  const helper = polypayX402({ apiKey: 'test-key', protocolVersion: 1, resource });
  const response = helper.requirementResponse();
  const body = await response.json();

  assert.equal(response.headers.get('PAYMENT-REQUIRED'), null);
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts[0].maxAmountRequired, '10000');
});

test('failed v2 settlement returns both challenge and settlement receipt', async () => {
  let call = 0;
  const fetch = async () => Response.json({
    code: 0,
    message: '',
    data: ++call === 1
      ? { isValid: true }
      : {
          success: false,
          errorReason: 'insufficient_funds',
          transaction: '',
          network: 'eip155:8453'
        }
  });
  const helper = polypayX402({ apiKey: 'test-key', resource, fetch });
  const required = decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED'));
  const payment = encodeHeader({
    x402Version: 2,
    accepted: required.accepts[0],
    payload: { signature: '0xsignature', authorization: {} }
  });

  const result = await helper.verifyAndSettle(new Request(resource.resource, {
    headers: { 'PAYMENT-SIGNATURE': payment }
  }));
  const response = result.required();

  assert.equal(result.paid, false);
  assert.ok(response.headers.get('PAYMENT-REQUIRED'));
  assert.equal(
    decodeHeader(response.headers.get('PAYMENT-RESPONSE')).errorReason,
    'insufficient_funds'
  );
});

test('x402 v2 uses the configured canonical resource behind a proxy', async () => {
  const requests = [];
  const fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({
      code: 0,
      message: '',
      data: requests.length === 1
        ? { isValid: true }
        : { success: true, transaction: '0xabc', network: 'eip155:8453' }
    });
  };
  const helper = polypayX402({ apiKey: 'test-key', resource, fetch });
  const required = decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED'));
  const payment = encodeHeader({
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[0],
    payload: { signature: '0xsignature', authorization: {} }
  });

  await helper.verifyAndSettle(new Request('http://internal-service:3000/api/premium-data', {
    headers: { 'PAYMENT-SIGNATURE': payment }
  }));

  assert.equal(requests[0].resource, resource.resource);
  assert.equal(requests[0].method, resource.method);
});

test('x402 v2 does not accept the legacy X-PAYMENT header', async () => {
  let calls = 0;
  const helper = polypayX402({
    apiKey: 'test-key',
    resource,
    fetch: async () => {
      calls += 1;
      throw new Error('facilitator must not be called');
    }
  });
  const required = decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED'));
  const payment = encodeHeader({
    x402Version: 2,
    accepted: required.accepts[0],
    payload: { signature: '0xsignature', authorization: {} }
  });

  const result = await helper.verifyAndSettle(new Request(resource.resource, {
    headers: { 'X-PAYMENT': payment }
  }));

  assert.equal(result.paid, false);
  assert.equal(calls, 0);
  assert.ok(result.required().headers.get('PAYMENT-REQUIRED'));
});

test('x402 rejects unsupported settlement configuration before emitting a challenge', () => {
  assert.throws(
    () => polypayX402({
      apiKey: 'test-key',
      resource: { ...resource, network: 'eip155:56', assetContract: resource.payTo }
    }),
    /Unsupported x402 network/
  );
  assert.throws(
    () => polypayX402({
      apiKey: 'test-key',
      resource: { ...resource, assetContract: resource.payTo }
    }),
    /Unsupported USDC contract/
  );
  assert.throws(
    () => polypayX402({
      apiKey: 'test-key',
      resource: { ...resource, scheme: 'upto' }
    }),
    /Unsupported x402 scheme/
  );
  assert.throws(
    () => polypayX402({
      apiKey: 'test-key',
      resource: { ...resource, extra: { assetTransferMethod: 'permit2' } }
    }),
    /Unsupported x402 assetTransferMethod/
  );
});

test('x402 supports every production network with its Circle USDC contract', () => {
  const networks = {
    'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'eip155:137': '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    'eip155:10': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
  };

  for (const [network, asset] of Object.entries(networks)) {
    const helper = polypayX402({
      apiKey: 'test-key',
      resource: { ...resource, network }
    });
    const required = decodeHeader(helper.requirementResponse().headers.get('PAYMENT-REQUIRED'));
    assert.equal(required.accepts[0].network, network);
    assert.equal(required.accepts[0].asset, asset);
  }
});

function encodeHeader(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decodeHeader(value) {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}
