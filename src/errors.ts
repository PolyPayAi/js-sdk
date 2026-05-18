export class PolyPayError extends Error {
  public readonly code: number | string;
  public readonly status: number;
  public readonly payload?: unknown;

  constructor(message: string, options?: { code?: number | string; status?: number; payload?: unknown }) {
    super(message);
    this.name = 'PolyPayError';
    this.code = options?.code ?? 'UNKNOWN_ERROR';
    this.status = options?.status ?? 0;
    this.payload = options?.payload;
  }
}
