import {toPbm} from './formats/pbm.js';
import {toPng} from './formats/png.js';
import {toImageData} from './formats/image-data.js';
import {stitch} from './formats/stitch.js';
import EscPosRenderer from './renderers/esc-pos.js';
import StarPrntRenderer from './renderers/star-prnt.js';

/*
    ReceiptPrinterRenderer

    Entry point of the package. It exports the renderers and the image format
    helpers, and re-exports the public types of src/types.js, which are the
    contract between the renderers and the printer drivers that use them, see
    documentation/design.md.

    The implementation follows the design document.
*/

/**
 * @typedef {import('./types.js').Bitmap} Bitmap
 * @typedef {import('./types.js').ImageItem} ImageItem
 * @typedef {import('./types.js').CutItem} CutItem
 * @typedef {import('./types.js').PulseItem} PulseItem
 * @typedef {import('./types.js').FeedItem} FeedItem
 * @typedef {import('./types.js').UnknownItem} UnknownItem
 * @typedef {import('./types.js').RenderItem} RenderItem
 * @typedef {import('./types.js').RenderCommand} RenderCommand
 * @typedef {import('./types.js').RendererOptions} RendererOptions
 * @typedef {import('./types.js').CellSize} CellSize
 * @typedef {import('./types.js').Profile} Profile
 * @typedef {import('./types.js').PackedFont} PackedFont
 * @typedef {import('./formats/stitch.js').StitchOptions} StitchOptions
 */

export {EscPosRenderer, StarPrntRenderer, toPbm, toPng, toImageData, stitch};
