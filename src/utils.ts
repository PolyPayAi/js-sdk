import { ApiEnvelope } from './types';
import { PolyPayError } from './errors';

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl);
  if (trimmed.endsWith('/api/v1/sdk')) {
    return trimmed;
  }
  if (trimmed.endsWith('/api/v1')) {
    return `${trimmed}/sdk`;
  }
  return `${trimmed}/api/v1/sdk`;
}

export function normalizeX402Url(baseUrl: string): string {
  const trimmed = trimTrailingSlash(baseUrl);
  if (trimmed.endsWith('/api/v1/pay/x402')) {
    return trimmed;
  }
  if (trimmed.endsWith('/api/v1/pay')) {
    return `${trimmed}/x402`;
  }
  if (trimmed.endsWith('/api/v1/x402')) {
    return trimmed;
  }
  if (trimmed.endsWith('/api/v1')) {
    return `${trimmed}/pay/x402`;
  }
  return `${trimmed}/api/v1/pay/x402`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function assertBrowser(): void {
  if (typeof window === 'undefined') {
    throw new PolyPayError('PolyPay browser SDK must run in a browser environment.');
  }
}

export async function parseApiResponse<T>(response: Response): Promise<T> {
  let body: ApiEnvelope<T> | null = null;

  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new PolyPayError('Invalid JSON response from PolyPay.', {
      status: response.status
    });
  }

  if (!response.ok) {
    throw new PolyPayError(body.message || `HTTP ${response.status}`, {
      code: body.code,
      status: response.status,
      payload: body
    });
  }

  if (!body || body.code !== 0) {
    throw new PolyPayError(body?.message || 'PolyPay request failed.', {
      code: body?.code,
      status: response.status,
      payload: body
    });
  }

  return body.data;
}

export function createTimeoutController(timeout: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeout);

  return {
    controller,
    cleanup: () => globalThis.clearTimeout(timer)
  };
}
