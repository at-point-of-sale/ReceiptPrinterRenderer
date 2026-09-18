import Bitmap from '../bitmap.js';
import Font from '../font.js';

/**
 * @typedef {import('../types.js').Bitmap} Bitmap
 * @typedef {import('../types.js').RenderItem} RenderItem
 * @typedef {import('../types.js').Layout} Layout
 * @typedef {import('../types.js').LineEntry} LineEntry
 * @typedef {import('../types.js').PageEntry} PageEntry
 * @typedef {import('../types.js').FeedEntry} FeedEntry
 * @typedef {import('../types.js').LineOperation} LineOperation
 * @typedef {import('../types.js').RasterizeOptions} RasterizeOptions
 * @typedef {import('../font.js').PackedFont} PackedFont
 */

/**
 * @typedef {object} BitmapBackendOptions
 * @property {number} width                        Width of the paper in dots, a multiple of 8
 * @property {string[]} [commands]                 Command types that may appear in the output
 * @property {number} [maxHeight]                  Maximum height of an image item, taller segments are split
 * @property {number} [feedThreshold]              Runs of blank rows at least this tall become feed items
 * @property {Object<string, PackedFont>} [font]   Font data, instead of the built in fonts
 * @property {number} [height]                     Height of the paper in dots, rows outside it are clipped
 * @property {number} [cutterDistance]             Distance between the cutter and the print head in dots
 */

/* The built in fonts the two printer fonts are drawn from. Font A is the 12x24
   font, font B is the 8x16 font, centred in whatever cell the profile gives it,
   which is 9x17 on Epson and 9x24 on Star */

const GLYPH_FONTS = {A: '12x24', B: '8x16'};

/* How much a growing row buffer allocates the first time */

const INITIAL_ROWS = 256;

/* The rotation the four print directions of page mode give the layout of a
   print area, see the pageDirection() of the layout engine */

const PAGE_ROTATIONS = [null, Bitmap.rotate90, Bitmap.rotate180, Bitmap.rotate270];

/* The version of the display list this back-end draws */

const VERSION = 1;

/**
 * The bitmap back-end draws the entries of the layout engine and cuts image
 * items from the rows they leave behind.
 *
 * It composes one bitmap per line box, of the width of the surface the line was
 * laid out on: the text cells are drawn from the packed font, the rectangles
 * are filled and the images are blitted, the box is turned when the entry says
 * so, and the rows are added to the paper at the position the entry carries. A
 * page is composed the same way, on a canvas per print area, turned by the
 * direction of the area and blitted into the page.
 *
 * It holds the paper of the boxes that were drawn and not flushed yet, from the
 * row of the list its first row stands on. A box at a position the paper
 * already reached is drawn over the rows that are there, with OR, the way a
 * second pass of the print head adds dots to the ones that are already on the
 * paper. A box in front of the rows it still holds cannot be drawn at all, the
 * paper of those rows has left the printer, and the layout engine never asks
 * for one: it clamps a reverse feed at the last command that took the paper
 * away, which is the same rule.
 */
class BitmapBackend {
  #width;
  #commands;
  #maxHeight;
  #feedThreshold;
  #height;
  #cutterDistance;

  #fonts;
  #cache;
  #serials;
  #serial;

  #buffer;
  #capacity;
  #rows;
  #origin;
  #blankRuns;
  #overprinted;

  #items;

  /**
     * Create a bitmap back-end
     *
     * @param  {BitmapBackendOptions}   options   How the output of this back-end looks
     */
  constructor(options) {
    const settings = options || {};

    if (!Number.isInteger(settings.width) || settings.width < 8 || settings.width % 8 !== 0) {
      throw new Error('Width must be a positive multiple of 8 dots');
    }

    this.#width = settings.width;
    this.#commands = new Set(settings.commands || []);
    this.#maxHeight = typeof settings.maxHeight === 'undefined' ? null : settings.maxHeight;
    this.#feedThreshold = typeof settings.feedThreshold === 'undefined' ? 24 : settings.feedThreshold;

    if (this.#maxHeight !== null && (!Number.isInteger(this.#maxHeight) || this.#maxHeight < 1)) {
      throw new Error('Maximum height must be a positive integer');
    }

    if (!Number.isInteger(this.#feedThreshold) || this.#feedThreshold < 1) {
      throw new Error('Feed threshold must be a positive integer');
    }

    /* The paper of a display list is its height, and an entry that reaches
       past it is clipped to it, which is what a piece of paper with a cut
       through a line needs: the rows below the cut belong to the next piece.
       A back-end that draws a stream has no such limit, the paper is as long
       as the stream prints */

    this.#height = typeof settings.height === 'undefined' || settings.height === null ?
      null :
      Math.max(0, settings.height);

    /* The rows between the cutter and the print head never leave at a command:
       they are the paper that stays in the printer and becomes the top of the
       next piece, whatever the command is, see command() */

    this.#cutterDistance = settings.cutterDistance || 0;

    /* The glyphs come from the built in fonts, unless an application supplied
       its own font data in the same packed format */

    this.#fonts = {
      A: settings.font ? new Font(settings.font[GLYPH_FONTS.A]) : Font.get(GLYPH_FONTS.A),
      B: settings.font ? new Font(settings.font[GLYPH_FONTS.B]) : Font.get(GLYPH_FONTS.B),
    };

    /* Cells repeat a lot on a receipt, so they are kept for as long as this
       back-end lives, which is as long as the renderer it belongs to. A glyph a
       stream downloaded has no name to be cached under, so every bitmap that
       comes past gets a serial number of its own */

    this.#cache = new Map();
    this.#serials = new WeakMap();
    this.#serial = 0;

    this.#items = [];

    this.#clear();
  }

  /**
     * Width of the paper in dots
     *
     * @return {number}   Width in dots
     */
  get width() {
    return this.#width;
  }

  /**
     * Draw a line box on the paper
     *
     * @param  {LineEntry}   entry   The line and its operations
     */
  line(entry) {
    const bitmap = this.#compose(entry, this.#width);

    this.#append(entry.y, entry.rotation === 180 ? Bitmap.rotate180(bitmap) : bitmap);
  }

  /**
     * Draw a printed page on the paper: every print area on a canvas of its
     * own, turned by the direction of the area and blitted into the page, and
     * the page on the paper as one block
     *
     * @param  {PageEntry}   entry   The page and its areas
     */
  page(entry) {
    let dots = null;

    for (const area of entry.areas || []) {
      const sideways = area.direction === 1 || area.direction === 3;
      const logical = sideways ?
        {width: area.height, height: area.width} :
        {width: area.width, height: area.height};

      const canvas = Bitmap.create(logical.width, logical.height);

      for (const box of area.entries || []) {
        if (box.type !== 'line') {
          continue;
        }

        const bitmap = this.#compose(box, logical.width);

        Bitmap.blit(box.rotation === 180 ? Bitmap.rotate180(bitmap) : bitmap, canvas, 0, box.y);
      }

      const rotate = PAGE_ROTATIONS[area.direction];
      const turned = rotate ? rotate(canvas) : canvas;

      const height = Math.max(area.y + turned.height, dots ? dots.height : 0);

      if (!dots || dots.height < height) {
        const grown = Bitmap.create(this.#width, height);

        if (dots) {
          Bitmap.blit(dots, grown, 0, 0);
        }

        dots = grown;
      }

      Bitmap.blit(turned, dots, area.x, area.y);
    }

    /* The page is as tall as the entry says, whatever its areas hold: an area
       that stayed empty still feeds the paper, the way a printer feeds it */

    const page = Bitmap.create(this.#width, entry.height);

    if (dots) {
      Bitmap.blit(dots, page, 0, 0);
    }

    this.#append(entry.y, page);
  }

  /**
     * Advance the paper without printing
     *
     * @param  {FeedEntry}   entry   The rows to advance
     */
  feed(entry) {
    this.#appendBlank(entry.y, entry.height);
  }

  /**
     * Handle a command.
     *
     * A command the driver supports flushes: the rows of the boxes that are on
     * the paper become image items, so that the command lands between them in
     * the output, the way it stands in the byte stream.
     *
     * A command the driver does not support is dropped and changes nothing, per
     * the fallback table in the design: the blank lines the encoder fed before
     * a cut are already in the image and stay in the image it belongs to, and a
     * pulse or an unknown command leaves nothing behind at all.
     *
     * @param  {object}   entry   The command and the row the paper is on
     */
  command(entry) {
    if (!this.#commands.has(entry.type)) {
      return;
    }

    /* The row the command stands on and the bytes it came from are fields of
       the display list, which says where everything of a stream is; the item
       stream is what a driver sends on, and it carries neither */

    const item = {type: entry.type};

    for (const key of Object.keys(entry)) {
      if (key !== 'type' && key !== 'y' && key !== 'source') {
        item[key] = entry[key];
      }
    }

    /* The rows in front of the command leave the printer, the rows behind it
       stay in it: a cut stands above the rows that were printed last, and those
       become the top of the next piece of paper. A cut stands at the row the
       paper is cut at, every other command at the row of the print head, and
       the cutter holds its distance of rows back at both, so that the cut that
       comes after a pulse still has them to leave behind. A command of a stream
       without a distance stands at the bottom of the paper and takes all of it */

    if (typeof entry.y !== 'number') {
      this.#flush(Infinity);
    } else {
      this.#flush(entry.type === 'cut' ? entry.y : entry.y - this.#cutterDistance);
    }

    this.#items.push(item);
  }

  /**
     * Finish the stream: flush the rows and return the items
     *
     * @return {RenderItem[]}   The items of this stream, in order
     */
  end() {
    this.#flush(Infinity);

    return this.#items;
  }

  /**
     * Throw away the rows and the items this back-end holds. The fonts and the
     * cells that were drawn are kept, they are as good for the next stream.
     */
  discard() {
    this.#items = [];

    this.#clear();
  }

  /**
     * Drop every row that was drawn but not flushed
     */
  #clear() {
    this.#buffer = new Uint8Array(Bitmap.rowBytes(this.#width) * INITIAL_ROWS);
    this.#capacity = INITIAL_ROWS;
    this.#rows = 0;
    this.#origin = 0;
    this.#blankRuns = [];
    this.#overprinted = false;
  }

  /**
     * Draw the operations of a line box into a bitmap of the width of the
     * surface it was laid out on, which clips what reaches past the edge the
     * way the paper clips it
     *
     * @param  {LineEntry}   entry   The line and its operations
     * @param  {number}      width   Width of the surface in dots
     * @return {Bitmap}              The line box
     */
  #compose(entry, width) {
    const bitmap = Bitmap.create(width, entry.height);

    for (const operation of entry.operations || []) {
      if (operation.type === 'text') {
        Bitmap.blit(this.#cell(operation), bitmap, operation.x, operation.y);
        this.#spacing(bitmap, operation);
        continue;
      }

      if (operation.type === 'image') {
        Bitmap.blit(
            {width: operation.width, height: operation.height, data: operation.data},
            bitmap,
            operation.x,
            operation.y,
        );

        continue;
      }

      if (operation.type === 'rect') {
        this.#fill(bitmap, operation);
      }
    }

    return bitmap;
  }

  /**
     * The right side character spacing behind a cell, drawn next to the cell
     * and not in it: the reverse of the cell covers it and so does the
     * underline, which is what an Epson prints, while the gaps HT, ESC $ and
     * ESC \\ skip carry no spacing at all and stay white.
     *
     * The cell itself is cached, the spacing is not part of it: two cells of
     * the same character in the same style are one bitmap whatever spacing
     * follows them. The rules are the ones of Font.renderGlyph: no line under a
     * reverse or a turned cell, the thickness in paper dots and not scaled,
     * along the bottom rows of the box for the underline and the top rows for
     * the upperline. The dots are clipped by the line the way a cell is,
     * because they are drawn with setPixel, and the print area of the line,
     * which is narrower than the paper when a margin is set, was applied by the
     * layout when it wrote the field.
     *
     * @param  {Bitmap}          bitmap      The line box to draw on
     * @param  {LineOperation}   operation   The text operation
     */
  #spacing(bitmap, operation) {
    const spacing = operation.spacing || 0;

    if (spacing <= 0) {
      return;
    }

    const style = operation.style || {};
    const x = operation.x + operation.width;

    if (style.invert) {
      this.#fill(bitmap, {x, y: operation.y, width: spacing, height: operation.height});
      return;
    }

    if (operation.rotation === 90) {
      return;
    }

    const upperline = Math.min(style.upperline || 0, operation.height);

    if (upperline > 0) {
      this.#fill(bitmap, {x, y: operation.y, width: spacing, height: upperline});
    }

    const underline = Math.min(style.underline || 0, operation.height);

    if (underline > 0) {
      this.#fill(bitmap, {
        x,
        y: operation.y + operation.height - underline,
        width: spacing,
        height: underline,
      });
    }
  }

  /**
     * Fill a rectangle with black
     *
     * @param  {Bitmap}          bitmap      The bitmap to draw on
     * @param  {LineOperation}   operation   The rectangle
     */
  #fill(bitmap, operation) {
    const right = operation.x + operation.width;
    const bottom = operation.y + operation.height;

    for (let y = operation.y; y < bottom; y++) {
      for (let x = operation.x; x < right; x++) {
        Bitmap.setPixel(bitmap, x, y, 1);
      }
    }
  }

  /**
     * The cell of a text operation, drawn from the packed font in the style,
     * the size and the rotation the operation carries. Cells repeat a lot on a
     * receipt, so they are kept, and this back-end only ever reads from them.
     *
     * @param  {LineOperation}   operation   The text operation
     * @return {Bitmap}                      The cell
     */
  #cell(operation) {
    const key = this.#key(operation);

    if (this.#cache.has(key)) {
      return this.#cache.get(key);
    }

    const font = this.#fonts[operation.font] || this.#fonts.A;
    const cell = operation.bitmap ? this.#glyphCell(font, operation) : font.renderGlyph(
        font.lookup(operation.codepoint),
        {
          cellWidth: operation.cell.width,
          cellHeight: operation.cell.height,
          widthMultiplier: operation.scale.x,
          heightMultiplier: operation.scale.y,
          bold: operation.style.bold,
          underline: operation.style.underline,
          upperline: operation.style.upperline || 0,
          invert: operation.style.invert,
          rotate: operation.rotation === 90,
          stretch: Font.isBoxDrawing(operation.codepoint),
        },
    );

    this.#cache.set(key, cell);

    return cell;
  }

  /**
     * The cell of a glyph a stream downloaded. The dots go in the top left
     * corner of a cell of the font, which is then drawn by the font itself, so
     * that a downloaded glyph is scaled, overstruck, underlined and inverted
     * exactly as a built in one is.
     *
     * @param  {Font}            font        The font of the cell
     * @param  {LineOperation}   operation   The text operation
     * @return {Bitmap}                      The cell
     */
  #glyphCell(font, operation) {
    /* A glyph that is narrower or shorter than the cell is placed at its top
       left corner, and one that is larger is clipped by it: the cell of the
       font is what a character takes on the line, whatever the stream defined */

    const glyph = Bitmap.create(operation.cell.width, operation.cell.height);

    Bitmap.blit(operation.bitmap, glyph, 0, 0);

    /* The glyph is as tall as the cell it is drawn in, so its own baseline is
       the baseline of that cell and its dots keep the corner they were put in */

    return font.renderGlyph(glyph, {
      cellWidth: glyph.width,
      cellHeight: glyph.height,
      baseline: font.cellBaseline(glyph.height),
      widthMultiplier: operation.scale.x,
      heightMultiplier: operation.scale.y,
      bold: operation.style.bold,
      underline: operation.style.underline,
      upperline: operation.style.upperline || 0,
      invert: operation.style.invert,
      rotate: operation.rotation === 90,
    });
  }

  /**
     * The key a cell is cached under, which is everything that changes a dot of
     * it: the font and the cell, what is drawn in it, and the style and the
     * size it is drawn at. A glyph a stream downloaded is a bitmap and has no
     * name, so it is cached under a serial number of its own.
     *
     * @param  {LineOperation}   operation   The text operation
     * @return {string}                      The key
     */
  #key(operation) {
    const style = operation.style;
    const shape = `${style.bold ? 1 : 0}${style.underline}${style.upperline || 0}` +
      `${style.invert ? 1 : 0}${operation.rotation === 90 ? 1 : 0}` +
      `|${operation.scale.x}x${operation.scale.y}|${operation.cell.width}x${operation.cell.height}`;

    if (!operation.bitmap) {
      return `${operation.font}|${operation.codepoint}|${shape}`;
    }

    if (!this.#serials.has(operation.bitmap)) {
      this.#serial++;
      this.#serials.set(operation.bitmap, this.#serial);
    }

    return `U|${operation.font}|${this.#serials.get(operation.bitmap)}|${shape}`;
  }

  /**
     * Make room for a number of rows in the buffer, doubling it when it is full
     *
     * @param  {number}   rows   Number of rows the buffer must hold
     */
  #reserve(rows) {
    if (rows <= this.#capacity) {
      return;
    }

    let capacity = this.#capacity;

    while (capacity < rows) {
      capacity *= 2;
    }

    const buffer = new Uint8Array(Bitmap.rowBytes(this.#width) * capacity);

    buffer.set(this.#buffer.subarray(0, Bitmap.rowBytes(this.#width) * this.#rows));

    this.#buffer = buffer;
    this.#capacity = capacity;
  }

  /**
     * Append the rows of a bitmap of the full paper width at a row of the list,
     * remembering which of them are blank, so that flushing does not need a
     * second pass.
     *
     * A row beyond the rows the buffer holds is written and extends the paper.
     * A row inside them is a row a reverse feed moved the paper back over, so
     * it is drawn over with OR, the way a second pass of the print head adds
     * dots to the ones that are already there, and the blank runs are rescanned
     * at the flush because a row that was blank may not be blank any more.
     *
     * @param  {number}   y        Row of the paper the bitmap starts on
     * @param  {Bitmap}   bitmap   The rows to append
     */
  #append(y, bitmap) {
    if (bitmap.height === 0) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);
    const start = y - this.#origin;
    const bottom = this.#bottom();

    if (start >= bottom) {
      return;
    }

    this.#skip(start);
    this.#reserve(Math.max(0, Math.min(start + bitmap.height, bottom)));

    for (let row = Math.max(0, -start); row < bitmap.height && start + row < bottom; row++) {
      const target = start + row;
      const offset = target * rowBytes;
      const source = bitmap.data.subarray(row * rowBytes, (row + 1) * rowBytes);

      if (target < this.#rows) {
        for (let byte = 0; byte < rowBytes; byte++) {
          this.#buffer[offset + byte] |= source[byte];
        }

        this.#overprinted = true;
        continue;
      }

      this.#buffer.set(source, offset);

      let blank = true;

      for (let byte = 0; byte < rowBytes; byte++) {
        if (this.#buffer[offset + byte] !== 0) {
          blank = false;
          break;
        }
      }

      if (blank) {
        this.#markBlank(target);
      }
    }

    this.#rows = Math.max(this.#rows, Math.min(start + bitmap.height, bottom));
  }

  /**
     * Append rows that are white by construction, an empty line or the gap
     * below a line, without looking at them. White over a row the paper moved
     * back over changes nothing, so those rows are stepped over rather than
     * cleared.
     *
     * @param  {number}   y       Row of the paper the rows start on
     * @param  {number}   count   Number of rows to append
     */
  #appendBlank(y, count) {
    if (count <= 0) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);
    const start = y - this.#origin;
    const bottom = this.#bottom();

    if (start >= bottom) {
      return;
    }

    this.#skip(start);
    this.#reserve(Math.max(0, Math.min(start + count, bottom)));

    for (let row = Math.max(0, -start); row < count && start + row < bottom; row++) {
      const target = start + row;

      if (target < this.#rows) {
        continue;
      }

      this.#buffer.fill(0, target * rowBytes, (target + 1) * rowBytes);
      this.#markBlank(target);
    }

    this.#rows = Math.max(this.#rows, Math.min(start + count, bottom));
  }

  /**
     * Fill the rows between the paper and a position that lies beyond it with
     * white. The layout engine never leaves a gap, its position moves box by
     * box, but a display list that was built by hand can.
     *
     * @param  {number}   row   Row of the buffer something is drawn at
     */
  #skip(row) {
    const limit = Math.min(row, this.#bottom());

    if (limit <= this.#rows) {
      return;
    }

    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#reserve(limit);

    while (this.#rows < limit) {
      this.#buffer.fill(0, this.#rows * rowBytes, (this.#rows + 1) * rowBytes);
      this.#markBlank(this.#rows);
      this.#rows++;
    }
  }

  /**
     * The row of the buffer the paper ends at: the height of the list this
     * back-end draws, counted from the rows it holds, and no limit at all when
     * it draws a stream
     *
     * @return {number}   The first row that is not on the paper any more
     */
  #bottom() {
    return this.#height === null ? Infinity : this.#height - this.#origin;
  }

  /**
     * Record that a row is blank, extending the run it belongs to
     *
     * @param  {number}   row   The row that is blank
     */
  #markBlank(row) {
    const last = this.#blankRuns[this.#blankRuns.length - 1];

    if (last && last.end === row) {
      last.end = row + 1;
      return;
    }

    this.#blankRuns.push({start: row, end: row + 1});
  }

  /**
     * Work out the blank runs of the whole buffer again. A reverse feed draws
     * ink over rows that were recorded as blank when they were appended, and
     * the runs of those rows are the only thing this back-end cannot fix up
     * while it draws, so they are counted once, at the flush that reads them.
     */
  #rescan() {
    const rowBytes = Bitmap.rowBytes(this.#width);

    this.#blankRuns = [];

    for (let row = 0; row < this.#rows; row++) {
      const offset = row * rowBytes;

      let blank = true;

      for (let byte = 0; byte < rowBytes; byte++) {
        if (this.#buffer[offset + byte] !== 0) {
          blank = false;
          break;
        }
      }

      if (blank) {
        this.#markBlank(row);
      }
    }
  }

  /**
     * Emit the rows between two positions as image items, splitting them into
     * pieces of at most maxHeight. An image item is never empty.
     *
     * @param  {number}   start   First row
     * @param  {number}   end     Row after the last one
     */
  #emit(start, end) {
    const rowBytes = Bitmap.rowBytes(this.#width);
    const limit = this.#maxHeight || (end - start);

    for (let y = start; y < end; y += limit) {
      const height = Math.min(limit, end - y);

      this.#items.push({
        type: 'image',
        width: this.#width,
        height,
        data: this.#buffer.slice(y * rowBytes, (y + height) * rowBytes),
      });
    }
  }

  /**
     * Turn the rows that were drawn into items and empty the buffer, up to a
     * row of the paper: everything in front of that row becomes items and
     * everything behind it stays in the buffer, for the paper that is still in
     * the printer. `Infinity` takes every row there is, which is what a flush
     * without a cutter distance does, since a command then stands at the bottom
     * of the paper.
     *
     * Runs of blank rows of at least feedThreshold dots become feed items and
     * split the image around them, but only when the driver supports feed,
     * otherwise they stay in the image as white rows. A run the flush cuts
     * through counts as the part of it that leaves.
     *
     * @param  {number}   limit   Row of the paper the rows are taken up to
     */
  #flush(limit) {
    if (this.#rows === 0) {
      this.#blankRuns = [];
      this.#overprinted = false;
      return;
    }

    const upto = limit === Infinity ?
      this.#rows :
      Math.max(0, Math.min(this.#rows, limit - this.#origin));

    if (this.#overprinted) {
      this.#rescan();
    }

    let emitted = 0;

    if (this.#commands.has('feed')) {
      for (const run of this.#blankRuns) {
        if (run.start >= upto) {
          break;
        }

        const end = Math.min(run.end, upto);

        if (end - run.start < this.#feedThreshold) {
          continue;
        }

        this.#emit(emitted, run.start);
        this.#items.push({type: 'feed', height: end - run.start});

        emitted = end;
      }
    }

    this.#emit(emitted, upto);

    this.#keep(upto);
  }

  /**
     * Drop the rows that were flushed and keep the ones behind them, which move
     * to the top of the buffer: the paper that is still in the printer, between
     * the cutter and the print head
     *
     * @param  {number}   flushed   Number of rows that left
     */
  #keep(flushed) {
    const kept = this.#rows - flushed;

    if (kept > 0) {
      const rowBytes = Bitmap.rowBytes(this.#width);

      this.#buffer.copyWithin(0, flushed * rowBytes, this.#rows * rowBytes);
    }

    this.#origin += flushed;
    this.#rows = kept;
    this.#blankRuns = [];
    this.#overprinted = false;

    if (kept > 0) {
      this.#rescan();
    }
  }
}

/**
 * Draw a display list and return the items a render of the same commands
 * returns. The entries are drawn in the order they stand in, which is the order
 * a printer prints them.
 *
 * The paper of a list is its height, and the rows of an entry that lie above
 * row 0 or below the height are not on it and are not drawn: that is what a
 * piece of `pieces()` with a cut through a line needs, where the entry stands
 * on both pieces and each draws the rows it holds.
 *
 * @param  {Layout}             layout      The display list, as layout() returned it
 * @param  {RasterizeOptions}   [options]   How the output looks
 * @return {RenderItem[]}                   The items, see the output contract in design.md
 */
function rasterize(layout, options) {
  if (!layout || typeof layout !== 'object') {
    throw new Error('A display list is required');
  }

  if (layout.version !== VERSION) {
    throw new Error(`Display list version ${layout.version} is not supported, this is version ${VERSION}`);
  }

  const settings = options || {};

  const backend = new BitmapBackend({
    width: layout.width,
    commands: settings.commands,
    maxHeight: settings.maxHeight,
    feedThreshold: settings.feedThreshold,
    font: settings.font,
    height: typeof layout.height === 'number' ? layout.height : null,
    cutterDistance: layout.cutterDistance,
  });

  for (const entry of layout.entries || []) {
    if (entry.type === 'line') {
      backend.line(entry);
    } else if (entry.type === 'page') {
      backend.page(entry);
    } else if (entry.type === 'feed') {
      backend.feed(entry);
    } else {
      backend.command(entry);
    }
  }

  return backend.end();
}

export default BitmapBackend;
export {BitmapBackend, rasterize, VERSION};
