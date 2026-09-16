import CodepageEncoder from '@point-of-sale/codepage-encoder';
import Bitmap from '../bitmap.js';
import Painter from '../painter.js';
import {internationalCharacterSet, noCharacterSet} from '../charsets.js';
import codepageMappings from '../../generated/mapping.js';
import printerProfiles from '../../generated/profiles.js';

/**
 * @typedef {import('../painter.js').Profile} Profile
 * @typedef {import('../painter.js').PainterOptions} PainterOptions
 * @typedef {import('../types.js').Layout} Layout
 * @typedef {import('../types.js').RendererOptions} RendererOptions
 * @typedef {import('../types.js').RenderItem} RenderItem
 */

const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const DLE = 0x10;
const HT = 0x09;
const LF = 0x0a;
const FF = 0x0c;
const CR = 0x0d;
const CAN = 0x18;

/* The resolution of a printer that has no dpi in its profile, which is what
   every receipt printer of this class prints at */

const DEFAULT_DPI = 203;

/* The largest reverse feed ESC K takes, in vertical motion units. Forty eight
   units is twenty four dots at the default unit of an Epson, which is the
   reverse feed the mechanism of that printer has; a larger value is out of
   range and the command is ignored, the way a printer ignores it. ESC e has no
   such range in the reference, see the notes of the reference page */

const MAX_REVERSE_UNITS = 48;

/* The character codes ESC & defines a glyph for and ESC ? cancels one for, and
   the height of a definition: three bytes of eight dots, the 24 dots of the
   fonts of these printers, which is the only value the reference gives y for
   them. A code outside the range makes the printer ignore the command, and a
   height that is not three leaves the parser without a layout for the data
   behind it, see userDefinedArguments */

const FIRST_GLYPH_CODE = 0x20;
const LAST_GLYPH_CODE = 0x7e;
const GLYPH_BYTES = 3;

/* The size of a user defined Kanji glyph of FS 2: 24 by 24 dots in column
   format, three bytes per column, which is 72 data bytes */

const KANJI_GLYPH_SIZE = 24;
const KANJI_GLYPH_BYTES = (KANJI_GLYPH_SIZE / 8) * KANJI_GLYPH_SIZE;

/* The values ESC V n accepts. 0 and 48 switch the rotation off, 1, 49, 2 and 50
   switch it on: the two differ in the space the printer leaves between the
   rotated characters, one dot against one and a half, which a cell of whole
   dots has no room for. Anything else leaves the rotation as it was */

const ROTATION = Object.assign(Object.create(null), {
  0: false, 1: true, 2: true, 48: false, 49: true, 50: true,
});

/* The functions of GS ( N, the colour of the characters and of the background
   they are printed on, and the shading mode. This renderer draws one bit, so
   every colour is the black of its paper */

const COLOUR_FUNCTIONS = [48, 49, 50];

/* The code system FS C selects, which decides which bytes are the lead byte of
   a multibyte character in Kanji mode */

const CODE_SYSTEMS = Object.assign(Object.create(null), {0: 'jis', 1: 'shift-jis', 48: 'jis', 49: 'shift-jis'});

/* The codepage every printer starts in, and the one an unknown codepage number
   falls back to */

const DEFAULT_CODEPAGE = 'cp437';

/* The values ESC - n accepts, as the binary numbers and as the ASCII digits.
   Anything else leaves the underline as it was, the way an unknown font or
   alignment does */

const UNDERLINE = Object.assign(Object.create(null), {0: 0, 1: 1, 2: 2, 48: 0, 49: 1, 50: 2});

/* The symbologies of GS k m, by the value of m */

const SYMBOLOGIES = Object.assign(Object.create(null), {
  0: 'upca',
  1: 'upce',
  2: 'ean13',
  3: 'ean8',
  4: 'code39',
  5: 'itf',
  6: 'codabar',
  65: 'upca',
  66: 'upce',
  67: 'ean13',
  68: 'ean8',
  69: 'code39',
  70: 'itf',
  71: 'codabar',
  72: 'code93',
  73: 'code128',
  74: 'gs1-128',
  75: 'gs1-databar-omni',
  76: 'gs1-databar-truncated',
  77: 'gs1-databar-limited',
  78: 'gs1-databar-expanded',
  79: 'code128-auto',
});

/* The print directions of ESC T, as the numbers and as the ASCII digits: 0 is
   left to right from the top left of the print area, 1 bottom to top from the
   bottom left, 2 right to left from the bottom right and 3 top to bottom from
   the top right. Any other value leaves the direction as it was */

const PRINT_DIRECTIONS = Object.assign(Object.create(null), {
  0: 0, 1: 1, 2: 2, 3: 3, 48: 0, 49: 1, 50: 2, 51: 3,
});

/* Where GS H n puts the human readable text of a barcode */

const HRI = Object.assign(Object.create(null), {
  0: 'none', 1: 'above', 2: 'below', 3: 'both',
  48: 'none', 49: 'above', 50: 'below', 51: 'both',
});

/* The error correction levels of the QR code commands */

const ERROR_LEVELS = Object.assign(Object.create(null), {48: 'L', 49: 'M', 50: 'Q', 51: 'H'});

/* How the mode of GS v 0, GS / and FS p scales an image: 0 normal, 1 double
   width, 2 double height and 3 both, as the numbers and as the ASCII digits.
   Any other value prints the image unscaled */

const IMAGE_SCALES = Object.assign(Object.create(null), {
  0: {x: 1, y: 1}, 1: {x: 2, y: 1}, 2: {x: 1, y: 2}, 3: {x: 2, y: 2},
  48: {x: 1, y: 1}, 49: {x: 2, y: 1}, 50: {x: 1, y: 2}, 51: {x: 2, y: 2},
});

/* The prefixes of the keys the images of the graphics commands are kept under
   in the painter. The NV and the download graphics of GS ( L are addressed by
   a key code of two bytes, the NV bit images of FS q by their number, and the
   downloaded bit image of GS * is the only one of its kind */

const NV_GRAPHICS = 'nv:';
const DOWNLOAD_GRAPHICS = 'dl:';
const NV_BIT_IMAGE = 'nv-bit-image:';
const DOWNLOAD_BIT_IMAGE = 'download-bit-image';

/* The tone parameter of the graphics commands: 48 is a monochrome image and 52
   a multiple tone one, of which this renderer draws the first colour */

const MONOCHROME = 48;
const MULTI_TONE = 52;

/* The size the graphics functions of GS ( L accept, in dots: the direction the
   data runs in holds up to 8192 dots and the other one up to 2047, so a raster
   image is at most 8192 dots wide and 2047 dots tall and a column image the
   other way round. A command that asks for more is out of range and is
   ignored, the way a printer ignores it */

const MAX_GRAPHICS_DATA = 8192;
const MAX_GRAPHICS_LINES = 2047;

/* The scale factors bx, by, x and y of the graphics functions: one dot, or two
   dots by repeating every dot */

const GRAPHICS_SCALES = [1, 2];

/* The delete all functions carry the three fixed bytes CLR, and no other
   parameter deletes anything */

const DELETE_ALL = [0x43, 0x4c, 0x52];

/* The size GS * accepts: x bytes of eight dots wide, y bytes of eight dots
   tall, and the memory of the printer holds 1536 of those bytes */

const MAX_DOWNLOAD_WIDTH = 255;
const MAX_DOWNLOAD_HEIGHT = 48;
const MAX_DOWNLOAD_BYTES = 1536;

/* What a printer starts a barcode with, until the commands say otherwise. The
   encoder always sets all three, so these are only reached by hand written
   streams */

const BARCODE_DEFAULTS = {height: 162, moduleWidth: 3, position: 'none', font: 'A'};

/* And the same for a QR code: model 2, three dot modules and the lowest error
   correction level, which are the defaults of the specification */

const QRCODE_DEFAULTS = {model: 2, moduleSize: 3, errorLevel: 'L'};

/* And for a PDF417: a size the printer picks, three dot modules, rows of three
   modules, the error correction of the ratio mode at one check codeword per ten
   data codewords, and the standard rather than the truncated form, which are
   the defaults of the ESC/POS reference. The encoder sets every one of them
   before it prints, so these are only reached by hand written streams */

const PDF417_DEFAULTS = {
  columns: 0,
  rows: 0,
  moduleWidth: 3,
  rowHeight: 3,
  errorLevel: 'auto',
  errorRatio: 1,
  truncated: false,
};

/**
 * The 256 entry table of a codepage, or null when the codepage encoder does not
 * implement it. Some of the mappings name codepages it does not have.
 *
 * @param  {string}         name   Name of the codepage
 * @return {number[]|null}         The code points of the bytes, or null
 */
function codepointsOf(name) {
  if (!CodepageEncoder.supports(name)) {
    return null;
  }

  try {
    return CodepageEncoder.getCodepoints(name, true);
  } catch (error) {
    /* A name the encoder knows as an alias only has no definition of its own
       and throws a TypeError on the way in, which is the case this catch is
       here for. Anything else is a fault of the platform, a global a sandbox
       does not have for instance, and is not ours to swallow: a stream that
       silently decodes to nothing but fallback glyphs is worse than an error */

    if (!(error instanceof TypeError)) {
      throw error;
    }

    return null;
  }
}

/*
    Argument lengths.

    A command in the tables below says how many bytes follow its two byte
    prefix, either as a number or as a function of the bytes. A function is
    given the whole stream and the position of the first argument, and returns
    the number of argument bytes, or -1 when the stream ends before the command
    is complete, which stops the parser without an error.
*/

/**
 * Arguments of a command that ends at the first NUL byte
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function nulTerminated(bytes, index) {
  let end = index;

  while (end < bytes.length && bytes[end] !== 0x00) {
    end++;
  }

  return end < bytes.length ? end - index + 1 : -1;
}

/**
 * Arguments of GS ( x pL pH d1..dk, where the two length bytes count the data
 * that follows them
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function parenthesisArguments(bytes, index) {
  if (index + 3 > bytes.length) {
    return -1;
  }

  return 3 + bytes[index + 1] + bytes[index + 2] * 256;
}

/**
 * Arguments of GS 8 L p1 p2 p3 p4 d1..dk, the four byte length variant
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function largeParenthesisArguments(bytes, index) {
  if (index + 5 > bytes.length) {
    return -1;
  }

  return 5 + bytes[index + 1] + bytes[index + 2] * 256 +
    bytes[index + 3] * 65536 + bytes[index + 4] * 16777216;
}

/**
 * Arguments of ESC * m nL nH d1..dk, a column mode image. The 24 dot modes
 * carry three bytes per column, the 8 dot modes one.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function columnImageArguments(bytes, index) {
  if (index + 3 > bytes.length) {
    return -1;
  }

  const mode = bytes[index];
  const columns = bytes[index + 1] + bytes[index + 2] * 256;

  return 3 + (mode === 32 || mode === 33 ? columns * 3 : columns);
}

/**
 * Arguments of GS v 0 m xL xH yL yH d1..dk, a raster image
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function rasterImageArguments(bytes, index) {
  if (index + 6 > bytes.length) {
    return -1;
  }

  const width = bytes[index + 2] + bytes[index + 3] * 256;
  const height = bytes[index + 4] + bytes[index + 5] * 256;

  return 6 + width * height;
}

/**
 * Arguments of GS k m .., a barcode. Function A, for m below 65, ends at a NUL
 * byte, function B carries its length.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function barcodeArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  if (bytes[index] >= 65) {
    if (index + 2 > bytes.length) {
      return -1;
    }

    return 2 + bytes[index + 1];
  }

  const length = nulTerminated(bytes, index + 1);

  return length < 0 ? -1 : length + 1;
}

/**
 * Arguments of GS V n, a cut. The variants that feed the paper first carry the
 * distance as a second argument.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function cutArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  return [65, 66, 103, 104].includes(bytes[index]) ? 2 : 1;
}

/**
 * Arguments of FS g 1 and FS g 2, the commands that write and read the user
 * memory. Writing carries its data length, reading does not.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function userMemoryArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  /* FS g 1 m a1 a2 a3 a4 nL nH d1..dk writes, FS g 2 m a1 a2 a3 a4 nL nH reads */

  if (bytes[index] === 1) {
    if (index + 8 > bytes.length) {
      return -1;
    }

    return 8 + bytes[index + 6] + bytes[index + 7] * 256;
  }

  return bytes[index] === 2 ? 8 : 0;
}

/**
 * Arguments of FS q n [xL xH yL yH d1..dk]1..[..]n, the definition of n NV bit
 * images, each x bytes wide and y bytes of eight dots tall
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function nvBitImageArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  let length = 1;

  for (let image = 0; image < bytes[index]; image++) {
    const header = index + length;

    if (header + 4 > bytes.length) {
      return -1;
    }

    const width = bytes[header] + bytes[header + 1] * 256;
    const height = bytes[header + 2] + bytes[header + 3] * 256;

    length += 4 + width * height * 8;
  }

  return length;
}

/**
 * Arguments of ESC & y c1 c2 [x d1..d(y * x)]1..[..], the definition of the
 * glyphs of the character codes c1 to c2. Every character carries the number of
 * columns it is wide and y bytes of eight dots per column.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function userDefinedArguments(bytes, index) {
  if (index + 3 > bytes.length) {
    return -1;
  }

  const characters = bytes[index + 2] - bytes[index + 1] + 1;

  /* A height the fonts of these printers do not have is a command the parser
     has no layout for, so it consumes the three parameters and leaves the rest
     to the stream, which is what it does for a c2 below c1 as well */

  if (bytes[index] !== GLYPH_BYTES) {
    return 3;
  }

  let length = 3;

  for (let character = 0; character < characters; character++) {
    if (index + length + 1 > bytes.length) {
      return -1;
    }

    length += 1 + bytes[index + length] * GLYPH_BYTES;
  }

  return length;
}

/**
 * Arguments of GS * x y d1..dk, a downloaded bitmap
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function downloadedBitmapArguments(bytes, index) {
  if (index + 2 > bytes.length) {
    return -1;
  }

  return 2 + bytes[index] * bytes[index + 1] * 8;
}

/**
 * Arguments of DLE EOT n, the real time status request. Two of its functions
 * carry a second parameter byte, every other one is a single byte.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function realTimeStatusArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  return bytes[index] === 7 || bytes[index] === 8 ? 2 : 1;
}

/*
    The number of bytes of DLE DC4, including its function byte. Function 1
    generates a pulse, m and t behind it, function 2 runs the power off
    sequence with its two byte fixed data, function 8 clears the buffers with
    its seven byte fixed data. Functions 3 and 7 are transmit requests of one
    parameter byte. Every other function is read as the function byte alone.

    The lengths of functions 3 and 7 are the common ones, they are not settled
    by a specification text that was available here.
*/

const REAL_TIME_REQUESTS = Object.assign(Object.create(null), {1: 3, 2: 3, 3: 2, 7: 2, 8: 8});

/**
 * Arguments of DLE DC4 fn .., the real time request
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function realTimeRequestArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  return REAL_TIME_REQUESTS[bytes[index]] || 1;
}

/*
    Argument lengths of the commands the renderer does not implement, from the
    ESC/POS specification. They are only used to stay in sync with the stream,
    the command itself becomes an unknown item. Commands that are not in these
    tables consume their prefix alone, which is the best guess there is.
*/

const UNKNOWN_ARGUMENTS = {
  [DLE]: {
    0x14: realTimeRequestArguments, /* DLE DC4 fn .., real time request */
  },

  [ESC]: {
    0x2f: 1, /* print downloaded bitmap */
    0x3d: 1, /* select peripheral device */
    0x43: 1, /* page length in lines */
    0x55: 1, /* unidirectional printing */
    0x63: 2, /* paper sensor and panel button settings */
  },

  [GS]: {
    0x3a: 0, /* start or end macro definition */
    0x41: 2, /* print position adjustment */
    0x45: 1, /* print control method */
    0x54: 1, /* print position at the top of the line */
    0x63: 0, /* print counter */
    0x67: 4, /* maintenance counter, GS g 0 m nL nH and GS g 2 m nL nH */
    0x7a: 2, /* print density and other settings */
  },

  [FS]: {
    0x67: userMemoryArguments, /* write and read the user memory */
  },
};

/**
 * Renders the ESC/POS commands ReceiptPrinterEncoder produces to images, the
 * way a printer would put them on paper.
 *
 * The parser is a table driven state machine over the byte stream. Every
 * command knows how many argument bytes it has, so that commands the renderer
 * does not implement can be skipped without losing the rest of the stream.
 */
class EscPosRenderer {
  static language = 'esc-pos';

  #painter;
  #mapping;
  #commands;

  #codepage;
  #codepoints;
  #codepointCache;
  #characterSet;
  #emphasis;
  #doubleStrike;
  #verticalUnits;
  #horizontalUnits;
  #kanji;
  #codeSystem;
  #userDefined;
  #direction;
  #dpi;
  #text;
  #graphics;
  #barcode;
  #refusing;
  #qrcode;
  #pdf417;

  /**
     * Create a renderer
     *
     * @param  {RendererOptions}   options   How the printer this renderer emulates behaves,
     *                                     `codepageMapping` and `profile` default to 'epson'
     */
  constructor(options) {
    const settings = options || {};

    if (!Number.isInteger(settings.width) || settings.width < 8 || settings.width % 8 !== 0) {
      throw new Error('Width is required and must be a positive multiple of 8 dots');
    }

    /* The mapping turns the number of a codepage command back into the name of
       a codepage, so it has to be the mapping the encoder used */

    const mapping = settings.codepageMapping || 'epson';

    if (!Object.prototype.hasOwnProperty.call(codepageMappings['esc-pos'], mapping)) {
      const names = Object.keys(codepageMappings['esc-pos']);

      throw new Error(`Unknown codepage mapping ${mapping}, must be one of ${names.join(', ')}`);
    }

    this.#mapping = codepageMappings['esc-pos'][mapping];

    /* A profile is a name of one of the built in profiles, or a profile of its
       own for a printer family that is not one of them */

    const profile = settings.profile || 'epson';
    let resolved = profile;

    if (typeof profile === 'string') {
      if (!Object.prototype.hasOwnProperty.call(printerProfiles, profile)) {
        throw new Error(
            `Unknown printer profile ${profile}, must be one of ${Object.keys(printerProfiles).join(', ')}`,
        );
      }

      resolved = printerProfiles[profile];
    }

    this.#painter = new Painter({
      language: EscPosRenderer.language,
      width: settings.width,
      profile: resolved,
      commands: settings.commands || [],
      maxHeight: settings.maxHeight,
      lineSpacing: settings.lineSpacing,
      feedThreshold: settings.feedThreshold,
      font: settings.font,
    });

    this.#codepointCache = new Map();
    this.#commands = this.#tables();

    this.#initialize();
  }

  /**
     * Number of font A characters that fit on a line, which must be the number
     * of columns the encoder was configured with
     *
     * @return {number}   Number of columns
     */
  get columns() {
    return this.#painter.columns;
  }

  /**
     * Render a stream of ESC/POS commands
     *
     * @param  {Uint8Array|number[]}   bytes   The commands
     * @return {RenderItem[]}                  The items, see the output contract in design.md
     */
  render(bytes) {
    return this.#run(bytes);
  }

  /**
     * Lay a stream of ESC/POS commands out and return the display list instead
     * of the dots, see documentation/display-list.md.
     *
     * The list carries every command of the stream, whatever the `commands`
     * option says, and `commands` decides which of them the printer performs
     * and so where the paper leaves it, see the method of the same name on
     * ReceiptPrinterRenderer
     *
     * @param  {Uint8Array|number[]}   bytes   The commands
     * @return {Layout}                        The display list
     */
  layout(bytes) {
    this.#painter.collect();

    return this.#run(bytes);
  }

  /**
     * Parse a stream and return whatever the painter made of it
     *
     * @param  {Uint8Array|number[]}   bytes   The commands
     * @return {RenderItem[]|Layout}           The items, or the display list
     */
  #run(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);

    /* Whatever happens, this renderer starts the next stream empty: a stream
       that fails halfway must not leak its rows, its items or its styles into
       the one after it */

    try {
      this.#initialize();
      this.#parse(data);

      return this.#painter.end();
    } finally {
      this.#painter.discard();
      this.#text = [];
    }
  }

  /**
     * Reset the state of the parser, which ESC @ does as well
     */
  #initialize() {
    this.#painter.reset();
    this.#verticalUnits = this.#painter.profile.motionUnit;
    this.#horizontalUnits = 1;
    this.#dpi = this.#painter.profile.dpi || DEFAULT_DPI;
    this.#characterSet = noCharacterSet();
    this.#emphasis = false;
    this.#doubleStrike = false;
    this.#kanji = false;
    this.#codeSystem = 'shift-jis';
    this.#userDefined = false;
    this.#direction = 0;
    this.#text = [];

    /* The graphics print buffer is part of the print buffer of the printer,
       which an initialize empties. The images the definition commands stored
       are not, they live in the painter for as long as this renderer does */

    this.#graphics = [];
    this.#barcode = Object.assign({}, BARCODE_DEFAULTS);
    this.#refusing = false;
    this.#qrcode = Object.assign({data: new Uint8Array(0)}, QRCODE_DEFAULTS);
    this.#pdf417 = Object.assign({data: new Uint8Array(0)}, PDF417_DEFAULTS);
    this.#selectCodepage(null);
  }

  /**
     * Walk the stream, turning printable bytes into text and everything else
     * into calls on the painter. A command that runs past the end of the stream
     * stops the parser, so malformed input never throws.
     *
     * @param  {Uint8Array}   bytes   The commands
     */
  #parse(bytes) {
    let index = 0;

    while (index < bytes.length) {
      const byte = bytes[index];

      /* In Kanji mode a lead byte and the byte behind it are one character.
         There is no CJK font here, so the pair becomes two cells of the
         fallback glyph, which is exactly the width a printer gives a Kanji
         character. A lead byte at the very end of the stream is not a pair and
         is printed as a character of its own */

      if (this.#kanji && this.#isLeadByte(byte) && index + 1 < bytes.length) {
        this.#flushText();

        /* Unless the stream defined a glyph for this code with FS 2, which is
           drawn in the two cells the placeholder would have taken */

        if (!this.#painter.glyph(byte * 256 + bytes[index + 1], {multibyte: true})) {
          this.#painter.placeholder(2);
        }

        index += 2;
        continue;
      }

      /* A byte that has a glyph a stream downloaded, while ESC % selected the
         user defined set, prints that glyph instead of the one of the codepage */

      if (byte >= 0x20 && this.#userDefined && this.#painter.hasGlyph(byte)) {
        this.#flushText();
        this.#painter.glyph(byte);

        index++;
        continue;
      }

      /* Printable bytes are gathered, so that a run of characters becomes one
         call on the painter, in one codepage */

      if (byte >= 0x20) {
        this.#text.push(byte);
        index++;
        continue;
      }

      this.#flushText();

      if (byte === HT) {
        this.#painter.tab();
        index++;
        continue;
      }

      if (byte === LF) {
        this.#painter.lineFeed();
        index++;
        continue;
      }

      /* FF prints the page of page mode and returns to standard mode. In
         standard mode it feeds to the next page, which a receipt printer with
         a roll of paper has not got, so it does nothing at all */

      if (byte === FF) {
        if (this.#painter.pageMode) {
          this.#painter.printPage();
          this.#painter.page(false);
        }

        index++;
        continue;
      }

      /* CAN deletes the print data of the print area in page mode, which is
         where this command is defined. In standard mode a printer ignores it */

      if (byte === CAN) {
        this.#painter.cancelPage();
        index++;
        continue;
      }

      /* The encoder ends its lines with LF CR, the carriage return does not
         move the paper */

      if (byte === CR) {
        index++;
        continue;
      }

      /* Other control characters are not commands, a printer ignores them */

      if (byte !== ESC && byte !== GS && byte !== FS && byte !== DLE) {
        index++;
        continue;
      }

      const length = this.#execute(bytes, index);

      if (length < 0) {
        return;
      }

      index += length;
    }

    this.#flushText();
  }

  /**
     * Hand the text that was gathered to the painter, in the codepage that was
     * current while it was gathered
     */
  #flushText() {
    if (this.#text.length === 0) {
      return;
    }

    this.#painter.text(this.#decode(this.#text));
    this.#text = [];
  }

  /**
     * Handle the command at a position in the stream
     *
     * @param  {Uint8Array}   bytes   The whole stream
     * @param  {number}       index   Position of the prefix byte of the command
     * @return {number}               Number of bytes the command occupies, or -1 when the stream is too short
     */
  #execute(bytes, index) {
    const prefix = bytes[index];

    if (index + 2 > bytes.length) {
      return -1;
    }

    const code = bytes[index + 1];
    const start = index + 2;

    const command = this.#commands[prefix][code];
    const argument = command ? command.args : UNKNOWN_ARGUMENTS[prefix][code];

    const length = typeof argument === 'function' ?
      argument(bytes, start) :
      (typeof argument === 'number' ? argument : 0);

    if (length < 0 || start + length > bytes.length) {
      return -1;
    }

    const consumed = bytes.subarray(index, start + length);

    if (!command) {
      this.#unknown(consumed);
    } else if (command.run) {
      command.run(bytes.subarray(start, start + length), consumed);
    }

    return 2 + length;
  }

  /**
     * The command tables, one per prefix byte. They are built per renderer so
     * that the handlers can reach the state of this renderer.
     *
     * A command without a handler is parsed and ignored, which is what the
     * printer does with the commands that do not change the paper. The blocks
     * are ignored here as well, they are rendered in a later section, but their
     * argument lengths are right so that the stream stays in sync.
     *
     * @return {object}   The tables, keyed by prefix byte and command byte
     */
  #tables() {
    return {
      /* The real time status requests are parsed: the renderer has no channel
         back to the host, so a request for a status cannot reach the paper.
         DLE DC4 is not one of them, it fires the drawer and clears the buffer,
         and stays an unknown item the driver can see */

      [DLE]: {
        0x04: {args: realTimeStatusArguments, run: null}, /* DLE EOT n, transmit real time status */
        0x05: {args: 1, run: null}, /* DLE ENQ n, real time request to the printer */
      },

      [ESC]: {
        0x0c: {args: 0, run: () => this.#painter.printPage({keep: true})}, /* ESC FF, print the page */
        0x20: {args: 1, run: (a) => this.#painter.spacing(this.#across(a[0]))},
        0x21: {args: 1, run: (a) => this.#printMode(a[0])},
        0x24: {args: 2, run: (a) => this.#painter.position(this.#across(a[0] + a[1] * 256))},
        0x25: {args: 1, run: (a) => this.#selectUserDefined(a[0])},
        0x26: {args: userDefinedArguments, run: (a) => this.#defineUserDefined(a)},
        0x2a: {args: columnImageArguments, run: (a) => this.#columnImage(a)},
        0x2d: {args: 1, run: (a) => this.#underline(a[0])},
        0x3f: {args: 1, run: (a) => this.#cancelUserDefined(a[0])},
        0x32: {args: 0, run: () => this.#painter.lineSpacing(null)},
        0x33: {args: 1, run: (a) => this.#painter.lineSpacing(this.#down(a[0]))},
        0x34: {args: 1, run: null}, /* italic, parsed and ignored, as the hardware does */
        0x40: {args: 0, run: () => this.#initialize()},
        0x44: {args: nulTerminated, run: (a) => this.#painter.tabs(Array.from(a.subarray(0, a.length - 1)))},
        0x45: {args: 1, run: (a) => this.#bold({emphasis: (a[0] & 1) !== 0})},
        0x47: {args: 1, run: (a) => this.#bold({doubleStrike: (a[0] & 1) !== 0})},
        0x4a: {args: 1, run: (a) => this.#painter.feed(this.#down(a[0]))},
        0x4b: {args: 1, run: (a) => this.#reverseFeed(a[0])},
        0x4c: {args: 0, run: () => this.#painter.page(true)}, /* ESC L, select page mode */
        0x4d: {args: 1, run: (a) => this.#font(a[0])},
        0x52: {args: 1, run: (a) => this.#international(a[0])},
        0x53: {args: 0, run: () => this.#painter.page(false)}, /* ESC S, select standard mode */
        0x54: {args: 1, run: (a) => this.#printDirection(a[0])},
        0x56: {args: 1, run: (a) => this.#rotate(a[0])},
        0x57: {args: 8, run: (a) => this.#printArea(a)},
        0x5c: {args: 2, run: (a) => this.#relative(a)},
        0x61: {args: 1, run: (a) => this.#align(a[0])},
        0x64: {args: 1, run: (a) => this.#painter.lineFeed(a[0])},
        0x65: {args: 1, run: (a) => this.#painter.reverseLineFeed(a[0])},
        0x69: {args: 0, run: () => this.#emitCut('full')}, /* legacy full cut */
        0x6d: {args: 0, run: () => this.#emitCut('partial')}, /* legacy partial cut */
        0x70: {args: 3, run: (a) => this.#pulse(a)},
        0x72: {args: 1, run: null}, /* print colour, parsed, this renderer draws one bit */
        0x74: {args: 1, run: (a) => this.#selectCodepage(a[0])},
        0x75: {args: 1, run: null}, /* transmit peripheral device status, parsed, there is no channel back */
        0x76: {args: 0, run: null}, /* transmit paper sensor status, parsed */
        0x7b: {args: 1, run: (a) => this.#painter.style({upsideDown: (a[0] & 1) !== 0})},
      },

      [GS]: {
        0x21: {args: 1, run: (a) => this.#size(a[0])},
        0x24: {args: 2, run: (a) => this.#pageVertical(a, false)}, /* GS $, absolute vertical position */
        0x28: {args: parenthesisArguments, run: (a, consumed) => this.#parenthesis(a, consumed)},
        0x2a: {args: downloadedBitmapArguments, run: (a) => this.#defineBitImage(a)},
        0x2f: {args: 1, run: (a, consumed) => this.#printBitImage(a, consumed)},
        0x38: {args: largeParenthesisArguments, run: (a, consumed) => this.#largeParenthesis(a, consumed)},
        0x42: {args: 1, run: (a) => this.#painter.style({invert: (a[0] & 1) !== 0})},
        0x48: {args: 1, run: (a) => this.#hriPosition(a[0])},
        0x49: {args: 1, run: null}, /* transmit printer id, parsed, there is no channel back */
        0x4c: {args: 2, run: (a) => this.#painter.margins({left: this.#horizontal(a[0] + a[1] * 256)})},
        0x50: {args: 2, run: (a) => this.#motionUnits(a[0], a[1])},
        0x56: {args: cutArguments, run: (a) => this.#cut(a[0])},
        0x57: {args: 2, run: (a) => this.#painter.margins({width: this.#horizontal(a[0] + a[1] * 256)})},
        0x5c: {args: 2, run: (a) => this.#pageVertical(a, true)}, /* GS \, relative vertical position */
        0x61: {args: 1, run: null}, /* automatic status back, parsed, there is no channel back */
        0x62: {args: 1, run: null}, /* smoothing, parsed, it changes no dot of a one bit image */
        0x66: {args: 1, run: (a) => this.#hriFont(a[0])},
        0x68: {args: 1, run: (a) => this.#barcodeHeight(a[0])},
        0x6a: {args: 1, run: null}, /* transmit remaining paper sensor status, parsed */
        0x6b: {args: barcodeArguments, run: (a, consumed) => this.#drawBarcode(a, consumed)},
        0x72: {args: 1, run: null}, /* transmit status, parsed, there is no channel back */
        0x76: {args: rasterImageArguments, run: (a, consumed) => this.#rasterImage(a, consumed)},
        0x77: {args: 1, run: (a) => this.#moduleWidth(a[0])},
      },

      [FS]: {
        0x21: {args: 1, run: null}, /* multibyte print mode, parsed, see the notes */
        0x26: {args: 0, run: () => this.#kanjiMode(true)},
        0x28: {args: parenthesisArguments, run: (a, consumed) => this.#fsParenthesis(a, consumed)},
        0x2d: {args: 1, run: null}, /* multibyte underline, parsed */
        0x2e: {args: 0, run: () => this.#kanjiMode(false)},
        0x32: {args: 2 + KANJI_GLYPH_BYTES, run: (a) => this.#defineKanji(a)},
        0x3f: {args: 2, run: (a) => this.#cancelKanji(a)},
        0x43: {args: 1, run: (a) => this.#kanjiCodeSystem(a[0])},
        0x53: {args: 2, run: null}, /* multibyte character spacing, parsed */
        0x57: {args: 1, run: null}, /* quadruple size multibyte, parsed */
        0x70: {args: 2, run: (a, consumed) => this.#printNvBitImage(a, consumed)},
        0x71: {args: nvBitImageArguments, run: (a) => this.#defineNvBitImages(a)},
      },
    };
  }

  /**
     * GS ( x, a group of commands that all carry their length the same way:
     * GS ( k are the two dimensional symbologies and GS ( L the graphics. Both
     * carry two bytes behind their length, the selector and the function, so
     * the handlers are given everything behind the length bytes.
     *
     * Everything else in the group reports an unknown command.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #parenthesis(args, consumed) {
    if (args[0] === 0x6b) {
      this.#symbol(args.subarray(3), consumed);
      return;
    }

    if (args[0] === 0x4c) {
      this.#graphicsFunction(args.subarray(3), consumed);
      return;
    }

    /* GS ( H asks the printer to send a response back, which is a channel this
       renderer has not got and paper it cannot touch, so it is parsed */

    if (args[0] === 0x48) {
      return;
    }

    /* GS ( N selects the colour of the characters and of the background they
       are printed on. This renderer draws one bit, so every colour is the black
       of its paper and the functions of the group change nothing */

    if (args[0] === 0x4e) {
      if (!COLOUR_FUNCTIONS.includes(args[3])) {
        this.#unknown(consumed);
      }

      return;
    }

    this.#unknown(consumed);
  }

  /**
     * FS ( x, the multibyte group under a two byte length. FS ( A selects the
     * font a Kanji glyph is drawn in, and this renderer draws a placeholder
     * cell for every multibyte character whatever the font is, so the command
     * cannot change a dot and is parsed.
     *
     * Everything else in the group reports an unknown command, FS ( C, the code
     * system, included: it selects UTF-8, which this renderer does not decode.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #fsParenthesis(args, consumed) {
    if (args[0] === 0x41) {
      return;
    }

    this.#unknown(consumed);
  }

  /**
     * GS 8 L p1 p2 p3 p4 .., the graphics group under a four byte length, which
     * is how an image that is larger than 65535 bytes is sent. The functions
     * are the ones of GS ( L, only the length is longer.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #largeParenthesis(args, consumed) {
    if (args[0] === 0x4c) {
      this.#graphicsFunction(args.subarray(5), consumed);
      return;
    }

    this.#unknown(consumed);
  }

  /**
     * The graphics group of GS ( L and GS 8 L, everything behind the length
     * bytes: m, which is always 48, the function code, and its parameters.
     *
     * Functions 112 and 113 store an image in the graphics print buffer, in
     * raster and in column format, and function 50 prints what is in it.
     * Functions 67, 68, 83 and 84 define an image under a key code, in the NV
     * memory and in the download memory, 69 and 85 print one of them, and 65,
     * 66, 81 and 82 delete them. The functions that only answer the host, the
     * capacities and the key code lists, are consumed and do nothing.
     *
     * @param  {Uint8Array}   payload    The bytes behind the length, m first
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #graphicsFunction(payload, consumed) {
    if (payload.length < 2 || payload[0] !== 0x30) {
      this.#unknown(consumed);
      return;
    }

    const parameters = payload.subarray(2);

    switch (payload[1]) {
      /* Store graphics in the print buffer, in raster and in column format */

      case 112:
        this.#storeGraphics(parameters, false, consumed);
        break;

      case 113:
        this.#storeGraphics(parameters, true, consumed);
        break;

        /* Print the graphics that are in the print buffer */

      case 50:
        this.#printGraphics();
        break;

        /* Define NV and download graphics, in raster and in column format */

      case 67:
        this.#defineGraphics(parameters, NV_GRAPHICS, false, consumed);
        break;

      case 68:
        this.#defineGraphics(parameters, NV_GRAPHICS, true, consumed);
        break;

      case 83:
        this.#defineGraphics(parameters, DOWNLOAD_GRAPHICS, false, consumed);
        break;

      case 84:
        this.#defineGraphics(parameters, DOWNLOAD_GRAPHICS, true, consumed);
        break;

        /* Print the graphics of a key code, with the two scale factors */

      case 69:
        this.#printDefined(parameters, NV_GRAPHICS, consumed);
        break;

      case 85:
        this.#printDefined(parameters, DOWNLOAD_GRAPHICS, consumed);
        break;

        /* Delete every image of a memory, and one image of a key code */

      case 65:
        this.#deleteAllGraphics(parameters, NV_GRAPHICS);
        break;

      case 81:
        this.#deleteAllGraphics(parameters, DOWNLOAD_GRAPHICS);
        break;

      case 66:
        this.#deleteGraphics(parameters, NV_GRAPHICS);
        break;

      case 82:
        this.#deleteGraphics(parameters, DOWNLOAD_GRAPHICS);
        break;

        /* The capacity and the key code list functions answer the host, which
         this renderer has no channel to, so they are reported the way every
         other command that asks the printer something is */

      case 48:
      case 51:
      case 52:
      case 64:
      case 80:
        this.#unknown(consumed);
        break;

        /* Function 49 sets the reference dot density of the graphics
         commands, x y of 50 for 180 dpi and 51 for 360 dpi. It is consumed and
         not honoured: the images of this renderer are drawn at one dot per
         dot, on the 203 dpi of both profiles */

      case 49:
        break;

      default:
        this.#unknown(consumed);
        break;
    }
  }

  /**
     * Functions 112 and 113, which store an image in the graphics print buffer:
     * a bx by c xL xH yL yH d1..dk, where a is 48 for a monochrome image and 52
     * for a multiple tone one, bx and by are 1 or 2 and scale the image by
     * repeating its dots, c is the colour of the data, and x and y are the size
     * of the image in dots.
     *
     * Every colour is drawn, in the black of a single colour printer: this
     * renderer has one image buffer where a two colour printer has one per
     * colour, so a store of the second colour is stored the way a store of the
     * first one is and nothing an image carried is lost.
     *
     * @param  {Uint8Array}   parameters   The parameters of the function
     * @param  {boolean}      column       True for the column format of 113
     * @param  {Uint8Array}   consumed     The whole command, for the unknown item
     */
  #storeGraphics(parameters, column, consumed) {
    if (parameters.length < 8 || (parameters[0] !== MONOCHROME && parameters[0] !== MULTI_TONE)) {
      this.#unknown(consumed);
      return;
    }

    const width = parameters[4] + parameters[5] * 256;
    const height = parameters[6] + parameters[7] * 256;

    /* A parameter outside the range of the command makes the printer ignore
       the whole command, so nothing is stored and nothing is printed */

    if (!GRAPHICS_SCALES.includes(parameters[1]) || !GRAPHICS_SCALES.includes(parameters[2])) {
      return;
    }

    if (!this.#fits(width, height, column)) {
      return;
    }

    const bitmap = this.#bitmap(parameters.subarray(8), width, height, column);

    if (bitmap.width === 0 || bitmap.height === 0) {
      return;
    }

    this.#graphics.push(Bitmap.scale(bitmap, parameters[1], parameters[2]));
  }

  /**
     * Function 50, which prints the graphics print buffer as a block, aligned
     * the way the alignment says, and empties it. Images that were stored one
     * after another are drawn under each other, so that nothing is lost.
     */
  #printGraphics() {
    const images = this.#graphics;

    this.#graphics = [];

    if (images.length === 0) {
      return;
    }

    if (images.length === 1) {
      this.#painter.block(images[0]);
      return;
    }

    const width = images.reduce((widest, image) => Math.max(widest, image.width), 0);
    const height = images.reduce((total, image) => total + image.height, 0);

    const bitmap = Bitmap.create(width, height);

    let y = 0;

    for (const image of images) {
      Bitmap.blit(image, bitmap, 0, y);
      y += image.height;
    }

    this.#painter.block(bitmap);
  }

  /**
     * Functions 67, 68, 83 and 84, which define an image in the NV or the
     * download memory: a kc1 kc2 b xL xH yL yH [c d1..dk]1..[c d1..dk]b, where
     * kc1 and kc2 are the key code the print functions address the image with
     * and b is the number of colour blocks that follow the size.
     *
     * The image is kept in the painter under its key code for as long as this
     * renderer lives, an initialize and the end of a stream included, the way
     * the memory of a printer keeps it. Every colour block is drawn into it
     * with OR: a single colour printer has one image buffer, so the colours
     * land on top of each other and no dot of the definition is lost.
     *
     * @param  {Uint8Array}   parameters   The parameters of the function
     * @param  {string}       prefix       Key prefix of the memory, NV or download
     * @param  {boolean}      column       True for the column format of 68 and 84
     * @param  {Uint8Array}   consumed     The whole command, for the unknown item
     */
  #defineGraphics(parameters, prefix, column, consumed) {
    if (parameters.length < 8 || (parameters[0] !== MONOCHROME && parameters[0] !== MULTI_TONE)) {
      this.#unknown(consumed);
      return;
    }

    const key = `${prefix}${parameters[1]}:${parameters[2]}`;
    const colours = parameters[3];

    const width = parameters[4] + parameters[5] * 256;
    const height = parameters[6] + parameters[7] * 256;

    /* A size outside the range of the command makes the printer ignore the
       whole command, so the image that is under this key code stays there */

    if (!this.#fits(width, height, column)) {
      return;
    }

    /* A colour block is the colour byte and the dots of the image in the
       format of the function */

    const size = column ?
      ((height + 7) >> 3) * width :
      ((width + 7) >> 3) * height;

    /* Every colour block of the definition is drawn into one image with OR,
       which is what a printer with one image buffer does with them and what
       keeps an image that was sent in a second colour alone.

       The image is as large as the blocks that were drawn, never as large as
       the size the command declared: a definition that carries fewer rows, or
       fewer columns, than it asks for is the image it carries, the same rule
       #bitmap() applies to a block of one colour */

    let image = null;
    let offset = 8;

    for (let colour = 0; colour < colours && offset < parameters.length; colour++) {
      const bitmap = this.#bitmap(
          parameters.subarray(offset + 1, offset + 1 + size), width, height, column,
      );

      offset += 1 + size;

      if (bitmap.width === 0 || bitmap.height === 0) {
        continue;
      }

      if (!image) {
        image = bitmap;
        continue;
      }

      if (bitmap.width > image.width || bitmap.height > image.height) {
        const merged = Bitmap.create(
            Math.max(image.width, bitmap.width), Math.max(image.height, bitmap.height),
        );

        Bitmap.blit(image, merged, 0, 0);

        image = merged;
      }

      Bitmap.blit(bitmap, image, 0, 0);
    }

    /* A definition whose dots are missing leaves the image that is under this
       key code alone, it does not delete it */

    if (image) {
      this.#painter.define(key, image);
    }
  }

  /**
     * Functions 69 and 85, which print an image of a key code: kc1 kc2 x y,
     * where x and y are 1 or 2 and scale the image by repeating its dots.
     *
     * A key code the printer never got a definition for prints nothing and does
     * not advance the paper, and the command is reported instead.
     *
     * @param  {Uint8Array}   parameters   The parameters of the function
     * @param  {string}       prefix       Key prefix of the memory, NV or download
     * @param  {Uint8Array}   consumed     The whole command, for the unknown item
     */
  #printDefined(parameters, prefix, consumed) {
    /* The function carries four parameters, and one that is missing or outside
       its range makes the printer ignore the command */

    if (parameters.length < 4) {
      return;
    }

    if (!GRAPHICS_SCALES.includes(parameters[2]) || !GRAPHICS_SCALES.includes(parameters[3])) {
      return;
    }

    const printed = this.#painter.print(`${prefix}${parameters[0]}:${parameters[1]}`, {
      scale: {x: parameters[2], y: parameters[3]},
    });

    if (!printed) {
      this.#unknown(consumed);
    }
  }

  /**
     * Functions 65 and 81, which delete every image of a memory. They carry the
     * three fixed bytes CLR, and a parameter that is not those three makes the
     * printer ignore the command, so nothing is deleted by accident.
     *
     * @param  {Uint8Array}   parameters   The parameters of the function
     * @param  {string}       prefix       Key prefix of the memory, NV or download
     */
  #deleteAllGraphics(parameters, prefix) {
    if (parameters.length < 3 || !DELETE_ALL.every((byte, index) => parameters[index] === byte)) {
      return;
    }

    this.#painter.forget(prefix);
  }

  /**
     * Whether a size is one the graphics functions accept. The data direction
     * of the format holds up to 8192 dots and the other one up to 2047, and a
     * size of zero is not an image, so anything else is out of range and makes
     * the printer ignore the command.
     *
     * @param  {number}    width    Width of the image in dots
     * @param  {number}    height   Height of the image in dots
     * @param  {boolean}   column   True for column format, false for raster format
     * @return {boolean}            True when the printer would accept the size
     */
  #fits(width, height, column) {
    const widest = column ? MAX_GRAPHICS_LINES : MAX_GRAPHICS_DATA;
    const tallest = column ? MAX_GRAPHICS_DATA : MAX_GRAPHICS_LINES;

    return width >= 1 && width <= widest && height >= 1 && height <= tallest;
  }

  /**
     * Functions 66 and 82, which delete the image of one key code. A key code
     * that holds no image deletes nothing, as it does on a printer.
     *
     * @param  {Uint8Array}   parameters   The parameters of the function
     * @param  {string}       prefix       Key prefix of the memory, NV or download
     */
  #deleteGraphics(parameters, prefix) {
    if (parameters.length < 2) {
      return;
    }

    this.#painter.define(`${prefix}${parameters[0]}:${parameters[1]}`, null);
  }

  /**
     * The dots of a graphics command as a bitmap, in the format the function
     * carries them in.
     *
     * The size of these images is not the length of the command, the group
     * length is, so a stream can ask for an image that is larger than the dots
     * it carries. The image is cut down to the rows, or the columns, the data
     * actually holds, and data that is not even one row or one column long is
     * no image at all, so both axes are bounded by the bytes that are there and
     * a size the range check let through never allocates more than the command
     * carries.
     *
     * @param  {Uint8Array}   data     The dots
     * @param  {number}       width    Width of the image in dots
     * @param  {number}       height   Height of the image in dots
     * @param  {boolean}      column   True for column format, false for raster format
     * @return {Bitmap}                The image
     */
  #bitmap(data, width, height, column) {
    if (width <= 0 || height <= 0) {
      return Bitmap.create(0, 0);
    }

    if (column) {
      const bytes = (height + 7) >> 3;
      const lines = Math.min(width, Math.floor(data.length / bytes));

      return lines > 0 ? Bitmap.fromColumns(data, lines, height) : Bitmap.create(0, 0);
    }

    const bytes = (width + 7) >> 3;
    const lines = Math.min(height, Math.floor(data.length / bytes));

    return lines > 0 ? Bitmap.fromRaster(data, width, lines) : Bitmap.create(0, 0);
  }

  /**
     * GS * x y d.., the downloaded bit image: x bytes of eight dots wide and y
     * bytes of eight dots tall, in column format. There is one downloaded bit
     * image, so a definition replaces the one before it.
     *
     * A size outside the range of the command, `x` of 1 to 255, `y` of 1 to 48
     * and at most 1536 bytes in all, makes the printer ignore the command, so
     * the image that was downloaded before it stays where it is.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #defineBitImage(args) {
    const width = args[0];
    const height = args[1];

    if (width < 1 || width > MAX_DOWNLOAD_WIDTH || height < 1 || height > MAX_DOWNLOAD_HEIGHT) {
      return;
    }

    if (width * height > MAX_DOWNLOAD_BYTES) {
      return;
    }

    this.#painter.define(
        DOWNLOAD_BIT_IMAGE,
        Bitmap.fromColumns(args.subarray(2), width * 8, height * 8),
    );
  }

  /**
     * GS / m, which prints the downloaded bit image in one of the four modes of
     * GS v 0. A printer that was never given a definition prints nothing.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #printBitImage(args, consumed) {
    const scale = IMAGE_SCALES[args[0]];

    /* A mode the command does not define is out of range, and the printer
       ignores the command */

    if (!scale) {
      return;
    }

    if (!this.#painter.print(DOWNLOAD_BIT_IMAGE, {scale})) {
      this.#unknown(consumed);
    }
  }

  /**
     * FS q n [xL xH yL yH d1..dk]1..[..]n, which defines the NV bit images: n
     * images, each x bytes of eight dots wide and y bytes of eight dots tall,
     * in column format. The command replaces every NV bit image the printer
     * held, as the reference says, so the images of an earlier definition are
     * forgotten first.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #defineNvBitImages(args) {
    /* A count outside the range of the command makes the printer ignore it, so
       an FS q 0 deletes nothing */

    if (args[0] < 1) {
      return;
    }

    this.#painter.forget(NV_BIT_IMAGE);

    let offset = 1;

    for (let image = 1; image <= args[0] && offset + 4 <= args.length; image++) {
      const width = args[offset] + args[offset + 1] * 256;
      const height = args[offset + 2] + args[offset + 3] * 256;
      const size = width * height * 8;

      if (width > 0 && height > 0) {
        this.#painter.define(`${NV_BIT_IMAGE}${image}`, Bitmap.fromColumns(
            args.subarray(offset + 4, offset + 4 + size), width * 8, height * 8,
        ));
      }

      offset += 4 + size;
    }
  }

  /**
     * FS p n m, which prints NV bit image n in one of the four modes of GS v 0.
     * An image the stream never defined prints nothing and the command is
     * reported: the printer holds NV bit images of its own, and this renderer
     * has never seen them.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #printNvBitImage(args, consumed) {
    const scale = IMAGE_SCALES[args[1]];

    /* A mode the command does not define is out of range, and the printer
       ignores the command */

    if (!scale) {
      return;
    }

    if (!this.#painter.print(`${NV_BIT_IMAGE}${args[0]}`, {scale})) {
      this.#unknown(consumed);
    }
  }

  /**
     * GS ( k, the two dimensional symbologies. The first byte says which one,
     * 49 for QR codes and 48 for PDF417, and the second one which command of
     * that symbology it is.
     *
     * @param  {Uint8Array}   args       The arguments behind the length bytes
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #symbol(args, consumed) {
    if (args.length < 2) {
      this.#unknown(consumed);
      return;
    }

    const [type, command] = args;

    if (type === 0x30) {
      this.#pdf417Symbol(command, args);
      return;
    }

    /* Maxicode, the two dimensional GS1 DataBar and the composite symbologies
       are the other selectors of this group, and none of them is rendered */

    if (type !== 0x31) {
      this.#unknown(consumed);
      return;
    }

    /* QR code, GS ( k pL pH 49 fn .. */

    if (command === 0x41 && args.length >= 3) {
      this.#qrcode.model = args[2] === 0x31 ? 1 : 2;
    }

    if (command === 0x43 && args.length >= 3) {
      this.#qrcode.moduleSize = Math.min(16, Math.max(1, args[2]));
    }

    if (command === 0x45 && args.length >= 3 && ERROR_LEVELS[args[2]]) {
      this.#qrcode.errorLevel = ERROR_LEVELS[args[2]];
    }

    /* The data of the next symbol, which stays stored until the next store, so
       printing twice prints the same symbol twice */

    if (command === 0x50 && args.length >= 3) {
      this.#qrcode.data = args.slice(3);
    }

    if (command === 0x51) {
      this.#painter.qrcode({
        data: this.#qrcode.data,
        moduleSize: this.#qrcode.moduleSize,
        errorLevel: this.#qrcode.errorLevel,
      });
    }
  }

  /**
     * GS ( k with the PDF417 selector, 48: 65 to 70 set the parameters of the
     * next symbol, 80 stores its data and 81 prints it.
     *
     * A parameter outside the range of its command is ignored and leaves the
     * value as it was, the way an unknown font or alignment does.
     *
     * @param  {number}       command   The function byte of the command
     * @param  {Uint8Array}   args      The arguments behind the length bytes
     */
  #pdf417Symbol(command, args) {
    /* fn 65, the number of data columns, 1 to 30, or 0 for a number the printer
       picks, and fn 66, the number of rows, 3 to 90, or 0 for the same */

    if (command === 0x41 && args.length >= 3 && (args[2] === 0 || (args[2] >= 1 && args[2] <= 30))) {
      this.#pdf417.columns = args[2];
    }

    if (command === 0x42 && args.length >= 3 && (args[2] === 0 || (args[2] >= 3 && args[2] <= 90))) {
      this.#pdf417.rows = args[2];
    }

    /* fn 67, the width of a module in dots, and fn 68, the height of a row as
       a multiple of that width */

    if (command === 0x43 && args.length >= 3 && args[2] >= 2 && args[2] <= 8) {
      this.#pdf417.moduleWidth = args[2];
    }

    if (command === 0x44 && args.length >= 3 && args[2] >= 2 && args[2] <= 8) {
      this.#pdf417.rowHeight = args[2];
    }

    /* fn 69, the error correction. With m of 48 the level is the digit behind
       it, 0 to 8. With m of 49 the command asks for a ratio of check codewords
       to data codewords instead, n tenths of the data, and the level that comes
       closest to it can only be picked once the number of codewords is known,
       so the ratio is passed on and the symbology resolves it. */

    if (command === 0x45 && args.length >= 4) {
      if (args[2] === 0x30 && args[3] >= 0x30 && args[3] <= 0x38) {
        this.#pdf417.errorLevel = args[3] - 0x30;
        this.#pdf417.errorRatio = 0;
      }

      if (args[2] === 0x31 && args[3] >= 1 && args[3] <= 40) {
        this.#pdf417.errorLevel = 'auto';
        this.#pdf417.errorRatio = args[3];
      }
    }

    /* fn 70, the form of the symbol: 0 standard, 1 truncated */

    if (command === 0x46 && args.length >= 3 && (args[2] === 0 || args[2] === 1)) {
      this.#pdf417.truncated = args[2] === 1;
    }

    /* The data of the next symbol, which stays stored until the next store, so
       printing twice prints the same symbol twice */

    if (command === 0x50 && args.length >= 3) {
      this.#pdf417.data = args.slice(3);
    }

    if (command === 0x51) {
      this.#painter.pdf417({
        data: this.#pdf417.data,
        columns: this.#pdf417.columns,
        rows: this.#pdf417.rows,
        moduleWidth: this.#pdf417.moduleWidth,
        rowHeight: this.#pdf417.rowHeight,
        errorLevel: this.#pdf417.errorLevel,
        errorRatio: this.#pdf417.errorRatio,
        truncated: this.#pdf417.truncated,
      });
    }
  }

  /**
     * GS h n, the height of the bars of the next barcode in dots
     *
     * @param  {number}   value   The argument of the command
     */
  #barcodeHeight(value) {
    if (value > 0) {
      this.#barcode.height = value;
    }
  }

  /**
     * GS w n, the width of the narrowest bar of the next barcode in dots. The
     * specification defines 2 to 6, the encoder sends 1 for the GS1 symbologies,
     * so the renderer takes everything a printer could draw.
     *
     * @param  {number}   value   The argument of the command
     */
  #moduleWidth(value) {
    if (value >= 1 && value <= 6) {
      this.#barcode.moduleWidth = value;
    }
  }

  /**
     * GS H n, where the human readable text of a barcode goes
     *
     * @param  {number}   value   The argument of the command
     */
  #hriPosition(value) {
    if (HRI[value]) {
      this.#barcode.position = HRI[value];
    }
  }

  /**
     * GS f n, the font of the human readable text of a barcode. The default is
     * font A, as the ESC/POS reference of this command says, and the encoder
     * never changes it.
     *
     * @param  {number}   value   The argument of the command
     */
  #hriFont(value) {
    if (value === 0 || value === 48) {
      this.#barcode.font = 'A';
    }

    if (value === 1 || value === 49) {
      this.#barcode.font = 'B';
    }
  }

  /**
     * GS k m .., a barcode. Function A, for m below 65, ends its data at a NUL
     * byte, function B carries the length of the data.
     *
     * Data the symbology refuses draws no bars. The reference says that a
     * `GS k` whose data is out of range is aborted and its data processed as
     * normal data, so the bytes are fed back into the parser at the position
     * the command stood: printable bytes become text in the codepage and the
     * style that are current, and a control byte does what it does anywhere
     * else, so a line feed inside refused data ends the line. An Epson TM-T70
     * does exactly that with the UPC-E rows of six to eight digits of the
     * escpos-php `barcode` fixture. Both functions behave the same way.
     *
     * Refused data that is itself a refused barcode goes to the text path
     * instead of being parsed again, which bounds the recursion at one level.
     * No stream in the wild nests them, and the alternative is a stream that
     * costs one stack frame per three bytes.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #drawBarcode(args, consumed) {
    const symbology = SYMBOLOGIES[args[0]];

    if (!symbology) {
      this.#unknown(consumed);
      return;
    }

    const data = args[0] >= 65 ? args.subarray(2, 2 + args[1]) : args.subarray(1, args.length - 1);

    const drawn = this.#painter.barcode({
      symbology,
      data: this.#ascii(data),
      moduleWidth: this.#barcode.moduleWidth,
      height: this.#barcode.height,
      hri: {position: this.#barcode.position, font: this.#barcode.font},
    });

    if (drawn) {
      return;
    }

    if (this.#refusing) {
      this.#painter.text(this.#decode(data));
      return;
    }

    this.#refusing = true;

    try {
      this.#parse(data);
    } finally {
      this.#refusing = false;
    }
  }

  /**
     * ESC * m nL nH d.., a column mode image: one strip of eight or twenty four
     * rows, one or three bytes per column, the most significant bit of the first
     * byte at the top. The single density modes print every column twice, so
     * that the image keeps its proportions at half the resolution.
     *
     * The strip goes into the line that is being composed. The encoder sets the
     * line spacing to the height of a strip, so that the strips of an image join
     * up as the line feeds behind them commit the lines.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #columnImage(args) {
    const mode = args[0];
    const columns = args[1] + args[2] * 256;
    const bytes = mode === 32 || mode === 33 ? 3 : 1;
    const double = mode === 1 || mode === 33;

    const strip = Bitmap.fromColumns(args.subarray(3), columns, bytes * 8);

    this.#painter.strip(double ? strip : Bitmap.scale(strip, 2, 1));
  }

  /**
     * GS v 0 m xL xH yL yH d.., a raster image: rows of xL + xH * 256 bytes,
     * eight dots per byte, drawn as a block of its own and aligned the way the
     * alignment says. The mode doubles the width, the height, or both, and it
     * is accepted as a number and as an ASCII digit, the way the other
     * arguments of this language are.
     *
     * GS v is only defined with a 0 behind it, so anything else reports an
     * unknown command instead of drawing whatever follows.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #rasterImage(args, consumed) {
    if (args[0] !== 0x30) {
      this.#unknown(consumed);
      return;
    }

    /* The first argument byte is the 0 of the command itself, the mode is the
       one behind it */

    const scale = IMAGE_SCALES[args[1]] || {x: 1, y: 1};
    const rowBytes = args[2] + args[3] * 256;
    const rows = args[4] + args[5] * 256;

    const bitmap = Bitmap.fromRaster(args.subarray(6), rowBytes * 8, rows);

    this.#painter.block(Bitmap.scale(bitmap, scale.x, scale.y));
  }

  /**
     * Decode the bytes of a barcode, which a printer reads as ASCII
     *
     * @param  {Uint8Array}   bytes   The bytes
     * @return {string}               The text
     */
  #ascii(bytes) {
    let result = '';

    for (const byte of bytes) {
      result += String.fromCharCode(byte);
    }

    return result;
  }

  /**
     * Report a command that was not understood
     *
     * @param  {Uint8Array}   consumed   The bytes of the command
     */
  #unknown(consumed) {
    this.#painter.command({type: 'unknown', data: consumed.slice()});
  }

  /**
     * ESC - n, the underline thickness, 0, 1 or 2 dots. A value the command
     * does not define leaves the underline as it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #underline(value) {
    if (typeof UNDERLINE[value] === 'number') {
      this.#painter.style({underline: UNDERLINE[value]});
    }
  }

  /**
     * ESC M n, the font
     *
     * @param  {number}   value   The argument of the command
     */
  #font(value) {
    if (value === 0 || value === 48) {
      this.#painter.font('A');
    }

    if (value === 1 || value === 49) {
      this.#painter.font('B');
    }
  }

  /**
     * ESC a n, the alignment
     *
     * @param  {number}   value   The argument of the command
     */
  #align(value) {
    const alignment = ['left', 'center', 'right'][value >= 48 ? value - 48 : value];

    if (alignment) {
      this.#painter.align(alignment);
    }
  }

  /**
     * GS ! n, the character size, the width multiplier in the high nibble and
     * the height multiplier in the low nibble, both one less than the multiplier
     *
     * @param  {number}   value   The argument of the command
     */
  #size(value) {
    this.#painter.style({
      width: ((value >> 4) & 7) + 1,
      height: (value & 7) + 1,
    });
  }

  /**
     * GS P x y, the motion units.
     *
     * The vertical motion unit decides how many dots ESC 3 and ESC J advance
     * the paper. The renderer tracks it as the number of units in one dot: on
     * an Epson printer a unit is half a dot by default, so two, and the profile
     * says so. The encoder sets both units to the resolution of the printer
     * around a column mode image, which makes one unit one dot, and restores
     * the defaults with GS P 0 0 afterwards. Any other value is taken as one
     * unit per dot as well, because the renderer does not know the resolution
     * of the printer it emulates.
     *
     * The horizontal unit is what ESC SP, ESC $, ESC \, GS L and GS W are
     * counted in, and it is tracked the other way round, as the number of dots
     * in one unit: one dot by default, and the dots of one `x`th of an inch
     * once the command sets it, which is the resolution of the profile divided
     * by `x`.
     *
     * @param  {number}   horizontal   The horizontal motion unit of the command
     * @param  {number}   vertical     The vertical motion unit of the command
     */
  #motionUnits(horizontal, vertical) {
    this.#verticalUnits = vertical === 0 ? this.#painter.profile.motionUnit : 1;
    this.#horizontalUnits = horizontal === 0 ? 1 : this.#dpi / horizontal;
  }

  /**
     * A distance in horizontal motion units, in dots
     *
     * @param  {number}   units   The distance of the command
     * @return {number}           The distance in dots
     */
  #horizontal(units) {
    return Math.round(units * this.#horizontalUnits);
  }

  /**
     * A distance in vertical motion units, in dots
     *
     * @param  {number}   units   The distance of the command
     * @return {number}           The distance in dots
     */
  #vertical(units) {
    return Math.round(units / this.#verticalUnits);
  }

  /**
     * A distance along the axis the characters of a line run in, in dots, which
     * is what ESC $ and ESC \ move the cursor by.
     *
     * That axis is the horizontal one of the paper in standard mode and in the
     * print directions 0 and 2 of page mode, and the vertical one in the
     * directions 1 and 3, where the text runs up or down the paper. The unit
     * follows the axis, which is what the reference of these commands says of
     * them in page mode.
     *
     * @param  {number}   units   The distance of the command
     * @return {number}           The distance in dots
     */
  #across(units) {
    return this.#sideways() ? this.#vertical(units) : this.#horizontal(units);
  }

  /**
     * A distance along the axis the lines of a page go down in, which is what
     * GS $ and GS \ move the position by. It is the other axis of #across().
     *
     * @param  {number}   units   The distance of the command
     * @return {number}           The distance in dots
     */
  #down(units) {
    return this.#sideways() ? this.#horizontal(units) : this.#vertical(units);
  }

  /**
     * Whether the text of the page runs up or down the paper instead of across
     * it, which is the case in the print directions 1 and 3
     *
     * @return {boolean}   True in a sideways print direction
     */
  #sideways() {
    return this.#painter.pageMode && (this.#direction === 1 || this.#direction === 3);
  }

  /**
     * ESC T n, the print direction and the starting position of page mode.
     *
     * The direction is a setting of the printer rather than of one page: a
     * stream can set it in standard mode, it is what the next page starts in,
     * and it survives that page. Only ESC @ puts it back to 0.
     *
     * @param  {number}   value   The argument of the command
     */
  #printDirection(value) {
    const direction = PRINT_DIRECTIONS[value];

    if (typeof direction !== 'number') {
      return;
    }

    this.#painter.pageDirection(direction);
    this.#direction = direction;
  }

  /**
     * ESC W xL xH yL yH dxL dxH dyL dyH, the print area of page mode. The
     * origin and the width are in horizontal motion units and the height in
     * vertical ones, whatever the print direction is: the area is a rectangle
     * on the page and not on the layout inside it.
     *
     * A width or a height of zero, and an origin outside the page, make the
     * printer drop the command, which the painter does as well. The area is a
     * setting of the printer and not of one page: it can be set in standard
     * mode, the next page starts in it, and it survives that page until ESC @.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #printArea(args) {
    this.#painter.pageArea({
      x: this.#horizontal(args[0] + args[1] * 256),
      y: this.#vertical(args[2] + args[3] * 256),
      width: this.#horizontal(args[4] + args[5] * 256),
      height: this.#vertical(args[6] + args[7] * 256),
    });
  }

  /**
     * GS $ nL nH and GS \ nL nH, the absolute and the relative position along
     * the vertical axis of the print direction. The relative distance is
     * signed, a value above 32767 is the negative distance below it, the way
     * ESC \ counts.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {boolean}      relative   True for GS \, the relative position
     */
  #pageVertical(args, relative) {
    const value = args[0] + args[1] * 256;
    const distance = relative && value > 32767 ? value - 65536 : value;

    this.#painter.pageVertical(this.#down(distance), {relative});
  }

  /**
     * ESC K n, print and reverse feed n vertical motion units. The pending line
     * is printed first and the paper then moves back over the rows that are
     * already on it, so that everything behind it overprints them.
     *
     * The command takes 0 to 48 units, twenty four dots at the default vertical
     * motion unit of an Epson, which is as far as the mechanism reverses. A
     * larger value is out of range and the whole command is ignored, the line
     * included, the way a printer ignores an argument it has no range for.
     *
     * @param  {number}   units   The argument of the command
     */
  #reverseFeed(units) {
    if (units > MAX_REVERSE_UNITS) {
      return;
    }

    this.#painter.reverseFeed(this.#down(units));
  }

  /**
     * ESC \ nL nH, the relative print position. The distance is signed, a
     * negative one moves the cursor back towards the left margin.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #relative(args) {
    const value = args[0] + args[1] * 256;
    const distance = value > 32767 ? value - 65536 : value;

    this.#painter.position(this.#painter.cursor + this.#across(distance));
  }

  /**
     * ESC ! n, the print mode: font, bold, double height, double width and
     * underline in one byte. It sets the same state the individual commands
     * set, so a GS ! behind it still decides the size.
     *
     * @param  {number}   value   The argument of the command
     */
  #printMode(value) {
    this.#painter.font((value & 0x01) ? 'B' : 'A');

    this.#painter.style({
      height: (value & 0x10) ? 2 : 1,
      width: (value & 0x20) ? 2 : 1,
      underline: (value & 0x80) ? 1 : 0,
    });

    this.#bold({emphasis: (value & 0x08) !== 0});
  }

  /**
     * Emphasis and double strike are two settings of the printer, ESC E and
     * ESC G, and bit 3 of ESC ! is the emphasis one. Both are printed darker
     * and this renderer has one bold, so the cells are bold while either of
     * them is on: switching one off does not undo the other.
     *
     * @param  {object}   changes   The setting to change, `emphasis` or `doubleStrike`
     */
  #bold(changes) {
    if (typeof changes.emphasis !== 'undefined') {
      this.#emphasis = changes.emphasis;
    }

    if (typeof changes.doubleStrike !== 'undefined') {
      this.#doubleStrike = changes.doubleStrike;
    }

    this.#painter.style({bold: this.#emphasis || this.#doubleStrike});
  }

  /**
     * ESC R n, the international character set. A number the command does not
     * define leaves the set as it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #international(value) {
    const table = internationalCharacterSet(value);

    if (table) {
      this.#characterSet = table;
    }
  }

  /**
     * FS & and FS ., which switch Kanji mode on and off
     *
     * @param  {boolean}   value   True for on
     */
  #kanjiMode(value) {
    this.#kanji = value;
  }

  /**
     * FS C n, the code system of the multibyte characters, which says which
     * bytes are a lead byte. A value the command does not define leaves it as
     * it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #kanjiCodeSystem(value) {
    if (CODE_SYSTEMS[value]) {
      this.#codeSystem = CODE_SYSTEMS[value];
    }
  }

  /**
     * ESC & y c1 c2 [x d1..d(y * x)]1..[..], which defines the glyphs of the
     * character codes c1 to c2 in the font that is current: y bytes of eight
     * dots in the vertical direction, which is three for the fonts of these
     * printers and the only value the command takes here, and per character the
     * number of columns it is wide and that many columns of y bytes, the most
     * significant bit at the top.
     *
     * A parameter outside the ranges of the command makes the printer ignore
     * the whole command, so the glyphs that are defined stay as they are. The
     * widest character is the cell of the font, twelve columns for font A and
     * nine for font B, which is what the ranges of the reference come down to.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #defineUserDefined(args) {
    const first = args[1];
    const last = args[2];

    if (args[0] !== GLYPH_BYTES || first > last) {
      return;
    }

    if (first < FIRST_GLYPH_CODE || last > LAST_GLYPH_CODE) {
      return;
    }

    /* The dots of every character first, so that a command whose last
       definition is out of range defines none of them, the way the printer
       ignores it whole */

    const glyphs = [];

    let offset = 3;

    for (let code = first; code <= last; code++) {
      const width = args[offset];
      const length = width * GLYPH_BYTES;

      if (width > this.#painter.characterWidth || offset + 1 + length > args.length) {
        return;
      }

      glyphs.push({code, data: args.subarray(offset + 1, offset + 1 + length), width});
      offset += 1 + length;
    }

    for (const glyph of glyphs) {
      this.#painter.defineGlyph(glyph.code, Bitmap.fromColumns(glyph.data, glyph.width, GLYPH_BYTES * 8));
    }
  }

  /**
     * ESC % n, which selects the glyphs a stream downloaded with bit 0 of n and
     * the built in ones without it. A character code without a definition
     * prints its built in glyph either way.
     *
     * @param  {number}   value   The argument of the command
     */
  #selectUserDefined(value) {
    this.#userDefined = (value & 1) !== 0;
  }

  /**
     * ESC ? n, which cancels the glyph of one character code in the current
     * font, so that the code prints its built in glyph again
     *
     * @param  {number}   value   The argument of the command
     */
  #cancelUserDefined(value) {
    if (value < FIRST_GLYPH_CODE || value > LAST_GLYPH_CODE) {
      return;
    }

    this.#painter.defineGlyph(value, null);
  }

  /**
     * FS 2 c1 c2 d1..d72, which defines the glyph of a multibyte character
     * code: 24 by 24 dots in the column format of ESC &, three bytes per
     * column. That is the Kanji font of these printers, and it is two cells of
     * font A wide, which is the width the placeholder of a multibyte character
     * takes as well.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #defineKanji(args) {
    const bitmap = Bitmap.fromColumns(args.subarray(2), KANJI_GLYPH_SIZE, KANJI_GLYPH_SIZE);

    this.#painter.defineGlyph(args[0] * 256 + args[1], bitmap, {multibyte: true});
  }

  /**
     * FS ? c1 c2, which cancels the glyph of a multibyte character code, so
     * that the code prints its placeholder cells again
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #cancelKanji(args) {
    this.#painter.defineGlyph(args[0] * 256 + args[1], null, {multibyte: true});
  }

  /**
     * ESC V n, the rotation of the characters by 90 degrees clockwise. It is a
     * standard mode command, so a stream that sends it in page mode is ignored,
     * and the print direction of ESC T is what turns a layout there.
     *
     * @param  {number}   value   The argument of the command
     */
  #rotate(value) {
    if (this.#painter.pageMode || typeof ROTATION[value] !== 'boolean') {
      return;
    }

    this.#painter.style({rotate: ROTATION[value]});
  }

  /**
     * Whether a byte starts a multibyte character in the current code system.
     * Shift JIS has two ranges of lead bytes, JIS is a pair of bytes of the
     * printable ASCII range for every character.
     *
     * @param  {number}   byte   The byte
     * @return {boolean}         True when a trail byte follows it
     */
  #isLeadByte(byte) {
    if (this.#codeSystem === 'jis') {
      return byte >= 0x21 && byte <= 0x7e;
    }

    return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);
  }

  /**
     * Cut the paper, for the commands that carry no argument
     *
     * @param  {string}   value   'full' or 'partial'
     */
  #emitCut(value) {
    this.#painter.command({type: 'cut', value});
  }

  /**
     * GS V n, cut the paper
     *
     * @param  {number}   value   The argument of the command
     */
  #cut(value) {
    this.#painter.command({
      type: 'cut',
      value: [1, 49, 66, 104].includes(value) ? 'partial' : 'full',
    });
  }

  /**
     * ESC p m t1 t2, open the cash drawer. The times are in units of two
     * milliseconds.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #pulse(args) {
    this.#painter.command({
      type: 'pulse',
      device: args[0] & 1,
      on: args[1] * 2,
      off: args[2] * 2,
    });
  }

  /**
     * ESC t n, select the codepage the following bytes are decoded with. A
     * number the mapping does not have falls back to cp437, and so does the
     * initial state.
     *
     * @param  {number|null}   value   The argument of the command, null for the initial codepage
     */
  #selectCodepage(value) {
    const name = (value === null ? null : this.#mapping[value]) || DEFAULT_CODEPAGE;

    if (name === this.#codepage) {
      return;
    }

    /* A mapping can name a codepage the codepage encoder does not implement,
       cp885 of the Bixolon mapping for instance. A printer without that
       codepage prints the bytes with the one it has, so the renderer falls back
       to cp437 rather than giving up on the rest of the receipt */

    if (!this.#codepointCache.has(name)) {
      this.#codepointCache.set(name, codepointsOf(name) || codepointsOf(DEFAULT_CODEPAGE) || []);
    }

    this.#codepage = name;
    this.#codepoints = this.#codepointCache.get(name);
  }

  /**
     * Decode bytes with the current codepage, and with the international
     * character set over it: that set replaces twelve code points of the
     * codepage and nothing else, which is what the printer does with it.
     *
     * @param  {number[]|Uint8Array}   bytes   The bytes to decode
     * @return {string}                        The text
     */
  #decode(bytes) {
    let result = '';

    for (const byte of bytes) {
      result += String.fromCodePoint(this.#characterSet[byte] || this.#codepoints[byte] || 0xfffd);
    }

    return result;
  }
}

export default EscPosRenderer;
export {EscPosRenderer};
