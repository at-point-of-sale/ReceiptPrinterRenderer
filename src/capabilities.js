/**
 * @typedef {import('./types.js').CellSize} CellSize
 * @typedef {import('./types.js').Profile} Profile
 */

/**
 * What a printer can do, as the `printerCapabilities` object of
 * ReceiptPrinterEncoder describes it. The renderer takes that object as it is,
 * so this is the shape of the encoder's profiles and not a format of its own;
 * every section is optional here, because a section that is not there says
 * nothing about the printer and refuses nothing.
 *
 * @typedef {object} PrinterCapabilities
 * @property {{supported?: boolean, symbologies?: string[]}} [barcodes]   The one dimensional symbologies
 * @property {{supported?: boolean, models?: string[]}} [qrcode]          QR codes, the models are not enforced
 * @property {{supported?: boolean}} [pdf417]                             PDF417 symbols
 * @property {{mode?: string}} [images]                                   The image mode, 'raster' or 'column'
 * @property {Object<string, {size?: string, columns?: number}>} [fonts]  The cell size of the fonts, 'B' is used
 */

/* The two ways the dots of an image reach a printer: a raster image is rows of
   dots, a column mode image is columns of eight or twenty four. A printer that
   takes one of the two does not print the other, and a profile that says
   nothing takes both */

const RASTER = 'raster';
const COLUMN = 'column';

/* The size of a cell as a profile of the encoder writes it, `9x17`: two
   numbers of at least one dot, so that a cell of no width or no height is a
   size this renderer cannot read rather than a cell nothing fits in */

const SIZE = /^([1-9]\d*)x([1-9]\d*)$/;

/**
 * The capabilities of one printer: what it prints, and what it refuses.
 *
 * A renderer that was given no capabilities builds one of these all the same,
 * an instance that says yes to everything, so the parsers ask the same
 * question either way and a stream renders as it always did.
 *
 * The names of the symbologies are the names of the encoder, which are the
 * names the parsers of this package use as well, with one exception that the
 * Star parser resolves: see the note on `barcode()`.
 */
class Capabilities {
  #everything;
  #barcodes;
  #symbologies;
  #qrcode;
  #pdf417;
  #mode;
  #fontB;

  /**
     * Create the capabilities of a printer
     *
     * @param  {PrinterCapabilities}   [capabilities]   The encoder's object, or nothing for a printer that does everything
     */
  constructor(capabilities) {
    this.#everything = capabilities === undefined || capabilities === null;

    if (this.#everything) {
      return;
    }

    if (typeof capabilities !== 'object' || Array.isArray(capabilities)) {
      throw new Error('Capabilities must be the printer capabilities object of ReceiptPrinterEncoder');
    }

    const barcodes = capabilities.barcodes;

    this.#barcodes = !barcodes || barcodes.supported !== false;
    this.#symbologies = barcodes && Array.isArray(barcodes.symbologies) ? new Set(barcodes.symbologies) : null;

    /* The models of the QR code group are not enforced: a printer that has QR
       codes at all prints the symbol of model 2 whatever the command asked
       for, so the list says nothing about what reaches the paper */

    this.#qrcode = !capabilities.qrcode || capabilities.qrcode.supported !== false;

    /* The fallback of a profile whose printer has no PDF417, which asks the
       encoder to write a barcode instead, is the encoder's business: the
       stream this renderer is given already carries whatever it chose */

    this.#pdf417 = !capabilities.pdf417 || capabilities.pdf417.supported !== false;

    /* An image mode this renderer does not know refuses nothing, the way a
       section that is missing does: a profile of a later encoder must not stop
       a preview from being drawn */

    const mode = capabilities.images && capabilities.images.mode;

    this.#mode = mode === RASTER || mode === COLUMN ? mode : null;

    this.#fontB = this.#cell(capabilities.fonts && capabilities.fonts.B);
  }

  /**
     * Whether a printer with these capabilities prints a symbology.
     *
     * The name is the one the encoder's profiles use, which is the name the
     * parsers give the selector of the command. The Star parser is the one
     * exception: StarPRNT has no way to select a code set, so its Code 128 is
     * drawn as the automatic variant of ESC/POS while the profiles of the Star
     * printers call it `code128`, and the parser asks for that name.
     *
     * @param  {string}    symbology   Name of the symbology
     * @return {boolean}               True when the printer prints it
     */
  barcode(symbology) {
    if (this.#everything) {
      return true;
    }

    if (!this.#barcodes) {
      return false;
    }

    return this.#symbologies ? this.#symbologies.has(symbology) : true;
  }

  /**
     * Whether a printer with these capabilities prints QR codes
     *
     * @return {boolean}   True when it does
     */
  qrcode() {
    return this.#everything || this.#qrcode;
  }

  /**
     * Whether a printer with these capabilities prints PDF417 symbols
     *
     * @return {boolean}   True when it does
     */
  pdf417() {
    return this.#everything || this.#pdf417;
  }

  /**
     * Whether a printer with these capabilities prints an image that arrives in
     * a mode. A profile that names one mode takes that mode alone, and a
     * profile that names none takes both.
     *
     * @param  {string}    mode   'raster' or 'column'
     * @return {boolean}          True when the printer prints such an image
     */
  image(mode) {
    if (this.#everything || this.#mode === null) {
      return true;
    }

    return this.#mode === mode;
  }

  /**
     * The printer profile with the cell of font B these capabilities give it,
     * which is the cell the encoder counted its columns in: 9 by 17 dots on
     * most printers, 9 by 24 on the Star printers and a few others, 10 by 24 on
     * the Epson TM-m30II and TM-m30III.
     *
     * The glyphs are the ones of the built in font of this package whatever the
     * cell is, an 8 by 16 dot face that stands centred in the cell on its
     * baseline, the way a printer draws a font that is smaller than its cell.
     * So a cell no profile of this package has, 10 by 24, needs no font of its
     * own and is drawn the way the other two are.
     *
     * @param  {Profile}   profile   The profile of the printer family
     * @return {Profile}             The profile, or a copy of it with the cell of font B
     */
  profile(profile) {
    if (!this.#fontB || !profile || !profile.fonts || !profile.fonts.B) {
      return profile;
    }

    if (profile.fonts.B.width === this.#fontB.width && profile.fonts.B.height === this.#fontB.height) {
      return profile;
    }

    return Object.assign({}, profile, {
      fonts: Object.assign({}, profile.fonts, {B: {width: this.#fontB.width, height: this.#fontB.height}}),
    });
  }

  /**
     * The cell of a font of the capabilities, `{size: '9x17'}`
     *
     * @param  {object}          font   The font, or nothing
     * @return {CellSize|null}          The cell in dots, or null when the font does not give one
     */
  #cell(font) {
    if (!font || typeof font.size !== 'string') {
      return null;
    }

    const match = SIZE.exec(font.size);

    if (!match) {
      throw new Error(`Unknown font size ${font.size}, must be the width and the height in dots, such as 9x17`);
    }

    return {width: Number(match[1]), height: Number(match[2])};
  }
}

export default Capabilities;
export {Capabilities};
