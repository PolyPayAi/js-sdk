# PolyPay JavaScript SDK

Official SDK for secure Hosted Checkout redirects and server-side x402 agent payments.

> Browser Public Key order creation has been removed in 2.0. Create Hosted Checkout
> on a trusted merchant server with an API Key, then pass only the opaque
> `checkout_url` to the browser.

## Features

- Redirect or open a popup using a server-created Hosted Checkout URL
- No API Key, amount, callback URL, or signing material in browser code
- Server-side x402 verification and settlement helpers
- TypeScript types with no runtime dependencies

## Installation

```bash
pnpm add @polypay/sdk
```

## Hosted Checkout

Create Checkout on the merchant server:

```ts
const response = await fetch('https://api.polypay.ai/api/v1/pay/order/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.POLYPAY_API_KEY!
  },
  body: JSON.stringify({
    amount: 100,
    mch_order_id: 'ORDER_123456',
    notify_url: 'https://merchant.example.com/webhooks/polypay',
    redirect_url: 'https://merchant.example.com/orders/ORDER_123456'
  })
});

const { data } = await response.json();
return { checkoutUrl: data.checkout_url };
```

Open the returned URL in the browser:

```ts
import { PolyPayCheckout } from '@polypay/sdk/browser';

const { checkoutUrl } = await fetch('/api/create-polypay-checkout', {
  method: 'POST'
}).then((response) => response.json());

new PolyPayCheckout().redirect(checkoutUrl);
```

To use a popup:

```ts
new PolyPayCheckout().openModal(checkoutUrl, {
  width: '450px',
  height: '650px',
  onClose: () => console.log('checkout popup closed')
});
```

Payment confirmation must come from a verified Webhook or an authenticated
server-side order query. A redirect or popup close is not proof of payment.

## 2.0 Migration

Remove all browser uses of:

- `PolyPayClient`
- `getSessionToken()`
- `createOrder()` and `getOrderStatus()`
- `buildHostedCheckoutUrl()` and `redirectToHostedCheckout()`
- browser-side `publicKey`, amount, signature, callback, and order parameters

Replace them with a server endpoint that creates Hosted Checkout and returns only
`checkout_url`. `PolyPayCheckout.redirect()` and `openModal()` accept that URL.

## x402 Agent Payments

Use `@polypay/sdk/x402` only in server-side code. It requires your merchant API
Key and must never be bundled into browser code.

```ts
import { polypayX402 } from '@polypay/sdk/x402';

const x402 = polypayX402({
  apiKey: process.env.POLYPAY_API_KEY!,
  resource: {
    resource: 'https://merchant.example.com/api/premium-data',
    method: 'GET',
    price: '$0.01',
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

The helper emits x402 v2 by default. Set `protocolVersion: 1` only during a
controlled legacy migration. Persist `fulfillmentKey` under a unique constraint
and run state-changing fulfillment only when `shouldFulfill` is true.

Supported standard x402 networks:

| Network | Chain |
| --- | --- |
| `eip155:8453` | Base |
| `eip155:1` | Ethereum |
| `eip155:137` | Polygon |
| `eip155:42161` | Arbitrum |
| `eip155:10` | Optimism |

Only standard EVM `exact` payments with Circle USDC
`transferWithAuthorization` are supported. If settlement times out, reconcile or
retry the same signed proof; do not create a replacement authorization solely
because the result is indeterminate.

## Script Tag Build

```html
<script src="/path/to/polypay.min.global.js"></script>
<script>
  const checkout = new PolyPay.PolyPayCheckout();
  checkout.redirect(serverCreatedCheckoutUrl);
</script>
```

The global bundle exposes `window.PolyPay`, `window.PolyPayCheckout`, and
`window.PolyPayX402`. Do not use `PolyPayX402` from a public script tag because
x402 settlement requires a server-only API Key.

## Build

```bash
pnpm install
pnpm test
```
