# PolyPay JavaScript SDK

Official SDK for PolyPay browser checkout integrations and server-side x402 agent payments.

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
- Public Key Mode for browser checkout, no API key exposure in the browser
- automatic short-lived token issuance and refresh
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

const checkout = new PolyPayCheckout();

checkout.redirectToHostedCheckout({
  publicKey: 'pub_your_public_key',
  amount: 100,
  timestamp: Date.now(),
  signature: 'server_generated_signature',
  orderId: 'ORDER_123456',
  notifyUrl: 'https://your-site.com/webhook',
  redirectUrl: 'https://your-site.com/success'
});
```

By default this redirects to:

```text
https://checkout.polypay.ai/en/checkout
```

Use `locale` to choose a localized checkout page, for example:

```ts
checkout.redirectToHostedCheckout(params, { locale: 'zh' });
// https://checkout.polypay.ai/zh/checkout
```

Pass `currency` and `network` only when the merchant already knows the payment method:

```ts
checkout.redirectToHostedCheckout({
  publicKey: 'pub_your_public_key',
  amount: 100,
  timestamp: Date.now(),
  signature: 'server_generated_signature',
  orderId: 'ORDER_123456',
  notifyUrl: 'https://your-site.com/webhook',
  redirectUrl: 'https://your-site.com/success',
  currency: 'USDT',
  network: 'Tron'
});
```

## API Base URL

Pass the server origin as `baseUrl`:

```ts
const client = new PolyPayClient({
  publicKey: 'pub_your_public_key',
  baseUrl: 'https://api.polypay.ai'
});
```

The SDK automatically expands it to:

```text
https://api.polypay.ai/api/v1/sdk
```

If you already pass a URL ending in `/api/v1` or `/api/v1/sdk`, it will preserve the correct path.

## Testing

Browser Public Key Mode is intended for production checkout flows. Validate integrations with a low-risk production order amount and a dedicated webhook endpoint before going live with real traffic.

## API

### `new PolyPayClient(options)`

Options:

- `publicKey: string` Required merchant public key in `pub_xxx` format
- `baseUrl?: string` PolyPay API origin, default `https://api.polypay.ai`
- `timeout?: number` Request timeout in milliseconds, default `30000`
- `autoRefreshWindowSeconds?: number` Refresh token before expiry, default `60`
- `headers?: Record<string, string>` Extra request headers
- `fetch?: typeof fetch` Optional custom fetch implementation

### `client.getSessionToken(forceRefresh?)`

Exchange the public key for a short-lived session token.

```ts
const token = await client.getSessionToken();
console.log(token.token, token.expiresAt);
```

### `client.createOrder(params)`

Create an order with the session token obtained from Public Key Mode. For normal merchant checkout, prefer hosted checkout so PolyPay owns payment method selection.

```ts
const order = await client.createOrder({
  currency: 'USDT',
  network: 'tron',
  amount: 50,
  orderId: 'ORDER_001',
  redirectUrl: 'https://your-site.com/success',
  notifyUrl: 'https://your-site.com/webhook'
});
```

Response fields:

- `tradeId`
- `paymentUrl`
- `amount`
- `actualAmount`
- `address`
- `expiresAt`

### `client.getOrderStatus(tradeId)`

```ts
const status = await client.getOrderStatus(order.tradeId);
console.log(status.status);
```

### `checkout.buildHostedCheckoutUrl(params, options?)`

Build the hosted checkout URL without navigating.

```ts
const url = checkout.buildHostedCheckoutUrl({
  publicKey: 'pub_your_public_key',
  amount: 50,
  timestamp: Date.now(),
  signature: 'server_generated_signature',
  orderId: 'ORDER_001',
  redirectUrl: 'https://your-site.com/success',
  notifyUrl: 'https://your-site.com/webhook'
});
```

The generated URL format is:

```text
https://checkout.polypay.ai/{locale}/checkout?public_key=...&amount=...&signature=...
```

### `checkout.redirectToHostedCheckout(params, options?)`

Redirect the current browser window to PolyPay hosted checkout.

Options:

- `checkoutUrl?: string` Hosted checkout origin, default `https://checkout.polypay.ai`
- `locale?: string` Locale path segment, default `en`

Response fields:

- `tradeId`
- `status`
- `amount`
- `confirmations?`
- `requiredConfirmations?`
- `txHash?`
- `paidAt?`

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
