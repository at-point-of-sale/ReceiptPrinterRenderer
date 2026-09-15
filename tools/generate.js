import fs from 'node:fs';
import {stringify} from 'javascript-stringify';

/*
    Generates the packed resources in generated/ from the sources in data/:

    - generated/mapping.js    codepage mappings from data/mappings, the same
                              text format and output as ReceiptPrinterEncoder
    - generated/profiles.js   printer profiles from data/profiles
    - generated/pdf417.js     the symbol characters of PDF417 from data/pdf417,
                              one array of module patterns per cluster

    data/fonts/fonts.js and data/fonts/outlines.js are not written here and
    never by this tool: they are the Renderer export of
    ReceiptPrinterFontEditor (https://github.com/at-point-of-sale/ReceiptPrinterFontEditor),
    which is where the bitmap font of this renderer is made. Their formats are
    documented in the Bitmap font section of documentation/design.md.

    See documentation/design.md for the formats.
*/

/**
 * The contents of generated/mapping.js, the codepage mappings per language
 *
 * @return {string}   The source of the module
 */
function generateMappings() {
  let output = 'const codepageMappings = {\n';

  for (const language of fs.readdirSync('data/mappings').sort()) {
    output += `\t'${language}': {\n`;

    for (const file of fs.readdirSync('data/mappings/' + language).sort()) {
      if (!file.endsWith('.txt')) {
        continue;
      }

      const lines = fs.readFileSync(`data/mappings/${language}/${file}`, 'utf8').split('\n');
      const name = file.replace(/\.txt$/, '').replace(/-legacy/g, '/legacy');
      const list = new Map();

      for (const line of lines) {
        if (line.length > 1 && line.charAt(0) != '#') {
          const [, key, value] = line.split(/\t/);
          list.set(parseInt(key, 16), value.trim());
        }
      }

      const mapping = new Array(Math.max(...list.keys()) + 1);

      for (const [key, value] of list) {
        mapping[key] = value;
      }

      output += `\t\t'${name}': ${stringify(mapping)},\n`;
    }

    output += '\t},\n';
  }

  output += '};\n\n';
  output += 'codepageMappings[\'esc-pos\'][\'zijang\'] = codepageMappings[\'esc-pos\'][\'pos-5890\'];\n\n';
  output += 'export default codepageMappings;\n';

  return output;
}

/**
 * The contents of generated/profiles.js, the defaults per printer family
 *
 * @return {string}   The source of the module
 */
function generateProfiles() {
  let output = 'const printerProfiles = {\n';

  for (const file of fs.readdirSync('data/profiles').sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }

    const definition = JSON.parse(fs.readFileSync('data/profiles/' + file, 'utf8'));
    output += `\t'${file.replace(/\.json$/, '')}': ${stringify(definition)},\n`;
  }

  output += '};\n\n';
  output += 'export default printerProfiles;\n';

  return output;
}

/**
 * The contents of generated/pdf417.js, the symbol characters of PDF417.
 *
 * The source is data/pdf417/clusters.txt, which says where the table comes
 * from: three clusters of 929 patterns, a pattern being the seventeen modules
 * of one symbol character as a number, the leftmost module in bit 16. The
 * cluster of a row is its row number modulo three, so the clusters are stored
 * in that order, 0, 3 and 6.
 *
 * @return {string}   The source of the module
 */
function generatePdf417() {
  const lines = fs.readFileSync('data/pdf417/clusters.txt', 'utf8').split('\n');
  const clusters = [];

  for (const line of lines) {
    const text = line.trim();

    if (text.length === 0 || text.charAt(0) === '#') {
      continue;
    }

    if (text.startsWith('cluster ')) {
      clusters.push([]);
      continue;
    }

    for (const value of text.split(/\s+/)) {
      clusters[clusters.length - 1].push(parseInt(value, 16));
    }
  }

  let output = 'const pdf417Clusters = [\n';

  for (const cluster of clusters) {
    output += `\t${stringify(cluster)},\n`;
  }

  output += '];\n\n';
  output += 'export default pdf417Clusters;\n';

  process.stdout.write(
      `pdf417: ${clusters.length} clusters of ${clusters.map((c) => c.length).join(', ')} symbol characters\n`,
  );

  return output;
}

fs.mkdirSync('generated', {recursive: true});
fs.writeFileSync('generated/mapping.js', generateMappings());
fs.writeFileSync('generated/profiles.js', generateProfiles());
fs.writeFileSync('generated/pdf417.js', generatePdf417());
