import {toPbm} from './formats/pbm.js';
import {toImageData} from './formats/image-data.js';

/*
    ReceiptPrinterRenderer

    Entry point of the package. It exports the renderers and the image format
    helpers. The type definitions below are the contract between the renderers
    and the printer drivers that use them, see documentation/design.md.

    The implementation follows the design document. Nothing below is final until
    the first renderer lands.
*/

/**
 * A 1-bit image. One bit per pixel, most significant bit first, every row
 * padded to a whole number of bytes, a set bit is a black dot.
 *
 * @typedef {object} Bitmap
 * @property {number} width    Width in dots
 * @property {number} height   Height in dots
 * @property {Uint8Array} data Packed rows, Math.ceil(width / 8) bytes per row
 */

/**
 * @typedef {object} ImageItem
 * @property {'image'} type
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data
 */

/**
 * @typedef {object} CutItem
 * @property {'cut'} type
 * @property {'full' | 'partial'} value
 */

/**
 * @typedef {object} PulseItem
 * @property {'pulse'} type
 * @property {number} device   0 or 1
 * @property {number} on       Pulse on time in milliseconds
 * @property {number} off      Pulse off time in milliseconds
 */

/**
 * @typedef {object} FeedItem
 * @property {'feed'} type
 * @property {number} height   Number of blank dot rows
 */

/**
 * @typedef {object} UnknownItem
 * @property {'unknown'} type
 * @property {Uint8Array} data   The bytes of the command that was not understood
 */

/** @typedef {ImageItem | CutItem | PulseItem | FeedItem | UnknownItem} RenderItem */

/** @typedef {'cut' | 'pulse' | 'feed' | 'unknown'} RenderCommand */

/**
 * @typedef {object} RendererOptions
 * @property {number} width                  Width of the print area in dots, a multiple of 8
 * @property {string} [codepageMapping]      Codepage mapping the commands were encoded with, defaults to 'epson'
 * @property {RenderCommand[]} [commands]    Command types that appear in the output, the rest is dropped
 * @property {number} [maxHeight]            Maximum height of an image item, taller segments are split
 * @property {number} [lineSpacing]          Default line spacing in dots, defaults to 30
 * @property {number} [feedThreshold]        Runs of blank rows at least this tall become feed items
 */

/* EscPosRenderer and StarPrntRenderer are added when the renderers land */

export {toPbm, toImageData};
