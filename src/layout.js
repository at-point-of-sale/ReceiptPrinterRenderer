import Bitmap from './bitmap.js';
import {barcode as encodeBarcode} from './symbologies/index.js';
import {qrcode as encodeQrcode} from './symbologies/qrcode.js';
import {pdf417 as encodePdf417} from './symbologies/pdf417.js';

/**
 * @typedef {import('./types.js').Bitmap} Bitmap
 * @typedef {import('./types.js').LineEntry} LineEntry
 * @typedef {import('./types.js').PageEntry} PageEntry
 * @typedef {import('./types.js').FeedEntry} FeedEntry
 * @typedef {import('./types.js').LineOperation} LineOperation
 * @typedef {import('./types.js').Source} Source
 */

/**
 * A cell size, as a printer profile describes it
 *
 * @typedef {object} CellSize
 * @property {number} width    Width of the cell in dots
 * @property {number} height   Height of the cell in dots
 */

/**
 * Printer family defaults, one of the entries of generated/profiles.js
 *
 * @typedef {object} Profile
 * @property {string} vendor                          Name of the printer family
 * @property {number} lineSpacing                     Default line spacing in dots
 * @property {number} motionUnit                      Default vertical motion units per dot
 * @property {number} [dpi]                           Resolution of the printer, for the horizontal motion unit of GS P
 * @property {number} [pageHeight]                    Height of the page of page mode in dots
 * @property {{A: CellSize, B: CellSize}} fonts       Cell size of font A and font B
 */

/**
 * @typedef {object} LayoutOptions
 * @property {number} width           Width of the print area in dots, a multiple of 8
 * @property {Profile} profile        Printer family defaults
 * @property {number} [lineSpacing]   Default line spacing in dots, defaults to the profile
 * @property {string[]} [commands]    Command types the driver supports, which decide where the paper leaves
 * @property {number} [cutterDistance]   Distance between the cutter and the print head in dots, 0 by default
 */

/**
 * The human readable text of a barcode
 *
 * @typedef {object} HriOptions
 * @property {string} position   'none', 'above', 'below' or 'both'
 * @property {string} font       Font the text is drawn in, 'A' or 'B'
 */

/**
 * One cell of the human readable text of a barcode, at the place the layout
 * gave it
 *
 * @typedef {object} HriCell
 * @property {string|null} value   The character, or null for a box of Code 93
 * @property {number} x            Left edge of the cell, in dots
 */

/**
 * A barcode, as a parser asks the engine to lay it out
 *
 * @typedef {object} BarcodeRequest
 * @property {string} symbology       Name of the symbology, see src/symbologies
 * @property {string} data            The value of the barcode
 * @property {number} moduleWidth     Width of the narrowest bar in dots
 * @property {number} height          Height of the bars in dots
 * @property {HriOptions} [hri]       Where the human readable text goes, and in which font
 */

/**
 * A QR code, as a parser asks the engine to lay it out
 *
 * @typedef {object} QrcodeRequest
 * @property {Uint8Array} data     The bytes to encode
 * @property {number} moduleSize   Size of one module in dots
 * @property {string} errorLevel   Error correction level, 'L', 'M', 'Q' or 'H'
 */

/**
 * A PDF417 symbol, as a parser asks the engine to lay it out
 *
 * @typedef {object} Pdf417Request
 * @property {Uint8Array} data              The bytes to encode
 * @property {number} [columns]             Data columns, 1 to 30, 0 for automatic
 * @property {number} [rows]                Rows, 3 to 90, 0 for automatic
 * @property {number} moduleWidth           Width of a module in dots
 * @property {number} rowHeight             Height of a row in modules
 * @property {number|string} [errorLevel]   Error correction level, 0 to 8, or 'auto'
 * @property {number} [errorRatio]          Check codewords per ten data codewords, for 'auto'
 * @property {boolean} [truncated]          Draw the truncated form of the symbol
 */

/**
 * How a kept image is drawn, as a parser asks the engine to print it
 *
 * @typedef {object} PrintRequest
 * @property {{x: number, y: number}} [scale]   Horizontal and vertical multiplier, 1 by default
 */

/**
 * The current print style, as the printers style commands set it
 *
 * @typedef {object} Style
 * @property {boolean} bold        Overstrike
 * @property {number} underline    Underline thickness in dots, 0, 1 or 2
 * @property {number} upperline    Upperline thickness in dots, 0, 1 or 2
 * @property {boolean} invert      White on black
 * @property {number} width        Horizontal size multiplier, 1 to 8
 * @property {number} height       Vertical size multiplier, 1 to 8
 * @property {boolean} rotate      Turn every character cell a quarter turn clockwise
 * @property {boolean} upsideDown  Rotate every committed line by 180 degrees
 */

/**
 * Which set a user defined glyph belongs to, and how wide its cell is
 *
 * @typedef {object} GlyphRequest
 * @property {boolean} [multibyte]   The glyph of a multibyte character code, drawn in a cell of two
 *                                   characters, instead of a glyph of the current font
 */

/**
 * The left margin and the width of the print area, in dots
 *
 * @typedef {object} Margins
 * @property {number} [left]    Left margin in dots, from the left edge of the paper
 * @property {number} [width]   Width of the print area in dots, null for the whole paper
 */

/**
 * The print area of page mode, in dots on the page, as a parser sets it
 *
 * @typedef {object} PrintArea
 * @property {number} x        Horizontal origin, from the left edge of the page
 * @property {number} y        Vertical origin, from the top of the page
 * @property {number} width    Width of the area in dots, 0 for the rest of the page
 * @property {number} height   Height of the area in dots, 0 for the rest of the page
 */

/**
 * How a page is printed
 *
 * @typedef {object} PrintPageRequest
 * @property {boolean} [keep]   Keep the dots and the position, so the page can be printed again
 */

/**
 * How a position of page mode is set
 *
 * @typedef {object} PageVerticalRequest
 * @property {boolean} [relative]   Count the distance from the current position instead of the area
 */

/**
 * Where the entries of a stream go. A back-end draws them, the collector keeps
 * them. The interface is internal, see documentation/design.md.
 *
 * @typedef {object} LayoutSink
 * @property {function(LineEntry): void} line         A committed line box with its operations
 * @property {function(PageEntry): void} page         A printed page with its areas
 * @property {function(FeedEntry): void} feed         Rows the paper advanced without printing
 * @property {function(object): void} command         A cut, a pulse or an unknown command, with its y
 * @property {function(): any} end                    The result of the sink
 * @property {function(): void} discard                Throw away what the sink holds
 */

/* The glyph box of the two printer fonts: the size of the glyphs of the built
   in bitmap fonts, which sit centred in the cell the profile gives the font.
   The engine has no font, so it carries the box of the format, which is what a
   consumer that draws its own glyphs fits into the cell */

const GLYPH_BOXES = {
  A: {width: 12, height: 24},
  B: {width: 8, height: 16},
};

/* Where the baseline of a cell sits, as a fraction of its height. The built in
   fonts have their baseline at three quarters of their own height, row 18 of
   the 24 row font A and row 12 of the 16 row font B, and a printer puts the
   baseline of a cell at the same fraction of the cell, so that cells of every
   size on a line share it */

const BASELINE = 3 / 4;

/* The style the human readable text of a barcode is drawn in, which is never
   the style of the text around it */

const PLAIN = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1, rotate: false};

/* The set the user defined glyphs of a multibyte character code belong to.
   The glyphs of the single byte codes belong to the set of the font they were
   defined in, 'A' or 'B', so this name is not one of those */

const MULTIBYTE_GLYPHS = 'multibyte';

/* How many characters wide the cell of a multibyte glyph is, which is the two
   cells the placeholder of a multibyte character takes as well */

const MULTIBYTE_CELLS = 2;

/* The default tab stops of a printer, every eight characters of font A, and
   the most stops ESC D can set */

const TAB_INTERVAL = 8;
const MAX_TAB_STOPS = 32;

/* How tall the page of page mode is when the profile does not say, in dots.
   1662 dots is the page mode maximum of an Epson TM-T88 at 576 dots wide */

const DEFAULT_PAGE_HEIGHT = 1662;

/* The resolution of a profile that does not name one */

const DEFAULT_DPI = 203;

/* The code point of the glyph a multibyte character is drawn with, which the
   font draws as its fallback box */

const PLACEHOLDER = 0xfffd;

/* White dot rows between the bars of a barcode and its human readable text.
   The cell of the font has no room of its own above a capital, so without a
   gap the text touches the bars. Four dots is a legibility choice, it is not
   taken from a specification, and it is still to be compared with what an
   Epson puts on paper. */

const HRI_GAP = 4;

/**
 * The row a cell of a given height has its baseline on, which is what
 * Font.cellBaseline() gives the built in fonts. It is a function of the height
 * of the cell alone, so the engine needs no font to lay a line out.
 *
 * @param  {number}   height   Height of the cell in dots
 * @return {number}            Row of the cell, counted from its top
 */
function cellBaseline(height) {
  return Math.floor(height * BASELINE);
}

/**
 * The rectangles of the hollow box a Code 93 prints for its start and its stop
 * character: half a cell wide, a third of a cell high, drawn in lines of one
 * dot. The font has no glyph for it, so it is rectangles of the block, the way
 * the bars are.
 *
 * It sits in the middle of the cell horizontally and on the middle of a digit
 * vertically, which is the middle between the top of the cell and the baseline
 * row of the font: rows 5 to 12 of the 24 row cell of font A, where centring in
 * the whole cell would put it three dots lower than the paper of an Epson
 * TM-T70 shows it, the cell having room for a descender the box does not use.
 *
 * @param  {number}     x      Left edge of the cell, in the block
 * @param  {number}     y      Top of the cell, in the block
 * @param  {CellSize}   size   Size of a cell of the font
 * @return {object[]}          The rectangles: four of them, or two when the cell is too small for the sides
 */
function hriBox(x, y, size) {
  const width = Math.max(1, size.width >> 1);
  const height = Math.max(1, Math.floor(size.height / 3));

  const left = x + ((size.width - width) >> 1);
  const top = y + Math.round((cellBaseline(size.height) - height) / 2);

  const rectangles = [{type: 'rect', x: left, y: top, width, height: 1}];

  if (height > 1) {
    rectangles.push({type: 'rect', x: left, y: top + height - 1, width, height: 1});
  }

  if (height > 2 && width > 1) {
    rectangles.push(
        {type: 'rect', x: left, y: top + 1, width: 1, height: height - 2},
        {type: 'rect', x: left + width - 1, y: top + 1, width: 1, height: height - 2},
    );
  }

  return rectangles;
}

/**
 * The layout engine keeps the state of the printer, composes lines from cells
 * and emits the boxes of the paper to a sink as they are committed. It is
 * shared by the parsers of every language, so it knows nothing about bytes or
 * commands, and it draws no dots either: a cell is as wide as the profile says
 * times the width multiplier, a barcode is as wide as its bars, and what the
 * glyph of a code point looks like is the business of whoever draws it.
 *
 * It holds a position on the paper, which is where the print head is: a line is
 * committed at the position and the position moves on by its height, so the two
 * are the same number until a reverse feed moves the position back over rows
 * that are already on the paper, which the lines behind it are then drawn over.
 *
 * The paper of a job begins at the cutter's distance, the blank rows that
 * stand between the cut edge and the print head when the job starts: the
 * position starts there, every entry is that far down, and a cut is emitted
 * that far above the row its command arrived at, since the cutter is that far
 * above the head. Without the option the distance is zero and none of it
 * happens, which is the paper as the commands describe it.
 *
 * In page mode it composes a page instead of the paper: the lines and the
 * blocks go into a print area of a page held in memory, in the coordinate
 * system of the print direction, and the page reaches the paper as one entry
 * when the stream prints it. Everything above works the same way inside the
 * area, the surface the layout happens on is the only thing that changes.
 */
class LayoutEngine {
  #width;
  #profile;
  #commands;
  #cells;

  #sink;

  #style;
  #font;
  #align;
  #lineSpacing;
  #defaultLineSpacing;
  #spacing;
  #tabs;
  #margins;
  #upsideDown;

  #line;
  #definitions;
  #glyphs;
  #source;

  #pageHeight;
  #pageSetup;
  #page;
  #held;

  #position;
  #extent;
  #floor;

  #cutterDistance;
  #opened;

  /**
     * Create a layout engine
     *
     * @param  {LayoutOptions}   options   How the printer this engine emulates behaves
     */
  constructor(options) {
    const settings = options || {};

    if (!Number.isInteger(settings.width) || settings.width < 8 || settings.width % 8 !== 0) {
      throw new Error('Width must be a positive multiple of 8 dots');
    }

    if (!settings.profile || !settings.profile.fonts) {
      throw new Error('A printer profile is required');
    }

    this.#width = settings.width;
    this.#profile = settings.profile;
    this.#commands = new Set(settings.commands || []);

    this.#defaultLineSpacing = typeof settings.lineSpacing === 'undefined' ?
      this.#profile.lineSpacing :
      settings.lineSpacing;

    if (!Number.isInteger(this.#defaultLineSpacing) || this.#defaultLineSpacing < 1) {
      throw new Error('Line spacing must be a positive integer');
    }

    /* The cutter sits above the print head: the paper between the two is blank
       and already past the head when a job starts, so the job prints that far
       below the cut edge and its cuts land that far above the print head, see
       #open() and #marker() */

    this.#cutterDistance = typeof settings.cutterDistance === 'undefined' ? 0 : settings.cutterDistance;

    if (!Number.isInteger(this.#cutterDistance) || this.#cutterDistance < 0) {
      throw new Error('Cutter distance must be a whole number of dots');
    }

    this.#cells = {
      A: this.#profile.fonts.A,
      B: this.#profile.fonts.B,
    };

    this.#pageHeight = this.#profile.pageHeight || DEFAULT_PAGE_HEIGHT;

    /* The images the graphics commands define live as long as this engine
       does: they are the memory of the printer, which an initialize does not
       empty and which is still there for the next job */

    this.#definitions = new Map();

    /* The user defined glyphs are the other memory of the printer, and the
       other lifetime: they live in RAM, so an initialize throws them away, see
       reset() */

    this.#glyphs = new Map();

    this.#sink = null;

    this.#clear();
    this.reset();
  }

  /**
     * Attach the sink of a stream. The engine keeps the memory of the printer
     * across streams, the sink holds one stream.
     *
     * @param  {LayoutSink}   sink   Where the entries go
     */
  attach(sink) {
    this.#sink = sink;
  }

  /**
     * The printer profile this engine uses
     *
     * @return {Profile}   The profile
     */
  get profile() {
    return this.#profile;
  }

  /**
     * Width of the print area in dots
     *
     * @return {number}   Width in dots
     */
  get width() {
    return this.#width;
  }

  /**
     * The resolution of the profile in dots per inch, 203 when it does not say
     *
     * @return {number}   Dots per inch
     */
  get dpi() {
    return this.#profile.dpi || DEFAULT_DPI;
  }

  /**
     * Number of font A characters that fit on a line
     *
     * @return {number}   Number of columns
     */
  get columns() {
    return Math.floor(this.#width / this.#cells.A.width);
  }

  /**
     * Initialize the printer state: styles, font, alignment and line spacing.
     * The boxes that were already committed and the entries that were already
     * emitted are kept, which is what ESC @ does on a real printer.
     */
  reset() {
    /* An initialize leaves page mode and throws the page away, which is what
       ESC @ does to the page buffer of a printer */

    this.page(false);

    this.#style = {bold: false, underline: 0, upperline: 0, invert: false, width: 1, height: 1, rotate: false};
    this.#font = 'A';
    this.#align = 'left';
    this.#lineSpacing = this.#defaultLineSpacing;
    this.#spacing = 0;
    this.#tabs = null;
    this.#margins = {left: 0, width: null};
    this.#upsideDown = false;
    this.#line = this.#empty();

    /* The glyphs a stream downloaded live in the RAM of the printer, which an
       initialize clears, unlike the images of the graphics commands, which are
       its NV memory and survive */

    this.#glyphs.clear();

    /* The print area and the print direction of page mode are settings of the
       printer, not of one page: a stream sets them in standard mode or in page
       mode, they survive the page they were used on, and only an initialize
       puts them back. No area at all is the whole printable area */

    this.#pageSetup = {area: null, direction: 0};
  }

  /**
     * Width of one character of the current font in dots, which is what the
     * margins and the tab stops of the Star commands are counted in
     *
     * @return {number}   Width of a cell in dots
     */
  get characterWidth() {
    return this.#cells[this.#font].width;
  }

  /**
     * Where the next cell goes, in dots from the left margin, which is what
     * ESC \ counts its distance from
     *
     * @return {number}   Position of the cursor
     */
  get cursor() {
    return this.#line.x;
  }

  /**
     * The bytes of the stream the calls that follow come from, which a parser
     * sets to the token it is handling: everything that is placed from here on
     * carries it, so that a consumer of the list can point at the command that
     * drew a block or at the byte that printed a character.
     *
     * A run of text is the exception: the parser gathers it and hands the
     * source of every character to text(), the bytes having been read long
     * before the call that places them.
     *
     * @param  {Source|null}   range   The range of the token, null for none
     */
  source(range) {
    this.#source = range || null;
  }

  /**
     * Append text to the current line, one cell per character, in the current
     * style. A character that does not fit on the rest of the line wraps to the
     * next one, the way a printer wraps.
     *
     * The string is already decoded, the parser owns the codepage.
     *
     * @param  {string}     value       The text to print
     * @param  {Source[]}   [sources]   The bytes of every character, the current source when left out
     */
  text(value, sources) {
    const ascent = this.#ascent();

    let index = 0;

    for (const character of value) {
      const source = sources ? sources[index] : null;

      this.#place(
          this.#cell(character.codePointAt(0), null, null, source),
          this.#spacing * this.#style.width,
          ascent,
      );

      index++;
    }
  }

  /**
     * Append cells of the fallback glyph, which is what a multibyte character
     * becomes on a printer without the font for it. One Kanji character is two
     * cells wide, so that the layout around it stays right.
     *
     * @param  {number}   count   Number of cells to draw
     */
  placeholder(count) {
    const ascent = this.#ascent();

    for (let cell = 0; cell < count; cell++) {
      this.#place(this.#cell(PLACEHOLDER), this.#spacing * this.#style.width, ascent);
    }
  }

  /**
     * Keep the glyph a stream downloaded for a character code, or cancel it
     * again with a bitmap of null.
     *
     * A single byte glyph belongs to the font that is current when it is
     * defined, so font A and font B hold a set of their own, and a multibyte
     * glyph belongs to a set of its own. The dots are kept as they were
     * defined; the cell they are drawn in is decided when they are printed,
     * because the size, the style and the font of that moment decide it.
     *
     * @param  {number}         code       The character code the glyph belongs to
     * @param  {Bitmap|null}    bitmap     The dots of the glyph, or null to cancel the definition
     * @param  {GlyphRequest}   [options]  Which set the glyph belongs to
     */
  defineGlyph(code, bitmap, options) {
    const key = this.#glyphKey(code, options);

    if (!bitmap) {
      this.#glyphs.delete(key);
      return;
    }

    this.#glyphs.set(key, bitmap);
  }

  /**
     * Whether a character code has a glyph a stream downloaded, in the set the
     * options name
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set to look in
     * @return {boolean}                    True when the set holds a glyph for it
     */
  hasGlyph(code, options) {
    return this.#glyphs.has(this.#glyphKey(code, options));
  }

  /**
     * Append the glyph a stream downloaded for a character code, in the current
     * style, the way text() appends a built in one. The dots are placed in the
     * top left corner of the cell and the rest of the cell stays blank, which
     * is what a glyph that is narrower or shorter than the cell prints like.
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set the glyph belongs to
     * @return {boolean}                    True when the set held a glyph and it was placed
     */
  glyph(code, options) {
    const bitmap = this.#glyphs.get(this.#glyphKey(code, options));

    if (!bitmap) {
      return false;
    }

    const cells = options && options.multibyte ? MULTIBYTE_CELLS : 1;

    /* The character spacing follows every cell the glyph takes, so a multibyte
       glyph of two cells leaves the space placeholder(2) would have left */

    this.#place(
        this.#glyphCell(bitmap, cells),
        this.#spacing * this.#style.width * cells,
        this.#ascent(),
    );

    return true;
  }

  /**
     * Change one or more style properties. Properties that are not given keep
     * their value.
     *
     * Upside down is not a property of a cell but of the line it lands on: it
     * rotates every line that is committed from here on, so it is kept apart
     * from the style the cells are drawn in. The rotation of ESC V is the other
     * way round, a property of the cell: every cell is turned a quarter turn
     * clockwise and the cells still go left to right along the line.
     *
     * @param  {Partial<Style>}   changes   The properties to change
     */
  style(changes) {
    if (!changes) {
      return;
    }

    for (const property of ['bold', 'underline', 'upperline', 'invert', 'width', 'height', 'rotate']) {
      if (typeof changes[property] !== 'undefined') {
        this.#style[property] = changes[property];
      }
    }

    if (typeof changes.upsideDown !== 'undefined') {
      this.#upsideDown = changes.upsideDown === true;
    }
  }

  /**
     * Change the space that follows every cell, which ESC SP sets. The space is
     * scaled with the width multiplier, as the printer scales it, and it is not
     * part of the width the alignment centres, so a centred line with character
     * spacing is centred on its characters.
     *
     * @param  {number}   dots   Extra dots after every cell
     */
  spacing(dots) {
    if (!Number.isInteger(dots) || dots < 0) {
      return;
    }

    this.#spacing = dots;
  }

  /**
     * Move the cursor to an absolute position on the line, in dots from the
     * left margin, which is what ESC $ and HT do. A position beyond the print
     * area is ignored, the way a printer ignores it.
     *
     * @param  {number}   dots   Position in dots from the left margin
     */
  position(dots) {
    if (!Number.isInteger(dots) || dots < 0 || dots > this.#area()) {
      return;
    }

    this.#line.x = dots;
  }

  /**
     * Set the tab stops, in characters of the current font, which is what
     * ESC D does. An empty list cancels every stop, after which a tab does
     * nothing at all, and `null` goes back to the default of a stop every eight
     * characters, which is what an initialize does. Stops have to ascend, a
     * stop that does not ends the list, and a printer holds at most 32 of them.
     *
     * A character is as wide as the cell plus the character spacing of
     * `spacing()`, which is how the ESC/POS reference of ESC D defines the
     * unit: the character width includes the right side spacing.
     *
     * @param  {number[]|null}   columns   The stops in characters, [] for none, null for the defaults
     */
  tabs(columns) {
    if (columns === null || typeof columns === 'undefined') {
      this.#tabs = null;
      return;
    }

    if (!Array.isArray(columns)) {
      return;
    }

    const width = this.#tabUnit();
    const stops = [];

    for (const column of columns) {
      if (!Number.isInteger(column) || column < 1 || stops.length >= MAX_TAB_STOPS) {
        break;
      }

      const position = column * width;

      if (stops.length && position <= stops[stops.length - 1]) {
        break;
      }

      stops.push(position);
    }

    this.#tabs = stops;
  }

  /**
     * Move the cursor to the next tab stop, which is what HT does. A tab past
     * the last stop does nothing, and neither does a tab when every stop was
     * cancelled. A stop that lies outside the print area puts the cursor one
     * dot beyond the area instead, so that the next character wraps to a new
     * line, which is what the ESC/POS reference of HT describes.
     */
  tab() {
    const stops = this.#tabs === null ? this.#defaultTabs() : this.#tabs;
    const area = this.#area();

    for (const stop of stops) {
      if (stop <= this.#line.x) {
        continue;
      }

      this.#line.x = stop < area ? stop : area + 1;

      return;
    }
  }

  /**
     * Set the left margin and the width of the print area, both in dots.
     *
     * The commands that set them are only effective at the beginning of a
     * line, so a line that is already being composed, or whose cursor has been
     * moved, makes the whole command do nothing, the way a printer drops it.
     * A width that does not fit on the paper is clamped to it.
     *
     * @param  {Margins}   changes   The margins to change, the others keep their value
     */
  margins(changes) {
    if (!changes || this.#page || this.#line.items.length !== 0 || this.#line.x !== 0) {
      return;
    }

    this.#margins = {
      left: typeof changes.left === 'undefined' ? this.#margins.left : Math.max(0, changes.left),
      width: typeof changes.width === 'undefined' ? this.#margins.width : changes.width,
    };
  }

  /**
     * Change the font
     *
     * @param  {string}   name   'A' or 'B'
     */
  font(name) {
    if (name !== 'A' && name !== 'B') {
      throw new Error(`Unknown font ${name}`);
    }

    this.#font = name;
  }

  /**
     * Change the alignment, which is applied when the line is committed
     *
     * @param  {string}   value   'left', 'center' or 'right'
     */
  align(value) {
    if (value !== 'left' && value !== 'center' && value !== 'right') {
      throw new Error(`Unknown alignment ${value}`);
    }

    this.#align = value;
  }

  /**
     * Change the line spacing
     *
     * @param  {number|null}   dots   Line spacing in dots, null restores the default
     */
  lineSpacing(dots) {
    if (dots === null || typeof dots === 'undefined') {
      this.#lineSpacing = this.#defaultLineSpacing;
      return;
    }

    if (!Number.isInteger(dots) || dots < 0) {
      throw new Error('Line spacing must be a non-negative integer');
    }

    this.#lineSpacing = dots;
  }

  /**
     * Commit the current line and advance the paper. The line is as tall as the
     * tallest cell on it, but never shorter than the line spacing, so a line of
     * double height text is 48 dots and not 60. An empty line advances by the
     * line spacing alone.
     *
     * @param  {number}   [count]   Number of lines to advance, ESC d n feeds more than one
     */
  lineFeed(count = 1) {
    this.#commit(this.#lineSpacing * count);
  }

  /**
     * Commit the current line and advance the paper by a number of dot rows
     * instead of by whole lines, which is what ESC J does. A line that is
     * taller than the requested distance still advances by its own height, so
     * that nothing overlaps.
     *
     * @param  {number}   dots   Number of dot rows to advance
     */
  feed(dots) {
    this.#commit(Math.max(0, dots));
  }

  /**
     * Commit the current line and move the paper back by a number of dot rows,
     * which is what the reverse feed commands do. The line is printed first,
     * because a reverse feed is a print command, and the paper then moves back
     * over the rows that are already on it, so that everything after this
     * overprints them.
     *
     * The move is clamped at the last command that took the paper away, a cut
     * or a drawer pulse the driver supports: the paper in front of it has left
     * the printer and a reverse feed cannot bring it back. A printer clamps in
     * the same place for its own reason, the mechanism, which is why the
     * commands that do this have a maximum of a few lines.
     *
     * @param  {number}   dots   Number of dot rows to move back
     */
  reverseFeed(dots) {
    this.#commit(0);

    if (!Number.isInteger(dots) || dots <= 0) {
      return;
    }

    /* In page mode the paper does not move at all, the position inside the
       print area does, and the top of the area is the clamp there */

    if (this.#page) {
      this.#page.y = Math.max(0, this.#page.y - dots);
      return;
    }

    this.#position = Math.max(this.#floor, this.#position - dots);
  }

  /**
     * Commit the current line and move the paper back by a number of lines
     * instead of by dot rows, which is what ESC e does. The line is the current
     * line spacing, the same unit lineFeed() advances by.
     *
     * @param  {number}   [count]   Number of lines to move back
     */
  reverseLineFeed(count = 1) {
    this.reverseFeed(this.#lineSpacing * count);
  }

  /**
     * Throw away the line that is being composed, without advancing the paper.
     * The Star CAN command cancels the print data of the line buffer, which is
     * this, and ESC @ does it as part of a full initialize.
     */
  cancel() {
    this.#line = this.#empty();
  }

  /**
     * Whether the engine is composing a page instead of the paper
     *
     * @return {boolean}   True in page mode
     */
  get pageMode() {
    return this.#page !== null;
  }

  /**
     * Enter page mode, or leave it and throw the page away.
     *
     * Page mode is entered at the beginning of a line only, which is what the
     * commands that select it say: a line that already holds characters, or
     * whose cursor was moved, makes the printer drop the command. Leaving page
     * mode deletes everything the page held, boxes and pending line alike; the
     * page only ever reaches the paper through printPage().
     *
     * @param  {boolean}   enabled   True to enter page mode, false to leave it
     */
  page(enabled) {
    if (enabled) {
      if (this.#page || this.#line.items.length !== 0 || this.#line.x !== 0) {
        return;
      }

      const area = this.#pageSetup.area;

      this.#page = {
        areas: [],
        current: null,
        area: area || {x: 0, y: 0, width: this.#width, height: this.#pageHeight},
        direction: this.#pageSetup.direction,
        bottom: area ? area.y + area.height : 0,
        extent: 0,
        reach: 0,
        top: Infinity,
        y: 0,
      };

      return;
    }

    if (!this.#page) {
      return;
    }

    this.#page = null;
    this.#line = this.#empty();

    this.#release();
  }

  /**
     * Set the print area of the page, in dots on the page. The origin is the
     * top left corner of the area, whatever the print direction is, and a width
     * or a height of zero is the rest of the page in that direction.
     *
     * An origin outside the page is ignored, the way the printer ignores it.
     * The area of a page that was given none is the whole page.
     *
     * The layout starts over in the new area, at its start position: what was
     * laid out in the area before this goes into the page, so a stream can
     * compose one page out of several areas.
     *
     * @param  {PrintArea}   area   The print area
     */
  pageArea(area) {
    if (!area) {
      return;
    }

    const x = Number.isInteger(area.x) ? area.x : 0;
    const y = Number.isInteger(area.y) ? area.y : 0;

    if (x < 0 || y < 0 || x >= this.#width || y >= this.#pageHeight) {
      return;
    }

    /* A width or a height of zero is not an area, and the command that carries
       one does nothing at all, the way the printer ignores it */

    if (!Number.isInteger(area.width) || !Number.isInteger(area.height) ||
        area.width <= 0 || area.height <= 0) {
      return;
    }

    const width = Math.min(area.width, this.#width - x);
    const height = Math.min(area.height, this.#pageHeight - y);

    this.#pageSetup.area = {x, y, width, height};

    if (!this.#page) {
      return;
    }

    this.#compose();

    this.#page.area = this.#pageSetup.area;

    /* The page feeds the paper over every area it was given, this one included,
       whatever the areas hold */

    this.#page.bottom = Math.max(this.#page.bottom, y + height);
  }

  /**
     * Set the print direction of page mode, which is the direction the text
     * runs in and the corner of the print area it starts in:
     *
     *   0   left to right, from the top left, drawn as it is laid out
     *   1   bottom to top, from the bottom left, a quarter turn counter-clockwise
     *   2   right to left, from the bottom right, half a turn
     *   3   top to bottom, from the top right, a quarter turn clockwise
     *
     * The layout of a direction happens in a coordinate system of its own, in
     * which the text runs to the right and the lines go down as they always do,
     * and the whole of it is turned when it goes into the page. The area is as
     * wide as it is tall in the two sideways directions, so a line of direction
     * 1 is as long as the area is high.
     *
     * Like a new area, a new direction starts the layout over, at the start
     * position of the direction.
     *
     * @param  {number}   direction   0, 1, 2 or 3
     */
  pageDirection(direction) {
    if (!Number.isInteger(direction) || direction < 0 || direction > 3) {
      return;
    }

    this.#pageSetup.direction = direction;

    if (!this.#page) {
      return;
    }

    this.#compose();

    this.#page.direction = direction;
  }

  /**
     * Move the position along the vertical axis of the print direction, which
     * is what GS $ and GS \ do in page mode: the distance is counted from the
     * start of the print area, or from the position itself when it is relative.
     * A position outside the area is ignored, the way the printer ignores it.
     *
     * The characters that are on the line are drawn where they were placed
     * before the position moves, so a stream that lays a page out with these
     * commands gets what it asked for.
     *
     * @param  {number}                 dots        The distance in dots
     * @param  {PageVerticalRequest}    [options]   `{relative: true}` to count from the position
     */
  pageVertical(dots, options) {
    if (!this.#page || !Number.isInteger(dots)) {
      return;
    }

    const position = options && options.relative === true ? this.#page.y + dots : dots;

    if (position < 0 || position > this.#logical().height) {
      return;
    }

    this.#settle();

    this.#page.y = position;
  }

  /**
     * Throw the boxes of the page away and keep the print area, which is what
     * CAN does in page mode
     */
  cancelPage() {
    if (!this.#page) {
      return;
    }

    this.#page.areas = [];
    this.#page.current = null;
    this.#page.extent = 0;
    this.#page.reach = 0;
    this.#page.top = Infinity;
    this.#page.y = 0;

    this.#line = this.#empty();
  }

  /**
     * Draw the page on the paper as one block and move the paper on by its
     * height, which is what FF and ESC FF do.
     *
     * The page is as tall as the print areas the stream set on it, so that the
     * paper advances over the whole area the way a printer feeds it, and as
     * tall as the boxes of what was laid out in it when the stream set no area
     * at all: the line boxes and the feeds of every area, mapped into the page
     * by the print direction, the bottom of the lowest one. A page that was
     * given neither an area nor a box is not printed, which is what makes
     * entering and leaving page mode without anything in between cost nothing.
     *
     * `{keep: true}` keeps the boxes, the area, the direction and the position,
     * so that the same page can be printed again.
     *
     * @param  {PrintPageRequest}   [options]   How the page is printed
     */
  printPage(options) {
    if (!this.#page) {
      return;
    }

    const keep = options ? options.keep === true : false;
    const position = this.#page.y;
    const cursor = this.#line.x;

    this.#compose();

    const page = this.#page;
    const height = Math.max(page.bottom, page.extent);

    if (height > 0) {
      /* The page is as tall as the areas it was given, boxes or no boxes, so it
         reaches the paper as an entry of that height rather than cut down to
         the rows that carry something: an area that stayed empty still feeds
         the paper, the way a printer feeds it */

      const areas = page.areas.slice();

      /* The page carries its own positions, so it goes on the paper itself and
         not inside the margins of the line mode. Upside down printing is a
         standard mode setting and does not turn a page either */

      const upsideDown = this.#upsideDown;

      this.#page = null;
      this.#upsideDown = false;

      this.#pageEntry(height, areas);

      this.#upsideDown = upsideDown;
      this.#page = page;
    }

    if (keep) {
      page.y = position;
      this.#line.x = cursor;
    } else {
      const area = this.#pageSetup.area;

      page.areas = [];
      page.current = null;
      page.bottom = area ? area.y + area.height : 0;
      page.extent = 0;
      page.reach = 0;
      page.top = Infinity;
      page.y = 0;
    }

    this.#release();
  }

  /**
     * Place a bitmap in the current line, at the cursor, as if it were one wide
     * cell. Column mode images are strips of 24 rows that sit inside normal
     * lines, this is how they get there.
     *
     * @param  {Bitmap}   bitmap   The strip to place
     */
  strip(bitmap) {
    this.#place(this.#image(bitmap));
  }

  /**
     * Commit the pending line, then put a bitmap on a line of its own, aligned
     * the way the current alignment says, and advance the paper by its height.
     *
     * Blocks that are not laid out by the line mode, the rows of the Star
     * raster mode, ask for `margins: false`: they carry their own position and
     * are placed on the paper itself, so a left margin of the line mode does
     * not shift them and a print area does not clip them.
     *
     * @param  {Bitmap}   bitmap      The block to draw
     * @param  {object}   [options]   `{margins: false}` to ignore the print area
     */
  block(bitmap, options) {
    this.#blockLine(
        bitmap.width,
        bitmap.height,
        [{type: 'image', x: 0, y: 0, width: bitmap.width, height: bitmap.height, data: bitmap.data}],
        options,
    );
  }

  /**
     * Keep an image for later, under a key of the parser's own making, such as
     * `nv:65:66` for the NV graphics of a key code or `nv-bit-image:1` for the
     * first image of an `FS q` definition.
     *
     * The images are the memory of the printer: they survive `reset()`, which
     * is what an initialize does, and `discard()`, so a definition in one
     * stream is still there in the next one. A definition without a bitmap
     * deletes the key, which is what the delete commands of the graphics group
     * do.
     *
     * @param  {string}        key      Name of the image
     * @param  {Bitmap|null}   bitmap   The image, or null to delete it
     */
  define(key, bitmap) {
    if (typeof key !== 'string') {
      return;
    }

    if (!bitmap) {
      this.#definitions.delete(key);
      return;
    }

    this.#definitions.set(key, bitmap);
  }

  /**
     * Delete every image whose key starts with a prefix, which is what the
     * commands that delete all NV or all download graphics do
     *
     * @param  {string}   prefix   The start of the keys to delete
     */
  forget(prefix) {
    for (const key of this.#definitions.keys()) {
      if (key.startsWith(prefix)) {
        this.#definitions.delete(key);
      }
    }
  }

  /**
     * Draw an image that was kept as a block, scaled by repeating its dots the
     * way the print commands of the graphics group scale it.
     *
     * A key that was never defined prints nothing at all and does not advance
     * the paper, which is what a printer does with an image it does not hold.
     * The parser reports the command instead, so the caller is told whether
     * anything was drawn.
     *
     * @param  {string}         key         Name of the image
     * @param  {PrintRequest}   [options]   How the image is scaled
     * @return {boolean}                    True when the image was drawn
     */
  print(key, options) {
    const bitmap = this.#definitions.get(key);

    if (!bitmap) {
      return false;
    }

    const scale = (options && options.scale) || {};
    const x = Number.isInteger(scale.x) && scale.x > 0 ? scale.x : 1;
    const y = Number.isInteger(scale.y) && scale.y > 0 ? scale.y : 1;

    this.block(Bitmap.scale(bitmap, x, y));

    return true;
  }

  /**
     * Lay a one dimensional barcode out as a block, with its human readable
     * text above it, below it, or not at all. The bars are rectangles and the
     * text is cells, so nothing of it is a bitmap.
     *
     * Data that is not valid for the symbology prints nothing, which is what
     * printer firmware does: the barcode is skipped and the paper does not
     * advance. The caller is told so, because the reference of `GS k` says that
     * a command whose data is out of range is aborted and its data processed as
     * normal data, which is what an Epson TM-T70 does with the UPC-E rows of
     * six to eight digits. Bars that are wider than the print area are skipped
     * as well, an Epson prints nothing at all rather than a barcode no reader
     * can read, but the data was valid there and is not printed as text.
     *
     * The human readable text is one run of cells centred under the bars,
     * except where a symbology asks for something else: UPC-A and EAN-8 carry
     * groups, which are centred under the modules that encode them, and the
     * four symbologies that carry `spread` put one character in each of as many
     * equal slots as there are characters. It is clipped when it is wider than
     * the paper.
     *
     * @param  {BarcodeRequest}   request   The barcode to draw
     * @return {boolean}                    False when the data is not valid for the symbology
     */
  barcode(request) {
    const code = encodeBarcode(request.symbology, request.data);

    if (code === null || code.bars.length === 0) {
      return false;
    }

    const moduleWidth = Math.max(1, request.moduleWidth || 1);

    /* The height of the command, unless the specification of the symbology
       fixes the height of its symbol or gives it a least height, which the GS1
       DataBar family does. Those heights are in modules, so they grow with the
       width of a module, the way a printer draws them */

    let height = Math.max(1, request.height || 1);

    if (code.height && code.height.fixed) {
      height = code.height.fixed * moduleWidth;
    }

    if (code.height && code.height.minimum) {
      height = Math.max(height, code.height.minimum * moduleWidth);
    }

    const barsWidth = code.bars.reduce((total, width) => total + width, 0) * moduleWidth;

    if (barsWidth > this.#surface()) {
      return true;
    }

    const position = (request.hri && request.hri.position) || 'none';

    /* The bars are one run of rectangles, the text one line of cells below
       them, above them, or both, with HRI_GAP dots of white in between, and the
       block is as wide as the wider of the two */

    const bars = [];

    let x = 0;

    for (let index = 0; index < code.bars.length; index++) {
      const width = code.bars[index] * moduleWidth;

      if (index % 2 === 0 && width > 0) {
        bars.push({type: 'rect', x, y: 0, width, height});
      }

      x += width;
    }

    if (position === 'none') {
      this.#blockLine(barsWidth, height, bars);
      return true;
    }

    const requested = (request.hri && request.hri.font) || 'A';
    const name = this.#cells[requested] ? requested : 'A';
    const size = this.#cells[name];

    /* One entry per cell of the text: a character, or null for a box of the
       start and the stop character of Code 93, which the font has no glyph
       for. A box is as wide as a cell and counts as a character everywhere */

    const cells = code.boxed ?
      [null, ...Array.from(code.text), null] :
      Array.from(code.text);

    const textWidth = Math.max(0, cells.length * size.width);

    /* Where every cell goes, measured from the left edge of the bars, which is
       negative for a cell that hangs off that edge. Null is one centred run */

    const placed = textWidth <= barsWidth ?
      this.#hriPositions(code, cells, size.width, barsWidth, moduleWidth) :
      null;

    let left = 0;
    let right = barsWidth;

    if (placed) {
      for (const cell of placed) {
        left = Math.min(left, cell.x);
        right = Math.max(right, cell.x + size.width);
      }
    }

    const above = position === 'above' || position === 'both';
    const below = position === 'below' || position === 'both';

    const margin = size.height + HRI_GAP;

    const width = placed ? right - left : Math.max(barsWidth, textWidth);
    const barsOffset = placed ? -left : (width - barsWidth) >> 1;
    const blockHeight = height + (above ? margin : 0) + (below ? margin : 0);

    const text = placed ?
      placed.map((cell) => ({value: cell.value, x: cell.x - left})) :
      cells.map((value, index) => ({value, x: ((width - textWidth) >> 1) + index * size.width}));

    const operations = [];

    if (above) {
      operations.push(...this.#textCells(text, name, 0));
    }

    for (const bar of bars) {
      operations.push(Object.assign({}, bar, {
        x: bar.x + barsOffset,
        y: above ? margin : 0,
      }));
    }

    if (below) {
      operations.push(...this.#textCells(text, name, blockHeight - size.height));
    }

    this.#blockLine(width, blockHeight, operations);

    return true;
  }

  /**
     * Where the cells of the human readable text of a barcode go, measured in
     * dots from the left edge of the bars, or null when the text is one run
     * centred under them, which is what every symbology without `groups` and
     * without `spread` asks for.
     *
     * A group is centred under the range of modules that encodes it: its left
     * edge is the start of the range plus half of what the group leaves over of
     * it, rounded down.
     *
     * A spread symbology divides the width of the bars into one interval more
     * than it has cells and centres a cell on each interior division point, so
     * that the margin on each side of the run is a whole interval: the pitch is
     * `barsWidth / (count + 1)`, a fraction of a dot, and the left edge of a
     * cell is its division point less half a cell, rounded to the nearest dot.
     * That is what the photographs of an Epson TM-T70 measure, pixel by pixel,
     * in all five of their spread rows.
     *
     * Both are the simplest rule that draws what the paper shows.
     *
     * @param  {Barcode}              code         The barcode of the symbology
     * @param  {Array<string|null>}   cells        One entry per cell, null for a box
     * @param  {number}               cellWidth    Width of a cell in dots
     * @param  {number}               barsWidth    Width of the bars in dots
     * @param  {number}               moduleWidth  Width of a module in dots
     * @return {HriCell[]|null}            The cells, or null for one centred run
     */
  #hriPositions(code, cells, cellWidth, barsWidth, moduleWidth) {
    if (Array.isArray(code.groups) && code.groups.length > 0) {
      const positions = [];

      for (const group of code.groups) {
        const characters = Array.from(group.text);
        const range = (group.end - group.start) * moduleWidth;
        const start = Math.floor(group.start * moduleWidth + (range - characters.length * cellWidth) / 2);

        characters.forEach((value, index) => positions.push({value, x: start + index * cellWidth}));
      }

      return positions;
    }

    if (code.spread !== true || cells.length === 0) {
      return null;
    }

    const pitch = barsWidth / (cells.length + 1);

    return cells.map((value, index) => ({
      value,
      x: Math.round((index + 1) * pitch - cellWidth / 2),
    }));
  }

  /**
     * Lay a QR code out as a block. Nothing is printed when there is no data to
     * encode, when the data does not fit in the largest symbol of its error
     * correction level, or when the symbol would be wider than the print area,
     * which is what a printer does in all three cases.
     *
     * @param  {QrcodeRequest}   request   The QR code to draw
     */
  qrcode(request) {
    if (!request.data || request.data.length === 0) {
      return;
    }

    const symbol = encodeQrcode(request.data, request.errorLevel);
    const moduleSize = Math.max(1, request.moduleSize || 1);

    if (symbol === null || symbol.width * moduleSize > this.#surface()) {
      return;
    }

    this.#blockLine(
        symbol.width * moduleSize,
        symbol.height * moduleSize,
        this.#modules(symbol.width, symbol.height, (x, y) => Bitmap.getPixel(symbol, x, y), moduleSize, moduleSize),
    );
  }

  /**
     * Lay a PDF417 symbol out as a block. Nothing is printed when there is no
     * data to encode, when the data does not fit in the number of columns and
     * rows the commands ask for, or when the symbol would be wider than the
     * print area, the same three rules the QR code follows.
     *
     * A module is `moduleWidth` dots wide and a row is `rowHeight` modules
     * tall, so a row is `rowHeight * moduleWidth` dots, which is how both
     * printer languages describe the height of a row. The symbol carries no
     * quiet zone, as a printer draws none.
     *
     * @param  {Pdf417Request}   request   The symbol to draw
     */
  pdf417(request) {
    if (!request.data || request.data.length === 0) {
      return;
    }

    const moduleWidth = Math.max(1, request.moduleWidth || 1);
    const rowHeight = Math.max(1, request.rowHeight || 1);

    const symbol = encodePdf417(request.data, {
      columns: request.columns,
      rows: request.rows,
      errorLevel: request.errorLevel,
      errorRatio: request.errorRatio,
      truncated: request.truncated,
      rowHeight,
    });

    if (symbol === null) {
      return;
    }

    const columns = symbol.modules[0].length;
    const width = columns * moduleWidth;

    if (width > this.#surface()) {
      return;
    }

    const height = rowHeight * moduleWidth;

    this.#blockLine(
        width,
        symbol.rows * height,
        this.#modules(
            columns,
            symbol.rows,
            (x, y) => symbol.modules[y][x],
            moduleWidth,
            height,
        ),
    );
  }

  /**
     * Handle a command.
     *
     * The engine emits every command it is given, with the row the paper is on
     * when it arrives, and the display list holds every one of them whatever
     * the driver supports. A command the driver does support takes the paper in
     * front of it away, which the engine does record: see #leave().
     *
     * @param  {object}   item   The item to emit, cut, pulse or unknown
     */
  command(item) {
    /* The bytes of the command travel with the item, because an item that
       waits for a page is emitted long after the parser moved on */

    const carried = Object.assign({}, item, {source: this.#source});

    /* A cut or a drawer pulse that arrives while a page is being composed
       waits for that page: the page is not on the paper yet, so an item in
       front of it would tell the driver to cut paper that is still to be
       printed. Everything else, the unknown items, is a diagnostic and is
       reported where it stands */

    if (this.#page && (item.type === 'cut' || item.type === 'pulse')) {
      this.#held.push(carried);
      return;
    }

    this.#leave(carried);

    this.#open();
    this.#sink.command(this.#marker(carried));
  }

  /**
     * Finish the stream: throw away the line that is still being composed and
     * return what the sink made of it. The engine is empty and initialized
     * afterwards, ready for another stream, with the options it was built with.
     *
     * The unfinished line is discarded and not committed, because that is what
     * the printer does with it: the cells sit in the line buffer and nothing
     * prints them until a line feed, a print command or the next job arrives.
     * A receipt that ends its last line prints in full, the line feed of that
     * line committed it; text without its line feed stays in the buffer, the
     * way it does on paper.
     *
     * @return {any}   The result of the sink, the items or the display list
     */
  end() {
    /* A page the stream never printed does not reach the paper, the way the
       line that is being composed does not */

    this.page(false);
    this.cancel();

    const result = this.#sink.end();

    this.discard();

    return result;
  }

  /**
     * Throw away everything this engine holds: the boxes the sink did not
     * return yet and the state. A renderer uses it to make sure a stream that
     * failed halfway leaves nothing behind for the next one.
     */
  discard() {
    this.#sink.discard();
    this.#clear();
    this.reset();
  }

  /**
     * Drop the position and the page, which is what a new stream starts with
     */
  #clear() {
    /* The paper of a job starts below the blank rows that stand between the
       cut edge and the print head, so the head of a job is at the cutter's
       distance and nothing can be printed or fed back above it */

    this.#position = this.#cutterDistance;
    this.#extent = this.#cutterDistance;
    this.#floor = this.#cutterDistance;
    this.#opened = false;
    this.#page = null;
    this.#held = [];
    this.#source = null;
  }

  /**
     * Put the blank paper of the cutter's distance at the top of the stream,
     * the rows that were already past the print head when the job started.
     *
     * It is emitted at the first entry of the stream and not when the stream
     * begins, because the sink of a stream is attached after the engine was
     * cleared, and a stream that prints nothing leaves no paper at all.
     */
  #open() {
    if (this.#opened) {
      return;
    }

    this.#opened = true;

    if (this.#cutterDistance > 0) {
      this.#sink.feed({type: 'feed', y: 0, height: this.#cutterDistance, source: null});
    }
  }

  /**
     * The operation of one cell of text, in a style and a font
     *
     * @param  {number}   codepoint   Unicode code point
     * @param  {string}   [name]      Font of the cell, the current font when it is left out
     * @param  {Style}    [style]     Style of the cell, the current style when it is left out
     * @param  {Source}   [source]    Bytes the cell came from, the current source when it is left out
     * @return {object}               The operation, with the size of its box
     */
  #cell(codepoint, name, style, source) {
    name = name || this.#font;
    style = style || this.#style;

    const size = this.#cells[name];

    return this.#textOperation(
        {codepoint, glyph: GLYPH_BOXES[name]},
        name,
        {width: size.width, height: size.height},
        style,
        source,
    );
  }

  /**
     * The operation of one cell of a glyph a stream downloaded, in the current
     * style and the current font. The dots sit in the top left corner of a cell
     * of the font and the rest of the cell stays blank, so the glyph box of the
     * operation is its cell.
     *
     * @param  {Bitmap}   bitmap   The glyph as the stream defined it
     * @param  {number}   cells    Width of the cell in characters of the current font
     * @return {object}            The operation, with the size of its box
     */
  #glyphCell(bitmap, cells) {
    const size = this.#cells[this.#font];
    const cell = {width: size.width * cells, height: size.height};

    return this.#textOperation(
        {bitmap, glyph: {width: cell.width, height: cell.height}},
        this.#font,
        cell,
        this.#style,
    );
  }

  /**
     * A text operation: what is drawn, in which cell, at which size and in
     * which style, and how large its box on the line is. A cell that is turned
     * by ESC V has the sides of its box swapped, because the turn is a quarter
     * turn clockwise about the top left corner of the unturned cell.
     *
     * @param  {object}     glyph      The code point or the bitmap, and the glyph box
     * @param  {string}     name       Font of the cell, 'A' or 'B'
     * @param  {CellSize}   cell       The unscaled cell
     * @param  {Style}      style      The style of the cell
     * @param  {Source}     [source]   Bytes the cell came from, the current source when it is left out
     * @return {object}                The operation, with the size of its box
     */
  #textOperation(glyph, name, cell, style, source) {
    const rotation = this.#rotated(style) ? 90 : 0;

    const width = cell.width * style.width;
    const height = cell.height * style.height;

    /* The fields are written in the order of the contract, so that a list that
       is read by hand reads the way the reference page does */

    const fields = typeof glyph.codepoint === 'number' ?
      {codepoint: glyph.codepoint} :
      {bitmap: glyph.bitmap};

    fields.font = name;
    fields.cell = cell;
    fields.glyph = glyph.glyph;
    fields.baseline = cellBaseline(cell.height);
    fields.scale = {x: style.width, y: style.height};
    fields.style = {
      bold: style.bold === true,
      underline: style.underline || 0,
      upperline: style.upperline || 0,
      invert: style.invert === true,
    };
    fields.rotation = rotation;

    /* The right side character spacing of the cell, which place() fills in for
       a cell that is followed by one: the operations of a barcode's human
       readable text are never, so the field is always there and defaults to no
       spacing at all */

    fields.spacing = 0;

    /* The byte that printed this cell, or the command that drew the block it
       belongs to: a run of text carries a source per character, everything
       else the source of the token the parser is handling */

    fields.source = source || this.#source;

    return {
      type: 'text',
      width: rotation === 90 ? height : width,
      height: rotation === 90 ? width : height,
      fields,
    };
  }

  /**
     * An image operation of a bitmap, at its own size
     *
     * @param  {Bitmap}   bitmap   The dots
     * @return {object}            The operation, with the size of its box
     */
  #image(bitmap) {
    return {
      type: 'image',
      width: bitmap.width,
      height: bitmap.height,
      fields: {data: bitmap.data, source: this.#source},
    };
  }

  /**
     * The cells of the human readable text of a barcode, in one font and
     * without any style, each at the left edge the layout gave it.
     *
     * A cell whose value is null is the start or the stop character of a Code
     * 93, which the font has no glyph for: it is drawn as a hollow rectangle of
     * one dot lines instead, as a printer does, and that is rectangle
     * operations of the block and not a glyph.
     *
     * @param  {HriCell[]}  cells  The cells and their left edges
     * @param  {string}     name   Font of the text, 'A' or 'B'
     * @param  {number}     y      Top of the text, in the block
     * @return {object[]}          The operations, one cell per character
     */
  #textCells(cells, name, y) {
    const size = this.#cells[name];
    const operations = [];

    for (const {value, x} of cells) {
      if (value === null) {
        operations.push(...hriBox(x, y, size));
        continue;
      }

      const cell = this.#cell(value.codePointAt(0), name, PLAIN);

      operations.push(Object.assign(
          {type: 'text', x, y, width: cell.width, height: cell.height},
          cell.fields,
      ));
    }

    return operations;
  }

  /**
     * The black modules of a symbol as rectangles: the runs of black dots of a
     * row become one rectangle each, and a run that repeats in the row below it
     * grows that rectangle instead of adding one, so that a symbol costs as few
     * rectangles as a row by row merge gives.
     *
     * @param  {number}     width    Number of modules per row
     * @param  {number}     height   Number of rows of modules
     * @param  {function}   get      Whether the module at a position is black
     * @param  {number}     scaleX   Width of a module in dots
     * @param  {number}     scaleY   Height of a module in dots
     * @return {object[]}            The rectangles, in the order they start
     */
  #modules(width, height, get, scaleX, scaleY) {
    const rectangles = [];

    let open = new Map();

    for (let y = 0; y < height; y++) {
      const next = new Map();

      let x = 0;

      while (x < width) {
        if (!get(x, y)) {
          x++;
          continue;
        }

        let end = x;

        while (end < width && get(end, y)) {
          end++;
        }

        const key = `${x}:${end}`;
        const previous = open.get(key);

        if (previous) {
          previous.height += scaleY;
          next.set(key, previous);
        } else {
          const rectangle = {
            type: 'rect',
            x: x * scaleX,
            y: y * scaleY,
            width: (end - x) * scaleX,
            height: scaleY,
          };

          rectangles.push(rectangle);
          next.set(key, rectangle);
        }

        x = end;
      }

      open = next;
    }

    return rectangles;
  }

  /**
     * The key a user defined glyph is kept under: the set it belongs to and its
     * character code
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set the glyph belongs to
     * @return {string}                     The key
     */
  #glyphKey(code, options) {
    return `${options && options.multibyte ? MULTIBYTE_GLYPHS : this.#font}|${code}`;
  }

  /**
     * How far the baseline of a text cell sits below its top edge. The cell of
     * a font has its baseline at three quarters of its height, where the built
     * in fonts have theirs, and the height multiplier repeats every dot, so the
     * ascent of the cell is the baseline of the cell times the multiplier.
     *
     * A cell that is turned by ESC V has no baseline of its own any more, its
     * text runs down the line instead of along it, so it stands on the bottom
     * of the line box like a strip does.
     *
     * @param  {string}   [name]    Font of the cell, the current font when it is left out
     * @param  {Style}    [style]   Style of the cell, the current style when it is left out
     * @return {number|null}        Ascent of the cell in dots, or null when the cell has no baseline
     */
  #ascent(name, style) {
    name = name || this.#font;
    style = style || this.#style;

    if (this.#rotated(style)) {
      return null;
    }

    return cellBaseline(this.#cells[name].height) * style.height;
  }

  /**
     * Whether the cells of a style are turned a quarter turn clockwise, which
     * is the rotation of ESC V. It is a standard mode command, so a page of
     * page mode is laid out upright whatever the setting is.
     *
     * @param  {Style}     style   The style
     * @return {boolean}           True when the cell is turned
     */
  #rotated(style) {
    return style.rotate === true && !this.#page;
  }

  /**
     * An empty line, which is what a line is before anything is placed on it
     * and right after it is committed
     *
     * @return {object}   The line
     */
  #empty() {
    return {items: [], x: 0, extent: 0, height: 0, ascent: 0, descent: 0, blocks: 0};
  }

  /**
     * Width of the print area in dots, the paper without the margins. A print
     * area that does not fit on the paper is clamped to it.
     *
     * @return {number}   Width in dots
     */
  #area() {
    if (this.#page) {
      return this.#logical().width;
    }

    const left = this.#left();
    const width = this.#margins.width === null ? this.#width - left : this.#margins.width;

    return Math.max(0, Math.min(width, this.#width - left));
  }

  /**
     * The left margin of the line, which is the left edge of the paper in page
     * mode: the print area of the page is the margin there
     *
     * @return {number}   Left margin in dots
     */
  #left() {
    return this.#page ? 0 : Math.min(this.#margins.left, this.#width);
  }

  /**
     * Width of the surface the layout happens on: the paper in standard mode
     * and the print area of the page, in the coordinate system of the print
     * direction, in page mode
     *
     * @return {number}   Width in dots
     */
  #surface() {
    return this.#page ? this.#logical().width : this.#width;
  }

  /**
     * The rotation a line box gets on the surface: half a turn while upside
     * down printing is on, and never in page mode, where the reference has
     * ESC { as a standard mode command and the print direction is what turns
     * the layout
     *
     * @return {number}   0 or 180 degrees
     */
  #rotation() {
    return this.#upsideDown && !this.#page ? 180 : 0;
  }

  /**
     * The width of one character for the tab stops: the cell plus the character
     * spacing behind it, which is the unit the ESC/POS reference of ESC D uses
     *
     * @return {number}   Width in dots
     */
  #tabUnit() {
    return this.characterWidth + this.#spacing;
  }

  /**
     * The tab stops of a printer that was not given any: one every eight
     * characters of font A, over the width of the paper. A stop beyond the
     * print area is still a stop, tab() sends the cursor past the area for it.
     *
     * @return {number[]}   The stops in dots from the left margin
     */
  #defaultTabs() {
    const stops = [];
    const step = (this.#cells.A.width + this.#spacing) * TAB_INTERVAL;

    for (let stop = step; stop <= this.#surface() && stops.length < MAX_TAB_STOPS; stop += step) {
      stops.push(stop);
    }

    return stops;
  }

  /**
     * The size of the print area in the coordinate system of the print
     * direction: the two sideways directions lay their text out along the
     * height of the area and their lines along its width
     *
     * @return {{width: number, height: number}}   The size in dots
     */
  #logical() {
    const {area, direction} = this.#page;

    return direction === 1 || direction === 3 ?
      {width: area.height, height: area.width} :
      {width: area.width, height: area.height};
  }

  /**
     * The area of the page that is being laid out, made the first time
     * something goes into it
     *
     * @return {object}   The area, with the entries it holds so far
     */
  #current() {
    if (!this.#page.current) {
      const {area, direction} = this.#page;

      this.#page.current = {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
        direction,
        entries: [],
      };
    }

    return this.#page.current;
  }

  /**
     * Commit the characters that are on the line where they were placed,
     * without moving the position, which is what a position command inside a
     * page has to do: a printer puts a character in the page as it reads it,
     * this engine keeps it on a line until something commits it.
     */
  #settle() {
    if (this.#line.items.length === 0) {
      return;
    }

    const {x} = this.#line;
    const y = this.#page.y;

    this.#commit(0);

    this.#page.y = y;
    this.#line.x = x;
  }

  /**
     * Put what was laid out in the current print area into the page and start
     * the area over. The page grows to hold it.
     *
     * The boxes of the area are mapped into the rows of the page. A box spans
     * the whole width of the logical surface, so what reaches the bottom of the
     * area depends on what the direction does with that surface: direction 0
     * draws it as it is, so the bottom of the lowest box is the bottom of the
     * area's layout, clipped where the area ends; the directions 1 and 3 swap
     * the axes, so the width of the surface is the height of the area and one
     * box spans the whole of it; direction 2 mirrors, so the top of the highest
     * box becomes the distance from the bottom of the area.
     */
  #compose() {
    const page = this.#page;

    this.#settle();

    this.#line = this.#empty();

    page.y = 0;

    if (page.reach > 0) {
      const {y, height} = page.area;

      let bottom = y + height;

      if (page.direction === 0) {
        bottom = y + Math.min(page.reach, height);
      } else if (page.direction === 2) {
        bottom = y + height - Math.min(page.top, height);
      }

      page.extent = Math.max(page.extent, bottom);
      page.reach = 0;
      page.top = Infinity;
    }

    if (!page.current) {
      return;
    }

    page.areas.push(page.current);
    page.current = null;
  }

  /**
     * Emit the cut and pulse items that waited for the page, behind the rows
     * that are on the paper by now
     */
  #release() {
    if (this.#held.length === 0) {
      return;
    }

    const held = this.#held;

    this.#held = [];

    for (const item of held) {
      this.#leave(item);

      this.#open();
      this.#sink.command(this.#marker(item));
    }
  }

  /**
     * The paper leaves the printer at a command the driver supports: a cut cuts
     * it off and a drawer pulse is handled where it stands, so everything in
     * front of the command is out of reach from there on.
     *
     * The print head is at the bottom of that paper afterwards, whatever a
     * reverse feed did to the position before, so the position moves down to
     * the extent of the paper and stays there: the command itself stands at
     * that row, what follows it is printed behind it, and a reverse feed cannot
     * move above it any more. A command the driver does not support changes
     * nothing at all, the way it changes nothing in the output.
     *
     * With a cutter distance only the paper above the cutter has left: the rows
     * between the cutter and the print head are still in the printer, and a
     * reverse feed may go back over them and print there, which is the top of
     * the next piece. So the floor is the cutter and not the head, and it never
     * moves back up, since the paper of an earlier command is gone for good.
     *
     * @param  {object}   item   The item, cut, pulse or unknown
     */
  #leave(item) {
    if (!this.#commands.has(item.type)) {
      return;
    }

    this.#position = this.#extent;
    this.#floor = Math.max(this.#floor, this.#extent - this.#cutterDistance);
  }

  /**
     * A command entry: the item and the row the paper is on when it arrives
     *
     * @param  {object}   item   The item, cut, pulse or unknown
     * @return {object}          The entry
     */
  #marker(item) {
    /* The cutter stands the cutter's distance above the print head, so the
       paper is cut that far above the row the command arrived at: the rows
       between the two are the last ones printed, which stay in the printer and
       become the top of the next receipt */

    const y = item.type === 'cut' ?
      Math.max(0, this.#position - this.#cutterDistance) :
      this.#position;

    const entry = {type: item.type, y};

    for (const key of Object.keys(item)) {
      if (key !== 'type') {
        entry[key] = item[key];
      }
    }

    return entry;
  }

  /**
     * Put a cell on the current line, wrapping to the next line when it does
     * not fit on the rest of this one
     *
     * A text cell brings the ascent of its baseline with it, and the rest of
     * the cell below the baseline is its descent. The line is as tall as the
     * largest ascent plus the largest descent, which is not the tallest cell
     * when a tall cell and a cell with a deep descender meet. A cell without a
     * baseline, a strip of a column image or a cell turned by ESC V, only has
     * to fit in the line box.
     *
     * @param  {object}        cell        The operation to place, with the size of its box
     * @param  {number}        [spacing]   Dots to leave behind the cell, the character spacing
     * @param  {number|null}   [ascent]    Dots between the top of the cell and its baseline, null when it has none
     */
  #place(cell, spacing = 0, ascent = null) {
    if (this.#line.x > 0 && this.#line.x + cell.width > this.#area()) {
      this.lineFeed();
    }

    /* The spacing rides along with the cell, because the reverse and the
       underline of the cell cover it: the box of the operation stays the cell,
       so nothing of the alignment, the wrapping, the tab stops or the extent of
       the line moves. commit() cuts it to what fits in the print area, which it
       can and this cannot, the alignment offset being unknown until the line is
       whole. The cursor still advances by the whole spacing, the way a printer
       advances it. */

    if (cell.type === 'text') {
      cell.fields.spacing = spacing;
    }

    this.#line.items.push({
      type: cell.type,
      fields: cell.fields,
      x: this.#line.x,
      width: cell.width,
      height: cell.height,
      ascent,
    });

    this.#line.extent = Math.max(this.#line.extent, this.#line.x + cell.width);
    this.#line.x += cell.width + spacing;

    if (ascent === null) {
      this.#line.blocks = Math.max(this.#line.blocks, cell.height);
    } else {
      this.#line.ascent = Math.max(this.#line.ascent, ascent);
      this.#line.descent = Math.max(this.#line.descent, cell.height - ascent);
    }

    this.#line.height = Math.max(this.#line.ascent + this.#line.descent, this.#line.blocks);
  }

  /**
     * Where content of a given width starts, for the current alignment
     *
     * @param  {number}   used     Width of the content in dots
     * @param  {number}   [area]   Width of the print area, the current one when it is left out
     * @return {number}            Horizontal position of the left edge, from the left margin
     */
  #offset(used, area) {
    const free = Math.max(0, (typeof area === 'number' ? area : this.#area()) - used);

    if (this.#align === 'center') {
      return free >> 1;
    }

    if (this.#align === 'right') {
      return free;
    }

    return 0;
  }

  /**
     * Commit the current line: place its cells in a box of the right height,
     * aligned inside the print area, and emit it.
     *
     * The text cells of the line share one baseline, the way the characters of
     * a printer do: the baseline of the line sits a descent above its bottom
     * edge and a cell is placed at `baseline - ascent` from the top of the line
     * box, so a single height character next to a double height one stands on
     * the same line as the tall one and the descender space of the tall one
     * hangs below it. A cell without a baseline, a strip of a column image or a
     * cell turned by ESC V, is put on the bottom of the line box. The underline
     * and the upperline are part of the cell and move with it. The gap of the
     * line spacing is the rows below the line and stays there.
     *
     * @param  {number}   minimum   Smallest height of the line in dots
     */
  #commit(minimum) {
    const line = this.#line;
    const height = Math.max(minimum, line.height);
    const left = this.#left();
    const area = this.#area();

    this.#line = this.#empty();

    if (height === 0) {
      return;
    }

    if (line.items.length === 0) {
      this.#appendBlank(height);
      return;
    }

    const offset = left + this.#offset(line.extent, area);
    const baseline = line.height - line.descent;
    const right = left + area;

    const operations = line.items.map((item) => {
      const top = item.ascent === null ? line.height - item.height : baseline - item.ascent;
      const x = offset + item.x;

      const operation = Object.assign(
          {type: item.type, x, y: top, width: item.width, height: item.height},
          item.fields,
      );

      /* The character spacing is dots the printer prints, so it stops at the
         right edge of the print area the way a cell does. A line that ends on
         that edge, which a right aligned line does and a centred one of an odd
         width can, has no room behind its last cell and its spacing is cut to
         what fits. It cannot be cut where the spacing is written, in place():
         the alignment offset is only known here, once the extent of the line
         is. The two back-ends draw the field as it stands, so they agree. */

      if (operation.spacing > 0) {
        operation.spacing = Math.max(0, Math.min(operation.spacing, right - (x + item.width)));
      }

      return operation;
    });

    this.#append({type: 'line', y: 0, height, rotation: this.#rotation(), operations});
  }

  /**
     * Commit the pending line, then put operations on a line of their own,
     * aligned the way the current alignment says, and advance the paper by the
     * height of the block.
     *
     * @param  {number}     width        Width of the block in dots
     * @param  {number}     height       Height of the block in dots
     * @param  {object[]}   operations   What is in it, in the coordinates of the block
     * @param  {object}     [options]    `{margins: false}` to ignore the print area
     */
  #blockLine(width, height, operations, options) {
    const paper = options ? options.margins === false : false;

    if (this.#line.items.length) {
      this.lineFeed();
    } else {
      this.#line = this.#empty();
    }

    const offset = paper ?
      this.#offset(width, this.#surface()) :
      this.#left() + this.#offset(width);

    /* The rectangles and the images of a block are made by the methods above
       and carry no source of their own, so they take the one of the command
       that drew the block: the bars of a barcode, the cells of its human
       readable text and the dots of an image all point at the same token */

    const placed = operations.map((operation) => Object.assign({}, operation, {
      x: operation.x + offset,
      source: operation.source || this.#source,
    }));

    this.#append({type: 'line', y: 0, height, rotation: this.#rotation(), operations: placed});
  }

  /**
     * Put a printed page on the paper as one entry, the way a block goes on a
     * line of its own. A page carries its own positions, so nothing of the line
     * mode moves it.
     *
     * @param  {number}     height   Height of the page in dots
     * @param  {object[]}   areas    The print areas the page was composed of
     */
  #pageEntry(height, areas) {
    if (this.#line.items.length) {
      this.lineFeed();
    } else {
      this.#line = this.#empty();
    }

    this.#append({type: 'page', y: 0, height, areas});
  }

  /**
     * Emit a box at the position of the paper, remembering how far the paper
     * reached.
     *
     * In page mode the box does not reach the paper at all, it goes into the
     * print area of the page at the position inside it, in the coordinate
     * system of the print direction.
     *
     * @param  {object}   entry   The line or the page
     */
  #append(entry) {
    if (entry.height === 0) {
      return;
    }

    if (this.#page) {
      entry.y = this.#page.y;

      this.#current().entries.push(entry);

      this.#page.top = Math.min(this.#page.top, this.#page.y);
      this.#page.y += entry.height;
      this.#page.reach = Math.max(this.#page.reach, this.#page.y);

      return;
    }

    this.#open();

    entry.y = this.#position;

    if (entry.type === 'page') {
      this.#sink.page(entry);
    } else {
      this.#sink.line(entry);
    }

    this.#advance(entry.height);
  }

  /**
     * Emit rows the paper advanced without printing, an empty line or the gap
     * below a line
     *
     * @param  {number}   count   Number of rows
     */
  #appendBlank(count) {
    if (count <= 0) {
      return;
    }

    if (this.#page) {
      this.#current().entries.push({type: 'feed', y: this.#page.y, height: count, source: this.#source});

      this.#page.top = Math.min(this.#page.top, this.#page.y);
      this.#page.y += count;
      this.#page.reach = Math.max(this.#page.reach, this.#page.y);

      return;
    }

    this.#open();
    this.#sink.feed({type: 'feed', y: this.#position, height: count, source: this.#source});

    this.#advance(count);
  }

  /**
     * Move the paper on by a number of rows, remembering how far it reached:
     * the extent is the bottom of the paper, which a reverse feed does not move
     * back and which is where the paper is cut off
     *
     * @param  {number}   count   Number of rows the paper moved
     */
  #advance(count) {
    this.#position += count;
    this.#extent = Math.max(this.#extent, this.#position);
  }
}

export default LayoutEngine;
export {cellBaseline, GLYPH_BOXES};
