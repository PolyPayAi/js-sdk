import { PolyPayError } from './errors';
import {
  CreateOrderParams,
  CreateOrderResponse,
  OrderStatusResponse,
  PolyPayClientOptions,
  SessionTokenPayload
} from './types';

const DISABLED_MESSAGE =
  'Browser Public Key API mode has been disabled. Create a Hosted Checkout URL on your merchant server and pass that URL to PolyPayCheckout.redirect().';

/**
 * @deprecated Public Key and browser-controlled Origin headers cannot authenticate order creation.
 * Use the merchant server Hosted Checkout API and redirect the returned URL instead.
 */
export class PolyPayClient {
  constructor(_options: PolyPayClientOptions) {
    throw new PolyPayError(DISABLED_MESSAGE);
  }

  /** @deprecated Browser Session Token issuance is disabled. */
  async getSessionToken(_forceRefresh = false): Promise<SessionTokenPayload> {
    throw new PolyPayError(DISABLED_MESSAGE);
  }

  /** @deprecated Create orders from the merchant server instead. */
  async createOrder(_params: CreateOrderParams): Promise<CreateOrderResponse> {
    throw new PolyPayError(DISABLED_MESSAGE);
  }

  /** @deprecated Query order status from the merchant server or Hosted Checkout. */
  async getOrderStatus(_tradeId: string): Promise<OrderStatusResponse> {
    throw new PolyPayError(DISABLED_MESSAGE);
  }
}
