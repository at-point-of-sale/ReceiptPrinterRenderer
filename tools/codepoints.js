import CodepageEncoder from '@point-of-sale/codepage-encoder';

/*
    The code points the renderer can ever print, shared by tools/generate.js,
    which rasterizes a glyph for each of them, and tools/subset-font.js, which
    keeps exactly those glyphs in the font source.
*/

/* The character drawn for a code point without a glyph */

export const REPLACEMENT_CHARACTER = 0xfffd;

/**
 * Every code point that can occur in a codepage of the codepage encoder, plus
 * printable ASCII, which every codepage shares
 *
 * @return {number[]}   Sorted list of code points
 */
export function usedCodepoints() {
  const used = new Set();

  for (const encoding of CodepageEncoder.getEncodings()) {
    for (const codepoint of CodepageEncoder.getCodepoints(encoding, true)) {
      if (codepoint) {
        used.add(codepoint);
      }
    }
  }

  for (let codepoint = 0x20; codepoint <= 0x7e; codepoint++) {
    used.add(codepoint);
  }

  return [...used].sort((a, b) => a - b);
}

export default usedCodepoints;
