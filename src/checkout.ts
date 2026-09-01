import { PolyPayError } from './errors';
import { ModalOptions } from './types';
import { assertBrowser } from './utils';

/** Opens opaque Hosted Checkout URLs created by a trusted merchant server. */
export class PolyPayCheckout {
  private popupWindow: Window | null = null;

  /** Redirects the current browser window to a server-created Hosted Checkout URL. */
  redirect(checkoutUrl: string): void {
    if (!checkoutUrl?.trim()) {
      throw new PolyPayError('checkoutUrl is required.');
    }
    assertBrowser();
    window.location.href = checkoutUrl;
  }

  /** Opens a server-created Hosted Checkout URL in a popup window. */
  openModal(checkoutUrl: string, options: ModalOptions = {}): Window | null {
    if (!checkoutUrl?.trim()) {
      throw new PolyPayError('checkoutUrl is required.');
    }
    assertBrowser();

    const width = options.width ?? '450px';
    const height = options.height ?? '650px';
    const parsedWidth = Number.parseInt(width, 10) || 450;
    const parsedHeight = Number.parseInt(height, 10) || 650;
    const left = Math.max((window.screen.width - parsedWidth) / 2, 0);
    const top = Math.max((window.screen.height - parsedHeight) / 2, 0);

    this.popupWindow = window.open(
      checkoutUrl,
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
}
