import LayoutEngine from './layout.js';
import BitmapBackend from './backends/bitmap.js';
import Collector from './backends/collector.js';

/**
 * @typedef {import('./types.js').Bitmap} Bitmap
 * @typedef {import('./types.js').Layout} Layout
 * @typedef {import('./types.js').Source} Source
 * @typedef {import('./types.js').RenderItem} RenderItem
 * @typedef {import('./types.js').RenderLanguage} RenderLanguage
 * @typedef {import('./font.js').PackedFont} PackedFont
 * @typedef {import('./layout.js').CellSize} CellSize
 * @typedef {import('./layout.js').Profile} Profile
 * @typedef {import('./layout.js').Style} Style
 * @typedef {import('./layout.js').Margins} Margins
 * @typedef {import('./layout.js').PrintArea} PrintArea
 * @typedef {import('./layout.js').BarcodeRequest} BarcodeRequest
 * @typedef {import('./layout.js').QrcodeRequest} QrcodeRequest
 * @typedef {import('./layout.js').Pdf417Request} Pdf417Request
 * @typedef {import('./layout.js').PrintRequest} PrintRequest
 * @typedef {import('./layout.js').PrintPageRequest} PrintPageRequest
 * @typedef {import('./layout.js').PageVerticalRequest} PageVerticalRequest
 * @typedef {import('./layout.js').GlyphRequest} GlyphRequest
 */

/**
 * @typedef {object} PainterOptions
 * @property {number} width                   Width of the print area in dots, a multiple of 8
 * @property {Profile} profile                Printer family defaults
 * @property {string[]} [commands]            Command types that may appear in the output
 * @property {number} [maxHeight]             Maximum height of an image item, taller segments are split
 * @property {number} [lineSpacing]           Default line spacing in dots, defaults to the profile
 * @property {number} [feedThreshold]         Runs of blank rows at least this tall become feed items
 * @property {Object<string, PackedFont>} [font]   Font data, instead of the built in fonts
 * @property {RenderLanguage} [language]      Language of the commands, which the display list reports
 */

/*
    The painter is the wiring of the two halves of a render.

    The layout engine of src/layout.js keeps the state of the printer and emits
    the boxes of the paper, the line boxes with their operations, the pages with
    their print areas, the feeds and the commands. A sink takes them: the bitmap
    back-end of src/backends/bitmap.js draws them and cuts image items from the
    rows, and the collector of src/backends/collector.js keeps them as the
    display list. The engine holds the memory of the printer, the kept images
    and the downloaded glyphs, so it lives as long as the renderer does and only
    the sink is attached per stream.

    The parsers of both languages talk to this class, which is the interface the
    implementation plan describes, so the split changed nothing they see.
*/

/**
 * The painter: a layout engine and the sink its entries go to
 */
class Painter {
  #engine;
  #backend;
  #collecting;
  #language;

  /**
     * Create a painter
     *
     * @param  {PainterOptions}   options   How the printer this painter emulates behaves
     */
  constructor(options) {
    const settings = options || {};

    /* The commands the driver supports reach both halves: the engine, because a
       cut the printer performs takes the paper in front of it away and a
       reverse feed cannot reach past it, and the back-end, because the same
       commands are the ones that flush and reach the item stream */

    this.#engine = new LayoutEngine({
      width: settings.width,
      profile: settings.profile,
      lineSpacing: settings.lineSpacing,
      commands: settings.commands,
    });

    this.#backend = new BitmapBackend({
      width: settings.width,
      commands: settings.commands,
      maxHeight: settings.maxHeight,
      feedThreshold: settings.feedThreshold,
      font: settings.font,
    });

    this.#language = settings.language;
    this.#collecting = false;

    this.#engine.attach(this.#backend);
  }

  /**
     * The printer profile this painter uses
     *
     * @return {Profile}   The profile
     */
  get profile() {
    return this.#engine.profile;
  }

  /**
     * Width of the print area in dots
     *
     * @return {number}   Width in dots
     */
  get width() {
    return this.#engine.width;
  }

  /**
     * Number of font A characters that fit on a line
     *
     * @return {number}   Number of columns
     */
  get columns() {
    return this.#engine.columns;
  }

  /**
     * Width of one character of the current font in dots, which is what the
     * margins and the tab stops of the Star commands are counted in
     *
     * @return {number}   Width of a cell in dots
     */
  get characterWidth() {
    return this.#engine.characterWidth;
  }

  /**
     * Where the next cell goes, in dots from the left margin
     *
     * @return {number}   Position of the cursor
     */
  get cursor() {
    return this.#engine.cursor;
  }

  /**
     * Whether the painter is composing a page instead of the paper
     *
     * @return {boolean}   True in page mode
     */
  get pageMode() {
    return this.#engine.pageMode;
  }

  /**
     * Collect the display list of the next stream instead of drawing it. The
     * engine is the same one, with the same kept images and the same downloaded
     * glyphs, so a layout is the render of the same stream without the dots.
     * `end()` returns the list, and the painter draws again afterwards.
     */
  collect() {
    this.#collecting = true;

    this.#engine.attach(new Collector({
      language: this.#language,
      width: this.#engine.width,
      dpi: this.#engine.dpi,
    }));
  }

  /**
     * Initialize the printer state: styles, font, alignment and line spacing.
     * The rows that were already committed and the items that were already
     * emitted are kept, which is what ESC @ does on a real printer.
     */
  reset() {
    this.#engine.reset();
  }

  /**
     * The bytes of the stream the calls that follow come from, which the
     * parser sets to the token it is handling
     *
     * @param  {Source|null}   range   The range of the token, null for none
     */
  source(range) {
    this.#engine.source(range);
  }

  /**
     * Append text to the current line, one cell per character, in the current
     * style
     *
     * @param  {string}     value       The text to print
     * @param  {Source[]}   [sources]   The bytes of every character, the current source when left out
     */
  text(value, sources) {
    this.#engine.text(value, sources);
  }

  /**
     * Append cells of the fallback glyph, which is what a multibyte character
     * becomes on a printer without the font for it
     *
     * @param  {number}   count   Number of cells to draw
     */
  placeholder(count) {
    this.#engine.placeholder(count);
  }

  /**
     * Keep the glyph a stream downloaded for a character code, or cancel it
     * again with a bitmap of null
     *
     * @param  {number}         code       The character code the glyph belongs to
     * @param  {Bitmap|null}    bitmap     The dots of the glyph, or null to cancel the definition
     * @param  {GlyphRequest}   [options]  Which set the glyph belongs to
     */
  defineGlyph(code, bitmap, options) {
    this.#engine.defineGlyph(code, bitmap, options);
  }

  /**
     * Whether a character code has a glyph a stream downloaded
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set to look in
     * @return {boolean}                    True when the set holds a glyph for it
     */
  hasGlyph(code, options) {
    return this.#engine.hasGlyph(code, options);
  }

  /**
     * Append the glyph a stream downloaded for a character code
     *
     * @param  {number}         code        The character code
     * @param  {GlyphRequest}   [options]   Which set the glyph belongs to
     * @return {boolean}                    True when the set held a glyph and it was placed
     */
  glyph(code, options) {
    return this.#engine.glyph(code, options);
  }

  /**
     * Change one or more style properties
     *
     * @param  {Partial<Style>}   changes   The properties to change
     */
  style(changes) {
    this.#engine.style(changes);
  }

  /**
     * Change the space that follows every cell, which ESC SP sets
     *
     * @param  {number}   dots   Extra dots after every cell
     */
  spacing(dots) {
    this.#engine.spacing(dots);
  }

  /**
     * Move the cursor to an absolute position on the line
     *
     * @param  {number}   dots   Position in dots from the left margin
     */
  position(dots) {
    this.#engine.position(dots);
  }

  /**
     * Set the tab stops, in characters of the current font
     *
     * @param  {number[]|null}   columns   The stops in characters, [] for none, null for the defaults
     */
  tabs(columns) {
    this.#engine.tabs(columns);
  }

  /**
     * Move the cursor to the next tab stop
     */
  tab() {
    this.#engine.tab();
  }

  /**
     * Set the left margin and the width of the print area, both in dots
     *
     * @param  {Margins}   changes   The margins to change, the others keep their value
     */
  margins(changes) {
    this.#engine.margins(changes);
  }

  /**
     * Change the font
     *
     * @param  {string}   name   'A' or 'B'
     */
  font(name) {
    this.#engine.font(name);
  }

  /**
     * Change the alignment, which is applied when the line is committed
     *
     * @param  {string}   value   'left', 'center' or 'right'
     */
  align(value) {
    this.#engine.align(value);
  }

  /**
     * Change the line spacing
     *
     * @param  {number|null}   dots   Line spacing in dots, null restores the default
     */
  lineSpacing(dots) {
    this.#engine.lineSpacing(dots);
  }

  /**
     * Commit the current line and advance the paper
     *
     * @param  {number}   [count]   Number of lines to advance, ESC d n feeds more than one
     */
  lineFeed(count = 1) {
    this.#engine.lineFeed(count);
  }

  /**
     * Commit the current line and advance the paper by a number of dot rows
     *
     * @param  {number}   dots   Number of dot rows to advance
     */
  feed(dots) {
    this.#engine.feed(dots);
  }

  /**
     * Commit the current line and move the paper back by a number of dot rows
     *
     * @param  {number}   dots   Number of dot rows to move back
     */
  reverseFeed(dots) {
    this.#engine.reverseFeed(dots);
  }

  /**
     * Commit the current line and move the paper back by a number of lines
     *
     * @param  {number}   [count]   Number of lines to move back
     */
  reverseLineFeed(count = 1) {
    this.#engine.reverseLineFeed(count);
  }

  /**
     * Throw away the line that is being composed, without advancing the paper
     */
  cancel() {
    this.#engine.cancel();
  }

  /**
     * Enter page mode, or leave it and throw the page away
     *
     * @param  {boolean}   enabled   True to enter page mode, false to leave it
     */
  page(enabled) {
    this.#engine.page(enabled);
  }

  /**
     * Set the print area of the page, in dots on the page
     *
     * @param  {PrintArea}   area   The print area
     */
  pageArea(area) {
    this.#engine.pageArea(area);
  }

  /**
     * Set the print direction of page mode
     *
     * @param  {number}   direction   0, 1, 2 or 3
     */
  pageDirection(direction) {
    this.#engine.pageDirection(direction);
  }

  /**
     * Move the position along the vertical axis of the print direction
     *
     * @param  {number}                 dots        The distance in dots
     * @param  {PageVerticalRequest}    [options]   `{relative: true}` to count from the position
     */
  pageVertical(dots, options) {
    this.#engine.pageVertical(dots, options);
  }

  /**
     * Throw the dots of the page away and keep the print area
     */
  cancelPage() {
    this.#engine.cancelPage();
  }

  /**
     * Draw the page on the paper as one block and move the paper on by its
     * height
     *
     * @param  {PrintPageRequest}   [options]   How the page is printed
     */
  printPage(options) {
    this.#engine.printPage(options);
  }

  /**
     * Place a bitmap in the current line, at the cursor, as if it were one wide
     * cell
     *
     * @param  {Bitmap}   bitmap   The strip to place
     */
  strip(bitmap) {
    this.#engine.strip(bitmap);
  }

  /**
     * Commit the pending line, then draw a bitmap on a line of its own
     *
     * @param  {Bitmap}   bitmap      The block to draw
     * @param  {object}   [options]   `{margins: false}` to ignore the print area
     */
  block(bitmap, options) {
    this.#engine.block(bitmap, options);
  }

  /**
     * Keep an image for later, under a key of the parser's own making
     *
     * @param  {string}        key      Name of the image
     * @param  {Bitmap|null}   bitmap   The image, or null to delete it
     */
  define(key, bitmap) {
    this.#engine.define(key, bitmap);
  }

  /**
     * Delete every image whose key starts with a prefix
     *
     * @param  {string}   prefix   The start of the keys to delete
     */
  forget(prefix) {
    this.#engine.forget(prefix);
  }

  /**
     * Draw an image that was kept as a block, scaled by repeating its dots
     *
     * @param  {string}         key         Name of the image
     * @param  {PrintRequest}   [options]   How the image is scaled
     * @return {boolean}                    True when the image was drawn
     */
  print(key, options) {
    return this.#engine.print(key, options);
  }

  /**
     * Draw a one dimensional barcode as a block, with its human readable text
     * above it, below it, or not at all
     *
     * @param  {BarcodeRequest}   request   The barcode to draw
     * @return {boolean}                    False when the data is not valid for the symbology
     */
  barcode(request) {
    return this.#engine.barcode(request);
  }

  /**
     * Draw a QR code as a block
     *
     * @param  {QrcodeRequest}   request   The QR code to draw
     */
  qrcode(request) {
    this.#engine.qrcode(request);
  }

  /**
     * Draw a PDF417 symbol as a block
     *
     * @param  {Pdf417Request}   request   The symbol to draw
     */
  pdf417(request) {
    this.#engine.pdf417(request);
  }

  /**
     * Handle a command, cut, pulse or unknown
     *
     * @param  {object}   item   The item to emit
     */
  command(item) {
    this.#engine.command(item);
  }

  /**
     * Finish the stream: throw away the line that is still being composed,
     * flush the rows and return the items, or the display list when the stream
     * was collected. The painter is empty and initialized afterwards, ready for
     * another stream, with the options it was built with.
     *
     * @return {RenderItem[]|Layout}   The items of this stream, or its display list
     */
  end() {
    const result = this.#engine.end();

    this.#draw();

    return result;
  }

  /**
     * Throw away everything this painter holds: the items that were not
     * returned yet, the rows that were not flushed, and the state. A renderer
     * uses it to make sure a stream that failed halfway leaves nothing behind
     * for the next one.
     */
  discard() {
    this.#engine.discard();

    this.#draw();
  }

  /**
     * Draw the next stream again, after one that was collected
     */
  #draw() {
    if (!this.#collecting) {
      return;
    }

    this.#collecting = false;

    this.#engine.attach(this.#backend);
  }
}

export default Painter;
