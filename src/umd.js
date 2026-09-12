import ReceiptPrinterRenderer from './receipt-printer-renderer.js';

/*
    Entry point of the UMD build.

    The package entry has a default export and named exports, which a UMD
    bundle cannot have both of: its global would become an object with a
    `default` property instead of the class. This module exports the class
    alone, so that the global of the browser bundle is the class itself and
    `new ReceiptPrinterRenderer({ ... })` works from a script tag, the way it
    does for ReceiptPrinterEncoder. The renderers and the image format helpers
    are static properties of the class, so nothing is out of reach.
*/

export default ReceiptPrinterRenderer;
