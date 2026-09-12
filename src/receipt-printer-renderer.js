import {toPbm} from './formats/pbm.js';
import {toPng} from './formats/png.js';
import {toImageData} from './formats/image-data.js';
import {stitch} from './formats/stitch.js';
import EscPosRenderer from './renderers/esc-pos.js';
import StarPrntRenderer from './renderers/star-prnt.js';

/*
    ReceiptPrinterRenderer

    Entry point of the package. It holds the unified renderer, a thin class
    that picks the renderer of a language the way ReceiptPrinterEncoder picks
    its language, and it exports the two renderers and the image format helpers
    by name as well.

    It also re-exports the public types of src/types.js, which are the contract
    between the renderers and the printer drivers that use them, see
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
 * @typedef {import('./types.js').RenderLanguage} RenderLanguage
 * @typedef {import('./types.js').RendererOptions} RendererOptions
 * @typedef {import('./types.js').ReceiptPrinterRendererOptions} ReceiptPrinterRendererOptions
 * @typedef {import('./types.js').CellSize} CellSize
 * @typedef {import('./types.js').Profile} Profile
 * @typedef {import('./types.js').PackedFont} PackedFont
 * @typedef {import('./formats/stitch.js').StitchOptions} StitchOptions
 */

/* The renderer of every language the package speaks. The three Star languages
   are the same command set, so one renderer handles them, which is why a
   language is not the same thing as a renderer class: star-prnt and star-line
   are the two the encoder writes, and star-graphics is the raster protocol of
   a TSP100, whose jobs enter raster mode with ESC * r A themselves */

const RENDERERS = Object.assign(Object.create(null), {
  'esc-pos': EscPosRenderer,
  'star-prnt': StarPrntRenderer,
  'star-line': StarPrntRenderer,
  'star-graphics': StarPrntRenderer,
});

/* The language of a renderer that was constructed without one */

const DEFAULT_LANGUAGE = 'esc-pos';

/**
 * Renders the commands ReceiptPrinterEncoder produces to images, in any of the
 * languages the encoder speaks.
 *
 * It takes the same options as the renderer of a language, plus the language
 * itself, so that an application or a driver that knows which language the
 * encoder was configured with does not have to know which renderer class
 * belongs to it. That mirrors the encoder, which takes the language as an
 * option as well.
 */
class ReceiptPrinterRenderer {
  /* The two renderers and the four image format helpers are static properties
     as well as named exports, so that the UMD build, whose global is this
     class, reaches all of them */

  static EscPosRenderer = EscPosRenderer;
  static StarPrntRenderer = StarPrntRenderer;

  static toPbm = toPbm;
  static toPng = toPng;
  static toImageData = toImageData;
  static stitch = stitch;

  #language;
  #renderer;

  /**
     * The languages this renderer accepts
     *
     * @return {RenderLanguage[]}   The names of the languages
     */
  static get languages() {
    return Object.keys(RENDERERS);
  }

  /**
     * Create a renderer
     *
     * @param  {ReceiptPrinterRendererOptions}   options   How the printer this renderer emulates
     *                                                     behaves, `language` defaults to 'esc-pos'
     */
  constructor(options) {
    const settings = options || {};

    this.#language = settings.language || DEFAULT_LANGUAGE;

    if (!Object.prototype.hasOwnProperty.call(RENDERERS, this.#language)) {
      throw new Error(
          `Unknown language ${this.#language}, must be one of ${ReceiptPrinterRenderer.languages.join(', ')}`,
      );
    }

    const Renderer = RENDERERS[this.#language];

    this.#renderer = new Renderer(settings);
  }

  /**
     * The language this renderer was created for. All three Star languages are
     * rendered by the StarPRNT renderer, but a renderer created for
     * 'star-line' reports 'star-line', which is the language the encoder that
     * produced the commands was configured with, and one created for
     * 'star-graphics' reports the protocol a driver resolved from its profile.
     *
     * @return {RenderLanguage}   The name of the language
     */
  get language() {
    return this.#language;
  }

  /**
     * Number of font A characters that fit on a line, which must be the number
     * of columns the encoder was configured with
     *
     * @return {number}   Number of columns
     */
  get columns() {
    return this.#renderer.columns;
  }

  /**
     * Render a stream of commands in the language of this renderer
     *
     * @param  {Uint8Array|number[]}   bytes   The commands
     * @return {RenderItem[]}                  The items, see the output contract in design.md
     */
  render(bytes) {
    return this.#renderer.render(bytes);
  }
}

export default ReceiptPrinterRenderer;

export {ReceiptPrinterRenderer, EscPosRenderer, StarPrntRenderer, toPbm, toPng, toImageData, stitch};
