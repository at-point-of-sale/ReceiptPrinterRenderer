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

const BEL = 0x07;
const LF = 0x0a;
const CR = 0x0d;
const EM = 0x19;
const SUB = 0x1a;
const CAN = 0x18;
const ESC = 0x1b;
const FS = 0x1c;
const GS = 0x1d;
const RS = 0x1e;

/* A Star command is ESC and a command byte, or ESC GS or ESC RS and a command
   byte. The three groups have their own table, keyed by the byte that follows
   the prefix */

const GROUP_ESC = 'esc';
const GROUP_GS = 'esc gs';
const GROUP_RS = 'esc rs';

/* The codepage a Star printer starts in, when the mapping has no entry 0, and
   the one an unknown codepage number falls back to */

const DEFAULT_CODEPAGE = 'star/standard';

/* Line spacing in dots. Star printers are 203 dpi, which is eight dots per
   millimetre, so the three millimetres of ESC 0 are 24 dots. ESC z 1 is the
   four millimetre default of the printer, which the profile owns */

const LINE_SPACING_ESC_0 = 24;
const DOTS_PER_MM = 8;

/* The values ESC - n accepts, as the binary numbers and as the ASCII digits.
   The Star underline is one dot thick, there is no second thickness. Anything
   else leaves the underline as it was */

const UNDERLINE = Object.assign(Object.create(null), {0: 0, 1: 1, 48: 0, 49: 1});

/* The values of the two arguments of ESC i, as the binary numbers and as the
   ASCII digits. The encoder sends the binary ones. A multiplier is the value
   plus one, so 1 to 6 */

const SIZE = Object.assign(Object.create(null), {
  0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6,
  48: 1, 49: 2, 50: 3, 51: 4, 52: 5, 53: 6,
});

/* The symbologies of ESC b n1, by the value of n1. The ones that are not in
   this table are the GS1 DataBar family, 10 to 13, which version 1 does not
   render.

   StarPRNT has no way to select a Code 128 code set, the encoder strips the
   selection, so a Star Code 128 is encoded the way the automatic variant of
   ESC/POS is: the printer picks the code sets */

const SYMBOLOGIES = Object.assign(Object.create(null), {
  0: 'upce',
  1: 'upca',
  2: 'ean8',
  3: 'ean13',
  4: 'code39',
  5: 'itf',
  6: 'code128-auto',
  7: 'code93',
  8: 'codabar',
  9: 'gs1-128',
});

/* The width of the narrowest bar in dots, by the value of n3 of ESC b.

   The Star documentation describes the three widths per symbology in tables of
   narrow and wide element widths instead of in dots. Two, three and four dots
   is the reading that makes a Star barcode the same size as the ESC/POS barcode
   the encoder produces from the same receipt: the encoder writes its own width
   option, 1 to 3, as n3 here and as GS w n plus one on ESC/POS */

const MODULE_WIDTHS = Object.assign(Object.create(null), {1: 2, 2: 3, 3: 4});

/* The error correction levels of the QR code commands */

const ERROR_LEVELS = Object.assign(Object.create(null), {0: 'L', 1: 'M', 2: 'Q', 3: 'H'});

/* What a printer starts a QR code with: model 2, three dot modules and the
   lowest error correction level */

const QRCODE_DEFAULTS = {model: 2, moduleSize: 3, errorLevel: 'L'};

/* And for a PDF417: a size the printer picks, two dot modules, rows of two
   modules and the lowest error correction level. The encoder sets all four
   before it prints, so these are only reached by hand written streams. The
   StarPRNT command set has no truncated form, unlike the ESC/POS one, so a
   Star symbol is always the standard one. */

const PDF417_DEFAULTS = {columns: 0, rows: 0, moduleWidth: 2, rowHeight: 2, errorLevel: 0};

/* Pulse width of the drawer commands that do not carry one, in milliseconds.
   ESC BEL n1 n2 sets the width of BEL and FS, SUB and EM are fixed */

const DEFAULT_PULSE = 200;

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

    A command in the tables below says how many bytes follow its prefix, either
    as a number or as a function of the bytes. A function is given the whole
    stream and the position of the first argument, and returns the number of
    argument bytes, or -1 when the stream ends before the command is complete,
    which stops the parser without an error.
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
 * Arguments of ESC b n1 n2 n3 n4 d1..dk RS, a barcode. The four parameters are
 * followed by the data, which ends at the record separator. Data that holds a
 * 0x1e byte itself therefore ends the command early, which is inherent to the
 * framing of the command and not something the parser can repair. The encoder
 * encodes barcode data as ASCII, so it never sends one.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function barcodeArguments(bytes, index) {
  let end = index + 4;

  if (end > bytes.length) {
    return -1;
  }

  while (end < bytes.length && bytes[end] !== RS) {
    end++;
  }

  return end < bytes.length ? end - index + 1 : -1;
}

/**
 * Arguments of ESC GS y .., the QR code group: S s n sets a parameter,
 * D 1 m nL nH d1..dk stores the data and P prints the symbol.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function qrcodeArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  /* ESC GS y S 0 n, S 1 n and S 2 n, the model, the error level and the size */

  if (bytes[index] === 0x53) {
    return 3;
  }

  /* ESC GS y D 1 m nL nH d1..dk, the data of the next symbol */

  if (bytes[index] === 0x44) {
    if (index + 5 > bytes.length) {
      return -1;
    }

    return 5 + bytes[index + 3] + bytes[index + 4] * 256;
  }

  /* ESC GS y P prints, anything else is a command of one byte */

  return 1;
}

/**
 * Arguments of ESC GS x .., the PDF417 group: S 0 n n1 n2 sets the shape,
 * S 1 n, S 2 n and S 3 n set a parameter, D nL nH d1..dk stores the data and
 * P prints the symbol.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function pdf417Arguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  if (bytes[index] === 0x53) {
    if (index + 2 > bytes.length) {
      return -1;
    }

    /* ESC GS x S 0 n n1 n2 carries the rows and the columns, the other
       parameters are one byte */

    return bytes[index + 1] === 0x30 ? 5 : 3;
  }

  /* ESC GS x D nL nH d1..dk, the data of the next symbol. Unlike the QR code
     data command this one has no function byte between D and the length */

  if (bytes[index] === 0x44) {
    if (index + 3 > bytes.length) {
      return -1;
    }

    return 3 + bytes[index + 1] + bytes[index + 2] * 256;
  }

  return 1;
}

/**
 * Arguments of ESC X nL nH d1..dk, a column mode image of 24 dot strips, three
 * bytes per column. The LF CR that follows it in the stream is not part of the
 * command.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function columnImageArguments(bytes, index) {
  if (index + 2 > bytes.length) {
    return -1;
  }

  return 2 + (bytes[index] + bytes[index + 1] * 256) * 3;
}

/**
 * Arguments of ESC K, ESC L and ESC k, the bit image commands, which carry the
 * number of data bytes in two length bytes
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function bitImageArguments(bytes, index) {
  if (index + 2 > bytes.length) {
    return -1;
  }

  return 2 + bytes[index] + bytes[index + 1] * 256;
}

/**
 * Arguments of ESC * r .., the raster mode commands of the TSP100 family. Most
 * of them carry their parameter as ASCII digits followed by a NUL byte, the
 * ones that switch a mode carry nothing, and the margins have a second letter.
 *
 * @param  {Uint8Array}   bytes   The whole stream
 * @param  {number}       index   Position of the first argument
 * @return {number}               Number of argument bytes, or -1 when the stream is too short
 */
function rasterArguments(bytes, index) {
  if (index + 1 > bytes.length) {
    return -1;
  }

  /* ESC * is the raster group only when the letter r follows. Anything else is
     a command of one byte, and it is complete, so the check for the second byte
     belongs behind this one */

  if (bytes[index] !== 0x72) {
    return 1;
  }

  if (index + 2 > bytes.length) {
    return -1;
  }

  /* R initializes, A enters, B quits, C clears, a and b delimit a block */

  if ([0x41, 0x42, 0x43, 0x52, 0x61, 0x62].includes(bytes[index + 1])) {
    return 2;
  }

  /* ESC * r m l n NUL and ESC * r m r n NUL, the left and right margins */

  const digits = bytes[index + 1] === 0x6d ?
    nulTerminated(bytes, index + 3) :
    nulTerminated(bytes, index + 2);

  if (digits < 0) {
    return -1;
  }

  return (bytes[index + 1] === 0x6d ? 3 : 2) + digits;
}

/*
    Argument lengths of the commands the renderer does not implement. StarPRNT
    and Star Line Mode share most of their command set, and these are the
    lengths of the common ones, as best as the Star Line Mode and Star Graphic
    Mode specifications describe them. They are only used to stay in sync with
    the stream, the command itself becomes an unknown item. Commands that are
    not in these tables consume their prefix alone, which is the best guess
    there is, and the encoder emits none of them.
*/

const UNKNOWN_ARGUMENTS = {
  [GROUP_ESC]: {
    0x0c: 1, /* ESC FF n, print the buffer in the mode n, which is NUL, EOT, EM or LF */
    0x28: 1, /* select character expansion */
    0x29: 1, /* cancel character expansion */
    0x2a: rasterArguments, /* raster mode group */
    0x31: 0, /* select 1/8 inch line spacing, legacy */
    0x44: nulTerminated, /* horizontal tab positions */
    0x51: 1, /* right margin */
    0x52: 1, /* international character set */
    0x57: 1, /* character expansion */
    0x63: 1, /* select character set */
    0x68: 1, /* character height */
    0x6b: bitImageArguments, /* bit image, quadruple density */
    0x6c: 1, /* left margin */
  },

  [GROUP_GS]: {
    0x03: 3, /* ESC GS ETX s n1 n2, automatic status */
    0x23: 1, /* print density */
    0x5c: 2, /* vertical position */
    0x62: 1, /* blackmark and sensor settings */
    0x63: 1, /* colour */
  },

  [GROUP_RS]: {
    0x41: 1, /* print area */
    0x43: 1, /* character style */
    0x45: 1, /* character expansion */
    0x61: 1, /* print start control */
    0x64: 1, /* print density */
    0x72: 1, /* print speed */
  },
};

/**
 * Renders the StarPRNT commands ReceiptPrinterEncoder produces to images, the
 * way a printer would put them on paper. The Star Line Mode commands the
 * encoder emits for the star-line language are the same set, so this renderer
 * handles both.
 *
 * The parser is a table driven state machine over the byte stream, the same
 * one the ESC/POS renderer uses, over the three Star command groups. Every
 * command knows how many argument bytes it has, so that commands the renderer
 * does not implement can be skipped without losing the rest of the stream.
 */
class StarPrntRenderer {
  static language = 'star-prnt';

  #painter;
  #mapping;
  #commands;

  #initialCodepage;
  #codepage;
  #codepoints;
  #codepointCache;
  #pulse;
  #text;
  #qrcode;
  #pdf417;

  /**
     * Create a renderer
     *
     * @param  {RendererOptions}   options   How the printer this renderer emulates behaves,
     *                                     `codepageMapping` and `profile` default to 'star'
     */
  constructor(options) {
    const settings = options || {};

    if (!Number.isInteger(settings.width) || settings.width < 8 || settings.width % 8 !== 0) {
      throw new Error('Width is required and must be a positive multiple of 8 dots');
    }

    /* The mapping turns the number of a codepage command back into the name of
       a codepage, so it has to be the mapping the encoder used */

    const mapping = settings.codepageMapping || 'star';

    if (!Object.prototype.hasOwnProperty.call(codepageMappings['star-prnt'], mapping)) {
      throw new Error(`Unknown codepage mapping ${mapping}`);
    }

    this.#mapping = codepageMappings['star-prnt'][mapping];

    /* A Star printer starts in the codepage of number 0 of its mapping, which
       is the Star specific standard character set */

    this.#initialCodepage = this.#mapping[0] || DEFAULT_CODEPAGE;

    /* A profile is a name of one of the built in profiles, or a profile of its
       own for a printer family that is not one of them */

    const profile = settings.profile || 'star';
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

    this.#pulse = {on: DEFAULT_PULSE, off: DEFAULT_PULSE};
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
     * Render a stream of StarPRNT commands
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
      this.#pulse = {on: DEFAULT_PULSE, off: DEFAULT_PULSE};

      this.#initialize();
      this.#parse(data);

      return this.#painter.end();
    } finally {
      this.#painter.discard();
      this.#text = [];
    }
  }

  /**
     * Reset the state of the parser, which ESC @ does as well. The pulse width
     * of ESC BEL is not part of it, that setting survives an initialize on a
     * Star printer.
     */
  #initialize() {
    this.#painter.reset();
    this.#text = [];
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

      /* CAN throws away the print data of the line that is being composed,
         without advancing the paper. The encoder only ever sends it right
         behind ESC @, where the line buffer is already empty */

      if (byte === CAN) {
        this.#painter.cancel();
        index++;
        continue;
      }

      /* The drawers are driven by single control characters, BEL and FS for
         the first one, SUB and EM for the second */

      if (byte === BEL || byte === FS) {
        this.#drawer(0);
        index++;
        continue;
      }

      if (byte === SUB || byte === EM) {
        this.#drawer(1);
        index++;
        continue;
      }

      /* Other control characters are not commands, a printer ignores them */

      if (byte !== ESC) {
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
     * @param  {number}       index   Position of the ESC byte of the command
     * @return {number}               Number of bytes the command occupies, or -1 when the stream is too short
     */
  #execute(bytes, index) {
    if (index + 2 > bytes.length) {
      return -1;
    }

    /* ESC GS and ESC RS are prefixes of their own group, everything else is a
       command of the ESC group */

    const prefix = bytes[index + 1];
    const grouped = prefix === GS || prefix === RS;

    if (grouped && index + 3 > bytes.length) {
      return -1;
    }

    const group = grouped ? (prefix === GS ? GROUP_GS : GROUP_RS) : GROUP_ESC;
    const code = grouped ? bytes[index + 2] : prefix;
    const start = index + (grouped ? 3 : 2);

    const command = this.#commands[group][code];
    const argument = command ? command.args : UNKNOWN_ARGUMENTS[group][code];

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

    return start + length - index;
  }

  /**
     * The command tables, one per group. They are built per renderer so that
     * the handlers can reach the state of this renderer.
     *
     * A command without a handler is parsed and ignored, which is what the
     * printer does with the commands that do not change the paper. The blocks
     * are ignored here as well, they are rendered in a later section, but their
     * argument lengths are right so that the stream stays in sync.
     *
     * @return {object}   The tables, keyed by group and command byte
     */
  #tables() {
    return {
      [GROUP_ESC]: {
        0x07: {args: 2, run: (a) => this.#pulseWidth(a)},
        0x2d: {args: 1, run: (a) => this.#underline(a[0])},
        0x30: {args: 0, run: () => this.#painter.lineSpacing(LINE_SPACING_ESC_0)},
        0x34: {args: 0, run: () => this.#painter.style({invert: true})},
        0x35: {args: 0, run: () => this.#painter.style({invert: false})},
        0x40: {args: 0, run: () => this.#initialize()},
        0x45: {args: 0, run: () => this.#painter.style({bold: true})},
        0x46: {args: 0, run: () => this.#painter.style({bold: false})},
        0x49: {args: 1, run: (a) => this.#painter.feed(a[0])}, /* feed n eighths of a millimetre, one dot each */
        0x4a: {args: 1, run: (a) => this.#painter.feed(a[0] * 2)}, /* feed n quarters of a millimetre, two dots each */
        0x4b: {args: bitImageArguments, run: (a) => this.#bitImage(a, 2)}, /* bit image, normal density */
        0x4c: {args: bitImageArguments, run: (a) => this.#bitImage(a, 1)}, /* bit image, fine density */
        0x58: {args: columnImageArguments, run: (a) => this.#columnImage(a)},
        0x61: {args: 1, run: (a) => this.#painter.lineFeed(a[0])},
        0x62: {args: barcodeArguments, run: (a, consumed) => this.#drawBarcode(a, consumed)},
        0x64: {args: 1, run: (a) => this.#cut(a[0])},
        0x69: {args: 2, run: (a) => this.#size(a[0], a[1])},
        0x7a: {args: 1, run: (a) => this.#lineSpacing(a[0])},
      },

      [GROUP_GS]: {
        0x50: {args: 1, run: null}, /* print mode, the encoder flushes with it, no effect on paper */
        0x61: {args: 1, run: (a) => this.#align(a[0])},
        0x74: {args: 1, run: (a) => this.#selectCodepage(a[0])},
        0x78: {args: pdf417Arguments, run: (a) => this.#pdf417Symbol(a)},
        0x79: {args: qrcodeArguments, run: (a) => this.#symbol(a)},
      },

      [GROUP_RS]: {
        0x46: {args: 1, run: (a) => this.#font(a[0])},
      },
    };
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
     * ESC b n1 n2 n3 n4 d.. RS, a barcode. The GS1 DataBar symbologies are not
     * rendered in version 1 and report an unknown command.
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

    /* n2 is 1 for a barcode without text and 2 for one with the text below it,
       which a Star printer draws in font A */

    this.#painter.barcode({
      symbology,
      data: this.#ascii(args.subarray(4, args.length - 1)),
      moduleWidth: MODULE_WIDTHS[args[2]] || MODULE_WIDTHS[1],
      height: args[3] || 1,
      hri: {position: args[1] === 2 || args[1] === 0x32 ? 'below' : 'none', font: 'A'},
    });
  }

  /**
     * ESC GS y .., the QR code group: S 0 n is the model, S 1 n the error
     * correction level, S 2 n the size of a module in dots, D 1 m nL nH d..
     * stores the data of the next symbol, and P prints it.
     *
     * The data stays stored until the next store, so printing twice prints the
     * same symbol twice.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #symbol(args) {
    if (args[0] === 0x53 && args.length >= 3) {
      if (args[1] === 0x30) {
        this.#qrcode.model = args[2] === 1 ? 1 : 2;
      }

      if (args[1] === 0x31 && ERROR_LEVELS[args[2]]) {
        this.#qrcode.errorLevel = ERROR_LEVELS[args[2]];
      }

      if (args[1] === 0x32) {
        this.#qrcode.moduleSize = Math.min(8, Math.max(1, args[2]));
      }

      return;
    }

    if (args[0] === 0x44 && args.length >= 5) {
      this.#qrcode.data = args.slice(5, 5 + args[3] + args[4] * 256);
      return;
    }

    if (args[0] === 0x50) {
      this.#painter.qrcode({
        data: this.#qrcode.data,
        moduleSize: this.#qrcode.moduleSize,
        errorLevel: this.#qrcode.errorLevel,
      });
    }
  }

  /**
     * ESC GS x .., the PDF417 group: S 0 n1 n2 n3 is the size, S 1 n the error
     * correction level, S 2 n the width of a module in dots, S 3 n the height
     * of a row as a multiple of that width, D nL nH d.. stores the data of the
     * next symbol, and P prints it.
     *
     * The size command carries the rows and the columns behind a byte that says
     * whether they are used at all: 0 leaves both to the printer, 1 takes the
     * two that follow, where a zero is automatic for that one alone. The
     * encoder always sends 1, with the numbers of the receipt. Anything else is
     * not a value of the command and leaves the size as it was.
     *
     * The data stays stored until the next store, so printing twice prints the
     * same symbol twice.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #pdf417Symbol(args) {
    if (args[0] === 0x53 && args.length >= 3) {
      if (args[1] === 0x30 && args.length >= 5 && (args[2] === 0 || args[2] === 1)) {
        const rows = args[2] === 1 ? args[3] : 0;
        const columns = args[2] === 1 ? args[4] : 0;

        if (rows === 0 || (rows >= 3 && rows <= 90)) {
          this.#pdf417.rows = rows;
        }

        if (columns === 0 || (columns >= 1 && columns <= 30)) {
          this.#pdf417.columns = columns;
        }
      }

      if (args[1] === 0x31 && args[2] <= 8) {
        this.#pdf417.errorLevel = args[2];
      }

      if (args[1] === 0x32 && args[2] >= 2 && args[2] <= 8) {
        this.#pdf417.moduleWidth = args[2];
      }

      if (args[1] === 0x33 && args[2] >= 2 && args[2] <= 8) {
        this.#pdf417.rowHeight = args[2];
      }

      return;
    }

    if (args[0] === 0x44 && args.length >= 3) {
      this.#pdf417.data = args.slice(3, 3 + args[1] + args[2] * 256);
      return;
    }

    if (args[0] === 0x50) {
      this.#painter.pdf417({
        data: this.#pdf417.data,
        columns: this.#pdf417.columns,
        rows: this.#pdf417.rows,
        moduleWidth: this.#pdf417.moduleWidth,
        rowHeight: this.#pdf417.rowHeight,
        errorLevel: this.#pdf417.errorLevel,
      });
    }
  }

  /**
     * ESC X nL nH d.., a column mode image: one strip of twenty four rows,
     * three bytes per column, the most significant bit of the first byte at the
     * top. The strip goes into the line that is being composed, and the LF CR
     * behind the command commits it. The encoder sets the line spacing to the
     * height of a strip with ESC 0, so that the strips of an image join up.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #columnImage(args) {
    this.#painter.strip(this.#strip(args.subarray(2), args[0] + args[1] * 256, 3));
  }

  /**
     * ESC K and ESC L, the eight dot bit images of Star Line Mode: one byte per
     * column, the most significant bit at the top, and the length of the data
     * in two bytes. The single density image prints every column twice, so that
     * it keeps its proportions at half the resolution.
     *
     * The encoder emits neither command, it uses ESC X for every image.
     *
     * @param  {Uint8Array}   args    The arguments of the command
     * @param  {number}       repeat  How often a column is printed
     */
  #bitImage(args, repeat) {
    const columns = args[0] + args[1] * 256;
    const strip = this.#strip(args.subarray(2), columns, 1);

    this.#painter.strip(Bitmap.scale(strip, repeat, 1));
  }

  /**
     * A strip of a column mode image
     *
     * @param  {Uint8Array}   data      The columns
     * @param  {number}       columns   Number of columns
     * @param  {number}       bytes     Number of bytes per column
     * @return {object}                 The strip, eight rows per byte
     */
  #strip(data, columns, bytes) {
    const strip = Bitmap.create(columns, bytes * 8);

    for (let column = 0; column < columns; column++) {
      for (let byte = 0; byte < bytes; byte++) {
        const value = data[column * bytes + byte];

        for (let bit = 0; bit < 8; bit++) {
          if (value & (0x80 >> bit)) {
            Bitmap.setPixel(strip, column, byte * 8 + bit, 1);
          }
        }
      }
    }

    return strip;
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
     * ESC - n, the underline. The Star underline has one thickness, so the
     * command only switches it on and off, and a value it does not define
     * leaves the underline as it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #underline(value) {
    if (typeof UNDERLINE[value] === 'number') {
      this.#painter.style({underline: UNDERLINE[value]});
    }
  }

  /**
     * ESC RS F n, the font. Font C of the command is a font this renderer does
     * not have, so it leaves the font as it was.
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
     * ESC GS a n, the alignment
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
     * ESC i h w, the character size, the height multiplier first and the width
     * multiplier second, both one less than the multiplier. A value outside the
     * range of the command leaves the size as it was.
     *
     * @param  {number}   height   The first argument of the command
     * @param  {number}   width    The second argument of the command
     */
  #size(height, width) {
    if (typeof SIZE[height] !== 'number' || typeof SIZE[width] !== 'number') {
      return;
    }

    this.#painter.style({width: SIZE[width], height: SIZE[height]});
  }

  /**
     * ESC z n, the line spacing.
     *
     * ESC z 1 is the four millimetre default of a Star printer, so it restores
     * the default line spacing, the way ESC 2 does on ESC/POS. The default
     * lives in the profile, or in the lineSpacing option when a driver gave
     * one, and the renderer must not pin it to the 32 dots of the Star profile:
     * the encoder writes ESC 0 before a column mode image and ESC z 1 behind
     * it, so a printer with another line spacing has to come back to its own.
     *
     * ESC z 0 is the three millimetres of ESC 0, 24 dots. Those are the only
     * values the encoder emits, and no hardware check settled the rest, so any
     * other n is read as n millimetres, eight dots each, which is an
     * approximation.
     *
     * @param  {number}   value   The argument of the command
     */
  #lineSpacing(value) {
    if (value === 1) {
      this.#painter.lineSpacing(null);
      return;
    }

    this.#painter.lineSpacing(value === 0 ? LINE_SPACING_ESC_0 : value * DOTS_PER_MM);
  }

  /**
     * ESC d n, cut the paper. The variants that feed the paper to the cutter
     * first cut the same way, the feed is already on the paper.
     *
     * @param  {number}   value   The argument of the command
     */
  #cut(value) {
    this.#painter.command({
      type: 'cut',
      value: [1, 3, 49, 51].includes(value) ? 'partial' : 'full',
    });
  }

  /**
     * ESC BEL n1 n2, the width of the pulse that BEL and FS send to the first
     * drawer, in units of ten milliseconds. The setting survives ESC @, as it
     * does on a Star printer.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #pulseWidth(args) {
    this.#pulse = {on: args[0] * 10, off: args[1] * 10};
  }

  /**
     * BEL and FS open the first drawer with the width ESC BEL set, SUB and EM
     * open the second one with the fixed width of the specification.
     *
     * @param  {number}   device   0 for the first drawer, 1 for the second
     */
  #drawer(device) {
    this.#painter.command({
      type: 'pulse',
      device,
      on: device === 0 ? this.#pulse.on : DEFAULT_PULSE,
      off: device === 0 ? this.#pulse.off : DEFAULT_PULSE,
    });
  }

  /**
     * ESC GS t n, select the codepage the following bytes are decoded with. A
     * number the mapping does not have falls back to the codepage the printer
     * starts in, and so does the initial state.
     *
     * @param  {number|null}   value   The argument of the command, null for the initial codepage
     */
  #selectCodepage(value) {
    const name = (value === null ? null : this.#mapping[value]) || this.#initialCodepage;

    if (name === this.#codepage) {
      return;
    }

    /* A mapping can name a codepage the codepage encoder does not implement. A
       printer without that codepage prints the bytes with the one it has, so
       the renderer falls back to the codepage it started in rather than giving
       up on the rest of the receipt */

    if (!this.#codepointCache.has(name)) {
      this.#codepointCache.set(
          name,
          codepointsOf(name) || codepointsOf(this.#initialCodepage) || codepointsOf(DEFAULT_CODEPAGE) || [],
      );
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

export default StarPrntRenderer;
export {StarPrntRenderer};
