import CodepageEncoder from '@point-of-sale/codepage-encoder';
import {tokenize} from '@point-of-sale/receipt-printer-decoder/tokenizer';
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
 * @typedef {import('../types.js').Source} Source
 * @typedef {import('@point-of-sale/receipt-printer-decoder/tokenizer').Token} Token
 */

/* The eight bytes of the tokenizer's control set #control() has a case for: HT
   tabs, LF feeds, CR does nothing, CAN throws the line away, BEL and FS open the
   first drawer and SUB and EM the second. The nine it has no case for, SO, SI,
   DC2, DC4, VT, FF, ENQ, EOT and ETB, are taken as nothing. NUL and EOT stand
   here as well because they are the two arguments of ESC FF that are control
   bytes of their own */

const BEL = 0x07;
const HT = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const EOT = 0x04;
const NUL = 0x00;
const EM = 0x19;
const SUB = 0x1a;
const CAN = 0x18;
const FS = 0x1c;

/* The highest international character set the Star table shares with the Epson
   one, see the notes in documentation/commands-star-prnt.md */

const LAST_CHARACTER_SET = 13;

/* The raster data command that feeds one dot row behind its data, `b`. The
   other one, `k`, leaves the position where it was; the tokenizer tells the
   two apart from the letters they are outside raster mode, and the byte of the
   token says which of them it is */

const RASTER_FEED = 0x62;

/* The EOT and FF modes of raster mode that cut the paper, by the value of
   ESC * r E n NUL and ESC * r F n NUL. The modes that only print or feed are
   not in the table. A tear bar model has no cutter, mode 3 feeds the paper to
   the bar instead, which is the closest to a partial cut the item stream has */

const RASTER_CUTS = Object.assign(Object.create(null), {
  3: 'partial', 8: 'full', 9: 'full', 12: 'partial', 13: 'partial',
});

/* The mode a raster job that does not set one is in, which is the initial
   value of a model with a cutter */

const DEFAULT_RASTER_MODE = 13;

/* The furthest ESC * r Y n NUL moves, in dots. The command takes a decimal
   number of any length, and a job that asks for more than a sixteen bit dot
   count is not asking for paper that exists */

const MAX_RASTER_MOVE = 65535;

/* The drive circuits of ESC * r D n NUL, and the device of the pulse item each
   of them opens */

const RASTER_DRAWERS = Object.assign(Object.create(null), {1: [0], 2: [1], 3: [0, 1]});

/* A Star command is ESC and a command byte, or ESC GS, ESC RS or ESC FS and a
   command byte. The four groups have their own table of handlers, keyed by the
   mnemonic of the group the way the tokens of the tokenizer are */

const GROUP_ESC = 'ESC';
const GROUP_GS = 'ESC GS';
const GROUP_RS = 'ESC RS';
const GROUP_FS = 'ESC FS';

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

/* The symbologies of ESC b n1, by the value of n1.

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
  10: 'gs1-databar-omni',
  11: 'gs1-databar-truncated',
  12: 'gs1-databar-limited',
  13: 'gs1-databar-expanded',
});

/* The same table addressed by the ASCII digit of the number, which is how a
   Star printer takes the arguments of most of its commands and how receiptline
   writes them, see the notes of section 16. The two forms cannot be confused:
   the binary numbers stop at thirteen and the digits start at forty eight.

   Only the ten symbologies that have a digit get one. The numbers 10 to 13 have
   no single digit, and the bytes behind the nine, ':' to '=', are not digits at
   all: a stream that carries one of those is reported instead of drawn */

for (const [number, symbology] of Object.entries(SYMBOLOGIES)) {
  if (Number(number) < 10) {
    SYMBOLOGIES[0x30 + Number(number)] = symbology;
  }
}

/* The width of the narrowest bar in dots, by the value of n3 of ESC b.

   The Star documentation describes the widths per symbology in tables of narrow
   and wide element widths instead of in dots. Two, three and four dots for n3 of
   1, 2 and 3 is the reading that makes a Star barcode the same size as the
   ESC/POS barcode the encoder produces from the same receipt: the encoder writes
   its own width option, 1 to 3, as n3 here and as GS w n plus one on ESC/POS.

   The values above three are the ones receiptline writes, which is the only
   evidence of those tables there is here, see the notes of section 16: 4, 5 and
   6 are the three widths of Code 39 and Codabar, and 8 is the middle width of
   ITF. The table is flat, so a value that means different widths for different
   symbologies keeps the one of the general case: ITF is the only symbology with
   such a value, its widest, which draws three dots here instead of four.

   Every value is accepted as the binary number and as the ASCII digit of it,
   the way the symbologies are, because that is how receiptline writes them */

const MODULE_WIDTHS = Object.assign(Object.create(null), {
  1: 2, 2: 3, 3: 4, 4: 2, 5: 3, 6: 4, 8: 3,
});

for (const [number, width] of Object.entries(MODULE_WIDTHS)) {
  MODULE_WIDTHS[0x30 + Number(number)] = width;
}

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

/* The functions of ESC GS P, the page mode group: 0 and 1 enter and leave page
   mode, 2 selects the print direction, 3 sets the print region, 4 and 5 are the
   absolute and the relative position along the vertical axis of that direction,
   6 prints the region, 7 prints it and recovers to standard mode and 8 throws
   the data of the region away. The numbers are accepted as the binary values
   and as the ASCII digits, the way every other Star parameter is; the encoder
   writes the digits, and its flush is ESC GS P '0' ESC GS P '1' around a job. */

const PAGE_MODE_FUNCTIONS = Object.assign(Object.create(null), {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8,
  48: 0, 49: 1, 50: 2, 51: 3, 52: 4, 53: 5, 54: 6, 55: 7, 56: 8,
});

/* The number of dot rows an ESC k band carries, which the command does not
   name: the height of a band is fixed, the width bytes are the only argument */

const BAND_ROWS = 24;

/* Pulse width of the drawer commands that do not carry one, in milliseconds.
   ESC BEL n1 n2 sets the width of BEL and FS, SUB and EM are fixed */

const DEFAULT_PULSE = 200;

/* The width of the paper `handlers()` builds a renderer on, which is the
   narrowest a renderer takes: it is thrown away without rendering a dot */

const HANDLER_WIDTH = 8;

/* The languages this renderer speaks, which are one command set: star-line
   differs only in the line buffering of the encoder, and star-graphics is the
   raster protocol of a TSP100, which is the raster mode of this set. A renderer
   reports the one it was created for in its display list */

const STAR_LANGUAGES = ['star-prnt', 'star-line', 'star-graphics'];

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

/**
 * Renders the StarPRNT commands ReceiptPrinterEncoder produces to images, the
 * way a printer would put them on paper. The Star Line Mode commands the
 * encoder emits for the star-line language are the same set, so this renderer
 * handles both.
 *
 * The syntax of the stream belongs to @point-of-sale/receipt-printer-decoder:
 * `tokenize()` cuts the bytes into commands, runs of text, control bytes, the
 * rows of dots of raster mode and the tail of a truncated command, and this
 * renderer says what every one of them does to the paper. The tables below are
 * the handlers of the commands, keyed by the mnemonic of the group and the
 * command byte the way the tokens are, and a command without a handler is an
 * unknown item.
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
  #characterSet;
  #pulse;
  #text;
  #textSources;
  #source;
  #base;
  #qrcode;
  #refusing;
  #pdf417;
  #leftColumn;
  #rightColumn;
  #raster;

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
      const names = Object.keys(codepageMappings['star-prnt']);

      throw new Error(`Unknown codepage mapping ${mapping}, must be one of ${names.join(', ')}`);
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
        throw new Error(
            `Unknown printer profile ${profile}, must be one of ${Object.keys(printerProfiles).join(', ')}`,
        );
      }

      resolved = printerProfiles[profile];
    }

    this.#painter = new Painter({
      language: STAR_LANGUAGES.indexOf(settings.language) === -1 ?
        StarPrntRenderer.language :
        settings.language,
      width: settings.width,
      profile: resolved,
      commands: settings.commands || [],
      maxHeight: settings.maxHeight,
      lineSpacing: settings.lineSpacing,
      cutterDistance: settings.cutterDistance,
      feedThreshold: settings.feedThreshold,
      font: settings.font,
    });

    this.#codepointCache = new Map();
    this.#commands = this.#tables();

    this.#pulse = {on: DEFAULT_PULSE, off: DEFAULT_PULSE};
    this.#initialize();
  }

  /**
     * The commands this renderer has a handler for, as the command bytes under
     * the mnemonic of their group, which is how a token of the tokenizer of
     * @point-of-sale/receipt-printer-decoder names them.
     *
     * It is here for the tests, `test/tokens.js`, which asserts that the
     * tokenizer has an argument length for every one of them: without that the
     * command would be read as its prefix alone and the rest of the stream
     * would be lost. Nothing else of this package calls it, and the tables it
     * reports are built per renderer, so it builds one of the smallest paper
     * there is to read them off
     *
     * @return {Object<string, number[]>}   The command bytes, keyed by the mnemonic of the group
     */
  static handlers() {
    return new StarPrntRenderer({width: HANDLER_WIDTH}).#handlers();
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
    return this.#run(bytes);
  }

  /**
     * Lay a stream of StarPRNT commands out and return the display list instead
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
      this.#pulse = {on: DEFAULT_PULSE, off: DEFAULT_PULSE};

      /* The offsets of the tokens are counted in this stream, from its first
         byte, and only the data of a refused barcode is parsed with a base of
         its own, see drawBarcode() */

      this.#base = 0;
      this.#source = null;

      this.#initialize();
      this.#dispatch(tokenize(data, StarPrntRenderer.language));

      /* Rows that are still in the raster image buffer when the stream ends are
         printed, so that a job that forgot its execute command is not lost */

      this.#rasterFlush();

      return this.#painter.end();
    } finally {
      this.#painter.discard();
      this.#text = [];
      this.#textSources = [];
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
    this.#textSources = [];
    this.#refusing = false;
    this.#characterSet = noCharacterSet();
    this.#leftColumn = 0;
    this.#rightColumn = 0;
    this.#qrcode = Object.assign({data: new Uint8Array(0)}, QRCODE_DEFAULTS);
    this.#pdf417 = Object.assign({data: new Uint8Array(0)}, PDF417_DEFAULTS);
    this.#rasterInitialize(false);
    this.#selectCodepage(null);
  }

  /**
     * Turn the tokens of a stream into calls on the painter. The tokenizer has
     * already said where every command ends, which bytes are text and which of
     * the printable bytes are the rows of dots of raster mode, so there is no
     * syntax left here: every token is handed to the handler of what it means.
     *
     * @param  {Token[]}   tokens   The tokens of the stream
     */
  #dispatch(tokens) {
    for (const token of tokens) {
      /* Everything the painter places from here on comes from this token, and
         a run of text hands a source per character to the painter instead */

      this.#source = {offset: this.#base + token.offset, length: token.length};

      this.#painter.source(this.#source);

      switch (token.type) {
        /* Printable bytes are gathered, so that a run of characters becomes
           one call on the painter, in one codepage. Star has no multibyte
           character set, so a run is never pairs of bytes */

        case 'text':
          for (let index = 0; index < token.bytes.length; index++) {
            this.#text.push(token.bytes[index]);
            this.#textSources.push({offset: this.#source.offset + index, length: 1});
          }

          break;

        case 'control':
          this.#control(token);
          break;

          /* A byte a printer ignores changes nothing but the run of text it
           stands in, which ends there the way it ends at a command, and the
           tail of a command or of a row of dots the stream was cut inside of
           stops the parse, which is what an `incomplete` token is and why it
           is always last */

        case 'ignored':
        case 'incomplete':
          this.#flushText();
          break;

        default:
          this.#command(token);
          break;
      }
    }

    this.#flushText();
  }

  /**
     * A control token: one of the control bytes a Star printer acts on, or a
     * row of dots of raster mode, which carries its data as the arguments of
     * the token and says with its byte whether the paper feeds behind it.
     *
     * A control byte this renderer has no case for changes nothing but the run
     * of text it stands in, which ends there, the way a byte the printer
     * ignores does: the switch below falls through and reports nothing.
     *
     * @param  {Token}   token   The control token
     */
  #control(token) {
    this.#flushText();

    /* In raster mode `b` and `k` are the commands that carry a row of dots,
       everywhere else they are the letters b and k */

    if (token.arguments) {
      this.#rasterRow(token.arguments, token.byte === RASTER_FEED);
      return;
    }

    switch (token.byte) {
      case HT:
        this.#painter.tab();
        break;

      case LF:
        this.#painter.lineFeed();
        break;

        /* CAN throws away the print data of the line that is being composed,
         without advancing the paper. The encoder only ever sends it right
         behind ESC @, where the line buffer is already empty */

      case CAN:
        this.#painter.cancel();
        break;

        /* The drawers are driven by single control characters, BEL and FS for
         the first one, SUB and EM for the second */

      case BEL:
      case FS:
        this.#drawer(0);
        break;

      case SUB:
      case EM:
        this.#drawer(1);
        break;

        /* The encoder ends its lines with LF CR, the carriage return does not
         move the paper */

      case CR:
        break;
    }
  }

  /**
     * Hand the text that was gathered to the painter, in the codepage that was
     * current while it was gathered
     */
  #flushText() {
    if (this.#text.length === 0) {
      return;
    }

    this.#painter.text(this.#decode(this.#text), this.#textSources);

    this.#text = [];
    this.#textSources = [];
  }

  /**
     * One source per byte of a run of text, which is what the layout gives
     * every cell of it: the bytes of a run are bytes of the stream in order
     *
     * @param  {number}     offset   Position of the first byte in the stream
     * @param  {number}     count    Number of bytes
     * @return {Source[]}            The sources, one per byte
     */
  #sources(offset, count) {
    const sources = [];

    for (let index = 0; index < count; index++) {
      sources.push({offset: offset + index, length: 1});
    }

    return sources;
  }

  /**
     * Hand a command token to its handler, or report it as an unknown command
     * when there is none. The handler decides, not the tokenizer: a command the
     * tokenizer has a length for but this renderer draws nothing for is an
     * unknown item all the same, which is what a driver sees today
     *
     * @param  {Token}   token   The command token
     */
  #command(token) {
    this.#flushText();

    const command = this.#commands[token.prefix][token.code];

    if (!command) {
      this.#unknown(token.bytes);
      return;
    }

    if (command.run) {
      command.run(token.arguments, token.bytes);
    }
  }

  /**
     * The tables of this renderer as the keys they hold, for `handlers()`
     *
     * @return {Object<string, number[]>}   The command bytes, keyed by the mnemonic of the group
     */
  #handlers() {
    return Object.fromEntries(Object.entries(this.#commands).map(
        ([prefix, table]) => [prefix, Object.keys(table).map(Number)],
    ));
  }

  /**
     * The command handlers, one table per group, keyed by the mnemonic of the
     * group and the command byte the way the tokens of the tokenizer are. They
     * are built per renderer so that the handlers can reach its state.
     *
     * An entry without a `run` is a command that is read and does nothing,
     * which is what the printer does with the commands that do not change the
     * paper; a command with no entry at all is an unknown item.
     *
     * @return {object}   The tables, keyed by the mnemonic of the group and the command byte
     */
  #tables() {
    return {
      [GROUP_ESC]: {
        0x06: {run: null}, /* ESC ACK SOH, the real time status, parsed, there is no channel back */
        0x07: {run: (a) => this.#pulseWidth(a)},
        0x20: {run: (a) => this.#painter.spacing(this.#spacing(a[0]))},
        0x0c: {run: (a, consumed) => this.#formFeed(a[0], consumed)},
        0x2a: {run: (a, consumed) => this.#rasterCommand(a, consumed)},
        0x2d: {run: (a) => this.#underline(a[0])},
        0x30: {run: () => this.#painter.lineSpacing(LINE_SPACING_ESC_0)},
        0x34: {run: () => this.#painter.style({invert: true})},
        0x35: {run: () => this.#painter.style({invert: false})},
        0x40: {run: () => this.#initialize()},
        0x44: {run: (a) => this.#painter.tabs(Array.from(a.subarray(0, a.length - 1)))},
        0x45: {run: () => this.#painter.style({bold: true})},
        0x46: {run: () => this.#painter.style({bold: false})},
        0x49: {run: (a) => this.#painter.feed(a[0])}, /* feed n eighths of a millimetre, one dot each */
        0x4a: {run: (a) => this.#painter.feed(a[0] * 2)}, /* feed n quarters of a millimetre, two dots each */
        0x4b: {run: (a) => this.#bitImage(a, 2)}, /* bit image, normal density */
        0x4c: {run: (a) => this.#bitImage(a, 1)}, /* bit image, fine density */
        0x51: {run: (a) => this.#rightMargin(a[0])},
        0x52: {run: (a) => this.#international(a[0])},
        0x57: {run: (a) => this.#doubleWidth(a[0])},
        0x58: {run: (a) => this.#columnImage(a)},
        0x5f: {run: (a) => this.#upperline(a[0])},
        0x61: {run: (a) => this.#painter.lineFeed(a[0])},
        0x62: {run: (a, consumed) => this.#drawBarcode(a, consumed)},
        0x64: {run: (a) => this.#cut(a[0])},
        0x68: {run: (a) => this.#height(a[0])},
        0x69: {run: (a) => this.#size(a[0], a[1])},
        0x6b: {run: (a) => this.#bandImage(a)}, /* bit image, twenty four dot band */
        0x6c: {run: (a) => this.#leftMargin(a[0])},
        0x73: {run: null}, /* ESC s n1 n2, the Kanji character spacing, parsed, see the reference page */
        0x7a: {run: (a) => this.#lineSpacing(a[0])},
      },

      /* The status, the settings and the buzzer are parsed: none of them puts a
         dot on the paper, and the item stream carries neither a status nor a
         sound. ESC GS b and ESC GS c are not among them, smoothing and reduced
         printing both change the dots */

      [GROUP_GS]: {
        0x03: {run: null}, /* ESC GS ETX s n1 n2, the print end counter */
        0x07: {run: null}, /* ESC GS BEL m t1 t2, the buzzer */
        0x19: {run: null}, /* ESC GS EM DC1 or DC2 m n1 n2, buzzer */
        0x23: {run: null}, /* ESC GS # m N n1 n2 n3 n4 LF NUL, the memory switch */
        0x41: {run: (a) => this.#painter.position(a[0] + a[1] * 256)},
        0x50: {run: (a) => this.#pageMode(a)}, /* the page mode group */
        0x52: {run: (a) => this.#relative(a)},
        0x53: {run: (a, consumed) => this.#rasterImage(a, consumed)},
        0x61: {run: (a) => this.#align(a[0])},
        0x74: {run: (a) => this.#selectCodepage(a[0])},
        0x78: {run: (a) => this.#pdf417Symbol(a)},
        0x79: {run: (a, consumed) => this.#symbol(a, consumed)},
      },

      [GROUP_RS]: {
        0x46: {run: (a) => this.#font(a[0])},
        0x61: {run: null}, /* ESC RS a n, the status transmission conditions */
        0x64: {run: null}, /* print density */
        0x72: {run: null}, /* print speed */
      },

      /* ESC FS p prints a logo the printer holds and ESC FS q defines one,
         neither of which this renderer draws, see the reference page */

      [GROUP_FS]: {},
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
     * ESC b n1 n2 n3 n4 d.. RS, a barcode.
     *
     * Data the symbology refuses draws no bars: the bytes are fed back into the
     * parser at the position the command stood, the way `GS k` of ESC/POS does
     * it, which is the Epson reference applied to StarPRNT and unverified on
     * Star hardware. Refused data that is itself a refused barcode goes to the
     * text path instead of being parsed again, which bounds the recursion.
     *
     * The payload is tokenized on its own, with a tokenizer that starts fresh,
     * so a command inside refused data still does what it does but can no
     * longer change where the rest of the stream is cut: the tokenizer read
     * `ESC b` as one command and the record separator as the end of its data,
     * which is what the reference says and what a printer does, see design.md
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

    const data = args.subarray(4, args.length - 1);

    /* Where the data of the command starts in the stream: the arguments are
       the tail of the token, and the data is the tail of the arguments */

    const offset = this.#source.offset + this.#source.length - args.length + 4;

    /* n2 is 1 for a barcode without text and 2 for one with the text below it,
       which a Star printer draws in font A */

    const drawn = this.#painter.barcode({
      symbology,
      data: this.#ascii(data),
      moduleWidth: MODULE_WIDTHS[args[2]] || MODULE_WIDTHS[1],
      height: args[3] || 1,
      hri: {position: args[1] === 2 || args[1] === 0x32 ? 'below' : 'none', font: 'A'},
    });

    if (drawn) {
      return;
    }

    if (this.#refusing) {
      this.#painter.text(this.#decode(data), this.#sources(offset, data.length));
      return;
    }

    this.#refusing = true;

    /* The payload is tokenized on its own, so its tokens are counted from its
       own first byte: the base puts them back where they stand in the stream,
       and the source of this command is restored behind them */

    const base = this.#base;
    const source = this.#source;

    this.#base = offset;

    try {
      this.#dispatch(tokenize(data, StarPrntRenderer.language));
    } finally {
      this.#refusing = false;
      this.#base = base;
      this.#source = source;

      this.#painter.source(source);
    }
  }

  /**
     * ESC GS y .., the QR code group: S 0 n is the model, S 1 n the error
     * correction level, S 2 n the size of a module in dots, D 1 m nL nH d..
     * stores the data of the next symbol, and P prints it. D 2, the manual
     * setting, is reported, see the branch below.
     *
     * The data stays stored until the next store, so printing twice prints the
     * same symbol twice.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #symbol(args, consumed) {
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

    /* ESC GS y D 2 a [m nL nH d..] x a, the manual setting, carries its data in
       as many blocks as `a` says. The tokenizer cuts it right, so the stream
       stays in sync, and this renderer stores none of it: reading the blocks as
       the D 1 layout would store a slice of the wrong bytes, so the command is
       reported instead and the symbol that was stored before it stays */

    if (args[0] === 0x44 && args[1] === 0x32) {
      this.#unknown(consumed);
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
     * The encoder emits neither command, it uses ESC X for every image, and no
     * external producer of section 16 emits them either.
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
     * ESC k n1 n2 d.., the twenty four dot band of Star Line Mode: a band of
     * twenty four dot rows, `n1 + n2 * 256` bytes of eight dots per row, in
     * raster format, one row after another. The band goes into the line that is
     * being composed and the LF behind the command commits it, the way the
     * strips of ESC X do, and the producer sets the line spacing to twenty four
     * dots with ESC 0 so that the bands of an image join up.
     *
     * The encoder emits neither this command nor ESC K and ESC L, it uses ESC X
     * for every image; receiptline prints its images with this one, see the
     * notes of section 16.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #bandImage(args) {
    const width = args[0] + args[1] * 256;

    /* A band without dots is not an image, and a strip of nothing would still
       give the line the height of a band */

    if (width === 0) {
      return;
    }

    this.#painter.strip(Bitmap.fromRaster(args.subarray(2), width * 8, BAND_ROWS));
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
    return Bitmap.fromColumns(data, columns, bytes * 8);
  }

  /**
     * ESC GS S m n1 n2 n3 n4 n5 d.., the raster image the Star SDKs print an
     * image with: `m` of 1 is the raster bit image, `n1 + n2 * 256` is the width
     * of the image in bytes of eight dots, `n3 + n4 * 256` its height in dots,
     * and `n5` is a fixed byte the command carries. The dots follow in raster
     * format, one row after another, the way GS v 0 carries them on ESC/POS.
     *
     * The image is drawn as a block of its own, aligned the way ESC GS a says,
     * and inside the print area of ESC l and ESC Q, like every other block.
     *
     * Any other `m` is a variant of the command this renderer does not know, so
     * it is reported; the data is consumed either way, because the length bytes
     * sit in the same place.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #rasterImage(args, consumed) {
    if (args[0] !== 1 && args[0] !== 49) {
      this.#unknown(consumed);
      return;
    }

    const width = args[1] + args[2] * 256;
    const height = args[3] + args[4] * 256;

    /* An image without dots is not an image, and drawing it as a block would
       commit the line that is being composed for nothing */

    if (width === 0 || height === 0) {
      return;
    }

    this.#painter.block(Bitmap.fromRaster(args.subarray(6), width * 8, height));
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
     * ESC _ n, the upperline, which a Star printer draws along the top of the
     * cell the way the underline is drawn along the bottom. It has one
     * thickness, like the underline, and a value the command does not define
     * leaves it as it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #upperline(value) {
    if (typeof UNDERLINE[value] === 'number') {
      this.#painter.style({upperline: UNDERLINE[value]});
    }
  }

  /**
     * ESC W n, the character width expansion: 1 is double width and 0 is back
     * to normal. A value the command does not define leaves the width as it
     * was.
     *
     * @param  {number}   value   The argument of the command
     */
  #doubleWidth(value) {
    if (value === 0 || value === 48) {
      this.#painter.style({width: 1});
    }

    if (value === 1 || value === 49) {
      this.#painter.style({width: 2});
    }
  }

  /**
     * ESC h n, the character height expansion, the multiplier one less than the
     * value, the way ESC i counts it, so 1 is double height. A value outside
     * that range leaves the height as it was.
     *
     * @param  {number}   value   The argument of the command
     */
  #height(value) {
    if (typeof SIZE[value] === 'number') {
      this.#painter.style({height: SIZE[value]});
    }
  }

  /**
     * ESC R n, the international character set, which replaces twelve code
     * points of the character table. Star shares the numbers of the sets it has
     * in common with Epson; a number above those is left alone, see the notes
     * of this command in documentation/commands-star-prnt.md.
     *
     * @param  {number}   value   The argument of the command
     */
  #international(value) {
    const table = internationalCharacterSet(value, LAST_CHARACTER_SET);

    if (table) {
      this.#characterSet = table;
    }
  }

  /**
     * ESC GS R n1 n2, the relative print position, in dots. The distance is
     * signed, a negative one moves the cursor back towards the left margin,
     * the way ESC \ does in ESC/POS.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #relative(args) {
    const value = args[0] + args[1] * 256;
    const distance = value > 32767 ? value - 65536 : value;

    this.#painter.position(this.#painter.cursor + distance);
  }

  /**
     * ESC GS P n .., the page mode group.
     *
     * Function 0 enters page mode and function 1 leaves it, printing the page
     * the printer composed. The references erase the page instead of printing
     * it; the encoder's flush is these two commands with nothing in between,
     * around a job and not around a page, and a job that composed a page and
     * left page mode means to see it, see the reference page.
     *
     * Function 2 is the print direction, function 3 the print region and
     * functions 4 and 5 the absolute and the relative position along the
     * vertical axis of the direction, all of them in dots, which is the unit of
     * the Star position commands. Function 6 prints the page and keeps it with
     * its data, function 7 prints it and recovers to standard mode, which is
     * what function 1 does here, and function 8 throws away what every region
     * of the page holds. The print region survives all three: it is a setting
     * of the printer here and only ESC @ puts it back, where the references
     * initialize it with function 1 and function 7.
     *
     * @param  {Uint8Array}   args   The arguments of the command
     */
  #pageMode(args) {
    const fn = PAGE_MODE_FUNCTIONS[args[0]];

    if (fn === 0) {
      this.#painter.page(true);
      return;
    }

    if (fn === 1 || fn === 7) {
      this.#painter.printPage();
      this.#painter.page(false);
      return;
    }

    if (fn === 2) {
      this.#painter.pageDirection(args[1] >= 48 ? args[1] - 48 : args[1]);
      return;
    }

    if (fn === 3) {
      this.#painter.pageArea({
        x: args[1] + args[2] * 256,
        y: args[3] + args[4] * 256,
        width: args[5] + args[6] * 256,
        height: args[7] + args[8] * 256,
      });

      return;
    }

    if (fn === 4 || fn === 5) {
      const value = args[1] + args[2] * 256;
      const relative = fn === 5;

      this.#painter.pageVertical(relative && value > 32767 ? value - 65536 : value, {relative});
      return;
    }

    if (fn === 6) {
      this.#painter.printPage({keep: true});
      return;
    }

    if (fn === 8) {
      this.#painter.cancelPage();
    }
  }

  /**
     * ESC l n, the left margin, in characters of the current font
     *
     * @param  {number}   value   The argument of the command
     */
  #leftMargin(value) {
    this.#leftColumn = value;
    this.#applyMargins();
  }

  /**
     * ESC Q n, the right margin, which is the column the print area ends at,
     * counted from the left edge of the paper. A right margin that is not
     * beyond the left one leaves the print area at the full width of the paper.
     *
     * @param  {number}   value   The argument of the command
     */
  #rightMargin(value) {
    this.#rightColumn = value;
    this.#applyMargins();
  }

  /**
     * Hand the two margins to the painter, in dots
     */
  #applyMargins() {
    const character = this.#painter.characterWidth;
    const columns = this.#rightColumn - this.#leftColumn;

    this.#painter.margins({
      left: this.#leftColumn * character,
      width: columns > 0 ? columns * character : null,
    });
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
     * ESC SP n, the character spacing, in dots behind every cell, which is the
     * Star counterpart of the ESC/POS command of the same name.
     *
     * No StarPRNT specification text was available here, so the reading comes
     * from the only producer the fixtures have: receiptline writes `ESC SP '0'`
     * in the setup of its three thermal Star command sets and `ESC SP 0x00` in
     * the one of its impact set, both of them no spacing at all, and it writes
     * the arguments of `ESC s` and `ESC z` next to it in the same two forms. So
     * the ASCII digits '0' to '9' are read as 0 to 9 dots, the way the arguments
     * of ESC b are, and every other value as the number of dots it is. The two
     * forms cannot be confused in practice: a character spacing of 48 dots is
     * six millimetres between two characters.
     *
     * @param  {number}   value   The argument of the command
     * @return {number}           The spacing in dots
     */
  #spacing(value) {
    return value >= 0x30 && value <= 0x39 ? value - 0x30 : value;
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
     * ESC * r .., the raster mode group, and ESC * m for anything that is not
     * the raster group.
     *
     * Raster mode is a second way to print: rows of dots go into an image
     * buffer, and an execute command prints the buffer and, depending on the
     * mode that was stored before the rows were sent, cuts the paper. It is
     * what the TSP100 family prints from, which is why this renderer reads it:
     * the job a driver builds with StarGraphicsPrinterEncoder renders back to
     * the paper it was made from.
     *
     * @param  {Uint8Array}   args       The arguments of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #rasterCommand(args, consumed) {
    if (args[0] !== 0x72) {
      this.#unknown(consumed);
      return;
    }

    const command = args[1];

    /* The margins carry a second letter, l or r, the other commands that have
       a parameter carry it as ASCII digits up to a NUL byte */

    const value = this.#rasterValue(args.subarray(command === 0x6d ? 3 : 2));

    switch (command) {
      /* R initializes raster mode, A enters it and initializes it as well, B
         leaves it after printing what is left in the buffer */

      case 0x52:
        this.#rasterInitialize(this.#raster.active);
        break;

      case 0x41:
        this.#rasterInitialize(true);
        break;

      case 0x42:
        this.#rasterExecute(this.#raster.eot);
        this.#raster.active = false;
        break;

        /* C throws the image buffer away without printing it */

      case 0x43:
        this.#rasterClear();
        break;

        /* D drives a drawer, E and F store the modes of the two execute
         commands, e stores the one of ESC FF EM */

      case 0x44:
        this.#rasterDrawer(value);
        break;

      case 0x45:
        this.#raster.eot = value;
        break;

      case 0x46:
        this.#raster.ff = value;
        break;

      case 0x65:
        this.#raster.em = value;
        break;

        /* Y moves the position down, which leaves blank rows behind */

      case 0x59:
        this.#rasterMove(value);
        break;

        /* The margins are in bytes of eight dots, l for the left one and r for
         the right one */

      case 0x6d:
        if (args[2] === 0x6c) {
          this.#raster.left = value * 8;
        }

        if (args[2] === 0x72) {
          this.#raster.right = value * 8;
        }

        break;

        /* P, Q, t and K are settings that do not change the dots, a and b are
         the block delimiters of the command emulator mode */

      default:
        break;
    }
  }

  /**
     * The parameter of a raster command, which is a decimal number written as
     * ASCII digits and closed with a NUL byte
     *
     * @param  {Uint8Array}   bytes   The argument bytes, the NUL included
     * @return {number}               The value, 0 when there are no digits
     */
  #rasterValue(bytes) {
    let value = 0;

    for (const byte of bytes) {
      if (byte < 0x30 || byte > 0x39) {
        break;
      }

      value = value * 10 + (byte - 0x30);
    }

    return value;
  }

  /**
     * Reset the settings of raster mode and throw the image buffer away, which
     * is what ESC * r R and ESC * r A both do
     *
     * @param  {boolean}   active   Whether raster mode is on afterwards
     */
  #rasterInitialize(active) {
    this.#raster = {
      active,
      left: 0,
      right: 0,
      ff: DEFAULT_RASTER_MODE,
      eot: DEFAULT_RASTER_MODE,
      em: DEFAULT_RASTER_MODE,
      rows: [],
      height: 0,
      current: null,
      pending: false,
      source: null,
    };
  }

  /**
     * Grow the range of the stream the rows in the image buffer came from,
     * which is the source of the block they are printed as: from the first
     * raster token that filled the buffer to the last, the rows of dots and
     * the moves of the position alike. The execute command that prints the
     * buffer is not part of it, it draws nothing of its own.
     */
  #rasterSource() {
    const range = this.#source;

    if (!range) {
      return;
    }

    const source = this.#raster.source;

    if (!source) {
      this.#raster.source = {offset: range.offset, length: range.length};
      return;
    }

    const end = Math.max(source.offset + source.length, range.offset + range.length);

    source.offset = Math.min(source.offset, range.offset);
    source.length = end - source.offset;
  }

  /**
     * Throw away the rows that are in the image buffer
     */
  #rasterClear() {
    this.#raster.rows = [];
    this.#raster.height = 0;
    this.#raster.current = null;
    this.#raster.pending = false;
    this.#raster.source = null;
  }

  /**
     * One row of raster data. The row is as wide as the print head, so it is
     * placed at the left margin of the raster and the bytes that are missing at
     * the right are white. Data is written into the buffer with an OR, the way
     * the specification describes it, so a `k` command and the `b` behind it
     * build one row together.
     *
     * @param  {Uint8Array}   data   The bytes of the row, eight dots per byte
     * @param  {boolean}      feed   True for `b`, which ends the row
     */
  #rasterRow(data, feed) {
    const rowBytes = Bitmap.rowBytes(this.#painter.width);

    this.#rasterSource();

    if (!this.#raster.current) {
      this.#raster.current = new Uint8Array(rowBytes);
    }

    /* The left margin of raster mode is a whole number of bytes, so the data
       lands on a byte boundary */

    const offset = this.#raster.left >> 3;

    for (let byte = 0; byte < data.length && offset + byte < rowBytes; byte++) {
      this.#raster.current[offset + byte] |= data[byte];
    }

    this.#raster.pending = true;

    if (feed) {
      this.#rasterLine();
    }
  }

  /**
     * Close the row that is being built and start the next one
     */
  #rasterLine() {
    if (this.#raster.current) {
      this.#raster.rows.push({data: this.#raster.current, count: 1});
    } else {
      this.#rasterBlank(1);
    }

    this.#raster.height++;
    this.#raster.current = null;
    this.#raster.pending = false;
  }

  /**
     * Add a run of blank rows to the image buffer. A run is a count and not a
     * row per row, so that a move of tens of thousands of dots costs nothing
     * until the buffer is drawn.
     *
     * @param  {number}   count   Number of blank rows
     */
  #rasterBlank(count) {
    const last = this.#raster.rows[this.#raster.rows.length - 1];

    if (last && !last.data) {
      last.count += count;
      return;
    }

    this.#raster.rows.push({data: null, count});
  }

  /**
     * ESC * r Y n NUL, move the position down by n dots, which leaves n blank
     * rows in the buffer. A row that was being built is closed first, it is the
     * row the position is on.
     *
     * @param  {number}   dots   Number of dot rows to move
     */
  #rasterMove(dots) {
    let rows = Math.min(Math.max(0, dots), MAX_RASTER_MOVE);

    if (rows <= 0) {
      return;
    }

    /* The row that is being built is the row the position is on, so closing it
       is the first of the dots the command moves */

    if (this.#raster.pending) {
      this.#rasterLine();
      rows--;
    }

    this.#rasterSource();

    if (rows > 0) {
      this.#rasterBlank(rows);
      this.#raster.height += rows;
    }
  }

  /**
     * Print the image buffer: the rows become one block as wide as the paper,
     * placed on the paper itself, so that neither the alignment nor the
     * margins of the line mode move them.
     *
     * @return {boolean}   True when there was something to print
     */
  #rasterFlush() {
    if (this.#raster.pending) {
      this.#rasterLine();
    }

    const rows = this.#raster.rows;
    const height = this.#raster.height;

    if (height === 0) {
      return false;
    }

    const width = this.#painter.width;
    const rowBytes = Bitmap.rowBytes(width);
    const bitmap = Bitmap.create(width, height);
    const source = this.#raster.source;

    let y = 0;

    for (const run of rows) {
      if (run.data) {
        bitmap.data.set(run.data, y * rowBytes);
      }

      y += run.count;
    }

    this.#rasterClear();

    /* The block came from the rows, not from the command that printed them,
       so it is placed with the range of the tokens that filled the buffer and
       the source of the current token is put back behind it */

    this.#painter.source(source || this.#source);

    /* The rows carry their own position, the left margin of the raster, so
       they are placed on the paper and not inside the print area of the line
       mode: an ESC l or an ESC Q must not shift or clip them */

    this.#painter.block(bitmap, {margins: false});

    this.#painter.source(this.#source);

    return true;
  }

  /**
     * Print the image buffer and perform the mode that was stored for this
     * execute command. An execute command on an empty buffer does nothing at
     * all, which is what the specification says.
     *
     * @param  {number}   mode   The stored EOT, FF or EM mode
     */
  #rasterExecute(mode) {
    if (!this.#rasterFlush()) {
      return;
    }

    if (RASTER_CUTS[mode]) {
      this.#painter.command({type: 'cut', value: RASTER_CUTS[mode]});
    }
  }

  /**
     * ESC * r D n NUL, drive a drawer from raster mode. The pulse is the one
     * the line mode commands set, so ESC BEL still decides how long the first
     * drawer is opened.
     *
     * @param  {number}   value   The drive circuit, 1, 2 or 3 for both
     */
  #rasterDrawer(value) {
    const devices = RASTER_DRAWERS[value];

    if (!devices) {
      return;
    }

    /* The specification has the printer ignore this command while data is in
       the image buffer. The renderer prints that data instead, so that the
       paper is right whatever a stream does */

    this.#rasterFlush();

    for (const device of devices) {
      this.#drawer(device);
    }
  }

  /**
     * ESC FF n, execute a mode: NUL is the FF mode, EOT the EOT mode and EM the
     * EM mode of the block commands. Any other byte is not a command of this
     * renderer and is reported with the mode byte it carries.
     *
     * @param  {number}       value      The mode byte of the command
     * @param  {Uint8Array}   consumed   The whole command, for the unknown item
     */
  #formFeed(value, consumed) {
    if (value === NUL) {
      this.#rasterExecute(this.#raster.ff);
      return;
    }

    if (value === EOT) {
      this.#rasterExecute(this.#raster.eot);
      return;
    }

    if (value === EM) {
      this.#rasterExecute(this.#raster.em);
      return;
    }

    this.#unknown(consumed);
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

export default StarPrntRenderer;
export {StarPrntRenderer};
