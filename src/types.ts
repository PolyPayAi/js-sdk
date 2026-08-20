export type Currency = 'USDT' | 'USDC' | 'BUSD' | (string & {});

export type Network = 'tron' | 'ethereum' | 'bsc' | 'solana' | 'polygon' | (string & {});

export type OrderStatus = 'pending' | 'paid' | 'expired' | 'cancelled' | 'unknown';

export interface PolyPayClientOptions {
  publicKey: string;
  baseUrl?: string;
  tokenPath?: string;
  ordersPath?: string;
  timeout?: number;
  autoRefreshWindowSeconds?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface CreateOrderParams {
  currency: Currency;
  network: Network;
  amount: number;
  orderId?: string;
  redirectUrl?: string;
  notifyUrl?: string;
}

export interface HostedCheckoutParams {
  publicKey: string;
  amount: number | string;
  timestamp: number | string;
  signature: string;
  orderId?: string;
  redirectUrl?: string;
  notifyUrl?: string;
  contract?: string;
  currency?: Currency;
  network?: Network;
}

export interface HostedCheckoutOptions {
  checkoutUrl?: string;
  locale?: string;
}

export interface SessionTokenPayload {
  token: string;
  expiresAt: number;
}

export interface CreateOrderResponse {
  tradeId: string;
  paymentUrl: string;
  amount: number;
  actualAmount: number;
  address: string;
  expiresAt: number;
}

export interface OrderStatusResponse {
  tradeId: string;
  status: OrderStatus;
  amount: number;
  confirmations?: number;
  requiredConfirmations?: number;
  txHash?: string;
  paidAt?: number;
}

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface ModalOptions {
  width?: string;
  height?: string;
  onClose?: () => void;
}

export interface PollStatusOptions {
  interval?: number;
  timeout?: number;
  signal?: AbortSignal;
}

export interface CheckoutStatusEventMap {
  pending: OrderStatusResponse;
  paid: OrderStatusResponse;
  expired: OrderStatusResponse;
  cancelled: OrderStatusResponse;
  unknown: OrderStatusResponse;
  error: Error;
}

export interface X402PaymentRequirements {
  scheme: 'exact';
  network: 'eip155:8453' | 'eip155:1' | 'eip155:137' | 'eip155:42161' | 'eip155:10';
  amount?: string;
  price?: string;
  maxAmountRequired?: string;
  asset: 'USDC' | string;
  assetContract?: string;
  payTo: string;
  resource?: string;
  method?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402GuardOptions {
  apiKey: string;
  facilitatorUrl?: string;
  timeout?: number;
  fetch?: typeof fetch;
  protocolVersion?: 1 | 2;
  resource: Omit<X402PaymentRequirements, 'scheme' | 'network' | 'asset' | 'resource' | 'payTo'> &
    Partial<Pick<X402PaymentRequirements, 'scheme' | 'network' | 'asset'>> & {
      resource: string;
      payTo: string;
    };
}

export interface X402VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
  payment?: unknown;
}

export interface X402SettleResult {
  success: boolean;
  invalidReason?: string;
  errorReason?: string;
  transaction?: string;
  blockNumber?: number;
  status?: string;
  network?: string;
  payer?: string;
  amount?: string;
  paymentId?: string;
  replayed?: boolean;
  extensions?: Record<string, unknown>;
}

export interface X402GuardResult {
  paid: boolean;
  shouldFulfill: boolean;
  fulfillmentKey?: string;
  required: () => Response;
  verify?: X402VerifyResult;
  settle?: X402SettleResult;
  responseHeaders?: Record<string, string>;
}
