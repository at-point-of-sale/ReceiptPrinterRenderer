import CodepageEncoder from '@point-of-sale/codepage-encoder';
import Painter from '../painter.js';
import codepageMappings from '../../generated/mapping.js';
import printerProfiles from '../../generated/profiles.js';

/**
 * @typedef {import('../painter.js').Profile} Profile
 * @typedef {import('../painter.js').PainterOptions} PainterOptions
 */

/**
 * @typedef {object} EscPosRendererOptions
 * @property {number} width                  Width of the print area in dots, a multiple of 8
 * @property {string} [codepageMapping]      Codepage mapping the commands were encoded with, defaults to 'epson'
 * @property {string[]} [commands]           Command types that appear in the output, the rest is dropped
 * @property {number} [maxHeight]            Maximum height of an image item, taller segments are split
 * @property {number} [lineSpacing]          Default line spacing in dots, defaults to the profile
 * @property {string|Profile} [profile]      Printer family defaults, a name or a profile, defaults to 'epson'
 * @property {number} [feedThreshold]        Runs of blank rows at least this tall become feed items
 * @property {object} [font]                 Font data, instead of the built in fonts
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
    0x66: 1, /* HRI font */
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
    0x71: 0, /* define NV bit image, variable */
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

  /**
     * Create a renderer
     *
     * @param  {EscPosRendererOptions}   options   How the printer this renderer emulates behaves
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
     * @return {object[]}                      The items, see the output contract in design.md
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
        0x2a: {args: columnImageArguments, run: null}, /* TODO column image, section 4 */
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
        0x48: {args: 1, run: null}, /* TODO barcode HRI position, section 4 */
        0x50: {args: 2, run: (a) => this.#motionUnits(a[1])},
        0x56: {args: cutArguments, run: (a) => this.#cut(a[0])},
        0x68: {args: 1, run: null}, /* TODO barcode height, section 4 */
        0x6b: {args: barcodeArguments, run: null}, /* TODO barcode, section 4 */
        0x76: {args: rasterImageArguments, run: null}, /* TODO raster image, section 4 */
        0x77: {args: 1, run: null}, /* TODO barcode module width, section 4 */
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
    /* TODO section 4: GS ( k is the QR code and PDF417 group */

    if (args[0] === 0x6b) {
      return;
    }

    this.#unknown(consumed);
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
