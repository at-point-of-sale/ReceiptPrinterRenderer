/*
    Public types.

    The typedefs in this module are the contract between the renderers and the
    printer drivers that use them, see documentation/design.md. They live in
    their own module so that every module of the package refers to the same
    definition and the bundled declarations contain each type once.

    This module has no runtime code.
*/

/**
 * @typedef {import('./layout.js').CellSize} CellSize
 * @typedef {import('./layout.js').Profile} Profile
 * @typedef {import('./font.js').PackedFont} PackedFont
 */

/**
 * A 1-bit image. One bit per pixel, most significant bit first, every row
 * padded to a whole number of bytes, a set bit is a black dot.
 *
 * @typedef {object} Bitmap
 * @property {number} width      Width in dots
 * @property {number} height     Height in dots
 * @property {Uint8Array} data   Packed rows, Math.ceil(width / 8) bytes per row
 */

/**
 * The bytes of the stream something came from: the byte that printed a cell of
 * text, or the command token that drew a block. The offsets are counted in the
 * stream that was given to layout(), and nothing of the stream itself is kept.
 *
 * @typedef {object} Source
 * @property {number} offset   Position of the first byte in the stream
 * @property {number} length   Number of bytes, at least one
 */

/**
 * A rendered segment of the receipt
 *
 * @typedef {object} ImageItem
 * @property {'image'} type
 * @property {number} width      Width in dots
 * @property {number} height     Height in dots
 * @property {Uint8Array} data   Packed rows, Math.ceil(width / 8) bytes per row
 */

/**
 * Cut the paper here
 *
 * @typedef {object} CutItem
 * @property {'cut'} type
 * @property {'full' | 'partial'} value
 */

/**
 * Open the cash drawer
 *
 * @typedef {object} PulseItem
 * @property {'pulse'} type
 * @property {number} device   0 or 1
 * @property {number} on       Pulse on time in milliseconds
 * @property {number} off      Pulse off time in milliseconds
 */

/**
 * Advance the paper without printing
 *
 * @typedef {object} FeedItem
 * @property {'feed'} type
 * @property {number} height   Number of blank dot rows
 */

/**
 * A command that was not understood, for diagnostics
 *
 * @typedef {object} UnknownItem
 * @property {'unknown'} type
 * @property {Uint8Array} data   The bytes of the command that was not understood
 */

/** @typedef {ImageItem | CutItem | PulseItem | FeedItem | UnknownItem} RenderItem */

/** @typedef {'cut' | 'pulse' | 'feed' | 'unknown'} RenderCommand */

/** @typedef {'esc-pos' | 'star-prnt' | 'star-line' | 'star-graphics'} RenderLanguage */

/**
 * @typedef {object} RendererOptions
 * @property {number} width                              Width of the print area in dots, a multiple of 8
 * @property {string} [codepageMapping]                  Codepage mapping the commands were encoded with, per language
 * @property {RenderCommand[]} [commands]                Command types that appear in the output, the rest is dropped
 * @property {number} [maxHeight]                        Maximum height of an image item, taller segments are split
 * @property {number} [lineSpacing]                      Default line spacing in dots, defaults to the profile
 * @property {string|Profile} [profile]                  Printer family defaults, a name or a profile, per language
 * @property {number} [feedThreshold]                    Runs of blank rows at least this tall become feed items
 * @property {Object<string, PackedFont>} [font]         Font data, in the packed format of the built in fonts
 */

/**
 * The options of the unified renderer: the options of a renderer, plus the
 * language of the commands it is given
 *
 * @typedef {RendererOptions & {language?: RenderLanguage}} ReceiptPrinterRendererOptions
 */

/**
 * The display list of a stream: what a printer prints, where it prints it, and
 * nothing about how the dots are made. See documentation/display-list.md.
 *
 * @typedef {object} Layout
 * @property {number} version               Version of the format, 1
 * @property {RenderLanguage} language      Language of the commands the list was made from
 * @property {number} width                 Width of the paper in dots
 * @property {number} height                Height of the paper in dots, from its first row to its last
 * @property {number} dpi                   Resolution of the printer in dots per inch
 * @property {LayoutEntry[]} entries        The entries, in stream order, which is draw order
 */

/** @typedef {LineEntry | PageEntry | FeedEntry | CutEntry | PulseEntry | UnknownEntry} LayoutEntry */

/**
 * A line box: a text line, or a block on a line of its own. It spans the width
 * of the surface it was laid out on.
 *
 * @typedef {object} LineEntry
 * @property {'line'} type
 * @property {number} y                        Row of the paper the line starts on
 * @property {number} height                   Height of the line box in dots
 * @property {number} rotation                 0, or 180 for the upside down printing of ESC {
 * @property {LineOperation[]} operations      What is on the line, in draw order
 */

/**
 * A page of page mode as it reaches the paper, one block of the paper width
 *
 * @typedef {object} PageEntry
 * @property {'page'} type
 * @property {number} y              Row of the paper the page starts on
 * @property {number} height         Height of the page in dots
 * @property {PageArea[]} areas      The print areas it was composed of, in the order the stream set them
 */

/**
 * A print area of a page, with what was laid out in it in the logical frame of
 * its print direction
 *
 * @typedef {object} PageArea
 * @property {number} x                                  Left edge of the area, from the left of the page
 * @property {number} y                                  Top of the area, from the top of the page
 * @property {number} width                              Width of the area in dots
 * @property {number} height                             Height of the area in dots
 * @property {number} direction                          Print direction, 0 to 3
 * @property {(LineEntry | FeedEntry)[]} entries         What was laid out in it, in the logical frame
 */

/**
 * Rows the paper advanced without printing
 *
 * @typedef {object} FeedEntry
 * @property {'feed'} type
 * @property {number} y        Row of the paper the feed starts on
 * @property {number} height   Number of rows
 * @property {Source} source   The command that fed, or the line feed of an empty line
 */

/**
 * The paper is cut between row `y - 1` and row `y`
 *
 * @typedef {object} CutEntry
 * @property {'cut'} type
 * @property {number} y
 * @property {'full' | 'partial'} value
 * @property {Source} source   The command that cut the paper
 */

/**
 * The drawer opens when the paper is at row `y`
 *
 * @typedef {object} PulseEntry
 * @property {'pulse'} type
 * @property {number} y
 * @property {number} device   0 or 1
 * @property {number} on       Pulse on time in milliseconds
 * @property {number} off      Pulse off time in milliseconds
 * @property {Source} source   The command that opened the drawer
 */

/**
 * A command that was not understood, with a copy of its bytes
 *
 * @typedef {object} UnknownEntry
 * @property {'unknown'} type
 * @property {number} y
 * @property {Uint8Array} data
 * @property {Source} source   The command that was not understood
 */

/** @typedef {TextOperation | RectOperation | ImageOperation} LineOperation */

/**
 * One cell of text. Every operation carries its whole style, there are no state
 * changes in the list.
 *
 * @typedef {object} TextOperation
 * @property {'text'} type
 * @property {number} x                  Left edge of the box, from the left edge of the surface
 * @property {number} y                  Top of the box, from the top of the line
 * @property {number} width              Width of the box in dots
 * @property {number} height             Height of the box in dots
 * @property {number} [codepoint]        The Unicode code point, U+FFFD for a byte without a glyph
 * @property {Bitmap} [bitmap]           The dots of a glyph the stream downloaded, instead of a code point
 * @property {string} font               'A' or 'B'
 * @property {CellSize} cell             The unscaled cell of this operation
 * @property {CellSize} glyph            The unscaled glyph box, which sits centred in the cell
 * @property {number} baseline           Row of the cell the glyph stands on, unscaled
 * @property {{x: number, y: number}} scale   Size multipliers, 1 to 8
 * @property {TextStyle} style           The style of the cell
 * @property {number} rotation           0, or 90 for the quarter turn of ESC V
 * @property {number} spacing            Dots of right side character spacing behind the box, scaled, cut to the area
 * @property {Source} source             The byte that printed the cell, or the command that drew its block
 */

/**
 * The style of a text operation
 *
 * @typedef {object} TextStyle
 * @property {boolean} bold      The glyph a second time one glyph dot to the right
 * @property {number} underline  Thickness of the line along the bottom of the cell in dots, 0, 1 or 2
 * @property {number} upperline  Thickness of the line along the top of the cell in dots, 0, 1 or 2
 * @property {boolean} invert    The cell black and the glyph white
 */

/**
 * A filled black rectangle: a bar of a barcode, or a run of black modules of a
 * QR code, a PDF417 symbol or a DataBar
 *
 * @typedef {object} RectOperation
 * @property {'rect'} type
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {Source} source   The command that drew the symbol
 */

/**
 * A 1-bit bitmap, one dot on one dot, in the format of the output contract
 *
 * @typedef {object} ImageOperation
 * @property {'image'} type
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data   Packed rows, Math.ceil(width / 8) bytes per row
 * @property {Source} source     The command that drew the image
 */

/**
 * How an SVG document of the sub-entry looks. The viewBox is always in dots,
 * whatever the units of the width and the height are.
 *
 * @typedef {object} SvgOptions
 * @property {'dots'|'mm'|'pt'|'px'} [units]   Units of the width and the height of the document, dots by default
 * @property {boolean} [cutMarker]             Draw a dashed line at every cut, off by default
 * @property {string|null} [background]        Colour of the paper, '#fff' by default, null for a transparent paper
 * @property {string} [ink]                    Colour of the ink, '#000' by default
 */

/**
 * @typedef {object} RasterizeOptions
 * @property {RenderCommand[]} [commands]          Command types that appear in the output, the rest is dropped
 * @property {number} [maxHeight]                  Maximum height of an image item, taller segments are split
 * @property {number} [feedThreshold]              Runs of blank rows at least this tall become feed items
 * @property {Object<string, PackedFont>} [font]   Font data, in the packed format of the built in fonts
 */

export {};
