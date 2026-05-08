import { PonponPayError } from './errors';
import { CheckoutStatusEventMap, ModalOptions, OrderStatusResponse, PollStatusOptions } from './types';
import { assertBrowser, sleep } from './utils';
import { PonponPayClient } from './client';

type EventName = keyof CheckoutStatusEventMap;
type EventHandler<T extends EventName> = (payload: CheckoutStatusEventMap[T]) => void;

export class PonponPayCheckout {
  private readonly client?: PonponPayClient;
  private popupWindow: Window | null = null;
  private pollAbortController: AbortController | null = null;
  private readonly handlers: Map<EventName, Set<(payload: unknown) => void>> = new Map();

  constructor(client?: PonponPayClient) {
    this.client = client;
  }

  redirect(paymentUrl: string): void {
    assertBrowser();
    if (!paymentUrl) {
      throw new PonponPayError('paymentUrl is required.');
    }
    window.location.href = paymentUrl;
  }

  openModal(paymentUrl: string, options: ModalOptions = {}): Window | null {
    assertBrowser();
    if (!paymentUrl) {
      throw new PonponPayError('paymentUrl is required.');
    }

    const width = options.width ?? '450px';
    const height = options.height ?? '650px';
    const parsedWidth = Number.parseInt(width, 10) || 450;
    const parsedHeight = Number.parseInt(height, 10) || 650;
    const left = Math.max((window.screen.width - parsedWidth) / 2, 0);
    const top = Math.max((window.screen.height - parsedHeight) / 2, 0);

    this.popupWindow = window.open(
      paymentUrl,
      'ponponpay_checkout',
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
      throw new PonponPayError('PonponPayCheckout requires a PonponPayClient instance for pollStatus().');
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
        const error = new PonponPayError('Payment status polling timed out.');
        this.emit('error', error);
        throw error;
      }

      await sleep(interval);
    }

    const error = new PonponPayError('Payment status polling was aborted.');
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
