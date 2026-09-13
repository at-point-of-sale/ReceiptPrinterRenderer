import {toSvg} from './svg/writer.js';

/*
    Entry point of the UMD build of the SVG sub-entry.

    A UMD bundle cannot have a default export and named exports at once, and the
    global of this one is an object with toSvg() on it rather than the function
    itself: a page that loads the renderer and the writer from two script tags
    gets ReceiptPrinterRendererSvg.toSvg(layout), which reads the way the module
    import does, and the object has room for whatever the entry gains later.
*/

export {toSvg};
