# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/at-point-of-sale/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
- [ESC/POS commands](commands-esc-pos.md)
  - [Statuses](#statuses)
  - [Text and control](#text-and-control)
  - [Styles and sizes](#styles-and-sizes)
  - [Line spacing and feeds](#line-spacing-and-feeds)
  - [Alignment and position](#alignment-and-position)
  - [Page mode](#page-mode)
  - [Codepages and character sets](#codepages-and-character-sets)
  - [Barcodes](#barcodes)
  - [Barcode symbologies](#barcode-symbologies)
  - [QR codes](#qr-codes)
  - [PDF417](#pdf417)
  - [Images](#images)
  - [Graphics](#graphics)
  - [Two colour printing](#two-colour-printing)
  - [Cut and drawer](#cut-and-drawer)
  - [Printer state and status](#printer-state-and-status)
  - [Not supported yet](#not-supported-yet)
  - [Seen in the wild](#seen-in-the-wild)
- [StarPRNT commands](commands-star-prnt.md)
- [Design document](design.md)

<br>

## ESC/POS commands

This page lists every ESC/POS command `EscPosRenderer` recognises, what it does to the paper, and the exact values it accepts. It is a reference for the compatibility of the renderer: what a stream from ReceiptPrinterEncoder relies on, and what a stream from other software can expect.

The renderer emulates an Epson ESC/POS printer. It interprets the bytes the way the firmware does, including the cases where the firmware prints nothing at all: a symbol wider than the paper, an argument outside the range of its command. A barcode whose data the symbology refuses draws no bars and prints its data as text, which is what the firmware does with it. It does not improve on the printer, so `ESC 4` italic is ignored exactly as an Epson ignores it.

It deliberately differs from the hardware in a few places, each of them because the behaviour is not on the wire and no hardware check settled it. They are marked in the notes below, and these are all of them: the four dot gap between the bars of a barcode and its human readable text, the approximations of `ESC J` and `ESC d`, the default horizontal motion unit of `GS P`, a QR model 1 drawn as a model 2 symbol, the basic 43 character set of Code 93, the minimum of three data codewords of a PDF417 symbol, the placeholder cells of the Kanji group, the initial code system of `FS C`, `FS ( C` and with it UTF-8 not being decoded, sets 16 and 17 of `ESC R` replacing nothing, the feed order of `ESC { n`, the argument lengths of `DLE DC4 3` and `DLE DC4 7`, the reverse feed of `ESC e`, which is clamped to the paper the renderer holds rather than to the couple of lines the mechanism of a printer reverses, the images of the graphics print buffer drawn under each other, the download graphics and the downloaded bit image of `GS *` surviving an `ESC @`, a multiple tone image whose tones are all drawn as black, the two colour commands of [Two colour printing](#two-colour-printing), which change nothing on a one bit page, and with them the colour blocks of a graphics definition, which are drawn into one image with OR where a printer keeps one per colour, the character spacing of `ESC V 2`, the data of an `ESC &` whose `x` or whose character code is out of range, which is consumed with the command where a printer that ignores the command may leave it to the stream, the reference dot density of function `49`, which is consumed and not honoured, the heights of the GS1 DataBar family, which are a reading of the specification pending a hardware check, the placement of the human readable text of a barcode, which is read off photographs of one printout of the escpos-php `barcode` fixture from an Epson TM-T70 and is the simplest rule that draws what the paper shows: the two groups of a UPC-A and an EAN-8, the six body digits of a UPC-E, the spread of Code 39, Codabar, Code 93 and Code 128, the asterisks of Code 39 and the two boxes of Code 93; the forms of six, seven and eight digits of a UPC-E being refused and only number system `0` being accepted, which is that one TM-T70's firmware where the reference allows more; the data of a refused barcode printed as text, which the reference states for `GS k` and which the TM-T70 confirmed for the UPC-E rows alone; and four properties of [page mode](#page-mode): the height the printed page takes on the paper, which comes from the print areas the stream set and from the boxes of what was laid out in the page when it set none; a `cut` or a `pulse` waiting until the page is on the paper, where the alternative reading is a printer that ignores a `GS V` in page mode altogether; a line that does not fit at the bottom of a print area being clipped where the area ends, mid-glyph, rather than dropped whole; and `ESC W` counted in the motion units of the paper rather than in dots.

<br>

### Statuses

| Status | Meaning |
|---|---|
| **Rendered** | The command changes the output: dots on the paper, or a `cut`, `pulse` or `feed` item in the item stream. |
| **Parsed** | Recognised and consumed with the right length, but it changes nothing. The notes say why. |
| **Reported** | Consumed with the right length and reported as an `unknown` item that carries all of its bytes, the prefix included. Nothing on paper. |
| **Skipped** | Consumed silently. Nothing on paper, and no item either. |

A `cut`, `pulse`, `feed` or `unknown` item only reaches the output when the driver put that type in the `commands` option, see [Commands the printer supports](usage.md#commands-the-printer-supports). A **Reported** command with `unknown` switched off therefore leaves nothing at all, which is the same paper as **Skipped**.

**Reported** and **Parsed** are the same to the paper and say different things about it. **Reported** means the command may have changed the paper of a real printer and the renderer did not reproduce it, so the `unknown` item is the warning that this receipt could come out differently: a downloaded glyph, a logo the printer holds, a macro the printer replays. A command that cannot touch the paper is **Parsed** instead, however much it changes about the printer: a status request, which has no channel back to the host to answer over, a setting of a sensor reading or a print speed, a smoothing mode that adds no dot to a one bit image. The number of unknown items of a stream is therefore a measure of how much of it this renderer is not showing, which is what the external fixtures count.

Every command in the tables below knows how many argument bytes it has, so a command the renderer does not implement never derails the text behind it. A command that is in neither table consumes its two prefix bytes alone, which is the best guess there is, and is reported. A command whose arguments run past the end of the stream stops the parser without an error, and everything before it is still rendered.

<br>

### Text and control

| Command | Name | Status | Notes |
|---|---|---|---|
| `0x20`..`0xFF` | printable byte | Rendered | Decoded with the current codepage, one cell per character in the current style. A byte the codepage does not map becomes U+FFFD, which the font draws as its fallback box. A character that no longer fits on the line wraps to the next one, as a printer wraps; a cell wider than the whole line is drawn and clipped, so nothing is dropped silently. |
| `LF` | line feed | Rendered | Commits the line that is being composed and advances the paper. |
| `CR` | carriage return | Skipped | Does not move the paper. The encoder ends every line with `LF CR`. |
| `ESC @` | initialize | Rendered | Resets style, font, alignment, line spacing, motion units, codepage and the stored barcode, QR code and PDF417 parameters. It also discards a half composed line, because the command initializes the line buffer along with the printer. Rows that were already committed stay on the paper, the command does not flush. |
| `HT` | horizontal tab | Rendered | Moves the cursor to the next tab stop, see [Alignment and position](#alignment-and-position). |
| `FF` | print the page | Rendered | In page mode it prints the page and returns to standard mode, see [Page mode](#page-mode). In standard mode it feeds to the top of the next page, which a roll of receipt paper has not got, so nothing happens. |
| `CAN` | cancel the page data | Rendered | In page mode it deletes the dots of the page and keeps the print area, see [Page mode](#page-mode). In standard mode the command is not defined and a printer ignores it, which is what this renderer does. |
| `DLE` | real time prefix | Parsed | `DLE EOT`, `DLE ENQ` and `DLE DC4` are consumed with their own lengths. The first two are status requests and leave no item; `DLE DC4` is reported, see [Printer state and status](#printer-state-and-status). |
| `FS &` | select Kanji mode | Rendered | The bytes that follow are read as multibyte characters, see [Codepages and character sets](#codepages-and-character-sets). |
| `FS .` | cancel Kanji mode | Rendered | Back to one byte per character. The encoder sends it right behind `ESC @`, where there is no Kanji mode to leave. |
| other bytes below `0x20` | — | Skipped | Everything that is not `HT`, `LF`, `FF`, `CR`, `CAN`, `DLE`, `ESC`, `GS` or `FS` is ignored, the way a printer ignores it. |

**The end of a stream is not a line feed.** Cells go on the paper when a line feed or a print command commits the line they are on, and at the end of a job the line that is still being composed is thrown away, the way `ESC @` throws it away and the way a printer leaves it in its line buffer. A receipt still prints in full: its last line ends with a line feed, which committed it. Text without one never prints, here or on paper, which is what the `cafe-order-voucher` sample of ESCPost demonstrates: it ends with `GS V 0` and the words "Buffered, not printed".

<br>

### Styles and sizes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC E n` | bold | Rendered | Bit 0 of `n`, so every odd value switches it on. Drawn as overstrike, the glyph twice with a one dot horizontal offset, which is what the print head does. Emphasis and the double strike of `ESC G` are two settings of the printer, and a cell is drawn bold while either of them is on, so `ESC G 0` does not undo an `ESC E 1`. |
| `ESC - n` | underline | Rendered | `0` off, `1` one dot thick, `2` two dots thick, along the bottom of the cell and across the spaces between characters. It runs through the right side character spacing of `ESC SP` behind the cell as well, which the reference states: "when underline mode is turned on, the right side character spacing is underlined". It does not run through the gaps `HT`, `ESC $` and `ESC \\` skip, those are not spacing. The ASCII digits `48`, `49` and `50` are accepted for the same three. Any other value leaves the underline as it was, instead of throwing. |
| `ESC 4 n` | italic | Parsed | Ignored, as Epson hardware ignores it. The encoder emits it for `italic()`, so a receipt that asks for italic prints upright, on paper and here. |
| `GS B n` | invert | Rendered | Bit 0 of `n`. The cell is drawn white on black, and the black covers the right side character spacing of `ESC SP` behind the cell, which is what an Epson prints: the reversed space behind an `A` printed with `ESC SP 5` is 17 dots wide on the paper, the 12 of the cell and the 5 of the spacing. The gap the line spacing leaves below the line stays white, and so do the gaps `HT`, `ESC $` and `ESC \\` skip, which are not spacing. |
| `GS ! n` | character size | Rendered | Width multiplier in the high nibble plus one, height multiplier in the low nibble plus one, both 1 to 8. Bits 3 and 7 are masked off, so there is no value this command refuses. Glyphs are scaled by repeating dots, as a printer scales them. |
| `ESC M n` | font | Rendered | `0` or `48` font A, 12 by 24 dots, `1` or `49` font B, 9 by 17 dots in the Epson profile and 9 by 24 in the Star profile. Font C, `2` or `50`, has no glyphs here and leaves the font as it was. |
| `ESC ! n` | print mode | Rendered | Font, emphasis, double height, double width and underline in one byte: bit 0 font B, bit 3 emphasis, bit 4 double height, bit 5 double width, bit 7 underline. It sets the same state as the individual commands and clears what it does not set, so `ESC ! 0` is plain font A text, with the double strike of `ESC G` as the one exception: that is a setting of its own and bit 3 does not clear it. A `GS !` behind it decides the size, and an `ESC !` behind a `GS !` overrides that size with its two bits. |
| `ESC G n` | double strike | Rendered | Bit 0 of `n`, drawn as bold. A print head strikes the same dots twice, which is not visible on a thermal printer; the overstrike of bold is the closest thing on paper and it is what the firmware of a thermal printer does with the command. It is a setting of its own next to the emphasis of `ESC E` and bit 3 of `ESC !`, and the cell is bold while either of them is on. |
| `ESC { n` | upside down printing | Rendered | Bit 0 of `n`. It is a standard mode command: in [page mode](#page-mode) it turns neither the lines of a print area nor the page that is printed, and the print direction of `ESC T` is what turns a layout there. Every line that is committed while it is on, blocks included, is rotated by 180 degrees over the full width of the paper, so a left aligned line comes out at the right edge upside down. **The order in which the lines are fed does not change, which is a simplification: a printer holds the whole page and prints it bottom up. A stream that wants that composes it in [page mode](#page-mode), where a page is held in memory and printed in one go.** |
| `ESC V n` | rotate 90 degrees | Rendered | The values are exactly `0`, `1`, `2`, `48`, `49` and `50`: `0` and `48` switch the rotation off, the other four switch it on, and any other value leaves it as it was, the way an unknown font or alignment does. Every character cell is turned a quarter turn clockwise and the cells still go left to right along the line, so a rotated line reads from the bottom of the paper to the top and is as tall as a character is wide. A rotated character gets no underline and no upperline, which the reference of `ESC - n` exempts the way it exempts a reverse character; the setting itself is kept, so the line behind an `ESC V 0` is underlined again. A block does not turn at all, an image, a barcode and a QR code stand the way they always stand. **The reference gives `1` and `2` a character spacing of one dot and one and a half; a cell of whole dots has no room for the difference, so the two are the same here.** It is a standard mode command, as the reference says: in [page mode](#page-mode) the command is dropped and a rotation that is on turns nothing, the way `ESC { n` turns nothing there. |

<br>

### Line spacing and feeds

The height of a committed line is the larger of the tallest cell on it and the current line spacing, so a line of double height text is 48 dots and not 60, which is how the firmware behaves as well. The cells of a line share the baseline of the font whatever their size, the way the firmware draws them: the ascent of a cell is the baseline of its cell times the height multiplier and the rest of the cell is its descent, the line is as tall as the largest ascent plus the largest descent, and every cell is drawn with its baseline on the baseline of the line, so a single height character next to a double height one stands on the same line as the tall one and the descender space of the tall cell hangs below it. A cell with no baseline, a 24 row strip of a column mode image or a cell turned by `ESC V`, sits on the bottom of the line box. The gap of the line spacing falls below the line: with the Epson default of 30 dots and a 24 dot cell that is six dots at every line boundary. An empty line is the line spacing alone. Blocks, which is what barcodes, QR codes, PDF417 symbols and raster images are, advance by their own height and get no line spacing added.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC 2` | default line spacing | Rendered | Back to the default: 30 dots for the Epson profile, 32 for the Star profile, or the `lineSpacing` option when the driver gave one. |
| `ESC 3 n` | line spacing | Rendered | `n` vertical motion units, rounded to `n / units` dots. With the Epson default of two units per dot `ESC 3 24` is twelve dots; behind the `GS P dpi dpi` the encoder writes in front of a column mode image it is 24 dots. |
| `ESC J n` | print and feed n units | Rendered | Commits the line and advances by `n / units` dot rows, rounded. A line taller than that still advances by its own height, so nothing overlaps. An approximation: the encoder never emits this command and no hardware check settled it. |
| `ESC d n` | print and feed n lines | Rendered | Commits the line and advances by at least `n` line spacings, under the same rule, so `ESC d 1` is exactly `LF` and `ESC d 0` commits the line without a gap below it. The same approximation as `ESC J`. |
| `ESC K n` | print and reverse feed n units | Rendered | Commits the line, printing it, and then moves the paper back by `n / units` dot rows, rounded, so that everything behind it is printed over the rows that are already there, dot for dot with OR. `n` is 0 to 48, which is 24 dots at the default vertical motion unit of an Epson and is as far as the mechanism reverses; a larger value is out of range and the whole command is ignored, the pending line included, the way a printer ignores an argument it has no range for. |
| `ESC e n` | print and reverse feed n lines | Rendered | The same, `n` lines of the current line spacing instead of dot rows. Every value of `n` is accepted, see the note below the table. |
| `ESC C n` | page length in lines | Reported | |

A reverse feed moves the paper back over rows the painter still holds, and no further: the rows of the lines that were already handed to an image item are gone, so the move stops at the top of the rows that are left, and it never goes above the first row of the paper. That is the one clamp there is. The mechanism of a printer has a clamp of its own, a couple of lines at most and for `ESC K` the 48 units of its range, and this renderer does not impose it on `ESC e`: the Epson reference gives that command no range that the wild respects, and the demo of escpos-php reverses three lines with it. A stream that asks for more than the paper it has just printed gets the top of that paper, which is where a printer would have refused to go too.

Rows the paper moved back over are printed over, they are not replaced: a dot that is there stays there, and the second pass adds its own dots to it, which is what a print head does. A row that was blank and is drawn over is no longer blank, so it no longer counts towards a `feed` item.

Runs of blank rows of at least `feedThreshold` dots become `feed` items and split the image around them, but only when `feed` is in `commands`; otherwise they stay in the image as white rows. The six blank dots below a line of text belong to the run that follows them, so a feed item usually starts a few rows above the empty line that caused it.

<br>

### Alignment and position

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC a n` | alignment | Rendered | `0` or `48` left, `1` or `49` centre, `2` or `50` right. Applied when the line is committed, over the free width of the line, and to blocks when they are drawn. Any other value leaves the alignment as it was. |
| `GS P x y` | motion units | Rendered | The vertical unit is what `ESC 3` and `ESC J` are counted in, and it is tracked as the number of units in one dot: `GS P 0 0` returns to the profile default, two units per dot on Epson and one on Star, and any other `y` is read as one unit per dot, because the renderer does not know the resolution of the printer it emulates and setting the unit to that resolution is the only thing the encoder ever does with this command. The horizontal unit is what `ESC SP`, `ESC $`, `ESC \\`, `GS L` and `GS W` are counted in, and it is the other way round, the number of dots in one unit: one dot until the command sets it, and `dpi / x` dots afterwards, with the `dpi` of the profile, 203 for both built in profiles. `GS P 0 0` returns to one dot per unit. **One dot per unit is a simplification: an Epson starts at 1/180 inch horizontally, which is 1.13 dots.** |
| `ESC SP n` | right side character spacing | Rendered | `n` horizontal motion units behind every character, scaled with the width multiplier, as the printer scales it. The space is not part of the width the alignment centres, so a centred line is centred on its characters, and it is part of the width of a character for the tab stops of `ESC D` and for the default stops. It is white, except that it belongs to the character in front of it for two styles: the reverse of `GS B` covers it and so does the underline of `ESC -`, each over the rows of the cell it covers there, and the spacing behind the last character of a line is covered the same way. No line runs through it behind a cell that is inverted or turned by `ESC V`, the rule of the cell itself; a turned cell that is inverted does have its spacing filled, because the turn exempts the lines and not the reverse. The spacing stops at the right edge of the print area: a right aligned line ends on that edge and the spacing of its last cell has no room. |
| `ESC $ nL nH` | absolute print position | Rendered | `nL + nH * 256` horizontal motion units from the left margin. A position beyond the print area is ignored. Cells that were already placed stay where they are, so moving back and printing again overprints, the way a printer overprints. |
| `ESC \ nL nH` | relative print position | Rendered | The same, relative to the cursor and signed: a value above 32767 is the negative distance below it, which moves back towards the left margin. A distance that lands outside the print area is ignored. |
| `HT` | horizontal tab | Rendered | Moves the cursor to the first tab stop beyond it. A tab with no stop behind it does nothing, and neither does one when every stop was cancelled. A stop that lies outside the print area puts the cursor one dot beyond the area instead, so that the character behind the tab wraps to a new line, which is what the reference of this command describes. |
| `ESC D n1..nk NUL` | horizontal tab positions | Rendered | Up to 32 stops, each `n` times the width of a character of the font that is current when the command arrives, so a stop is a number of dots from then on. A character is as wide as its cell plus the right side spacing of `ESC SP`, which is the unit of the reference. The stops have to ascend, one that does not ends the list. `ESC D NUL` cancels every stop, after which `HT` does nothing at all; `ESC @` puts the default back, a stop every eight characters of font A. |
| `GS L nL nH` | left margin | Rendered | `nL + nH * 256` horizontal motion units from the left edge of the paper. The command is only effective at the beginning of a line, as the reference says: a line that already holds characters, or whose cursor was moved, makes the printer drop the command, and this renderer drops it too. |
| `GS W nL nH` | print area width | Rendered | The width of the print area in horizontal motion units, only effective at the beginning of a line like `GS L`. A width that does not fit next to the left margin is clamped to the paper. Wrapping, the alignment and the tab stops all work inside the print area, so a centred line is centred between the margins. |
| `GS T n` | print position at the top of the line | Reported | |
| `GS A m n` | print position adjustment | Reported | |

The commands of page mode, `ESC L`, `ESC S`, `ESC T`, `ESC W`, `FF`, `ESC FF`, `CAN`, `GS $` and `GS \`, are in [Page mode](#page-mode) below.

<br>

### Page mode

In page mode the printer does not print a line at a time. It composes a page in memory, in a print area on that page and in one of four print directions, and prints the whole area in one go when the stream asks for it. This renderer lays the page out the same way: the text, the blocks and the positions of the tables above all work inside the print area, in the coordinate system of the direction, and the page reaches the paper as one block.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC L` | select page mode | Rendered | Only at the beginning of a line in standard mode, as the reference says: a line that already holds characters, or whose cursor was moved, makes the printer drop the command. A page starts in the print area and the print direction the printer holds, which `ESC W` and `ESC T` set and `ESC @` puts back; without an `ESC W` that is the whole printable area and direction 0. |
| `ESC S` | select standard mode | Rendered | Leaves page mode. **The dots of the page are deleted and never printed**, which is the reference: only `FF` and `ESC FF` print a page. `ESC @` leaves page mode the same way, and so does the end of the stream. |
| `FF` | print and return to standard mode | Rendered | Prints the page on the paper as one block, throws its dots away and returns to standard mode. |
| `ESC FF` | print the page | Rendered | Prints the page and keeps everything: the dots, the print area, the direction and the position, so the same page can be printed again, and page mode stays on. |
| `CAN` | cancel the page data | Rendered | Deletes the dots of the page, and the line that is being composed with them. The print area survives, so the page that is printed after it still feeds the height of the area, and the position goes back to the start of the area. |
| `ESC W xL xH yL yH dxL dxH dyL dyH` | print area | Rendered | The origin `x` and the width `dx` in horizontal motion units, the origin `y` and the height `dy` in vertical motion units, which is two units per dot on the Epson profile. A width or a height of `0`, and an origin outside the printable area, make the command do nothing, the way the printer drops it. The area is a setting of the printer rather than of one page: a stream may set it in standard mode, the next page starts in it, and it survives that page until `ESC @`. Several areas can be set on one page: what was laid out in the area before goes into the page, and the layout starts over at the start of the new area. |
| `ESC T n` | print direction | Rendered | `0` or `48` left to right from the top left of the area, `1` or `49` bottom to top from the bottom left, `2` or `50` right to left from the bottom right, `3` or `51` top to bottom from the top right. Any other value leaves the direction as it was. A new direction starts the layout over, at the start position of that direction. Like the print area it is a setting of the printer: it may be set in standard mode, it is what the next page starts in, and `ESC @` puts it back to `0`. |
| `GS $ nL nH` | absolute vertical position | Rendered | `nL + nH * 256` units along the vertical axis of the print direction, counted from the start of the print area. A position outside the area is ignored. In standard mode the command does nothing, which is what the printer does with it. |
| `GS \ nL nH` | relative vertical position | Rendered | The same, relative to the position and signed: a value above 32767 is the negative distance below it. |
| `ESC $ nL nH`, `ESC \ nL nH` | horizontal position | Rendered | The commands of [Alignment and position](#alignment-and-position), along the horizontal axis of the print direction. |

**The unit follows the axis.** Two axes run through a print area: the one the characters of a line run along and the one the lines go down. `ESC $`, `ESC \` and `ESC SP` move along the first and `GS $`, `GS \`, `ESC 3`, `ESC J`, `ESC K`, `ESC d` and `ESC e` along the second. In the directions 0 and 2 the first axis is the horizontal one of the paper and the second the vertical one, so they count in horizontal and in vertical motion units; in the directions 1 and 3, where the text runs up or down the paper, the two swap and so do the units, which is the page mode rule the reference gives these commands. `ESC d` and `ESC e` count in lines of the current line spacing, and that spacing is set by `ESC 3`, so they follow it. The print area is a rectangle on the page rather than on the layout inside it, so `ESC W` counts its origin and its size the same way whatever the direction is.

**The four directions are four rotations.** The layout of a print area happens in a coordinate system of its own, in which the text runs to the right and the lines go down as they always do, and the whole of it is turned when it goes into the page: direction 0 is drawn as it is, direction 1 a quarter turn counter-clockwise, direction 2 half a turn and direction 3 a quarter turn clockwise. The area is as wide as it is tall in the two sideways directions, so a line of direction 1 is as long as the area is high and it wraps over the height of the area.

**The page is printed as a block of the height of its print areas.** The paper advances over every area the stream set on the page, the way a printer feeds it, so an area of 400 dots leaves 400 dots of paper whatever it holds, the origin of the area included and an area that stayed empty included. A page the stream never gave an area is as tall as the boxes of what was laid out in it instead, which is a deviation: the default area is the whole page, 1662 dots on both profiles, and feeding that for a page of two lines would put twenty centimetres of white on the receipt. The boxes are the line boxes and the feeds of every area of the page, the gap of the line spacing below a line included, mapped into the page by the print direction of the area and clipped where the area ends, and the page is as tall as the lowest of them: a trailing blank line in a page feeds its rows the way it does in standard mode, because the printer feeds what it laid out and not the rows its ink reaches. A line box spans the whole width of the layout of its area, and what that reaches depends on the direction: `1` and `3` swap the axes, so the width of the layout is the height of the area and a single line spans the whole of it; `2` mirrors, so the bottom of the page is the height of the area minus the top of the highest box; `0` leaves both axes alone. One line laid out in direction `1` or `3` without a print area is a page of the full 1662 dots, and so is one in direction `2` that starts at the top of its layout, while a line that `GS $` put 150 dots down a mirrored page ends 150 dots above the bottom of it. A page with neither an area nor a box prints nothing at all.

**Text that does not fit is discarded.** A character that runs past the right edge of the area wraps to the next line inside the area, and a line that runs past the bottom of the area is cut off there, dot row by dot row: a line that half fits is printed to the last row of the area and clipped mid-glyph. **That is the reading of this renderer**, next to the other one, a printer that drops such a line whole; it is in the list of deviations at the top of this page.

**A `cut` or a `pulse` in page mode waits for the page.** The page is not on the paper yet when the command arrives, so the item would tell a driver to cut paper that is still to be printed. The items are emitted right behind the page instead, or when page mode is left without printing it, so the item stream stays in the order of the paper. **That is a reading**: no specification text available here settles what a printer does with `GS V` or `ESC p` in page mode.

**The page height comes from the profile**, `pageHeight`, 1662 dots for both built in profiles, which is the page mode maximum of an Epson TM-T88 at 576 dots wide. It is what a print area of size `0` grows to and what an origin is measured against. **No specification text available here settled the Star page height, which takes the same number.**

<br>

### Codepages and character sets

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC t n` | select codepage | Rendered | `n` is looked up in the `codepageMapping` the renderer was built with, which has to be the mapping the encoder used. An unknown number falls back to cp437, and so does a codepage the codepage encoder does not implement, `cp885` of the Bixolon mapping for one: a printer without that codepage prints the bytes with the one it has, and a receipt is never lost over one character. The printer starts in cp437 and `ESC @` returns to it. |
| `ESC R n` | international character set | Rendered | Sets 0 to 17: USA, France, Germany, United Kingdom, Denmark I, Sweden, Italy, Spain I, Japan, Norway, Denmark II, Spain II, Latin America, Korea, Slovenia and Croatia, China, Vietnam and Arabia. The set replaces the twelve code points `0x23`, `0x24`, `0x40`, `0x5B`, `0x5C`, `0x5D`, `0x5E`, `0x60`, `0x7B`, `0x7C`, `0x7D` and `0x7E`, after the codepage decoding and only for those twelve bytes, so the rest of the codepage is untouched. A number the command does not define leaves the set as it was, and `ESC @` goes back to the USA set, which replaces nothing. **Sets 16 and 17 are in the table of the reference but their replacements are not in any specification text that was available here, so both print the characters of set 0.** The won sign of the Korean set has no glyph in the built in font and prints as the fallback box. |
| `ESC & y c1 c2 [x d1..d(y * x)]..` | define user defined characters | Rendered | The glyphs of the character codes `c1` to `c2`, in the font that is current. `y` is the height of a definition in bytes of eight dots, and it is `3` for the fonts of these printers, which is the only value the command takes here: the 24 dots of a cell. Every character carries `x`, its width in columns, and that many columns of three bytes, the most significant bit at the top, which is the column format of `ESC *`. The widest character is the cell of the font, twelve columns for font A and nine for font B, and the codes run from `32` to `126`. An `x` or a code outside those ranges makes the printer ignore the whole command, so the glyphs that were defined stay as they are and nothing of the definition is kept; **the data of such a command is consumed with it, which is a reading, see the list of deviations at the top of this page.** A `y` that is not `3` is different: the parser has no layout for the data behind it, so the command consumes its three parameters alone and the bytes behind it are read as the stream, exactly as they are when `c2` is below `c1`. An `x` of zero is a character of no dots, which prints as a blank cell. The definitions of font A and font B are two sets, the font that is current when the command arrives decides which one it lands in, and `ESC @` throws both away: they live in the RAM of the printer, unlike the images of the [graphics](#graphics) group. |
| `ESC % n` | select user defined character set | Rendered | Bit 0 of `n`. While it is on, a character code that has a definition prints the downloaded glyph in the cell of the current font, with the bold, the underline, the invert and the size of the print mode applied to it exactly as they are applied to a built in glyph, and a code without a definition prints its built in glyph. The dots of a glyph that is narrower or shorter than the cell go in the top left corner of it and the rest of the cell stays blank, and a glyph that is larger than the cell is clipped by it. `ESC @` switches the selection off. |
| `ESC ? n` | cancel user defined character | Rendered | Cancels the glyph of the character code `n` in the current font, so that the code prints its built in glyph again. A code outside `32` to `126` is out of range and cancels nothing. |
| `FS &` | select Kanji mode | Rendered | The bytes that follow are read as multibyte characters: a lead byte and the byte behind it are one character, which is drawn as two cells of the fallback glyph, unless the stream defined a glyph for that code with `FS 2`. There is no CJK font here, so the placeholder is what keeps the layout right; **two fallback cells is a choice of this renderer, a printer draws the glyph in the same 24 dots.** A lead byte at the very end of the stream is not a pair and prints as a character of its own. |
| `FS C n` | Kanji code system | Rendered | `0` or `48` JIS, where every pair of bytes from `0x21` to `0x7E` is one character, `1` or `49` Shift JIS, where a lead byte is `0x81` to `0x9F` or `0xE0` to `0xFC`. A value the command does not define leaves the code system as it was. **The printer starts in Shift JIS here, and the initial value differs per model in the reference, so a stream that relies on the model's default and sends no `FS C` may be read in the other system.** |
| `FS ! n` | multi byte print mode | Parsed | The size and the underline of the multibyte characters. This renderer draws them as placeholder cells in the style of the single byte text, so the command changes nothing on paper. |
| `FS - n` | multi byte underline | Parsed | The same. |
| `FS S n1 n2` | Kanji character spacing | Parsed | The left and the right space of a multibyte character, in horizontal motion units. |
| `FS W n` | quadruple size Kanji | Parsed | |
| `FS ( A pL pH fn m` | Kanji font | Parsed | Selects the font a multibyte character is drawn in. There is no CJK font here whatever it selects, every multibyte character is a placeholder cell of the same size, so the command cannot change a dot. receiptline sends it in the setup of its ESC/POS command sets. |
| `FS ( C pL pH fn ..` | character encode system | Reported | The group that selects UTF-8 on the models that have it. Consumed with the length it carries, so the stream stays in sync. **Its layout is not settled by a specification text that was available here, so nothing is rendered for it and a stream in UTF-8 prints the bytes through the current codepage.** |
| `FS 2 c1 c2 d1..d72` | define user defined Kanji | Rendered | The glyph of the multibyte character code `c1 c2`, 24 by 24 dots in the column format of `ESC &`, three bytes per column, which is 72 data bytes. While Kanji mode is on, a code that has a definition prints it in a cell of two characters, which is the width the placeholder of a multibyte character takes, and every other code keeps its placeholder cells. **The number of data bytes depends on the Kanji font of the printer, which the stream does not say; 24 by 24 is the font of these printers and the only size that fits the two cells of the placeholder, so that is what this renderer reads.** The encoder never sends this command. |
| `FS ? c1 c2` | cancel user defined Kanji | Rendered | Cancels the glyph of the multibyte character code `c1 c2`, so that the code prints its placeholder cells again. `ESC @` cancels every definition. |

`FS .` leaves Kanji mode again, see [Text and control](#text-and-control).

<br>

### Barcodes

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS h n` | barcode height | Rendered | The height of the bars in dots, for the barcodes that follow. `0` is refused and leaves the height as it was. The printer starts at 162 dots. |
| `GS w n` | barcode module width | Rendered | The width of the narrowest bar in dots, 1 to 6. The specification defines 2 to 6, but the encoder sends 1 for GS1-128 and the GS1 DataBar family, so 1 is accepted. Any other value leaves it as it was. The printer starts at 3 dots. |
| `GS H n` | HRI position | Rendered | `0` none, `1` above, `2` below, `3` both, and `48` to `51` for the same four. Any other value leaves it as it was. The printer starts at none and the encoder sends `0` or `2`. |
| `GS f n` | HRI font | Rendered | `0` or `48` font A, `1` or `49` font B. The default is font A, which is what the reference of this command says; the encoder never sends it, so the text of a barcode from the encoder is always font A. |
| `GS k m d1..dk NUL` | barcode, function A | Rendered | For `m` below 65. The data runs to the first `NUL` byte and is read as ASCII. Data the symbology refuses draws no bars and is printed as text instead, see below. |
| `GS k m n d1..dn` | barcode, function B | Rendered | For `m` of 65 and up, with the length in front of the data. The symbologies of both functions render identically, and both hand refused data to the text path. |

The bars are drawn as a block of their own: the pending line is committed first, the block is aligned the way `ESC a` says, and the paper advances by the height of the block. Barcodes carry no quiet zone, a printer does not print one either.

**Data that is not valid for the symbology draws no bars and is printed as text.** The reference says that a `GS k` whose data is out of range is aborted and its data processed as normal data, and that is what an Epson TM-T70 does: the rows of the escpos-php `barcode` fixture that send a UPC-E of six, seven and eight digits printed `123456`, `0123456` and `01234567` as a line of text where the barcode would have been. The bytes go to the text path in the codepage and the style that are current, exactly as if they had arrived as text, and this holds for every symbology that refuses data, because the reference states it for the command and not for a symbology.

A barcode whose bars are wider than the print area is different: an Epson prints nothing rather than a barcode no reader can read, and the data was valid, so nothing is printed as text either. The human readable text is not part of that rule, it is clipped when it is wider than the paper.

**A check digit that is sent is never verified.** The TM-T70 printed the UPC-A, the EAN-13, the EAN-8 and the twelve digit UPC-E rows of that fixture that carry a wrong check digit as they came, bars and digits both. A check digit that is missing is still computed, for every form that has a shorter one.

The GS1 DataBar family is the one family whose height is not only the height of `GS h`. ISO/IEC 24724 gives all four variants a height: thirteen modules for Truncated, ten for Limited, thirty three for Omnidirectional and thirty four for Expanded, in modules, so they follow the width of a module of `GS w`. **The specification words all four as minimums, and what an Epson does with a `GS h` below them is remembered as having no effect on this family at all, which no hardware check settled here. This renderer reads the heights of Truncated and Limited as fixed, so that a `GS h` of two hundred dots does not turn a Truncated symbol back into the Omnidirectional one it has the bars of, and the heights of Omnidirectional and Expanded as minimums, so that a taller `GS h` still makes those symbols taller.** The human readable text of these symbols is the element string with its application identifiers in parentheses.

Omnidirectional is ninety six modules wide, of which ninety five are printed, and Limited is seventy nine, of which seventy three are printed: the module in front of the left guard bar, and the five module space behind the right guard bar of Limited, are quiet zone and a printer does not print them either. The parenthesised notation of Expanded has no escape for a parenthesis inside a value, so an `(` in the data always starts the next application identifier, which is what BWIPP and the reference encoders do with it as well.

The human readable text is cells in the HRI font, drawn without any style, so it is never affected by the bold, underline, invert or size of the text around it. Between the bars and the text sits a gap of four dots, because the cell of the font has no room of its own above a capital and the text would otherwise touch the bars. **That gap is a legibility choice of this renderer, not a number from a specification, and it has not been compared with what an Epson puts on paper.**

**Where the characters go differs per symbology**, as measured on a printout of the escpos-php `barcode` fixture from an Epson TM-T70:

- **UPC-A and EAN-8 print their digits in two groups**, six and six and four and four, each group centred under the modules that encode it, with the centre guard between them: `012345 678901` and `0123 4565`. For UPC-A the left group sits on modules 3 to 45 and the right group on 50 to 92, for EAN-8 on 3 to 31 and 36 to 64. The number system digit and the check digit of a UPC-A are inside those groups, not beside the bars. The left edge of a group is the start of its module range in dots plus half of what the group leaves over of that range, rounded down.
- **EAN-13, ITF and the GS1 family print one run of cells centred under the bars**, which is what every symbology did before. The printout shows EAN-13 that way; ITF, GS1-128 and the GS1 DataBar family were not on it and keep the centred run, with this note.
- **Code 39, Codabar, Code 93, Code 128 and Code 128 auto spread their characters across the bars**: the width of the bars is divided into one interval more than there are characters, and a character is centred on each of the interior division points, which leaves a margin of a whole interval at each end of the run. The pitch is the width of the bars divided by the number of characters plus one, a fraction of a dot, and the left edge of a character is its division point less half a cell, rounded to the nearest dot. That is what the photographs measure, pixel by pixel, in all five of their spread rows. When the characters together are wider than the bars there is no room to spread them and they are drawn as the centred run of the other symbologies.
- **UPC-E prints the six digits of its symbol** and nothing else, centred: `123450`, not `01234505`.
- **Code 39 wraps its text in the asterisks of its start and stop character**, `* A B C   0 1 2 *` for the data `ABC 012`; data that already carries them, `*TEXT*`, is not wrapped twice. **Code 93 wraps its text in the small boxes of its start and stop character**, drawn as a hollow rectangle of one dot lines, half a cell wide and a third of a cell high, because the font has no glyph for it. It sits in the middle of its cell horizontally and on the middle of a digit vertically, which is the middle between the top of the cell and the baseline row of the font, rows 5 to 12 of the 24 row cell of font A: the cell has room for a descender the box does not use, so centring in the whole cell would put it three dots below where the paper shows it. Each box is a cell of the spread like any character, and it reaches the display list as rectangle operations of the block, not as a glyph. Code 93 also prints its text as it was sent, lower case included, while the bars encode the upper case of the basic 43 character set.

**All of that is a reading of photographs of one printout**, measured at an angle, so each rule is the simplest one that draws what the paper shows and a scan can refine it later. The same rules are applied to StarPRNT, where no hardware confirmed them at all.

The block a barcode lays out is as wide as the wider of the bars and the text, and a group or a spread that reaches past an edge of the bars widens the block on that side instead of being clipped.

<br>

### Barcode symbologies

`m` of `GS k`, and what the renderer draws for it. The values 65 to 71 are function B and select the same symbologies as 0 to 6.

| Value | Symbology | Status | Notes |
|---|---|---|---|
| `0`, `65` | UPC-A | Rendered | Eleven or twelve digits. The check digit is computed when it is missing and never verified when it is there. Drawn as the EAN-13 it is, with the leading zero left out of the text, which is printed in two groups of six under the modules that encode them. |
| `1`, `66` | UPC-E | Rendered | The eleven or twelve digits of the UPC-A the symbol stands for, whose number system digit must be a `0`. The UPC-A is compressed when it has a zero suppressed form, and when it has none the printer keeps the five manufacturer digits and the last product digit, so `01234567890` draws the symbol of `123450`. The twelfth digit is the check digit and is not verified; the eleven digit form computes it. The text is the six digits of the symbol and nothing else. **The forms of six, seven and eight digits are refused: an Epson TM-T70 printed those rows of the escpos-php `barcode` fixture as text and drew no bars, while the reference allows them on newer firmware, and only number system `0` was ever on the paper. See the list of deviations at the top of this page.** |
| `2`, `67` | EAN-13 | Rendered | Twelve or thirteen digits, the check digit computed when it is missing and never verified when it is there. The thirteen digits are one run centred under the bars. |
| `3`, `68` | EAN-8 | Rendered | Seven or eight digits, the check digit computed when it is missing and never verified when it is there. The eight digits are printed in two groups of four under the modules that encode them. |
| `4`, `69` | Code 39 | Rendered | No check digit, as the firmware computes none. The start and stop character are added by the renderer; data that already carries them, `*TEXT*`, is encoded once and not wrapped twice, while a `*` anywhere else prints the data as text. Lower case is printed as upper case, a character outside the set prints the data as text. A wide element is three modules. The text carries the asterisks of the start and stop character and is spread across the bars. |
| `5`, `70` | ITF | Rendered | An even number of digits. An odd number prints its data as text rather than being padded, because padding would change the number. A wide element is three modules. |
| `6`, `71` | Codabar | Rendered | The start and stop characters are `A` to `D`. Data without them gets an `A` on both sides, data with only one of the two, or with one of those letters in the middle, prints the data as text. They are part of the human readable text, as the firmware prints them, and that text is spread across the bars. A wide element is two modules. |
| `72` | Code 93 | Rendered | Two check characters are computed and drawn. Only the basic 43 character set is encoded, the full ASCII variant is not implemented, as printer firmware does not implement it either; a character outside the set prints the data as text. Lower case is encoded as upper case but printed as it was sent, which is what the TM-T70 drew under the bars of `012abcd`. The text is spread across the bars between the two small boxes of the start and the stop character, which are rectangles of the block and not glyphs. |
| `73` | Code 128 | Rendered | The data carries the code set selection: `{A`, `{B` and `{C` select a set, `{1` to `{4` are the function characters, `{S` is the shift and `{{` is a brace. Data that does not start with a code set, or that holds an escape the table does not have, prints its data as text. The encoder puts `{B` in front of a value that does not start with a brace. **Inside `{C` one byte is one digit pair and carries its value, 0 to 99, which is what the specification says and what receiptline and escpos-php send: `{C` `0x15` `0x20` `0x2b` is `213243` and `{C` `0x00` `0x03` is `0003`. A value written as digit characters, `{C1234`, is therefore the pairs 49, 50, 51 and 52 and prints `49505152`, on a printer and here; see [Seen in the wild](#seen-in-the-wild) and the notes of section 16 of the implementation plan.** A byte of 100 or more is no pair and switches to code set B, which is the only thing a printer can do with it. A byte above 127 fits in no code set and prints the data as text. The text under the bars is the data without the escapes, with the two digits of every pair of code set C, spread across the bars. |
| `74` | GS1-128 | Rendered | A Code 128 with FNC1 behind the start symbol and the code sets picked for the data. The encoder strips `(`, `)` and `*` from the value before it sends it. |
| `75` | GS1 DataBar Omnidirectional | Rendered | Thirteen digits, or fourteen with the check digit, which is validated; a wrong one prints its data as text. **This family keeps the check digit rule of its own specification: the `never verified` rule of section 23 was measured on UPC and EAN alone.** The symbol is the RSS-14 of ISO/IEC 24724, ninety six modules of four data characters and two finder patterns. The height is at least thirty three modules, whatever `GS h` says. |
| `76` | GS1 DataBar Truncated | Rendered | The same data and the same bars as Omnidirectional, thirteen modules tall, which is the height the specification gives it and which `GS h` does not change. |
| `77` | GS1 DataBar Limited | Rendered | Thirteen or fourteen digits of a GTIN that starts with a zero or a one, seventy nine modules of two data characters with a check character between them. Ten modules tall, whatever `GS h` says. |
| `78` | GS1 DataBar Expanded | Rendered | A GS1 element string with its application identifiers in parentheses, `(01)90614141000015(3103)000123`, in four to twenty two symbol characters. The compressed encodation methods of AI `(01)` are used where the element string allows them: a weight in AI `(3103)`, `(3202)` or `(3203)`, a weight in AI `(3100)` to `(3109)` or `(3200)` to `(3209)` with an optional date in AI `(11)`, `(13)`, `(15)` or `(17)`, and a price or a rate in AI `(392x)` or `(393x)`. Every other identifier of the 31xx and 32xx blocks, `(3123)` and `(3210)` among them, has no compressed method and goes through the general purpose field, as does everything else, with the numeric, alphanumeric and ISO 646 compaction of the specification. The height is at least thirty four modules. Data that is not an element string, or that holds a character no compaction method has, prints its data as text. |
| `79` | Code 128 auto | Rendered | The renderer picks the code sets, the way a printer does when the data does not say: code set C for a run of four digits or more and for a value that starts with two, code set A only when the value needs the control characters, and never the shift. The text is spread across the bars, as it is for symbology `73`. |
| any other | — | Reported | Including the values the specification leaves open. |

<br>

### QR codes

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS ( k pL pH 49 65 n1 n2` | model | Parsed | `49` is model 1, `50` and everything else model 2. The value is stored but never used: both models are drawn as a model 2 symbol, which is a deviation from the hardware. |
| `GS ( k pL pH 49 67 n` | module size | Rendered | `n` dots per module, clamped to 1 to 16. The encoder sends 1 to 8. The printer starts at 3. |
| `GS ( k pL pH 49 69 n` | error correction | Rendered | `48` L, `49` M, `50` Q, `51` H. Any other value leaves it as it was. The printer starts at L. |
| `GS ( k pL pH 49 80 48 d..` | store data | Rendered | The bytes are stored and encoded in the byte mode of the specification, so any byte survives whatever codepage the reader assumes. The storage survives until the next store, so two print commands print the same symbol twice. `ESC @` empties it. |
| `GS ( k pL pH 49 81 48` | print | Rendered | Draws the symbol as a block, aligned the way `ESC a` says, one dot per module scaled by the module size and without a quiet zone, as a printer prints it. The version is the smallest one the data fits in at the error correction level that was asked for. Nothing is printed, and the paper does not advance, when the storage is empty, when the data does not fit in the largest symbol of that level, or when the symbol would be wider than the print area. |
| `GS ( k pL pH 49 ..` | any other function | Skipped | Consumed with the length of the group, and nothing happens. |
| `GS ( k pL pH ..` | any other selector | Reported | Maxicode, the two dimensional GS1 DataBar and the composite symbologies, and a group that is too short to hold a selector and a function. |

<br>

### PDF417

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS ( k pL pH 48 65 n` | columns | Rendered | The number of data columns, 1 to 30, or `0` for a number the renderer picks. Outside that range the value is left as it was. The printer starts at automatic. |
| `GS ( k pL pH 48 66 n` | rows | Rendered | The number of rows, 3 to 90, or `0` for automatic. |
| `GS ( k pL pH 48 67 n` | module width | Rendered | 2 to 8 dots. The printer starts at 3. |
| `GS ( k pL pH 48 68 n` | row height | Rendered | The height of a row as a multiple of the module width, 2 to 8, so a row is `n` times the module width in dots. The printer starts at 3. |
| `GS ( k pL pH 48 69 m n` | error correction | Rendered | With `m` of `48`, `n` is the level as an ASCII digit, `48` to `56` for level 0 to 8. With `m` of `49`, `n` is a ratio instead, 1 to 40 tenths of the data codewords as check codewords; the level is only known once the data is compacted, so the ratio is passed on and the symbology picks the level whose number of check codewords comes closest to it. Any other combination leaves the setting as it was. The printer starts at the ratio mode at one tenth. |
| `GS ( k pL pH 48 70 n` | options | Rendered | `0` the standard symbol, `1` the truncated one, which drops the right row indicator and the stop pattern. |
| `GS ( k pL pH 48 80 48 d..` | store data | Rendered | Stored until the next store, like the QR code data. |
| `GS ( k pL pH 48 81 48` | print | Rendered | Draws the symbol as a block, aligned, without a quiet zone. Nothing is printed when the storage is empty, when the data does not fit the number of columns and rows that were asked for, when it is more than 925 codewords, or when the symbol would be wider than the print area. |
| `GS ( k pL pH 48 ..` | any other function | Skipped | Consumed with the length of the group, and nothing happens. |

A symbol never holds fewer than three data codewords: one codeword of data and the length descriptor fill the data area exactly, with no room for the padding codeword the examples of the specification always leave, and readers refuse the result. **That minimum is a decision of this renderer, it is not a rule of the specification.** With no columns or rows given, the automatic size is the number of columns whose symbol comes closest to three times as wide as it is tall, which is what makes a small symbol on a receipt scannable, and the automatic error correction level is the recommendation of the specification, level 2 up to 40 data codewords, 3 up to 160, 4 up to 320 and 5 above that.

<br>

### Images

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC * m nL nH d..` | column mode image | Rendered | `nL + nH * 256` columns. `m` of `0` and `1` are the eight dot modes, one byte per column, `32` and `33` the 24 dot modes, three bytes per column, the most significant bit of the first byte at the top. The single density modes, `0` and `32`, print every column twice, so the image keeps its proportions at half the resolution. The strip goes into the line that is being composed, like one wide cell, and the `LF` behind it commits the line; the encoder sets the line spacing to 24 dots around an image so the strips join up. Any other `m` is read as an eight dot mode, doubled unless `m` is `1`, since its length has to be guessed either way. The encoder only emits `ESC * 33`. |
| `GS v 0 m xL xH yL yH d..` | raster image | Rendered | `xL + xH * 256` bytes per row, eight dots per byte, and `yL + yH * 256` rows. `m` of `0` normal, `1` double width, `2` double height and `3` both, by repeating dots, and `48` to `51` for the same four. Any other value prints the image unscaled. Drawn as a block of its own, aligned the way `ESC a` says. |
| `GS v m ..` | anything that is not `GS v 0` | Reported | The command is only defined with a `0` behind it, so the renderer reports it instead of drawing whatever follows. |
| `GS ( L pL pH 48 fn ..` | graphics | Rendered | The graphics group, whose functions are listed under [Graphics](#graphics). `pL + pH * 256` counts everything behind the two length bytes, so a function the renderer does not know is still consumed whole. An `m` that is not `48` is not this group and is reported. |
| `GS 8 L p1 p2 p3 p4 48 fn ..` | graphics, long form | Rendered | The same group under a four byte length, which is the form a definition of more than 65535 bytes has to use. The functions and their parameters are the same, only the length is longer. **The reference reserves this form for the functions that carry data, `67`, `68`, `83`, `84`, `112` and `113`; this renderer accepts every function of the group under it, which costs nothing and keeps a stream that uses it in sync.** |
| `GS * x y d..` | define the downloaded bit image | Rendered | `x` bytes of eight dots wide and `y` bytes of eight dots tall, `x * y * 8` data bytes in column format: one column after another, `y` bytes per column, the most significant bit of the first byte at the top. There is one downloaded bit image, so a definition replaces the one before it. `x` runs from 1 to 255, `y` from 1 to 48, and `x * y` is at most the 1536 bytes the memory of the printer holds; a size outside those ranges makes the printer ignore the command, so the image that was downloaded before it stays where it is. |
| `GS / m` | print the downloaded bit image | Rendered | `m` of `0` normal, `1` double width, `2` double height and `3` both, and `48` to `51` for the same four, exactly as `GS v 0` scales its image. A mode the command does not define makes the printer ignore it, unlike `GS v 0`, which carries its image in the same command and prints it unscaled. Drawn as a block of its own, aligned the way `ESC a` says. A printer that was never given a definition prints nothing at all and the command is reported. |
| `FS q n [xL xH yL yH d..]..` | define NV bit images | Rendered | `n` images, each `x` bytes of eight dots wide and `y` bytes of eight dots tall, `x * y * 8` data bytes in the column format of `GS *`. The command replaces every NV bit image the printer held, so the images of an earlier definition are gone; an `n` of `0` is outside the range of the command and is ignored, which deletes nothing. The images are numbered 1 to `n`, which is what `FS p` addresses them with. The encoder never sends it. |
| `FS p n m` | print an NV bit image | Rendered | Image `n` in the four modes of `GS /`, a mode outside them ignored the same way. An image the stream never defined prints nothing and the command is reported: a printer holds NV bit images that were put there by a utility, and the renderer has never seen them. |
| `ESC / n` | print downloaded bitmap | Reported | |

An image that is wider than the paper is drawn at the left of the print area and clipped at the right edge of the paper, the way a printer clips it. The barcode rule, which prints nothing at all when the symbol does not fit the paper, is not applied to images: an image that is a few dots too wide still carries its message.

<br>

### Graphics

The functions of the `GS ( L` and `GS 8 L` group, by their function code. Every function carries `m` of `48` in front of the function code.

| Function | Name | Status | Notes |
|---|---|---|---|
| `112` | store raster graphics in the print buffer | Rendered | `a bx by c xL xH yL yH d..`. `a` of `48` is a monochrome image and `52` a multiple tone one, whose tones are drawn as black; any other value is reported. `bx` and `by` of `2` double the width and the height of the image by repeating its dots, exactly as `GS v 0` doubles, and any other value is read as `1`. `c` is the colour of the data, which is drawn whatever colour it names: this renderer has one image buffer where a two colour printer has one per colour, see [Two colour printing](#two-colour-printing). `x` and `y` are the size of the image in dots, 1 to 8192 in the direction the data runs in and 1 to 2047 across it, so a raster image is at most 8192 dots wide and 2047 dots tall. The data is one row after another, `int((x + 7) / 8)` bytes per row, eight dots per byte. A `bx`, `by` or size outside its range makes the printer ignore the command, so nothing is stored and nothing is printed, and a command that carries fewer dots than its size asks for stores only the rows that are there. |
| `113` | store column graphics in the print buffer | Rendered | The same parameters, with the dots one column after another, `int((y + 7) / 8)` bytes per column, the most significant bit of the first byte at the top, so the image is at most 2047 dots wide and 8192 dots tall. The same picture through `112` and `113` prints the same dots. |
| `50` | print the graphics of the print buffer | Rendered | Draws what the store functions gathered as a block of its own, aligned the way `ESC a` says, and empties the buffer. **Images that were stored one after another are drawn under each other, which is a choice of this renderer: the reference does not say where a second store lands.** An empty buffer prints nothing and does not advance the paper. `ESC @` throws the buffer away, as it throws away the print buffer it is part of. |
| `67`, `68` | define NV graphics, raster and column format | Rendered | `a kc1 kc2 b xL xH yL yH [c d..]1..[c d..]b`. The image is kept under the key code `kc1 kc2`, `b` is the number of colour blocks that follow the size, and each block is its colour byte and the dots of the image in the format of the function. Every block is drawn into one image with OR, so nothing an image carried is lost, see [Two colour printing](#two-colour-printing). The sizes are the ones of `112` and `113`, and a size outside its range, or a definition whose dots are missing, makes the command do nothing at all: the image that is under that key code stays where it is. The plan of section 13 had `68` and `84` parsed and skipped; they are rendered here, because the column format is the one of function `113` and the definition costs nothing extra. |
| `83`, `84` | define download graphics, raster and column format | Rendered | The same parameters, in the download memory instead of the NV memory. The two memories have key codes of their own, so the same key code can hold a different image in each. |
| `69` | print NV graphics | Rendered | `kc1 kc2 x y`, where `x` and `y` are `1` or `2`, the `2` doubling the width and the height by repeating dots. A parameter that is missing or outside that range makes the printer ignore the command. Drawn as a block of its own, aligned the way `ESC a` says. A key code the renderer never got a definition for prints nothing at all, does not advance the paper, does not commit the line that is being composed, and the command is reported. |
| `85` | print download graphics | Rendered | The same, from the download memory. |
| `65`, `81` | delete all NV, all download graphics | Rendered | Both take `d1 d2 d3` of `CLR`, the bytes `67 76 82`, and every image of that memory is forgotten. Any other parameter makes the printer ignore the command, so nothing is deleted by accident. |
| `66`, `82` | delete one NV, one download image | Rendered | `kc1 kc2`. A key code that holds no image deletes nothing, as it does on a printer. |
| `48`, `51`, `52` | transmit the memory capacities | Reported | The renderer has no channel back to the host, and the capacities do not change the paper, so the command is reported the way every other request for a status is. |
| `49` | set the reference dot density | Parsed | `x y`, both `50` for 180 dpi and `51` for 360 dpi, which is the density the sizes of the graphics functions are counted in. Consumed and not honoured: this renderer draws one dot of an image on one dot of the paper, at the 203 dpi of both profiles, so a stream that asks for another density prints its image at the size its dots have. |
| `64`, `80` | transmit the key code lists | Reported | The same, they answer the host. |
| anything else | | Reported | Consumed with the length of the group. |

An image a definition function stored stays in the painter for the life of the renderer: an `ESC @` does not delete it, and neither does the end of a stream, so a receipt that defines a logo once and prints it in every job after that renders the way it prints. **That is the NV memory of a printer exactly, and a deviation for the download memory and for the downloaded bit image of `GS *`, which a printer keeps in RAM and clears on `ESC @`.** A second renderer instance starts with nothing, the way a second printer does.


### Two colour printing

A two colour printer has a paper roll with a second colour on it and an image buffer per colour. This renderer draws one bit, black on white, so it has one image buffer and every colour is the black of its paper: the colour commands are consumed and change nothing, and the dots of every colour a graphics command carries are drawn.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC r n` | print colour | Parsed | The colour the characters behind it are printed in, `0` and `48` the first one, `1` and `49` the second. Both are black here. |
| `GS ( N pL pH fn m` | colour of the characters and of their background | Parsed | Function `48` selects the colour of the characters, `49` the colour of the background they are printed on and `50` the shading mode. Nothing changes on this paper: the characters are black whatever colour is selected, and the background of a character is the white of the paper. **A background that is printed would be the invert of `GS B` on a one bit page; the reading of this renderer is the printer instead, because the models these profiles describe have one colour and ignore the group altogether. A stream that prints white on black asks for `GS B`, and one that asks for it with a background colour prints black on white here.** A function the group does not have is reported with all of its bytes. |
| `GS ( L`, `GS 8 L` colour blocks | the colours of a graphics definition | Rendered | The define functions carry a block per colour and the store functions a colour byte. Every block is drawn, combined into one image with OR, so an image a stream sent in the second colour is on the paper instead of missing. See [Graphics](#graphics). |

<br>

### Cut and drawer

| Command | Name | Status | Notes |
|---|---|---|---|
| `GS V n` | cut | Rendered | `1`, `49`, `66` and `104` are a partial cut, every other value a full one. `65`, `66`, `103` and `104` carry a second argument, the paper to feed before cutting, which is consumed and ignored: the blank lines the encoder feeds before a cut are already on the image. Emits a `cut` item, and the lines that are finished become an image item in front of it. |
| `ESC p m t1 t2` | pulse | Rendered | Drawer `m & 1`, `t1 * 2` milliseconds on and `t2 * 2` off. Emits a `pulse` item, which flushes the same way a cut does. The encoder writes its default of 100 and 500 ms as `ESC p 0 50 250`. |
| `ESC i` | full cut, legacy | Rendered | The legacy command without arguments. Emits a `cut` item with the value `full`. |
| `ESC m` | partial cut, legacy | Rendered | The same, with the value `partial`. |

A half composed line stays in the painter and continues behind the command, which is what a printer does when it fires the drawer before the pending line prints. The encoder always finishes the line first, so in practice the line is empty.

<br>

### Printer state and status

These commands change nothing about the paper of the receipt that is being rendered. They are all consumed with the lengths of the specification, so that the stream stays in sync, and the status column says whether the command could have changed the paper of a real printer: the ones that ask the printer something or set something the paper cannot show are **Parsed**, the ones that might have moved a dot are **Reported**, so that a driver sees them. See [Statuses](#statuses) for the rule.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC u n` | transmit peripheral device status | Parsed | The renderer never answers a status request, it has no channel back to the host, and a request cannot reach the paper. |
| `ESC v` | transmit paper sensor status | Parsed | |
| `GS I n` | transmit printer id | Parsed | |
| `GS a n` | automatic status back | Parsed | Switches the status the printer sends by itself, over the channel that is not there. |
| `GS b n` | smoothing | Parsed | Smoothing interpolates the dots of a scaled glyph on the printer. There is no dot of a one bit image it can add or take away here, so it changes nothing that can be drawn. |
| `GS j n` | transmit remaining paper sensor status | Parsed | |
| `GS r n` | transmit status | Parsed | |
| `GS ( H pL pH fn m ..` | request the transmission of a response | Parsed | The whole selector, whichever function it carries: every one of them asks for an answer over the channel that is not there. |
| `DLE EOT n` | transmit real time status | Parsed | One argument byte, and two for `DLE EOT 7 n` and `DLE EOT 8 n`. |
| `DLE ENQ n` | real time request | Parsed | Recovers the printer from an error and restarts or cancels the job. This renderer is never in an error state, so there is nothing to recover from and nothing to cancel. |
| `ESC = n` | select peripheral device | Reported | It can switch the printer off the line, and what a printer that is not listening does with the rest of the stream is not modelled. |
| `ESC U n` | unidirectional printing | Reported | |
| `ESC c n` (`ESC c 3`, `ESC c 4`, `ESC c 5`) | paper sensor and panel button settings | Reported | Consumed as two argument bytes, the selector and its value. The sensor settings stop the printing on a paper end, which is paper. |
| `GS c` | print counter | Reported | |
| `GS g m nL nH` | maintenance counter | Reported | Both `GS g 0` and `GS g 2`, consumed as four argument bytes. |
| `GS z n1 n2` | print density and other settings | Reported | The density is not the only thing behind this command, the "other settings" of its name are not settled here. |
| `GS E n` | print control method | Reported | |
| `GS :` | start or end macro definition | Reported | The macro is printed by `GS ^`, which this renderer does not keep. |
| `FS g 1 m a1..a4 nL nH d..` | write to the user memory | Reported | Consumed with the data length it carries. |
| `FS g 2 m a1..a4 nL nH` | read from the user memory | Reported | |
| `DLE DC4 fn ..` | real time request | Reported | `fn 1 m t` generates a pulse, `fn 2 a b` runs the power off sequence, `fn 8` carries the seven fixed bytes of the clear buffer request, and `fn 3` and `fn 7` one parameter byte each. Anything else is read as the function byte alone. **The lengths of `fn 3` and `fn 7` are the common ones, they are not settled by a specification text that was available here.** This is the one real time command that is reported and not parsed: `fn 1` fires the drawer, which is a `pulse` the driver should see, and `fn 8` clears the buffer, which is the paper. The pulse is reported rather than rendered: it is a real time command the printer performs at once, next to the receipt rather than in it. |

<br>

### Not supported yet

These are the ESC/POS commands the renderer parses but does not render. Every command that was planned for is rendered now; what is left is the list below, and none of it is planned.

- CJK fonts. The Kanji group draws placeholder cells for the characters the stream did not download a glyph for, not glyphs of a font; a receipt that needs real CJK text needs a printer with the font. UTF-8 through `FS ( C` is not decoded either, for the same reason and because the layout of that group is not settled here.
- NV logos and graphics that a utility put in the printer before the stream. An image the stream defines itself is drawn, see [Images](#images) and [Graphics](#graphics); a print of a key code or an image number the stream never defined prints nothing and is reported, because the renderer has never seen what the printer holds.
- Status and settings commands, `GS I`, `GS r`, `GS a`, `ESC u`, `ESC v`, `GS j`, `GS z`, `FS g`, the `DLE` real time commands and the rest of [Printer state and status](#printer-state-and-status): there is no channel back to the host, and the settings do not change the paper. The ones that provably cannot change it are parsed and leave no item, the ones that might are reported.
- Maxicode and the composite symbologies, the other selectors of the `GS ( k` group.

<br>

### Seen in the wild

The tables above say what the renderer does with a command. This one says which commands other producers actually send, taken from the external fixtures: byte streams that [receiptline](https://github.com/receiptline/receiptline), [python-escpos](https://github.com/python-escpos/python-escpos), [escpos-php](https://github.com/mike42/escpos-php) and [ESCPOS_NET](https://github.com/lukevp/ESC-POS-.NET) produced for their own examples and tests, plus the sample streams that two renderers ship to exercise a parser rather than an encoder, [ESCPost](https://github.com/receiptful/escpost) and [escpos-tools](https://github.com/receipt-print-hq/escpos-tools). They are kept in `test/fixtures/external` with their provenance and rendered to golden images.

Every command below is exercised by at least one of those streams. A command that is not in this table is either only sent by ReceiptPrinterEncoder, which the fixtures of the other test files cover, or by nobody the fixtures have seen.

| Command | Name | Status | Seen in |
|---|---|---|---|
| `ESC @` | initialize | Rendered | escpos-php, escpos-tools, escpost, receiptline |
| `FS .` | cancel Kanji mode | Rendered | receiptline |
| `ESC E n` | bold | Rendered | escpos-php, escpos-tools, escpost, python-escpos, receiptline |
| `ESC G n` | double strike | Rendered | escpos-php |
| `ESC - n` | underline | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `GS B n` | invert | Rendered | escpost, python-escpos, receiptline |
| `GS ! n` | character size | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `ESC M n` | font | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `ESC ! n` | print mode | Rendered | escpos-php, escpos-tools, escpost, python-escpos |
| `ESC { n` | upside down printing | Rendered | python-escpos, receiptline |
| `ESC 3 n` | line spacing | Rendered | escpost, python-escpos, receiptline |
| `ESC 2` | default line spacing | Rendered | escpost |
| `ESC d n` | print and feed n lines | Rendered | escpos-php, escpos-tools, escpost, python-escpos |
| `ESC J n` | print and feed n dots | Rendered | escpost |
| `ESC e n` | print and reverse feed n lines | Rendered | escpos-php, the demo, which prints three lines, reverses three lines and prints over them |
| `ESC a n` | alignment | Rendered | escpos-php, escpos-tools, escpost, python-escpos, receiptline |
| `ESC SP n` | right side character spacing | Rendered | escpost, receiptline |
| `ESC $ nL nH` | absolute print position | Rendered | escpost, receiptline |
| `ESC \ nL nH` | relative print position | Rendered | escpost, both the positive and the negative movement, and receiptline |
| `GS L nL nH` | left margin | Rendered | escpos-php, escpost, receiptline |
| `GS W nL nH` | print area width | Rendered | escpos-php, escpost, receiptline |
| `GS P x y` | motion units | Rendered | escpost, which sets them and then feeds in dots |
| `ESC t n` | select codepage | Rendered | escpos-php, python-escpos, receiptline |
| `FS C n` | Kanji code system | Rendered | receiptline |
| `FS - n` | multi byte underline | Parsed | receiptline |
| `FS S n1 n2` | Kanji character spacing | Parsed | receiptline |
| `FS ( A pL pH fn m` | Kanji font | Parsed | receiptline |
| `GS h n` | barcode height | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `GS w n` | barcode module width | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `GS H n` | HRI position | Rendered | escpos-php, escpost, python-escpos, receiptline |
| `GS f n` | HRI font | Rendered | python-escpos |
| `GS k m d1..dk NUL` | barcode, function A | Rendered | python-escpos, with `m` of `4`, Code 39, and escpost, with `2`, EAN-13 |
| `GS k m n d1..dn` | barcode, function B | Rendered | escpos-php, with `m` of `65` to `73`, receiptline, with `69` and `73`, and escpost, with `67` and with `75` to `78`, the GS1 DataBar family its own profiles refuse |
| `GS ( k pL pH 49 ..` | QR code | Rendered | escpos-net, escpos-php and escpost, functions `65`, `67`, `69`, `80` and `81` |
| `GS ( k pL pH 48 ..` | PDF417 | Rendered | escpos-php, functions `65`, `67`, `68`, `69`, `70`, `80` and `81` |
| `GS v 0 m xL xH yL yH d..` | raster bit image | Rendered | escpost, with every `m` it has, python-escpos, receiptline |
| `ESC * m nL nH d..` | bit image | Rendered | escpost, with all four densities, `m` of `0`, `1`, `32` and `33` |
| `GS ( L pL pH 48 112 ..` | store the graphics buffer | Rendered | escpos-tools, python-escpos |
| `GS 8 L p1..p4 48 112 ..` | store the graphics buffer, long form | Rendered | receiptline |
| `GS ( L pL pH 48 50` | print the graphics buffer | Rendered | escpos-tools, python-escpos, receiptline |
| `GS V m`, `GS V m n` | cut | Rendered | escpos-php, escpos-tools, escpost, with the full and the partial cut and with function B, python-escpos, receiptline |
| `ESC p m t1 t2` | pulse | Rendered | escpos-php, escpos-tools |
| `GS a n` | automatic status back | Parsed | receiptline |
| `GS r n` | transmit status | Parsed | receiptline |
| `GS b n` | smoothing | Parsed | python-escpos |

**Not one of these produces an `unknown` item any more.** Four of them did until section 16c: `ESC e`, the reverse line feed of the escpos-php demo, which is rendered now, and `GS a`, `GS r`, `GS b` and `FS ( A`, the status, smoothing and Kanji font commands receiptline and python-escpos put around a job, which are parsed now because none of them can touch the paper. The 296 unknown items the 123 external fixtures carried are 0, so an unknown item in one of these streams is a real gap from here on.

The last rows come from the sample streams of two renderers rather than from an encoder, which is why they reach commands no library above sends: the four bit image densities of `ESC *`, every scaling mode of `GS v 0`, `ESC 2`, `ESC J`, `GS P` and the GS1 DataBar selectors of `GS k`. A renderer writes those by hand to exercise a parser, so they are the part of the table that says what the wild does when it is not an encoder holding the pen.

`npm run contact-sheet` can put the renderings of two of those projects next to ours, where the tools are installed on the machine that builds the page: thermal and ESCPost, each with a coarse agreement metric. See section 16b of the implementation plan for what the two disagree about and why.
