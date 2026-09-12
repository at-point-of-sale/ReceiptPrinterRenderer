import Bitmap from './bitmap.js';
import fonts from '../generated/fonts.js';

/**
 * @typedef {import('./types.js').Bitmap} Bitmap
 */

/**
 * A packed bitmap font, as tools/generate.js produces it. The format is
 * documented there.
 *
 * @typedef {object} PackedFont
 * @property {number} width                     Cell width of the font in dots
 * @property {number} height                    Cell height of the font in dots
 * @property {number} fallback                  Glyph number drawn for code points the font does not have
 * @property {Object<string, number>} index     Code point to glyph number
 * @property {string} data                      Base64 encoded glyph rows
 */

/**
 * @typedef {object} GlyphOptions
 * @property {number} [cellWidth]          Width of the cell the glyph is drawn in, defaults to the font width
 * @property {number} [cellHeight]         Height of the cell the glyph is drawn in, defaults to the font height
 * @property {number} [widthMultiplier]    Horizontal scale, 1 to 8, dots are repeated
 * @property {number} [heightMultiplier]   Vertical scale, 1 to 8, dots are repeated
 * @property {boolean} [bold]              Overstrike the glyph with a one dot horizontal offset
 * @property {boolean} [stretch]           Extend the ink at the edges of the glyph to the edges of the cell
 * @property {number} [underline]          Underline thickness in dots, 0, 1 or 2
 * @property {boolean} [invert]            Draw the cell white on black
 */

/**
 * Decode base64 without the APIs of one platform. Browsers and Node 16 and up
 * have atob, older Node only has Buffer.
 *
 * @param  {string}       value   Base64 encoded data
 * @return {Uint8Array}           The decoded bytes
 */
function decodeBase64(value) {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const result = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      result[i] = binary.charCodeAt(i);
    }

    return result;
  }

  /* eslint-disable no-undef */
  if (typeof Buffer === 'function') {
    const buffer = Buffer.from(value, 'base64');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  /* eslint-enable no-undef */

  throw new Error('No base64 decoder available on this platform');
}

/**
 * A fixed cell bitmap font. Glyphs are looked up by code point and drawn into
 * a cell of the size the printer uses for the font, with the styles of the
 * current print mode applied.
 */
class Font {
  static #cache = new Map();

  #width;
  #height;
  #rowBytes;
  #glyphBytes;
  #index;
  #data;
  #glyphs;
  #fallback;

  /**
     * Create a font from packed font data
     *
     * @param  {PackedFont}   packed   Packed font data, see tools/generate.js
     */
  constructor(packed) {
    if (!packed || typeof packed.data !== 'string') {
      throw new Error('Invalid font data');
    }

    this.#width = packed.width;
    this.#height = packed.height;
    this.#rowBytes = Bitmap.rowBytes(packed.width);
    this.#glyphBytes = this.#rowBytes * packed.height;
    /* A null prototype, so that a code point never finds a property of Object,
       and so that a font passed in by an application is safe as well */

    this.#data = decodeBase64(packed.data);
    this.#glyphs = Math.floor(this.#data.length / this.#glyphBytes);

    /* A null prototype, so that a code point never finds a property of Object,
       and so that a font passed in by an application is safe as well */

    this.#index = Object.assign(Object.create(null), packed.index);
    this.#fallback = this.#glyph(packed.fallback || 0);
  }

  /**
     * One of the built in fonts, by the size of its cell
     *
     * @param  {string}   name   Size of the font, '12x24' for font A or '8x16' for font B
     * @return {Font}            The font
     */
  static get(name) {
    if (!Object.prototype.hasOwnProperty.call(fonts, name)) {
      throw new Error(`Unknown font ${name}`);
    }

    /* Decoding a font costs a copy of its glyphs, and the built in fonts never
       change, so every one of them is decoded once */

    if (!Font.#cache.has(name)) {
      Font.#cache.set(name, new Font(fonts[name]));
    }

    return Font.#cache.get(name);
  }

  /**
     * The sizes of the built in fonts
     *
     * @return {string[]}   Names that Font.get accepts
     */
  static get names() {
    return Object.keys(fonts);
  }

  /**
     * Whether a code point is one of the box drawing and block characters, the
     * characters that have to connect to the ones in the cells around them.
     * The painter uses it to decide when to stretch a glyph to its cell.
     *
     * @param  {number}   codepoint   Unicode code point
     * @return {boolean}              True for U+2500 to U+259F
     */
  static isBoxDrawing(codepoint) {
    return codepoint >= 0x2500 && codepoint <= 0x259f;
  }

  /**
     * Width of the glyphs of this font in dots
     *
     * @return {number}   Width in dots
     */
  get width() {
    return this.#width;
  }

  /**
     * Height of the glyphs of this font in dots
     *
     * @return {number}   Height in dots
     */
  get height() {
    return this.#height;
  }

  /**
     * The glyph drawn for code points this font does not have, a hollow box
     *
     * @return {Bitmap}   The fallback glyph
     */
  get fallback() {
    return this.#fallback;
  }

  /**
     * Whether this font has a glyph of its own for a code point
     *
     * @param  {number}   codepoint   Unicode code point
     * @return {boolean}              True when the font has the glyph
     */
  has(codepoint) {
    return typeof this.#index[codepoint] === 'number';
  }

  /**
     * The glyph of a code point, or the fallback glyph when the font does not
     * have it. The result is a view on the font data, drawing on it changes the
     * font, so treat it as read only.
     *
     * @param  {number}   codepoint   Unicode code point
     * @return {Bitmap}               The glyph
     */
  lookup(codepoint) {
    const number = this.#index[codepoint];

    return typeof number === 'number' ? this.#glyph(number) : this.#fallback;
  }

  /**
     * Draw a glyph in a cell, scaled and styled as the printer would
     *
     * @param  {Bitmap}         glyph     Glyph, as lookup returned it
     * @param  {GlyphOptions}   options   How to draw it
     * @return {Bitmap}                   The cell, cellWidth * widthMultiplier by cellHeight * heightMultiplier dots
     */
  renderGlyph(glyph, options) {
    const settings = {
      cellWidth: this.#width,
      cellHeight: this.#height,
      widthMultiplier: 1,
      heightMultiplier: 1,
      bold: false,
      stretch: false,
      underline: 0,
      invert: false,
      ...options,
    };

    /* The glyph is centred in the cell, horizontally and vertically, so that a
       font smaller than the cell keeps its line of text in the middle and the
       gap between the characters on both sides */

    let cell = Bitmap.create(settings.cellWidth, settings.cellHeight);
    const left = Math.floor((settings.cellWidth - glyph.width) / 2);
    const top = Math.floor((settings.cellHeight - glyph.height) / 2);

    Bitmap.blit(glyph, cell, left, top);

    /* Bold is an overstrike, the printer prints the glyph a second time one dot
       to the right, which happens before scaling, as it does in a printer */

    if (settings.bold) {
      Bitmap.blit(glyph, cell, left + 1, top);
    }

    /* Box drawing characters have to connect to the cells around them, which
       the gap between the glyph and the cell breaks. Stretching pulls the ink
       at the edges of the glyph out to the edges of the cell, before scaling,
       so that the lines join at every size */

    if (settings.stretch) {
      this.#stretch(cell, left, top, glyph.width + (settings.bold ? 1 : 0), glyph.height);
    }

    cell = this.#scale(cell, settings.widthMultiplier, settings.heightMultiplier);

    /* The underline is drawn over the full width of the cell, also under the
       spaces, and its thickness is in dots, so it does not scale. A printer
       does not underline reverse characters, see the ESC/POS reference of
       ESC - n: "underline is not applied to white/black reverse characters" */

    if (settings.underline > 0 && !settings.invert) {
      const rowBytes = Bitmap.rowBytes(cell.width);
      const first = Math.max(0, cell.height - settings.underline);

      cell.data.fill(0xff, first * rowBytes, cell.height * rowBytes);
    }

    if (settings.invert) {
      for (let i = 0; i < cell.data.length; i++) {
        cell.data[i] = ~cell.data[i] & 0xff;
      }
    }

    this.#clearPadding(cell);

    return cell;
  }

  /**
     * A glyph by its number in the packed data
     *
     * @param  {number}   number   Glyph number
     * @return {Bitmap}            A view on the rows of that glyph
     */
  #glyph(number) {
    if (!Number.isInteger(number) || number < 0 || number >= this.#glyphs) {
      throw new Error(`Font has no glyph ${number}`);
    }

    const offset = number * this.#glyphBytes;

    return {
      width: this.#width,
      height: this.#height,
      data: this.#data.subarray(offset, offset + this.#glyphBytes),
    };
  }

  /**
     * Extend the ink at the edges of a glyph to the edges of the cell, so that
     * the lines of box drawing characters connect across cells
     *
     * @param  {Bitmap}   cell     The cell the glyph was drawn in
     * @param  {number}   left     Position of the glyph in the cell
     * @param  {number}   top      Position of the glyph in the cell
     * @param  {number}   width    Width of the glyph in the cell
     * @param  {number}   height   Height of the glyph in the cell
     */
  #stretch(cell, left, top, width, height) {
    const right = left + width - 1;
    const bottom = top + height - 1;

    for (let y = Math.max(0, top); y <= Math.min(bottom, cell.height - 1); y++) {
      if (Bitmap.getPixel(cell, left, y)) {
        for (let x = 0; x < left; x++) {
          Bitmap.setPixel(cell, x, y, 1);
        }
      }

      if (Bitmap.getPixel(cell, right, y)) {
        for (let x = right + 1; x < cell.width; x++) {
          Bitmap.setPixel(cell, x, y, 1);
        }
      }
    }

    for (let x = Math.max(0, left); x <= Math.min(right, cell.width - 1); x++) {
      if (Bitmap.getPixel(cell, x, top)) {
        for (let y = 0; y < top; y++) {
          Bitmap.setPixel(cell, x, y, 1);
        }
      }

      if (Bitmap.getPixel(cell, x, bottom)) {
        for (let y = bottom + 1; y < cell.height; y++) {
          Bitmap.setPixel(cell, x, y, 1);
        }
      }
    }
  }

  /**
     * Scale a bitmap by repeating its dots, the way a printer scales its
     * characters
     *
     * @param  {Bitmap}   bitmap     The bitmap to scale
     * @param  {number}   width      Horizontal multiplier
     * @param  {number}   height     Vertical multiplier
     * @return {Bitmap}              The scaled bitmap, or the original when both multipliers are one
     */
  #scale(bitmap, width, height) {
    if (width === 1 && height === 1) {
      return bitmap;
    }

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error('Multipliers must be positive integers');
    }

    const result = Bitmap.create(bitmap.width * width, bitmap.height * height);
    const rowBytes = Bitmap.rowBytes(result.width);

    for (let y = 0; y < bitmap.height; y++) {
      const offset = y * height * rowBytes;

      for (let x = 0; x < bitmap.width; x++) {
        if (!Bitmap.getPixel(bitmap, x, y)) {
          continue;
        }

        for (let i = 0; i < width; i++) {
          const dot = x * width + i;
          result.data[offset + (dot >> 3)] |= 0x80 >> (dot & 7);
        }
      }

      /* The other rows of this dot are a copy of the one just drawn */

      for (let i = 1; i < height; i++) {
        result.data.copyWithin(offset + i * rowBytes, offset, offset + rowBytes);
      }
    }

    return result;
  }

  /**
     * Clear the bits beyond the width of a bitmap, which inverting and
     * underlining set
     *
     * @param  {Bitmap}   bitmap   The bitmap to clean up
     */
  #clearPadding(bitmap) {
    const spare = bitmap.width & 7;

    if (spare === 0) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(bitmap.width);
    const mask = (0xff << (8 - spare)) & 0xff;

    for (let offset = rowBytes - 1; offset < bitmap.data.length; offset += rowBytes) {
      bitmap.data[offset] &= mask;
    }
  }
}

export default Font;
