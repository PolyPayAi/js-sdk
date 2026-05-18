import { PolyPayCheckout } from './checkout';
import { PolyPayClient } from './client';
import { PolyPayError } from './errors';
import { PolyPayX402, polypayX402 } from './x402';

const api = {
  PolyPayClient,
  PolyPayCheckout,
  PolyPayError,
  PolyPayX402,
  polypayX402
};

declare global {
  interface Window {
    PolyPay?: typeof api;
    PolyPayClient?: typeof PolyPayClient;
    PolyPayCheckout?: typeof PolyPayCheckout;
    PolyPayX402?: typeof PolyPayX402;
  }
}

if (typeof window !== 'undefined') {
  window.PolyPay = api;
  window.PolyPayClient = PolyPayClient;
  window.PolyPayCheckout = PolyPayCheckout;
  window.PolyPayX402 = PolyPayX402;
}

export default api;
