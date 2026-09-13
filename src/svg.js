import {toSvg} from './svg/writer.js';

/*
    The SVG sub-entry, @point-of-sale/receipt-printer-renderer/svg.

    It turns the display list of the main entry into an SVG document. It is an
    entry of its own because it carries the glyph outlines of
    generated/outlines.js, 344 kB of source, which a driver that renders images
    for a printer has no use for: nothing of src/ imports the outlines but this
    entry, and test/umd/check.js asserts that the main bundle does not hold one.

        import ReceiptPrinterRenderer from '@point-of-sale/receipt-printer-renderer';
        import { toSvg } from '@point-of-sale/receipt-printer-renderer/svg';

        const renderer = new ReceiptPrinterRenderer({ language: 'esc-pos', width: 576 });
        const svg = toSvg(renderer.layout(bytes));

    The document it writes is described in documentation/usage.md and in the
    SVG section of documentation/design.md; the list it reads is documented in
    documentation/display-list.md.
*/

/**
 * @typedef {import('./types.js').Layout} Layout
 * @typedef {import('./types.js').SvgOptions} SvgOptions
 */

export default toSvg;

export {toSvg};
