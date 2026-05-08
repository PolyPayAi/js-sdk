import { PonponPayCheckout } from './checkout';
import { PonponPayClient } from './client';
import { PonponPayError } from './errors';
import { PonponPayX402, ponponpayX402 } from './x402';

const api = {
  PonponPayClient,
  PonponPayCheckout,
  PonponPayError,
  PonponPayX402,
  ponponpayX402
};

declare global {
  interface Window {
    PonponPay?: typeof api;
    PonponPayClient?: typeof PonponPayClient;
    PonponPayCheckout?: typeof PonponPayCheckout;
    PonponPayX402?: typeof PonponPayX402;
  }
}

if (typeof window !== 'undefined') {
  window.PonponPay = api;
  window.PonponPayClient = PonponPayClient;
  window.PonponPayCheckout = PonponPayCheckout;
  window.PonponPayX402 = PonponPayX402;
}

export default api;
