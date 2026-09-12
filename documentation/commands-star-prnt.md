# ReceiptPrinterRenderer

<br>

Render the ESC/POS and StarPRNT commands created by [ReceiptPrinterEncoder](https://github.com/NielsLeenheer/ReceiptPrinterEncoder) to 1-bit images, for receipt printers that only support graphics.

- [About ReceiptPrinterRenderer](../README.md)
- [Usage and installation](usage.md)
- [ESC/POS commands](commands-esc-pos.md)
- [StarPRNT commands](commands-star-prnt.md)
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
  - [Raster mode](#raster-mode)
  - [Cut and drawer](#cut-and-drawer)
  - [Printer state and status](#printer-state-and-status)
  - [Not supported yet](#not-supported-yet)
  - [Seen in the wild](#seen-in-the-wild)
- [Design document](design.md)

<br>

## StarPRNT commands

This page lists every command `StarPrntRenderer` recognises, what it does to the paper, and the exact values it accepts. StarPRNT and Star Line Mode are the same set of commands, so this is the reference for both the `star-prnt` and the `star-line` language of the encoder.

The renderer emulates a Star printer. It interprets the bytes the way the firmware does, including the cases where the firmware prints nothing at all: a barcode with invalid data, a symbol wider than the paper, an argument outside the range of its command, which leaves the setting as it was rather than clipping it.

It deliberately differs from the hardware in a few places, each of them because the behaviour is not on the wire and no hardware check settled it. They are marked in the notes below, and these are all of them: the module widths of `ESC b`, the line spacing of an `ESC z n` that is not `0` or `1`, the feeds of `ESC I`, `ESC J` and `ESC a`, the four dot gap between the bars of a barcode and its human readable text, the reading of `ESC GS x S 0`, a QR model 1 drawn as a model 2 symbol, the basic 43 character set of Code 93, the minimum of three data codewords of a PDF417 symbol, the reading of `ESC h n` and `ESC Q n`, `ESC R n` leaving the sets above 13 alone, `ESC SP n`, whose length and meaning are read from what receiptline writes, the tear bar mode of raster mode read as a partial cut, the twenty four dot band of `ESC k`, the length of `ESC s n1 n2`, the module widths above three of `ESC b`, the layout of `ESC GS S` and its alignment, the assumed layout of `ESC FS q`, the heights of the GS1 DataBar family, which are a reading of the specification pending a hardware check, and the four functions of [page mode](#page-mode) that are not the two the encoder sends, whose numbering, lengths and units are read from the ESC/POS group of the same commands.

Two differences are the printer itself rather than the renderer, and both show up when the same receipt is printed in both languages: a pulse to the second drawer is fixed at 200 ms on and 200 ms off, because the width is not on the wire, and the size multipliers of `ESC i` stop at six where `GS ! n` of ESC/POS goes to eight.

<br>

### Statuses

| Status | Meaning |
|---|---|
| **Rendered** | The command changes the output: dots on the paper, or a `cut`, `pulse` or `feed` item in the item stream. |
| **Parsed** | Recognised and consumed with the right length, but it changes nothing. The notes say why. |
| **Reported** | Consumed with the right length and reported as an `unknown` item that carries all of its bytes, the prefix included. Nothing on paper. |
| **Skipped** | Consumed silently. Nothing on paper, and no item either. |

A `cut`, `pulse`, `feed` or `unknown` item only reaches the output when the driver put that type in the `commands` option, see [Commands the printer supports](usage.md#commands-the-printer-supports). A **Reported** command with `unknown` switched off therefore leaves nothing at all, which is the same paper as **Skipped**.

**Reported** and **Parsed** are the same to the paper and say different things about it. **Reported** means the command may have changed the paper of a real printer and the renderer did not reproduce it, so the `unknown` item is the warning that this receipt could come out differently: a logo the printer holds, a downloaded glyph, a command whose effect is not settled here. A command that cannot touch the paper is **Parsed** instead, however much it changes about the printer: a status request, which has no channel back to the host to answer over, a print density or a print speed, a buzzer the item stream has no sound for. The number of unknown items of a stream is therefore a measure of how much of it this renderer is not showing, which is what the fixtures of section 16 of the [implementation plan](implementation-plan.md) count.

A Star command is `ESC` and a command byte, or `ESC GS`, `ESC RS` or `ESC FS` and a command byte, so the parser has four tables. Every command in them knows how many argument bytes it has, so a command the renderer does not implement never derails the text behind it. A command that is in none of the tables consumes its prefix alone, two bytes or three, which is the best guess there is, and is reported. A command whose arguments run past the end of the stream stops the parser without an error, and everything before it is still rendered.

<br>

### Text and control

| Command | Name | Status | Notes |
|---|---|---|---|
| `0x20`..`0xFF` | printable byte | Rendered | Decoded with the current codepage, one cell per character in the current style. A byte the codepage does not map becomes U+FFFD, which the font draws as its fallback box. A character that no longer fits on the line wraps to the next one, as a printer wraps; a cell wider than the whole line is drawn and clipped, so nothing is dropped silently. |
| `LF` | line feed | Rendered | Commits the line that is being composed and advances the paper. |
| `CR` | carriage return | Skipped | Does not move the paper. The encoder ends every line with `LF CR`. |
| `CAN` | cancel | Rendered | Throws away the print data of the line that is being composed, without advancing the paper. The encoder sends it right behind `ESC @`, where the line buffer is already empty. |
| `ESC @` | initialize | Rendered | Resets style, font, alignment, line spacing, codepage and the stored QR code and PDF417 parameters, and discards a half composed line. The pulse width of `ESC BEL` survives it, as it does on a Star printer. Rows that were already committed stay on the paper, the command does not flush. |
| `ESC GS P n ..` | page mode | Rendered | The page mode group: `ESC GS P 0` enters page mode and `ESC GS P 1` leaves it and prints the page, see [Page mode](#page-mode). The encoder's flush is the two of them with nothing in between, which composes an empty page and prints nothing. |
| `ESC FF n` | execute a raster mode | Rendered | `ESC FF NUL` runs the FF mode, `ESC FF EOT` the EOT mode and `ESC FF EM` the EM mode: the raster image buffer is printed and, when the stored mode cuts, a `cut` item follows it, see [Raster mode](#raster-mode). Any other mode byte is reported, and it is consumed with the command either way, so that it is not executed as a command of its own: `EM` would open a drawer and `LF` would feed a line. |
| `HT` | horizontal tab | Rendered | Moves the cursor to the next tab stop, see [Alignment and position](#alignment-and-position). |
| other bytes below `0x20` | — | Skipped | Everything that is not `HT`, `LF`, `CR`, `CAN`, `BEL`, `FS`, `SUB`, `EM` or `ESC` is ignored, the way a printer ignores it. |

**The end of a stream is not a line feed.** Cells go on the paper when a line feed or a print command commits the line they are on, and at the end of a job the line that is still being composed is thrown away, exactly as `CAN` and `ESC @` throw it away and as a printer leaves it in its line buffer. A receipt still prints in full: its last line ends with a line feed, which committed it. Text without one never prints, here or on paper.

<br>

### Styles and sizes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC E` | bold on | Rendered | Drawn as overstrike, the glyph twice with a one dot horizontal offset, which is what the print head does. |
| `ESC F` | bold off | Rendered | |
| `ESC - n` | underline | Rendered | `0` off, `1` on, and the ASCII digits `48` and `49` for the same two. The Star underline is one dot thick, there is no second thickness. Any other value leaves the underline as it was. |
| `ESC _ n` | upperline | Rendered | The same values, drawn along the top of the cell the way the underline is drawn along the bottom, one dot thick and across the spaces between the characters. An inverted cell gets no upperline, the same rule the underline follows. |
| `ESC 4` | invert on | Rendered | The cell is drawn white on black; the space the line spacing leaves below the line stays white. |
| `ESC 5` | invert off | Rendered | |
| `ESC i h w` | character size | Rendered | The height multiplier first and the width multiplier second, both the value plus one, so `0` to `5` and the ASCII digits `48` to `53` give a multiplier of 1 to 6. A value outside that range leaves the size as it was, as a Star printer does, rather than clipping to six: the multipliers of seven and eight that `GS ! n` of ESC/POS carries have no value in this command. Glyphs are scaled by repeating dots. |
| `ESC RS F n` | font | Rendered | `0` or `48` font A, 12 by 24 dots, `1` or `49` font B, 9 by 24 dots in the Star profile and 9 by 17 in the Epson profile. Font C, `2`, has no glyphs here and leaves the font as it was. |
| `ESC W n` | character expansion, double width | Rendered | `1` or `49` is double width, `0` or `48` is back to one. Any other value leaves the width as it was. |
| `ESC h n` | character height | Rendered | The multiplier is the value plus one, the way `ESC i` counts it, so `1` is double height and `0` is back to one, and the ASCII digits `48` to `53` do the same. A value outside that range leaves the height as it was. **The multiplier of the value plus one is the StarPRNT reading of this command; the Star Line Mode documentation describes it as a double height switch, where `0` and `1` mean the same thing as here.** |
| `ESC ( n` | select character expansion | Reported | |
| `ESC ) n` | cancel character expansion | Reported | |
| `ESC RS C n` | character style | Reported | |
| `ESC RS E n` | character expansion | Reported | |

The encoder emits nothing for italic in this language, so there is no italic command to ignore.

<br>

### Line spacing and feeds

The height of a committed line is the larger of the tallest cell on it and the current line spacing, so a line of double height text is 48 dots and not 64, which is how the firmware behaves as well. The cells sit at the top of the line box and the gap falls below them: with the Star default of 32 dots and a 24 dot cell that is eight dots at every line boundary. An empty line is the line spacing alone. Blocks, which is what barcodes, QR codes, PDF417 symbols and raster images are, advance by their own height and get no line spacing added.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC 0` | line spacing, 3 mm | Rendered | 24 dots, at the eight dots per millimetre of a 203 dpi printer. The encoder writes it in front of a column mode image so that the 24 dot strips join up. |
| `ESC z n` | line spacing | Rendered | `1` is the four millimetre default of a Star printer, so it restores the default line spacing: 32 dots for the Star profile, 30 for the Epson profile, or the `lineSpacing` option when the driver gave one. It is not pinned to 32, because the encoder writes `ESC 0` before an image and `ESC z 1` behind it, and a printer with another line spacing has to come back to its own. `0` is the three millimetres of `ESC 0`. Those two are the only values the encoder emits; any other `n` is read as `n` millimetres, eight dots each, which is an approximation. |
| `ESC a n` | print and feed n lines | Rendered | Commits the line and advances by at least `n` line spacings. A line taller than that still advances by its own height, so nothing overlaps. An approximation: the encoder never emits it. |
| `ESC I n` | print and feed n eighths of a millimetre | Rendered | One dot each. The same approximation. |
| `ESC J n` | print and feed n quarters of a millimetre | Rendered | Two dots each. The same approximation. |
| `ESC 1` | line spacing, 1/8 inch | Reported | The legacy command. |

**There is no reverse feed here.** The ESC/POS renderer prints and moves the paper back with `ESC K` and `ESC e`, and the painter under both languages can do it, but no Star Line Mode or StarPRNT command of the specifications that were available here feeds the paper backwards, and none of the Star streams of the fixtures asks for one. A command that turns up as one can be added to this table later.

Runs of blank rows of at least `feedThreshold` dots become `feed` items and split the image around them, but only when `feed` is in `commands`; otherwise they stay in the image as white rows. The eight blank dots below a line of text belong to the run that follows them, so a feed item usually starts a few rows above the empty line that caused it.

<br>

### Alignment and position

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS a n` | alignment | Rendered | `0` or `48` left, `1` or `49` centre, `2` or `50` right. Applied when the line is committed, over the free width of the line, and to blocks when they are drawn. Any other value leaves the alignment as it was. |
| `HT` | horizontal tab | Rendered | Moves the cursor to the first tab stop beyond it. A tab with no stop behind it does nothing, and neither does one when every stop was cancelled. A stop that lies outside the print area puts the cursor one dot beyond the area, so that the character behind the tab wraps to a new line. |
| `ESC D n1..nk NUL` | horizontal tab positions | Rendered | Up to 32 stops, each `n` times the width of a character of the font that is current when the command arrives, which is the cell of that font plus the character spacing of `ESC SP` behind it, zero by default. The stops have to ascend, one that does not ends the list. `ESC D NUL` cancels every stop, after which `HT` does nothing at all, and `ESC @` puts the default back, a stop every eight characters of font A. |
| `ESC l n` | left margin | Rendered | The left margin, `n` characters of the current font. The command is only effective at the beginning of a line: a line that already holds characters, or whose cursor was moved, makes the printer drop it, and this renderer drops it too. |
| `ESC Q n` | right margin | Rendered | The column the print area ends at, counted from the left edge of the paper, so the area is `n` minus the left margin characters wide. It is only effective at the beginning of a line, like `ESC l`. A value that is not beyond the left margin leaves the area at the paper minus the left margin, which is where a printer without a right margin prints. Wrapping, the alignment and the tab stops all work inside the area. **That the right margin is a column rather than a width is the reading that makes `ESC l` and `ESC Q` line up with `GS L` and `GS W` of ESC/POS; no hardware check settled it.** |
| `ESC SP n` | right side character spacing | Rendered | The space behind every cell, in dots, the Star counterpart of `ESC SP` of ESC/POS. The ASCII digits `'0'` to `'9'` are read as 0 to 9, the way the arguments of `ESC b` are, and every other value as the number of dots it is. The space scales with the width multiplier of the characters, it counts towards the width of a character for `ESC D`, and it is not drawn behind the last character of a line. **No StarPRNT specification text was available here, so both the length and the meaning are a reading, and the source of it is receiptline: it writes `ESC SP '0'` in the setup of its three thermal Star command sets and `ESC SP 0x00` in the one of its impact set, one argument byte and no spacing at all in both forms, next to an `ESC s` and an `ESC z` it writes in the same two forms.** Every Star stream the fixtures have seen sets it to zero, so nothing in the wild moves by it. |
| `ESC GS A n1 n2` | absolute print position | Rendered | `n1 + n2 * 256` dots from the left margin, the Star counterpart of `ESC $`. A position beyond the print area is ignored. Cells that were already placed stay where they are, so moving back and printing again overprints, the way a printer overprints. |
| `ESC GS R n1 n2` | relative print position | Rendered | The same, relative to the cursor and signed: a value above 32767 is the negative distance below it, which moves back towards the left margin. A distance that lands outside the print area is ignored. |
| `ESC RS A n` | print area | Reported | |
| `ESC GS \ n1 n2` | vertical position | Reported | |

The print area, the direction and the two vertical positions of page mode are in [Page mode](#page-mode) below.

<br>

### Page mode

In page mode the printer composes a page in memory, in a print area on that page and in one of four print directions, and prints the whole area in one go. The semantics are the ones of [page mode of the ESC/POS page](commands-esc-pos.md#page-mode), which this renderer implements once in its painter for both languages: the same four rotations, the same wrapping and discarding inside the area, the same rule for how tall the printed page is, the same print area and print direction surviving the page they were set on, and the same holding of a `cut` or a `pulse` until the page is on the paper. The one difference is the unit: every distance of this group counts in dots, where the ESC/POS commands count in motion units.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS P 0` | page mode | Rendered | Enters page mode, and only at the beginning of a line: a line that already holds characters, or whose cursor was moved, drops the command. |
| `ESC GS P 1` | line mode | Rendered | Leaves page mode and prints the page. A page without a print area and without a dot prints nothing at all, which is why the encoder's flush, `ESC GS P 0 ESC GS P 1` around a job, leaves every receipt exactly as it was. |
| `ESC GS P 2 n1..n8` | print area | Rendered | The origin and the size of the print area, each of them two bytes, low byte first, **in dots**, which is the unit of `ESC GS A` and `ESC GS R`. A width or a height of `0`, and an origin outside the page, make the command do nothing. Like `ESC W` of ESC/POS the area is a setting of the printer: it may be set in line mode, the next page starts in it, and `ESC @` puts it back. |
| `ESC GS P 3 n` | print direction | Rendered | `0` to `3`, and the ASCII digits for the same: left to right, bottom to top, right to left and top to bottom, the four directions of `ESC T` of ESC/POS, and a setting of the printer in the same way. |
| `ESC GS P 4 n1 n2` | absolute vertical position | Rendered | Two bytes, low byte first, in dots along the vertical axis of the print direction, from the start of the print area. A position outside the area is ignored. |
| `ESC GS P 5 n1 n2` | relative vertical position | Rendered | The same, relative to the position and signed: a value above 32767 is the negative distance below it. |

**Functions 0 and 1 are the two the wild sends, and the four others are a reading.** ReceiptPrinterEncoder writes `ESC GS P '0'` and `ESC GS P '1'` as its flush, around a job and not around a page, which is exactly what entering page mode and leaving it again does on a printer: it prints what the printer holds. The other four functions are the print area, the direction and the two positions of the ESC/POS group under Star's numbering, with the lengths and the dot unit that numbering implies. **No StarPRNT specification text was available here to confirm the four**, no stream of the fixtures sends one, and the consequence of the reading being wrong is a stream that desynchronises on a command this renderer would otherwise have consumed as one byte. The `page-mode-directions` fixture is the same page in both languages, which the parity test compares dot for dot.

<br>

### Codepages and character sets

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS t n` | select codepage | Rendered | `n` is looked up in the `codepageMapping` the renderer was built with, which has to be the mapping the encoder used. The printer starts in entry `0` of that mapping, the Star specific standard character set, and `ESC @` returns to it; an unknown number lands there as well, and so does a codepage the codepage encoder does not implement. |
| `ESC R n` | international character set | Rendered | Sets `0` to `13`: USA, France, Germany, United Kingdom, Denmark I, Sweden, Italy, Spain I, Japan, Norway, Denmark II, Spain II, Latin America and Korea. The set replaces the twelve code points `0x23`, `0x24`, `0x40`, `0x5B`, `0x5C`, `0x5D`, `0x5E`, `0x60`, `0x7B`, `0x7C`, `0x7D` and `0x7E`, after the codepage decoding and only for those twelve bytes. `ESC @` goes back to the set that replaces nothing. **Star numbers these sets the way Epson does and the renderer uses the Epson table for them; Star also defines sets above 13, and those tables are not in the specification text that was available here, so a number above 13 leaves the set as it was.** |
| `ESC c n` | select character set | Reported | |

<br>

### Barcodes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC b n1 n2 n3 n4 d.. RS` | barcode | Rendered | `n1` is the symbology, see the table below, as the number or as the ASCII digit of it, so `4` and `52` are both Code 39. Only the symbologies numbered 0 to 9 have a digit; `58` to `61`, the bytes behind the nine, are not digits and are reported like any other value the command does not define. `n2` is `2` or `50` for the human readable text below the bars, which a Star printer draws in font A, and anything else for a barcode without text. `n3` is the module width: `1`, `2` and `3` are 2, 3 and 4 dots, `4`, `5` and `6` are the same three widths of Code 39 and Codabar, and `8` is the middle width of ITF, each of them as the number and as the ASCII digit of it. Any other value is read as `1`. **Star gives `n3` a table of narrow and wide element widths per symbology, and the values above three are the ones receiptline writes, which is the only evidence of those tables there is here. The table is flat, so a value that means different widths for different symbologies keeps the one of the general case: ITF is the only symbology with such a value, its widest, which draws three dots here instead of four.** `n4` is the height of the bars in dots, with `0` read as one dot. The data runs to the record separator and is read as ASCII; data that holds a `0x1e` byte itself therefore ends the command early, which is inherent to the framing of the command, and the encoder never sends one. |

**The three module widths are an assumption.** The Star documentation describes them in narrow and wide element widths per symbology rather than in dots; 2, 3 and 4 dots is the reading that makes a Star barcode the same size as the ESC/POS barcode the encoder produces from the same receipt, where the same width option is written as `GS w n` plus one. No hardware check settled it.

The bars are drawn as a block of their own: the pending line is committed first, the block is aligned the way `ESC GS a` says, and the paper advances by the height of the block. Barcodes carry no quiet zone, a printer does not print one either.

Data that is not valid for the symbology prints nothing at all and does not advance the paper, which is what printer firmware does. The same goes for a barcode whose bars are wider than the print area: the printer prints nothing rather than a barcode no reader can read. The human readable text is not part of that rule, it is centred under the bars and clipped when it is wider than the paper.

The GS1 DataBar family is the one family whose height is not only the height of `n4`. ISO/IEC 24724 gives all four variants a height: thirteen modules for Truncated, ten for Limited, thirty three for Omnidirectional and thirty four for Expanded, in modules, so they follow the width of a module of `n3`. **The specification words all four as minimums, and the printer notes of this family are remembered as the height command having no effect on it at all, which no hardware check settled here. This renderer reads the heights of Truncated and Limited as fixed, so that a large `n4` does not turn a Truncated symbol back into the Omnidirectional one it has the bars of, and the heights of Omnidirectional and Expanded as minimums, so that a taller `n4` still makes those symbols taller.** The human readable text of these symbols is the element string with its application identifiers in parentheses.

Omnidirectional is ninety six modules wide, of which ninety five are printed, and Limited is seventy nine, of which seventy three are printed: the module in front of the left guard bar, and the five module space behind the right guard bar of Limited, are quiet zone and a printer does not print them either. The parenthesised notation of Expanded has no escape for a parenthesis inside a value, so an `(` in the data always starts the next application identifier, which is what BWIPP and the reference encoders do with it as well.

The human readable text is one line of cells in font A, drawn without any style, so it is never affected by the bold, underline, invert or size of the text around it. Between the bars and the text sits a gap of four dots, because the cell of the font has no room of its own above a capital and the text would otherwise touch the bars. **That gap is a legibility choice of this renderer, not a number from a specification, and it has not been compared with what a Star printer puts on paper.**

<br>

### Barcode symbologies

`n1` of `ESC b`, and what the renderer draws for it. The numbers are Star's own, they are not the ones of `GS k` in ESC/POS, but they map onto the same generators.

| Value | Symbology | Status | Notes |
|---|---|---|---|
| `0` | UPC-E | Rendered | Six digits, seven with the number system in front of them, eight with the check digit behind them as well, or the eleven or twelve digits of the UPC-A the symbol stands for, which is compressed when it has a zero suppressed form and refused when it has none. Only the number systems `0` and `1` have such a form. |
| `1` | UPC-A | Rendered | Eleven or twelve digits. The check digit is computed when it is missing and validated when it is there, and a wrong one prints nothing. Drawn as the EAN-13 it is, with the leading zero left out of the text. |
| `2` | EAN-8 | Rendered | Seven or eight digits, the check digit computed or validated. |
| `3` | EAN-13 | Rendered | Twelve or thirteen digits, the check digit computed or validated. |
| `4` | Code 39 | Rendered | No check digit, as the firmware computes none. The start and stop character are added by the renderer, so a `*` in the data prints nothing. Lower case is printed as upper case, a character outside the set prints nothing. A wide element is three modules. |
| `5` | ITF | Rendered | An even number of digits. An odd number prints nothing rather than being padded, because padding would change the number. A wide element is three modules. |
| `6` | Code 128 | Rendered | StarPRNT has no way to select a code set, and the encoder strips the `{A`, `{B` and `{C` selection it passes through on ESC/POS, so the renderer picks the code sets the way a printer does: code set C for a run of four digits or more and for a value that starts with two, code set A only when the value needs the control characters, and never the shift. This is exactly what symbology `79` of ESC/POS does. A byte above 127 fits in no code set and prints nothing. |
| `7` | Code 93 | Rendered | Two check characters are computed and drawn. Only the basic 43 character set is encoded, the full ASCII variant is not implemented, as printer firmware does not implement it either; a character outside the set prints nothing. |
| `8` | Codabar | Rendered | The start and stop characters are `A` to `D`. Data without them gets an `A` on both sides, data with only one of the two, or with one of those letters in the middle, prints nothing. They are part of the human readable text, as the firmware prints them. A wide element is two modules. |
| `9` | GS1-128 | Rendered | A Code 128 with FNC1 behind the start symbol and the code sets picked for the data. The encoder strips `(`, `)` and `*` from the value before it sends it. |
| `10` | GS1 DataBar Omnidirectional | Rendered | Thirteen digits, or fourteen with the check digit, which is validated; a wrong one prints nothing. The symbol is the RSS-14 of ISO/IEC 24724, ninety six modules of four data characters and two finder patterns. The height is at least thirty three modules, whatever `n4` says. |
| `11` | GS1 DataBar Truncated | Rendered | The same data and the same bars as Omnidirectional, thirteen modules tall, which is the height the specification gives it and which `n4` does not change. |
| `12` | GS1 DataBar Limited | Rendered | Thirteen or fourteen digits of a GTIN that starts with a zero or a one, seventy nine modules of two data characters with a check character between them. Ten modules tall, whatever `n4` says. |
| `13` | GS1 DataBar Expanded | Rendered | A GS1 element string with its application identifiers in parentheses, `(01)90614141000015(3103)000123`, in four to twenty two symbol characters, with the compressed encodation methods of AI `(01)` where the element string allows them, a weight in AI `(3103)`, `(3202)` or `(3203)`, a weight in AI `(3100)` to `(3109)` or `(3200)` to `(3209)` with an optional date in AI `(11)`, `(13)`, `(15)` or `(17)`, and a price or a rate in AI `(392x)` or `(393x)`, and the general purpose method for everything else, the rest of the 31xx and 32xx blocks included. The height is at least thirty four modules. Data that is not an element string, or that holds a character no compaction method has, prints nothing. |
| any other | — | Reported | |

<br>

### QR codes

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS y S 0 n` | model | Parsed | `1` is model 1, everything else model 2. The value is stored but never used: both models are drawn as a model 2 symbol, which is a deviation from the hardware. |
| `ESC GS y S 1 n` | error correction | Rendered | `0` L, `1` M, `2` Q, `3` H. Any other value leaves it as it was. The printer starts at L. |
| `ESC GS y S 2 n` | module size | Rendered | `n` dots per module, clamped to 1 to 8, which is the range the encoder accepts. The printer starts at 3. |
| `ESC GS y D 1 m nL nH d..` | store data | Rendered | `nL + nH * 256` bytes, stored and encoded in the byte mode of the specification, so any byte survives whatever codepage the reader assumes. The storage survives until the next store, so two print commands print the same symbol twice. `ESC @` empties it. |
| `ESC GS y P` | print | Rendered | Draws the symbol as a block, aligned the way `ESC GS a` says, one dot per module scaled by the module size and without a quiet zone, as a printer prints it. The version is the smallest one the data fits in at the error correction level that was asked for. Nothing is printed, and the paper does not advance, when the storage is empty, when the data does not fit in the largest symbol of that level, or when the symbol would be wider than the print area. |
| `ESC GS y S n ..` | any other parameter | Skipped | An `S` command is always three bytes, so a sub-function other than `0`, `1` and `2` is consumed and changes nothing. |
| `ESC GS y ..` | any other function | Skipped | A function byte that is not `S`, `D` or `P` is consumed as one argument byte, and nothing happens. |

<br>

### PDF417

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS x S 0 n n1 n2` | size | Rendered | `n` of `0` leaves both the rows and the columns to the renderer, `1` takes the `n1` rows and the `n2` columns that follow, where a zero is automatic for that one alone. The rows are 3 to 90 and the columns 1 to 30, and a number outside its range leaves that one as it was. Any other `n` leaves the size as it was. The encoder always sends `1`. **This reading is not settled by hardware, it is the one that makes a Star receipt print the symbol the ESC/POS receipt prints.** |
| `ESC GS x S 1 n` | error correction | Rendered | Level `0` to `8`. A higher value leaves it as it was. The printer starts at level 0. |
| `ESC GS x S 2 n` | module width | Rendered | 2 to 8 dots. The printer starts at 2. |
| `ESC GS x S 3 n` | row height | Rendered | The height of a row as a multiple of the module width, 2 to 8, so a row is `n` times the module width in dots. The printer starts at 2. |
| `ESC GS x D nL nH d..` | store data | Rendered | `nL + nH * 256` bytes. There is no function byte between the `D` and the length, unlike the QR code command. Stored until the next store. |
| `ESC GS x P` | print | Rendered | Draws the symbol as a block, aligned, without a quiet zone. Nothing is printed when the storage is empty, when the data does not fit the number of columns and rows that were asked for, when it is more than 925 codewords, or when the symbol would be wider than the print area. |
| `ESC GS x S n ..` | any other parameter | Skipped | An `S 0` command is five bytes and every other `S` command three, so a sub-function other than `0` to `3` is consumed and changes nothing. |
| `ESC GS x ..` | any other function | Skipped | A function byte that is not `S`, `D` or `P` is consumed as one argument byte, and nothing happens. |

The StarPRNT command set has no command for the form of the symbol, so a Star printer always prints the standard symbol and never the truncated one that ESC/POS can ask for.

A symbol never holds fewer than three data codewords: one codeword of data and the length descriptor fill the data area exactly, with no room for the padding codeword the examples of the specification always leave, and readers refuse the result. **That minimum is a decision of this renderer, it is not a rule of the specification.** With no columns or rows given, the automatic size is the number of columns whose symbol comes closest to three times as wide as it is tall, which is what makes a small symbol on a receipt scannable.

<br>

### Images

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC X nL nH d..` | column mode image, 24 dots | Rendered | `nL + nH * 256` columns, three bytes per column, the most significant bit of the first byte at the top. The strip goes into the line that is being composed, like one wide cell, and the `LF CR` behind it commits the line; the encoder writes `ESC 0` in front of an image so that the 24 dot strips join up. This is the only image command the encoder emits. |
| `ESC L nL nH d..` | bit image, fine density | Rendered | A strip of eight rows, one byte per column, with the number of data bytes in the two length bytes. One dot per column. |
| `ESC K nL nH d..` | bit image, normal density | Rendered | The same, but every column is printed twice, so the image keeps its proportions at half the resolution. |
| `ESC k nL nH d..` | bit image, twenty four dot band | Rendered | A band of twenty four dot rows: `nL + nH * 256` is the width of a row in bytes of eight dots, and that many bytes follow per row, twenty four rows of them, in raster format. The band goes into the line that is being composed, like one wide cell, and the `LF` behind it commits the line; a producer writes `ESC 0` in front of an image so that the bands join up. A band of zero bytes prints nothing. **This is the reading receiptline sends, see [Seen in the wild](#seen-in-the-wild) and the notes of section 16 of the implementation plan: it prints its images in Star Line Mode as bands of twenty four rows behind `ESC 0`, and the render of the same document is then dot for dot the ESC/POS one. No Star Line Mode specification text was available here; the earlier reading of this page, an eight row strip of one byte per column like `ESC L`, printed the remaining twenty three rows of every band as text and is what the capture of section 16 corrected.** |
| `ESC GS S m n1 n2 n3 n4 n5 d..` | raster image | Rendered | The raster image the Star SDKs print a picture with. `m` of `1`, and the ASCII digit `49` for the same, is the raster bit image; any other value is a variant this renderer does not know and is reported, its data consumed. `n1 + n2 * 256` is the width of the image in bytes of eight dots, `n3 + n4 * 256` its height in dots, and `n5` is the fixed byte the command carries, which is consumed and ignored. The dots follow in raster format, one row after another, exactly as `GS v 0` carries them on ESC/POS. Drawn as a block of its own, aligned the way `ESC GS a` says and inside the print area of `ESC l` and `ESC Q`, like every other block. **The layout is the one of the plan and of this page; no Star specification text was available here to confirm it, and a variant with two bytes in front of the size is described elsewhere and is not what this renderer reads.** |
| `ESC FS p n m` | print an NV logo | Reported | The logo is stored in the printer by a utility, so the renderer has never seen it and prints nothing. Two argument bytes, the number of the logo and the mode. |
| `ESC FS q n [xL xH yL yH d..]..` | define logos | Reported | **Consumed with the layout of the ESC/POS command of the same name, `n` images of `x` bytes wide and `y` bytes of eight dots tall, because no Star specification text that was available here settles the layout of this command. Nothing is kept and nothing is drawn, so a logo this command defines is not printed by `ESC FS p` either.** |
| `ESC * r ..` | raster mode group | Rendered | The raster commands of the TSP100 family, see [Raster mode](#raster-mode). An `ESC *` that is not followed by an `r` is consumed as one argument byte and reported. |

<br>

### Raster mode

Raster mode is a second way to print, and the only one a TSP100 has: rows of dots go into an image buffer and an execute command prints the buffer, feeds and cuts. The renderer reads it, so a job that a driver built from the items of this renderer with [StarGraphicsPrinterEncoder](https://github.com/NielsLeenheer/StarGraphicsPrinterEncoder) renders back to the receipt it was made from.

Two rules of the mode shape the parsing. A setting is ignored while data is in the image buffer, so a job stores the mode of a cut before it sends the rows of that segment. And an execute command on an empty buffer does nothing at all, so a job that has to cut without rows sends one blank row first.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC * r R` | initialize raster mode | Rendered | Throws the image buffer away and puts the margins and the modes back to their initial values. |
| `ESC * r A` | enter raster mode | Rendered | The same, and `b` and `k` are the row commands from here on instead of the letters b and k. |
| `ESC * r B` | quit raster mode | Rendered | Prints what is left in the buffer, performing the EOT mode, and leaves raster mode. That is the specification itself, not a reading: raster mode ends by executing the EOT mode when raster data still remains in the image buffer, so a job that quits with rows in the buffer and the initial mode of a model with a cutter cuts the paper. |
| `ESC * r C` | clear raster data | Rendered | Throws the image buffer away without printing it. |
| `b n1 n2 d..` | raster data with a line feed | Rendered | One row of `n1 + n2 * 256` bytes of dots, eight dots per byte, placed at the left margin of the raster and padded with white to the width of the paper. Data is written into the row with an OR, and the position moves to the next row. A row that is wider than the paper is cut off. The rows are drawn on the paper itself: the left margin and the print area of the line mode, `ESC l` and `ESC Q`, neither shift them nor clip them, only `ESC * r m l` moves them. |
| `k n1 n2 d..` | raster data | Rendered | The same without the line feed, so the command behind it writes into the same row. |
| `ESC * r Y n NUL` | move down n dots | Rendered | Moves the position `n` dots down. A row that was being built by a `k` command is the first of those dots, so it is closed and `n` minus one blank rows follow it; with no row in hand the whole `n` are blank rows. They become a `feed` item when the driver supports one. `n` is clamped to 65535, a dot count larger than any paper. |
| `ESC * r E n NUL` | set the EOT mode | Rendered | The mode `ESC FF EOT` performs. |
| `ESC * r F n NUL` | set the FF mode | Rendered | The mode `ESC FF NUL` performs. |
| `ESC * r e n NUL` | set the EM mode | Rendered | The mode `ESC FF EM` performs. |
| `ESC FF NUL`, `ESC FF EOT`, `ESC FF EM` | execute a mode | Rendered | Prints the image buffer and cuts when the stored mode says so: `8` and `9` are a full cut, `12` and `13` a partial one, and `3`, which feeds to the tear bar of a model without a cutter, is read as a partial cut as well, because a tear bar is the closest thing to a cut the item stream has. `0`, `1` and `2` print without cutting, and so does every mode the table does not define. A printer with a cutter starts at `13`, which is the mode a job that sets none is read with. An execute command with an empty buffer does nothing. |
| `ESC * r D n NUL` | drive drawer | Rendered | `1` opens the first drawer, `2` the second and `3` both, and `0` opens none. The times are the ones of the line mode commands, so `ESC BEL` still sets the width of the first drawer and the second one is fixed at 200 ms on and 200 ms off. The specification has the printer ignore this command while data is in the image buffer; the renderer prints that data first instead, so that the paper is right whatever a stream does. |
| `ESC * r m l n NUL` | left margin of the raster | Rendered | `n` bytes of eight dots from the left edge of the paper. The rows that follow are placed there. |
| `ESC * r m r n NUL` | right margin of the raster | Parsed | Stored and not used: a row is cut off at the paper, not at the right margin. |
| `ESC * r P n NUL` | page length | Parsed | The paper of the renderer has no pages. |
| `ESC * r Q n NUL` | print quality | Parsed | |
| `ESC * r t n NUL` | top margin | Parsed | |
| `ESC * r K n NUL` | print colour | Parsed | The second colour of a two colour paper roll. |
| `ESC * r a`, `ESC * r b` | start and end a block | Parsed | The command emulator mode of the specification. |

Rows that are still in the image buffer when the stream ends are printed, so that a job that forgot its execute command is not lost.

<br>

### Cut and drawer

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC d n` | cut | Rendered | `1` and `3`, and the ASCII digits `49` and `51`, are a partial cut, every other value a full one. The variants that feed the paper to the cutter first cut the same way, the feed is already on the paper. Emits a `cut` item, and the lines that are finished become an image item in front of it. |
| `ESC BEL n1 n2` | pulse width | Rendered | The width of the pulse that `BEL` and `FS` send to the first drawer, in units of ten milliseconds. The setting survives `ESC @`, as it does on a Star printer, and it is reset to 200 ms on and 200 ms off at the start of every stream. |
| `BEL`, `FS` | open the first drawer | Rendered | Emits a `pulse` item for device `0`, with the width `ESC BEL` set, or 200 ms on and 200 ms off when it was never sent. |
| `SUB`, `EM` | open the second drawer | Rendered | Emits a `pulse` item for device `1`, always 200 ms on and 200 ms off, which the specification fixes: the width of the second drawer is not on the wire. A receipt that asks for other times therefore does not survive the round trip through this language, which is the printer and not the renderer. |

A half composed line stays in the painter and continues behind the command, which is what a printer does when it fires the drawer before the pending line prints. The encoder always finishes the line first, so in practice the line is empty.

<br>

### Printer state and status

These commands change nothing about the paper of the receipt that is being rendered. They are all consumed with the lengths of the Star Line Mode and Star Graphic Mode specifications, so that the stream stays in sync, and the status column says whether the command could have changed the paper of a real printer: the ones that ask the printer something or set something the paper cannot show are **Parsed**, the ones that might have moved a dot are **Reported**, so that a driver sees them. See [Statuses](#statuses) for the rule.

| Command | Name | Status | Notes |
|---|---|---|---|
| `ESC GS ETX s n1 n2` | automatic status | Parsed | The renderer never answers a status request, it has no channel back to the host, and a request cannot reach the paper. |
| `ESC ACK SOH` | real time status | Parsed | The three bytes of the Star Graphic Mode status request. receiptline ends every raster mode job with it, see [Seen in the wild](#seen-in-the-wild). |
| `ESC GS # n` | print density | Parsed | The darkness of the dots, which a one bit image has no room for. |
| `ESC RS d n` | print density | Parsed | The same. |
| `ESC RS r n` | print speed | Parsed | How fast the paper moves, not where it stops. |
| `ESC RS a n` | print start control | Parsed | When the printer starts printing what it has buffered, which changes the timing and not the paper. |
| `ESC s n1 n2` | printer setting | Parsed | **Consumed with two argument bytes, which is the length receiptline writes it with in its printer setup, `ESC s '0' '0'`; no Star specification text that was available here names this command, so neither its name nor its effect is settled.** It is parsed with the rest of that setup because every other command of it is a setting that the paper cannot show, and because the streams that carry it print the same receipt as the ESC/POS streams of the same document, which the parity test of `test/external.js` checks dot for dot. |
| `ESC GS BEL m n1 n2` | buzzer | Parsed | Three argument bytes. The buzzer is not part of the paper and the item stream has no sound, so nothing happens. |
| `ESC GS EM DC1 m n1 n2`, `ESC GS EM DC2 m n1 n2` | buzzer | Parsed | Four argument bytes, the `DC1` or `DC2` included. |
| `ESC GS b n` | blackmark and sensor settings | Reported | The sensor settings decide where the paper stops, which is paper. |
| `ESC GS c n` | colour | Reported | A second ribbon or a second thermal layer, which this renderer does not draw. |

<br>

### Not supported yet

These are the StarPRNT and Star Line Mode commands the renderer parses but does not render. Every command the [implementation plan](implementation-plan.md) planned for is rendered now; what is left is the list below, and none of it is planned.

- CJK fonts. A receipt that needs real CJK text needs a printer with the font.
- User defined characters: glyphs downloaded into the printer.
- NV logos: images a utility stored in the printer, which the renderer has never seen. `ESC FS p` reports an `unknown` item and prints nothing, and so does the definition command `ESC FS q`, whose layout is not settled here.
- Status and settings commands, `ESC GS ETX`, `ESC GS #`, `ESC GS b`, `ESC GS c`, `ESC RS a`, `ESC RS d`, `ESC RS r` and the rest of [Printer state and status](#printer-state-and-status): there is no channel back to the host, and the settings do not change the paper. The ones that provably cannot change it are parsed and leave no item, the ones that might are reported.
- The buzzer, `ESC GS BEL` and `ESC GS EM`: the item stream carries paper, cuts and drawers, and no sound.
- Maxicode and the composite symbologies, which this command set has no selector for in anything the renderer parses.

<br>

### Seen in the wild

The tables above say what the renderer does with a command. This one says which commands another producer actually sends, taken from the external fixtures of [section 16 of the implementation plan](implementation-plan.md): byte streams that [receiptline](https://github.com/receiptline/receiptline) produced for its own example documents, kept in `test/fixtures/external/receiptline` with their provenance and rendered to golden images.

receiptline is the only library of that set with a Star back end, and it has three: `starsbcs` is StarPRNT, `starlinesbcs` is Star Line Mode, and `stargraphic` is the raster mode of a TSP100. The same twenty one documents also go through its ESC/POS command sets, which is what the parity test of `test/external.js` compares.

The sources of section 16b, the sample streams and the reference renderers, are ESC/POS only: ESCPost, escpos-tools and thermal neither write nor read a Star language, so this table is unchanged by them, and the reference renderings on the contact sheet leave the Star fixtures out for the same reason.

| Command | Name | Status | Seen in |
|---|---|---|---|
| `ESC @` | initialize | Rendered | receiptline, every command set |
| `ESC E`, `ESC F` | bold on and off | Rendered | receiptline |
| `ESC - n` | underline | Rendered | receiptline, always with the one dot thickness Star has |
| `ESC 4`, `ESC 5` | invert on and off | Rendered | receiptline |
| `ESC i n1 n2` | character size | Rendered | receiptline |
| `ESC RS F n` | font | Rendered | receiptline |
| `ESC 0` | line spacing of 24 dots | Rendered | receiptline, once in its printer setup and again in front of every image and every ruled line |
| `ESC GS a n` | alignment | Rendered | receiptline |
| `ESC l n` | left margin | Rendered | receiptline |
| `ESC Q n` | right margin | Rendered | receiptline |
| `ESC GS A n1 n2` | absolute print position | Rendered | receiptline, for every column of a table |
| `ESC GS R n1 n2` | relative print position | Rendered | receiptline, for every vertical rule |
| `ESC SP n` | right side character spacing | Rendered | receiptline, in the setup of all four of its Star command sets, always as no spacing at all |
| `ESC GS t n` | select codepage | Rendered | receiptline, cp437 for the text and cp437 for the box drawing of its rules |
| `ESC b n1 n2 n3 n4 d.. RS` | barcode | Rendered | receiptline, with the symbology and the module width as ASCII digits, Code 39 and Code 128 |
| `ESC k nL nH d..` | bit image, twenty four dot band | Rendered | receiptline, for every image in Star Line Mode |
| `ESC GS S m n1..n5 d..` | raster image | Rendered | receiptline, for every image in StarPRNT |
| `ESC * r ..` | raster mode group | Rendered | receiptline, the `stargraphic` command set: `ESC * r A` to enter, `ESC * r P` for the page mode, `ESC * r Y` for every line feed, `b` for every row of dots and `ESC * r B` to leave, which prints the buffer and cuts in the default mode |
| `ESC d n` | cut | Rendered | receiptline |
| `ESC s n1 n2` | printer setting | Parsed | receiptline, in its printer setup |
| `ESC GS ETX s n1 n2` | automatic status | Parsed | receiptline, at the end of every job |
| `ESC RS a n` | print start control | Parsed | receiptline, in its printer setup |
| `ESC ACK SOH` | real time status | Parsed | receiptline, at the end of every raster mode job |

**Not one of these produces an `unknown` item any more.** Five of them did until section 16c: `ESC SP`, `ESC s`, `ESC RS a` and `ESC GS ETX` of the printer setup and the status channel of the text command sets, and `ESC RS a` and `ESC ACK SOH` of the raster one, 168 items over the 47 Star fixtures. `ESC SP` is rendered now, as the character spacing it is, and the other four are parsed because none of them can touch the paper.
