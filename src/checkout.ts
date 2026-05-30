import { PolyPayError } from './errors';
import {
  CheckoutStatusEventMap,
  HostedCheckoutOptions,
  HostedCheckoutParams,
  ModalOptions,
  OrderStatusResponse,
  PollStatusOptions
} from './types';
import { assertBrowser, sleep, trimTrailingSlash } from './utils';
import { PolyPayClient } from './client';

type EventName = keyof CheckoutStatusEventMap;
type EventHandler<T extends EventName> = (payload: CheckoutStatusEventMap[T]) => void;

export class PolyPayCheckout {
  private readonly client?: PolyPayClient;
  private popupWindow: Window | null = null;
  private pollAbortController: AbortController | null = null;
  private readonly handlers: Map<EventName, Set<(payload: unknown) => void>> = new Map();

  constructor(client?: PolyPayClient) {
    this.client = client;
  }

  buildHostedCheckoutUrl(params: HostedCheckoutParams, options: HostedCheckoutOptions = {}): string {
    if (!params.publicKey?.trim()) {
      throw new PolyPayError('publicKey is required.');
    }
    if (params.amount === undefined || params.amount === null || params.amount === '') {
      throw new PolyPayError('amount is required.');
    }
    if (params.timestamp === undefined || params.timestamp === null || params.timestamp === '') {
      throw new PolyPayError('timestamp is required.');
    }
    if (!params.signature?.trim()) {
      throw new PolyPayError('signature is required.');
    }

    const checkoutUrl = trimTrailingSlash(options.checkoutUrl ?? 'https://checkout.polypay.ai');
    const locale = options.locale?.trim() || 'en';
    const url = new URL(`${checkoutUrl}/${encodeURIComponent(locale)}/checkout`);
    const query: Record<string, string | undefined> = {
      public_key: params.publicKey.trim(),
      amount: String(params.amount),
      timestamp: String(params.timestamp),
      signature: params.signature.trim(),
      order_id: params.orderId,
      redirect_url: params.redirectUrl,
      notify_url: params.notifyUrl,
      contract: params.contract,
      currency: params.currency,
      network: params.network
    };

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  redirectToHostedCheckout(params: HostedCheckoutParams, options: HostedCheckoutOptions = {}): void {
    assertBrowser();
    window.location.href = this.buildHostedCheckoutUrl(params, options);
  }

  redirect(paymentUrl: string): void {
    assertBrowser();
    if (!paymentUrl) {
      throw new PolyPayError('paymentUrl is required.');
    }
    window.location.href = paymentUrl;
  }

  openModal(paymentUrl: string, options: ModalOptions = {}): Window | null {
    assertBrowser();
    if (!paymentUrl) {
      throw new PolyPayError('paymentUrl is required.');
    }

    const width = options.width ?? '450px';
    const height = options.height ?? '650px';
    const parsedWidth = Number.parseInt(width, 10) || 450;
    const parsedHeight = Number.parseInt(height, 10) || 650;
    const left = Math.max((window.screen.width - parsedWidth) / 2, 0);
    const top = Math.max((window.screen.height - parsedHeight) / 2, 0);

    this.popupWindow = window.open(
      paymentUrl,
      'polypay_checkout',
      `popup=yes,width=${parsedWidth},height=${parsedHeight},left=${left},top=${top}`
    );

    if (this.popupWindow && options.onClose) {
      const timer = window.setInterval(() => {
        if (!this.popupWindow || this.popupWindow.closed) {
          window.clearInterval(timer);
          this.popupWindow = null;
          options.onClose?.();
        }
      }, 500);
    }

    return this.popupWindow;
  }

  async pollStatus(tradeId: string, options: PollStatusOptions = {}): Promise<OrderStatusResponse> {
    if (!this.client) {
      throw new PolyPayError('PolyPayCheckout requires a PolyPayClient instance for pollStatus().');
    }

    this.stopPolling();

    const interval = options.interval ?? 3000;
    const timeout = options.timeout ?? 30 * 60 * 1000;
    const externalSignal = options.signal;
    const abortController = new AbortController();
    this.pollAbortController = abortController;

    const startedAt = Date.now();

    while (!abortController.signal.aborted && !externalSignal?.aborted) {
      const status = await this.client.getOrderStatus(tradeId);
      this.emit(status.status, status);

      if (status.status === 'paid' || status.status === 'expired' || status.status === 'cancelled') {
        this.stopPolling();
        return status;
      }

      if (Date.now() - startedAt >= timeout) {
        this.stopPolling();
        const error = new PolyPayError('Payment status polling timed out.');
        this.emit('error', error);
        throw error;
      }

      await sleep(interval);
    }

    const error = new PolyPayError('Payment status polling was aborted.');
    this.emit('error', error);
    throw error;
  }

  stopPolling(): void {
    if (this.pollAbortController) {
      this.pollAbortController.abort();
      this.pollAbortController = null;
    }
  }

  on<T extends EventName>(event: T, handler: EventHandler<T>): () => void {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(handler as (payload: unknown) => void);
    this.handlers.set(event, listeners);

    return () => {
      listeners.delete(handler as (payload: unknown) => void);
      if (listeners.size === 0) {
        this.handlers.delete(event);
      }
    };
  }

  private emit<T extends EventName>(event: T, payload: CheckoutStatusEventMap[T]): void {
    const listeners = this.handlers.get(event);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }
}
