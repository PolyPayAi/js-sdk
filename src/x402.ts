import { PolyPayError } from './errors';
import {
  X402GuardOptions,
  X402GuardResult,
  X402PaymentRequirements,
  X402SettleResult,
  X402VerifyResult
} from './types';
import { createTimeoutController, normalizeX402Url, parseApiResponse } from './utils';

const X_PAYMENT_HEADER = 'x-payment';
const USDC_CONTRACTS: Record<string, string> = {
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:137': '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
};

export class PolyPayX402 {
  private readonly apiKey: string;
  private readonly facilitatorUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly requirement: X402PaymentRequirements;

  constructor(options: X402GuardOptions) {
    if (!options.apiKey?.trim()) {
      throw new PolyPayError('apiKey is required for x402.');
    }
    if (!options.resource?.resource) {
      throw new PolyPayError('resource.resource is required for x402.');
    }
    if (!options.resource?.payTo) {
      throw new PolyPayError('resource.payTo is required for x402.');
    }

    this.apiKey = options.apiKey.trim();
    this.facilitatorUrl = normalizeX402Url(options.facilitatorUrl ?? 'https://api.polypay.ai');
    this.timeout = options.timeout ?? 30000;
    this.fetchImpl = options.fetch ?? fetch;
    const { scheme, network, asset, assetContract, maxTimeoutSeconds, ...resource } = options.resource;
    const resolvedNetwork = network ?? 'eip155:8453';

    this.requirement = {
      ...resource,
      scheme: scheme ?? 'exact',
      network: resolvedNetwork,
      asset: asset ?? 'USDC',
      assetContract: assetContract ?? USDC_CONTRACTS[resolvedNetwork],
      maxTimeoutSeconds: maxTimeoutSeconds ?? 60
    };
  }

  requirementResponse(): Response {
    return new Response(
      JSON.stringify({
        x402Version: 1,
        accepts: [this.requirement]
      }),
      {
        status: 402,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }

  async verifyAndSettle(request: Request): Promise<X402GuardResult> {
    const payment = request.headers.get(X_PAYMENT_HEADER);

    if (!payment) {
      return {
        paid: false,
        required: () => this.requirementResponse()
      };
    }

    const current = {
      method: request.method,
      resource: this.resolveRequestResource(request)
    };

    const verify = await this.verify(payment, current);
    if (!verify.isValid) {
      return {
        paid: false,
        verify,
        required: () => this.requirementResponse()
      };
    }

    const settle = await this.settle(payment, current);
    return {
      paid: settle.success,
      verify,
      settle,
      required: () => this.requirementResponse()
    };
  }

  async verify(payment: string, current?: { method?: string; resource?: string }): Promise<X402VerifyResult> {
    return this.request<X402VerifyResult>('/verify', {
      payment,
      paymentRequirements: this.requirement,
      method: current?.method,
      resource: current?.resource
    });
  }

  async settle(payment: string, current?: { method?: string; resource?: string }): Promise<X402SettleResult> {
    return this.request<X402SettleResult>('/settle', {
      payment,
      paymentRequirements: this.requirement,
      method: current?.method,
      resource: current?.resource
    });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const { controller, cleanup } = createTimeoutController(this.timeout);

    try {
      const response = await this.fetchImpl(`${this.facilitatorUrl}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body)
      });

      return parseApiResponse<T>(response);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new PolyPayError('PolyPay x402 request timed out.');
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  private resolveRequestResource(request: Request): string {
    return request.url;
  }
}

export function polypayX402(options: X402GuardOptions): PolyPayX402 {
  return new PolyPayX402(options);
}
