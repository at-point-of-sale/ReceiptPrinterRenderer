import CodepageEncoder from '@point-of-sale/codepage-encoder';
import Bitmap from '../bitmap.js';
import Painter from '../painter.js';
import codepageMappings from '../../generated/mapping.js';
import printerProfiles from '../../generated/profiles.js';

/**
 * @typedef {import('../painter.js').Profile} Profile
 * @typedef {import('../painter.js').PainterOptions} PainterOptions
 * @typedef {import('../types.js').RendererOptions} RendererOptions
 * @typedef {import('../types.js').RenderItem} RenderItem
 */

const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const LF = 0x0a;
const CR = 0x0d;

/* The codepage every printer starts in, and the one an unknown codepage number
   falls back to */

const DEFAULT_CODEPAGE = 'cp437';

/* The values ESC - n accepts, as the binary numbers and as the ASCII digits.
   Anything else leaves the underline as it was, the way an unknown font or
   alignment does */

const UNDERLINE = Object.assign(Object.create(null), {0: 0, 1: 1, 2: 2, 48: 0, 49: 1, 50: 2});

/* The symbologies of GS k m, by the value of m. The ones that are not in this
   table are the GS1 DataBar family, 75 to 78, which version 1 does not render */

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
  79: 'code128-auto',
});

/* Where GS H n puts the human readable text of a barcode */

const HRI = Object.assign(Object.create(null), {
  0: 'none', 1: 'above', 2: 'below', 3: 'both',
  48: 'none', 49: 'above', 50: 'below', 51: 'both',
});

/* The error correction levels of the QR code commands */

const ERROR_LEVELS = Object.assign(Object.create(null), {48: 'L', 49: 'M', 50: 'Q', 51: 'H'});

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

/*
    Argument lengths of the commands the renderer does not implement, from the
    ESC/POS specification. They are only used to stay in sync with the stream,
    the command itself becomes an unknown item. Commands that are not in these
    tables consume their prefix alone, which is the best guess there is.
*/

/* FS 2 c1 c2 d1..dk defines a Kanji glyph, and the number of data bytes depends
   on the Kanji font of the printer, which the stream does not say. The 16 by 16
   font is the common one and the encoder never sends this command at all, so
   the table assumes its 32 data bytes */

const UNKNOWN_ARGUMENTS = {
  [ESC]: {
    0x20: 1, /* right side character spacing */
    0x21: 1, /* print mode */
    0x24: 2, /* absolute print position */
    0x25: 1, /* select user defined character set */
    0x2f: 1, /* print downloaded bitmap */
    0x3d: 1, /* select peripheral device */
    0x3f: 1, /* cancel user defined character */
    0x43: 1, /* page length in lines */
    0x44: nulTerminated, /* horizontal tab positions */
    0x47: 1, /* double strike */
    0x4b: 1, /* print and reverse feed n dots */
    0x4c: 0, /* page mode */
    0x52: 1, /* international character set */
    0x53: 0, /* standard mode */
    0x54: 1, /* print direction in page mode */
    0x55: 1, /* unidirectional printing */
    0x56: 1, /* rotate 90 degrees */
    0x57: 8, /* print area in page mode */
    0x5c: 2, /* relative print position */
    0x63: 2, /* paper sensor and panel button settings */
    0x65: 1, /* print and reverse feed n lines */
    0x69: 0, /* full cut, legacy */
    0x6d: 0, /* partial cut, legacy */
    0x72: 1, /* print colour */
    0x75: 1, /* transmit peripheral device status */
    0x76: 0, /* transmit paper sensor status */
    0x7b: 1, /* upside down printing */
  },

  [GS]: {
    0x24: 2, /* absolute vertical position in page mode */
    0x2a: downloadedBitmapArguments, /* define downloaded bitmap */
    0x2f: 1, /* print downloaded bitmap */
    0x3a: 0, /* start or end macro definition */
    0x41: 2, /* print position adjustment */
    0x45: 1, /* print control method */
    0x49: 1, /* transmit printer id */
    0x4c: 2, /* left margin */
    0x54: 1, /* print position at the top of the line */
    0x57: 2, /* print area width */
    0x5c: 2, /* relative vertical position in page mode */
    0x61: 1, /* automatic status back */
    0x62: 1, /* smoothing */
    0x63: 0, /* print counter */
    0x67: 4, /* maintenance counter, GS g 0 m nL nH and GS g 2 m nL nH */
    0x6a: 1, /* transmit remaining paper sensor status */
    0x72: 1, /* transmit status */
    0x7a: 2, /* print density and other settings */
  },

  [FS]: {
    0x21: 1, /* multi byte print mode */
    0x26: 0, /* select Kanji mode */
    0x2d: 1, /* multi byte underline */
    0x32: 34, /* define user defined Kanji, c1 c2 and the glyph, see below */
    0x3f: 2, /* cancel user defined Kanji, c1 c2 */
    0x43: 1, /* Kanji code system */
    0x53: 2, /* Kanji character spacing */
    0x57: 1, /* quadruple size Kanji */
    0x67: userMemoryArguments, /* write and read the user memory */
    0x70: 2, /* print NV bit image */
    0x71: nvBitImageArguments, /* define NV bit image, n images with their sizes */
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
  #verticalUnits;
  #text;
  #barcode;
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
      throw new Error(`Unknown codepage mapping ${mapping}`);
    }

    this.#mapping = codepageMappings['esc-pos'][mapping];

    /* A profile is a name of one of the built in profiles, or a profile of its
       own for a printer family that is not one of them */

    const profile = settings.profile || 'epson';
    let resolved = profile;

    if (typeof profile === 'string') {
      if (!Object.prototype.hasOwnProperty.call(printerProfiles, profile)) {
        throw new Error(`Unknown printer profile ${profile}`);
      }

      resolved = printerProfiles[profile];
    }

    this.#painter = new Painter({
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
    this.#text = [];
    this.#barcode = Object.assign({}, BARCODE_DEFAULTS);
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

      /* Printable bytes are gathered, so that a run of characters becomes one
         call on the painter, in one codepage */

      if (byte >= 0x20) {
        this.#text.push(byte);
        index++;
        continue;
      }

      this.#flushText();

      if (byte === LF) {
        this.#painter.lineFeed();
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

      if (byte !== ESC && byte !== GS && byte !== FS) {
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
      [ESC]: {
        0x2a: {args: columnImageArguments, run: (a) => this.#columnImage(a)},
        0x2d: {args: 1, run: (a) => this.#underline(a[0])},
        0x32: {args: 0, run: () => this.#painter.lineSpacing(null)},
        0x33: {args: 1, run: (a) => this.#painter.lineSpacing(Math.round(a[0] / this.#verticalUnits))},
        0x34: {args: 1, run: null}, /* italic, parsed and ignored, as the hardware does */
        0x40: {args: 0, run: () => this.#initialize()},
        0x45: {args: 1, run: (a) => this.#painter.style({bold: (a[0] & 1) !== 0})},
        0x4a: {args: 1, run: (a) => this.#painter.feed(Math.round(a[0] / this.#verticalUnits))},
        0x4d: {args: 1, run: (a) => this.#font(a[0])},
        0x61: {args: 1, run: (a) => this.#align(a[0])},
        0x64: {args: 1, run: (a) => this.#painter.lineFeed(a[0])},
        0x70: {args: 3, run: (a) => this.#pulse(a)},
        0x74: {args: 1, run: (a) => this.#selectCodepage(a[0])},
      },

      [GS]: {
        0x21: {args: 1, run: (a) => this.#size(a[0])},
        0x28: {args: parenthesisArguments, run: (a, consumed) => this.#parenthesis(a, consumed)},
        0x38: {args: largeParenthesisArguments, run: (a, consumed) => this.#unknown(consumed)},
        0x42: {args: 1, run: (a) => this.#painter.style({invert: (a[0] & 1) !== 0})},
        0x48: {args: 1, run: (a) => this.#hriPosition(a[0])},
        0x50: {args: 2, run: (a) => this.#motionUnits(a[1])},
        0x56: {args: cutArguments, run: (a) => this.#cut(a[0])},
        0x66: {args: 1, run: (a) => this.#hriFont(a[0])},
        0x68: {args: 1, run: (a) => this.#barcodeHeight(a[0])},
        0x6b: {args: barcodeArguments, run: (a, consumed) => this.#drawBarcode(a, consumed)},
        0x76: {args: rasterImageArguments, run: (a, consumed) => this.#rasterImage(a, consumed)},
        0x77: {args: 1, run: (a) => this.#moduleWidth(a[0])},
      },

      [FS]: {
        0x2e: {args: 0, run: null}, /* cancel Kanji mode, no effect on rendering */
      },
    };
  }

  /**
     * GS ( x, a group of commands that all carry their length the same way.
     * Only the two dimensional symbologies of GS ( k are rendered, in a later
     * section. The graphics of GS ( L are not, and neither is the same group
     * under GS 8 L, so both of those report an unknown command, as does
     * everything else in the group.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #parenthesis(args, consumed) {
    if (args[0] === 0x6b) {
      this.#symbol(args.subarray(3), consumed);
      return;
    }

    this.#unknown(consumed);
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
     * byte, function B carries the length of the data. The GS1 DataBar
     * symbologies are not rendered in version 1 and report an unknown command.
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

    this.#painter.barcode({
      symbology,
      data: this.#ascii(data),
      moduleWidth: this.#barcode.moduleWidth,
      height: this.#barcode.height,
      hri: {position: this.#barcode.position, font: this.#barcode.font},
    });
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

    const strip = Bitmap.create(columns, bytes * 8);

    for (let column = 0; column < columns; column++) {
      for (let byte = 0; byte < bytes; byte++) {
        const value = args[3 + column * bytes + byte];

        for (let bit = 0; bit < 8; bit++) {
          if (value & (0x80 >> bit)) {
            Bitmap.setPixel(strip, column, byte * 8 + bit, 1);
          }
        }
      }
    }

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

    const mode = args[1] >= 48 ? args[1] - 48 : args[1];
    const rowBytes = args[2] + args[3] * 256;
    const rows = args[4] + args[5] * 256;

    const bitmap = Bitmap.create(rowBytes * 8, rows);

    bitmap.data.set(args.subarray(6, 6 + rowBytes * rows));

    this.#painter.block(Bitmap.scale(bitmap, mode === 1 || mode === 3 ? 2 : 1, mode === 2 || mode === 3 ? 2 : 1));
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
     * @param  {number}   vertical   The vertical motion unit of the command
     */
  #motionUnits(vertical) {
    this.#verticalUnits = vertical === 0 ? this.#painter.profile.motionUnit : 1;
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
     * Decode bytes with the current codepage
     *
     * @param  {number[]}   bytes   The bytes to decode
     * @return {string}             The text
     */
  #decode(bytes) {
    let result = '';

    for (const byte of bytes) {
      result += String.fromCodePoint(this.#codepoints[byte] || 0xfffd);
    }

    return result;
  }
}

export default EscPosRenderer;
export {EscPosRenderer};
