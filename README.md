# PolyPay JavaScript SDK

Official SDK for secure Hosted Checkout redirects and server-side x402 agent payments.

> **Security migration:** Browser Public Key Token mode is disabled. A Public Key and
> browser-controlled Origin/Referer headers cannot authenticate order creation. Create
> Hosted Checkout on your merchant server with an API Key, then pass the opaque
> `checkout_url` to the browser. `PolyPayClient`, `getSessionToken`, `createOrder`,
> `getOrderStatus`, and signed Public Key URL generation now throw a migration error.

The browser checkout helper is designed for frontend applications that need to:

- redirect users to PolyPay hosted checkout
- let PolyPay handle payment method selection
- optionally pass `currency` and `network` to skip method selection and go straight to the payment page

The x402 helper is designed for server-side route handlers that need to:

- return HTTP 402 payment requirements for protected resources
- advertise `PAYMENT-REQUIRED` and verify `PAYMENT-SIGNATURE` payloads
- return `PAYMENT-RESPONSE` settlement receipts
- settle standard EVM USDC `exact` payments through PolyPay

## Features

- Hosted checkout redirect, no merchant-side payment method page required
- server-created opaque Hosted Checkout URLs
- no API key, order amount, or signing material in browser code
- browser-first `fetch` implementation with no runtime dependencies
- popup checkout helper and payment status polling
- server-side x402 helper for agent payments
- TypeScript typings included

## Installation

```bash
npm install @polypay/sdk
```

```bash
pnpm add @polypay/sdk
```

## Quick Start

```ts
import { PolyPayCheckout } from '@polypay/sdk/browser';

const { checkoutUrl } = await fetch('/api/create-polypay-checkout', {
  method: 'POST'
}).then((response) => response.json());

new PolyPayCheckout().redirect(checkoutUrl);
```

## Legacy Public Key API

The former browser API is intentionally unavailable. Do not initialize
`PolyPayClient` or call its Session Token/order methods. Use the server-side
`POST /api/v1/pay/order/checkout` endpoint with `X-API-Key`, and return only its
`checkout_url` field to the browser.

## Checkout Helper

### Redirect

```ts
import { PolyPayCheckout } from '@polypay/sdk/browser';

const checkout = new PolyPayCheckout();
checkout.redirect(order.paymentUrl);
```

### Popup modal

```ts
const checkout = new PolyPayCheckout();

checkout.openModal(order.paymentUrl, {
  width: '450px',
  height: '650px',
  onClose: () => {
    console.log('checkout popup closed');
  }
});
```

### Poll payment status

```ts
const checkout = new PolyPayCheckout(client);

checkout.on('paid', (data) => {
  console.log('paid', data.tradeId);
});

await checkout.pollStatus(order.tradeId, {
  interval: 3000,
  timeout: 30 * 60 * 1000
});
```

Supported events:

- `pending`
- `paid`
- `expired`
- `cancelled`
- `unknown`
- `error`

## x402 Agent Payments

Use `@polypay/sdk/x402` only in server-side code. It requires your merchant API Key and must never be bundled into browser code.

```ts
import { polypayX402 } from '@polypay/sdk/x402';

const x402 = polypayX402({
  apiKey: process.env.POLYPAY_API_KEY!,
  resource: {
    resource: 'https://merchant.example.com/api/premium-data',
    method: 'GET',
    price: '$0.01',
    amount: '10000',
    network: 'eip155:8453',
    asset: 'USDC',
    payTo: '0xYourMerchantSettlementWallet',
    description: 'Premium market data'
  }
});

export async function GET(request: Request) {
  const result = await x402.verifyAndSettle(request);
  if (!result.paid) {
    return result.required();
  }

  return Response.json(
    { data: 'premium payload' },
    { headers: result.responseHeaders }
  );
}
```

The helper emits x402 v2 by default. Set `protocolVersion: 1` only during a controlled migration for legacy clients.
The configured `resource` URL and `method` are the canonical public request identity used for verification, including behind reverse proxies. A v2 helper reads only `PAYMENT-SIGNATURE`; a v1 helper reads only `X-PAYMENT`.

Keep the matching Dashboard Resource enabled. Settlement rejects disabled or missing resources. Raw standard facilitator requests that omit method/resource context are accepted only when the enabled Resource resolves uniquely from merchant, network, asset, amount, and recipient.

The raw facilitator settlement returns `paymentId` and `replayed`. The SDK maps them to `fulfillmentKey` and `shouldFulfill` on the `verifyAndSettle()` result. `paid` reports settlement state. `shouldFulfill` is true only for the request that wins the first confirmed payment-state transition; concurrent or later successful requests receive false. `fulfillmentKey` is the stable PolyPay payment ID. This flag is not a replacement for business idempotency: stateful endpoints must atomically persist their first business response under the unique key and return that stored response on retries. Read-only endpoints may continue serving the same protected representation when `paid` is true.

### x402 Resource Options

| Option | Required | Description |
|--------|----------|-------------|
| `resource` | Yes | Canonical protected resource URL |
| `payTo` | Yes | Merchant EVM wallet address receiving USDC |
| `price` | Yes* | Human-readable price, for example `$0.01` |
| `amount` | Yes* | x402 v2 USDC base-unit amount; required if `price` is omitted |
| `maxAmountRequired` | No | Legacy v1 alias for `amount` during migration |
| `method` | No | Protected HTTP method |
| `description` | No | Description shown to agents |
| `mimeType` | No | Resource MIME type |
| `scheme` | No | Defaults to `exact` |
| `network` | No | Defaults to `eip155:8453` |
| `asset` | No | Defaults to `USDC` |
| `assetContract` | No | Defaults to the network-specific Circle USDC contract |
| `maxTimeoutSeconds` | No | Defaults to `60` |
| `protocolVersion` | No | Defaults to `2`; set to `1` only for an explicit legacy migration |

Supported standard x402 networks:

| Network | Chain | USDC Contract |
|---------|-------|---------------|
| `eip155:8453` | Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `eip155:1` | Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `eip155:137` | Polygon | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` |
| `eip155:42161` | Arbitrum | `0xaf88d065e77c8C2239327C5EDb3A432268e5831` |
| `eip155:10` | Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |

Only standard EVM `exact` payments with Circle USDC `transferWithAuthorization` are supported. BSC, Tron, Solana, TON, and BTC are not part of this standard exact flow.

The helper validates the scheme, network, matching Circle USDC contract, and EIP-3009 metadata when it is created. Unsupported overrides fail before a payment challenge is sent to a wallet. If a settle request times out, retry the same signed payment proof; do not create a replacement authorization solely because the result is indeterminate.

## Script Tag Build

After build, use:

```html
<script src="/path/to/polypay.min.global.js"></script>
<script>
  const client = new PolyPay.PolyPayClient({
    publicKey: 'pub_your_public_key',
    baseUrl: 'https://api.polypay.ai'
  });
</script>
```

The global bundle also exposes:

- `window.PolyPay`
- `window.PolyPayClient`
- `window.PolyPayCheckout`
- `window.PolyPayX402`

Do not use `PolyPayX402` from a public script tag in production because x402 settlement requires your merchant API Key.

## Build

```bash
pnpm install
pnpm build
```
