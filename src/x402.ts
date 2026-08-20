import { PolyPayError } from './errors';
import {
  X402GuardOptions,
  X402GuardResult,
  X402PaymentRequirements,
  X402SettleResult,
  X402VerifyResult
} from './types';
import { createTimeoutController, normalizeX402Url, parseApiResponse } from './utils';

const PAYMENT_SIGNATURE_HEADER = 'payment-signature';
const LEGACY_PAYMENT_HEADER = 'x-payment';
const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
const LEGACY_PAYMENT_RESPONSE_HEADER = 'X-PAYMENT-RESPONSE';
const USDC_CONTRACTS: Record<string, string> = {
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:1': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  'eip155:137': '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  'eip155:42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'eip155:10': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'
};

export class PolyPayX402 {
  private readonly apiKey: string;
  private readonly facilitatorUrl: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly requirement: X402PaymentRequirements;
  private readonly protocolVersion: 1 | 2;
  private readonly resourceInfo: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  private readonly resourceMethod?: string;

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

    const amount =
      options.resource.amount ??
      options.resource.maxAmountRequired ??
      amountFromUSDCPrice(options.resource.price);
    if (!amount) {
      throw new PolyPayError(
        'resource.amount, resource.maxAmountRequired, or resource.price is required for x402.'
      );
    }

    this.apiKey = options.apiKey.trim();
    this.facilitatorUrl = normalizeX402Url(options.facilitatorUrl ?? 'https://api.polypay.ai');
    this.timeout = options.timeout ?? 30000;
    this.fetchImpl = options.fetch ?? fetch;
    this.protocolVersion = options.protocolVersion ?? 2;
    if (this.protocolVersion !== 1 && this.protocolVersion !== 2) {
      throw new PolyPayError('protocolVersion must be 1 or 2.');
    }
    this.resourceInfo = {
      url: options.resource.resource,
      description: options.resource.description,
      mimeType: options.resource.mimeType
    };
    this.resourceMethod = options.resource.method?.trim().toUpperCase();
    const {
      scheme,
      network,
      asset,
      assetContract,
      maxTimeoutSeconds,
      amount: _amount,
      maxAmountRequired: _maxAmountRequired,
      extra,
      ...resource
    } = options.resource;
    const resolvedNetwork = network ?? 'eip155:8453';
    const supportedAssetContract = USDC_CONTRACTS[resolvedNetwork];
    if (!supportedAssetContract) {
      throw new PolyPayError(`Unsupported x402 network: ${resolvedNetwork}.`);
    }
    if (scheme !== undefined && scheme !== 'exact') {
      throw new PolyPayError(`Unsupported x402 scheme: ${scheme}.`);
    }
    const resolvedAssetContract =
      assetContract ??
      (asset?.startsWith('0x') ? asset : supportedAssetContract);
    if (resolvedAssetContract.toLowerCase() !== supportedAssetContract.toLowerCase()) {
      throw new PolyPayError(`Unsupported USDC contract for x402 network ${resolvedNetwork}.`);
    }
    if (asset && asset !== 'USDC' && asset.toLowerCase() !== supportedAssetContract.toLowerCase()) {
      throw new PolyPayError(`Unsupported x402 asset for network ${resolvedNetwork}.`);
    }
    if (extra?.assetTransferMethod !== undefined && extra.assetTransferMethod !== 'eip3009') {
      throw new PolyPayError('Unsupported x402 assetTransferMethod.');
    }
    if (extra?.name !== undefined && extra.name !== 'USD Coin') {
      throw new PolyPayError('Unsupported x402 asset metadata name.');
    }
    if (extra?.version !== undefined && extra.version !== '2') {
      throw new PolyPayError('Unsupported x402 asset metadata version.');
    }

    this.requirement = this.protocolVersion === 2
      ? {
          scheme: scheme ?? 'exact',
          network: resolvedNetwork,
          amount,
          asset: resolvedAssetContract,
          payTo: resource.payTo,
          maxTimeoutSeconds: maxTimeoutSeconds ?? 60,
          extra: {
            assetTransferMethod: 'eip3009',
            name: 'USD Coin',
            version: '2',
            ...extra
          }
        }
      : {
          ...resource,
          scheme: scheme ?? 'exact',
          network: resolvedNetwork,
          asset: asset ?? 'USDC',
          assetContract: resolvedAssetContract,
          maxAmountRequired: amount,
          maxTimeoutSeconds: maxTimeoutSeconds ?? 60
        };
  }

  requirementResponse(settlement?: X402SettleResult): Response {
    const paymentRequired = this.paymentRequired();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.protocolVersion === 2) {
      headers[PAYMENT_REQUIRED_HEADER] = encodeBase64Json(paymentRequired);
      if (settlement) {
        headers[PAYMENT_RESPONSE_HEADER] = encodeBase64Json(toSettlementResponse(settlement));
      }
    } else if (settlement) {
      headers[LEGACY_PAYMENT_RESPONSE_HEADER] = encodeBase64Json(toSettlementResponse(settlement));
    }
    return new Response(JSON.stringify(paymentRequired), { status: 402, headers });
  }

  async verifyAndSettle(request: Request): Promise<X402GuardResult> {
    const signature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
    const legacyPayment = request.headers.get(LEGACY_PAYMENT_HEADER);
    if (signature && legacyPayment) {
      throw new PolyPayError('Provide only one x402 payment header.');
    }
    const payment = this.protocolVersion === 2 ? signature : legacyPayment;

    if (!payment) {
      return {
        paid: false,
        shouldFulfill: false,
        required: () => this.requirementResponse()
      };
    }

    if (this.resourceMethod && request.method.toUpperCase() !== this.resourceMethod) {
      throw new PolyPayError(
        `Request method ${request.method} does not match configured x402 method ${this.resourceMethod}.`
      );
    }
    const current = {
      method: this.resourceMethod ?? request.method.toUpperCase(),
      resource: this.resourceInfo.url
    };

    const verify = await this.verify(payment, current);
    if (!verify.isValid) {
      return {
        paid: false,
        shouldFulfill: false,
        verify,
        required: () => this.requirementResponse()
      };
    }

    const settle = await this.settle(payment, current);
    const fulfillmentKey = settlementPaymentId(settle);
    const replayed = settlementReplayed(settle);
    return {
      paid: settle.success,
      shouldFulfill: settle.success && !replayed,
      fulfillmentKey,
      verify,
      settle,
      required: () => this.requirementResponse(settle),
      responseHeaders: {
        [this.protocolVersion === 2 ? PAYMENT_RESPONSE_HEADER : LEGACY_PAYMENT_RESPONSE_HEADER]:
          encodeBase64Json(toSettlementResponse(settle))
      }
    };
  }

  async verify(payment: string, current?: { method?: string; resource?: string }): Promise<X402VerifyResult> {
    return this.request<X402VerifyResult>('/verify', {
      ...this.facilitatorPayment(payment),
      paymentRequirements: this.requirement,
      method: current?.method,
      resource: current?.resource
    });
  }

  async settle(payment: string, current?: { method?: string; resource?: string }): Promise<X402SettleResult> {
    return this.request<X402SettleResult>('/settle', {
      ...this.facilitatorPayment(payment),
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

  private paymentRequired(): Record<string, unknown> {
    if (this.protocolVersion === 1) {
      return { x402Version: 1, accepts: [this.requirement] };
    }
    return {
      x402Version: 2,
      error: 'PAYMENT-SIGNATURE header is required',
      resource: this.resourceInfo,
      accepts: [this.requirement],
      extensions: {}
    };
  }

  private facilitatorPayment(payment: string): Record<string, unknown> {
    const decoded = decodeBase64Json(payment);
    const version = typeof decoded.x402Version === 'number' ? decoded.x402Version : 0;
    if (version !== this.protocolVersion) {
      throw new PolyPayError(
        `Payment payload version ${version} does not match configured x402 version ${this.protocolVersion}.`
      );
    }
    if (version === 2) {
      return { x402Version: 2, paymentPayload: decoded };
    }
    if (version === 1) {
      return { x402Version: 1, payment };
    }
    throw new PolyPayError('Unsupported x402 payment version.');
  }
}

function settlementPaymentId(settlement: X402SettleResult): string | undefined {
  if (settlement.paymentId) return settlement.paymentId;
  const extension = settlement.extensions?.polypay;
  if (extension && typeof extension === 'object' && 'paymentId' in extension) {
    const paymentId = (extension as { paymentId?: unknown }).paymentId;
    return typeof paymentId === 'string' && paymentId !== '' ? paymentId : undefined;
  }
  return undefined;
}

function settlementReplayed(settlement: X402SettleResult): boolean {
  if (settlement.replayed === true) return true;
  const extension = settlement.extensions?.polypay;
  return Boolean(
    extension &&
      typeof extension === 'object' &&
      'replayed' in extension &&
      (extension as { replayed?: unknown }).replayed === true
  );
}

export function polypayX402(options: X402GuardOptions): PolyPayX402 {
  return new PolyPayX402(options);
}

function amountFromUSDCPrice(price?: string): string | undefined {
  const normalized = price?.trim().replace(/^\$/, '');
  if (!normalized || !/^\d+(\.\d{1,6})?$/.test(normalized)) return undefined;
  const [whole, fraction = ''] = normalized.split('.');
  const amount = `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
  return amount === '0' ? undefined : amount;
}

function encodeBase64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Json(value: string): Record<string, unknown> {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('invalid payload');
    }
    return decoded as Record<string, unknown>;
  } catch {
    throw new PolyPayError('Invalid x402 payment header.');
  }
}

function toSettlementResponse(result: X402SettleResult): Record<string, unknown> {
  return {
    success: result.success,
    ...(result.errorReason || result.invalidReason
      ? { errorReason: result.errorReason ?? result.invalidReason }
      : {}),
    transaction: result.transaction ?? '',
    network: result.network ?? '',
    ...(result.payer ? { payer: result.payer } : {}),
    ...(result.amount ? { amount: result.amount } : {}),
    ...(result.extensions ? { extensions: result.extensions } : {})
  };
}
