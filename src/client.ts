import { PolyPayError } from './errors';
import {
  CreateOrderParams,
  CreateOrderResponse,
  OrderStatusResponse,
  PolyPayClientOptions,
  SessionTokenPayload
} from './types';
import {
  assertBrowser,
  createTimeoutController,
  normalizeBaseUrl,
  parseApiResponse
} from './utils';

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class PolyPayClient {
  private readonly publicKey: string;
  private readonly baseUrl: string;
  private readonly tokenPath: string;
  private readonly ordersPath: string;
  private readonly timeout: number;
  private readonly autoRefreshWindowSeconds: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private tokenCache: CachedToken | null = null;
  private inflightTokenPromise: Promise<CachedToken> | null = null;

  constructor(options: PolyPayClientOptions) {
    if (!options.publicKey?.trim()) {
      throw new PolyPayError('publicKey is required.');
    }

    this.publicKey = options.publicKey.trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://api.polypay.ai');
    this.tokenPath = options.tokenPath ?? '/token';
    this.ordersPath = options.ordersPath ?? '/orders';
    this.timeout = options.timeout ?? 30000;
    this.autoRefreshWindowSeconds = options.autoRefreshWindowSeconds ?? 60;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  async getSessionToken(forceRefresh = false): Promise<SessionTokenPayload> {
    const token = await this.ensureSessionToken(forceRefresh);
    return {
      token: token.token,
      expiresAt: token.expiresAt
    };
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResponse> {
    if (!params.currency) {
      throw new PolyPayError('currency is required.');
    }
    if (!params.network) {
      throw new PolyPayError('network is required.');
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new PolyPayError('amount must be a positive number.');
    }

    const token = await this.ensureSessionToken();
    const data = await this.request<CreateOrderResponse>(this.ordersPath, {
      method: 'POST',
      token: token.token,
      body: {
        currency: params.currency,
        network: params.network,
        amount: params.amount,
        order_id: params.orderId,
        redirect_url: params.redirectUrl,
        notify_url: params.notifyUrl
      }
    });

    return {
      tradeId: data.tradeId,
      paymentUrl: data.paymentUrl,
      amount: data.amount,
      actualAmount: data.actualAmount,
      address: data.address,
      expiresAt: data.expiresAt
    };
  }

  async getOrderStatus(tradeId: string): Promise<OrderStatusResponse> {
    if (!tradeId?.trim()) {
      throw new PolyPayError('tradeId is required.');
    }

    const token = await this.ensureSessionToken();
    return this.request<OrderStatusResponse>(`${this.ordersPath}/${encodeURIComponent(tradeId)}/status`, {
      method: 'GET',
      token: token.token
    });
  }

  private async ensureSessionToken(forceRefresh = false): Promise<CachedToken> {
    assertBrowser();

    if (!forceRefresh && this.tokenCache && !this.isTokenExpiring(this.tokenCache.expiresAt)) {
      return this.tokenCache;
    }

    if (!forceRefresh && this.inflightTokenPromise) {
      return this.inflightTokenPromise;
    }

    this.inflightTokenPromise = this.issueToken().finally(() => {
      this.inflightTokenPromise = null;
    });

    this.tokenCache = await this.inflightTokenPromise;
    return this.tokenCache;
  }

  private isTokenExpiring(expiresAt: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return expiresAt - now <= this.autoRefreshWindowSeconds;
  }

  private async issueToken(): Promise<CachedToken> {
    const data = await this.request<{
      token: string;
      expiresAt: number;
    }>(this.tokenPath, {
      method: 'POST',
      body: {
        public_key: this.publicKey,
        timestamp: Date.now()
      }
    });

    if (!data.token) {
      throw new PolyPayError('PolyPay token response is missing token.');
    }

    return {
      token: data.token,
      expiresAt: data.expiresAt
    };
  }

  private async request<T>(
    path: string,
    options: {
      method: 'GET' | 'POST';
      token?: string;
      body?: Record<string, unknown>;
    }
  ): Promise<T> {
    assertBrowser();

    const { controller, cleanup } = createTimeoutController(this.timeout);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      const data = await parseApiResponse<T | Record<string, unknown>>(response);
      return this.normalizeKeys(data) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new PolyPayError('PolyPay request timed out.');
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  private normalizeKeys<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeKeys(item)) as T;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const normalized: Record<string, unknown> = {};

      for (const [key, item] of Object.entries(record)) {
        const camelKey = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
        normalized[camelKey] = this.normalizeKeys(item);
      }

      return normalized as T;
    }

    return value;
  }
}
