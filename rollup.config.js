import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';
import path from 'node:path';

// Which of the two entries a resolved module is, by a path with the separators
// of this platform turned into the ones an import uses, so that the command
// imports the builds beside it on Windows as well as on the others
function entry(id) {
	const file = id.split(path.sep).join('/');

	if (file.endsWith('/src/receipt-printer-renderer.js')) {
		return './receipt-printer-renderer.mjs';
	}

	return file.endsWith('/src/svg.js') ? './receipt-printer-renderer-svg.mjs' : null;
}

export default [

	// Browser-friendly UMD build, from the entry that only has the default
	// export, so that the global is the class itself
	{
		input: 'src/umd.js',
		output: {
			name: 'ReceiptPrinterRenderer',
			file: 'dist/receipt-printer-renderer.umd.js',
			sourcemap: true,
			exports: 'default',
			format: 'umd'
		},
		plugins: [
			resolve({ browser: true }),
			commonjs(),
			terser()
		]
	},

	// Browser-friendly ES module build
	{
		input: 'src/receipt-printer-renderer.js',
		output: {
			file: 'dist/receipt-printer-renderer.esm.js',
			sourcemap: true,
			exports: 'named',
			format: 'es'
		},
		plugins: [
			resolve({ browser: true }),
			commonjs(),
			terser()
		]
	},

	// CommonJS (for Node) and ES module (for bundlers) build
	{
		input: 'src/receipt-printer-renderer.js',
		external: ['@point-of-sale/codepage-encoder', 'lean-qr'],
		output: [
			{ file: 'dist/receipt-printer-renderer.cjs', exports: 'named', format: 'cjs' },
			{ file: 'dist/receipt-printer-renderer.mjs', exports: 'named', format: 'es' }
		]
	},

	// The command line, which is the arguments and nothing else: the renderer
	// and the SVG writer are external as well as the two dependencies and the
	// Node built-ins, and output.paths points them at the two module builds
	// that ship beside it, so that the package holds one copy of the renderer
	// and one of the outlines instead of three. No declarations are built for
	// it: the command is not an API and tsconfig.json does not include it
	{
		input: 'src/cli.js',
		external: (id) => id === '@point-of-sale/codepage-encoder' || id === 'lean-qr' ||
			/^node:/.test(id) || entry(id) !== null,
		output: [
			{
				file: 'dist/receipt-printer-renderer-cli.mjs',
				format: 'es',
				paths: (id) => entry(id) || id
			}
		]
	},

	// Bundled TypeScript declarations
	{
		input: 'dist/tmp/src/receipt-printer-renderer.d.ts',
		external: ['@point-of-sale/codepage-encoder', 'lean-qr'],
		output: {
			file: 'dist/receipt-printer-renderer.d.ts',
			format: 'es'
		},
		plugins: [
			dts()
		]
	},

	// The SVG sub-entry, @point-of-sale/receipt-printer-renderer/svg, which
	// carries the glyph outlines and is built on its own so that a driver that
	// renders images never loads them. Its UMD global is an object with toSvg,
	// not a function, so that the entry has room for whatever it gains later
	{
		input: 'src/svg-umd.js',
		output: {
			name: 'ReceiptPrinterRendererSvg',
			file: 'dist/receipt-printer-renderer-svg.umd.js',
			sourcemap: true,
			exports: 'named',
			format: 'umd'
		},
		plugins: [
			resolve({ browser: true }),
			commonjs(),
			terser()
		]
	},

	{
		input: 'src/svg.js',
		output: {
			file: 'dist/receipt-printer-renderer-svg.esm.js',
			sourcemap: true,
			exports: 'named',
			format: 'es'
		},
		plugins: [
			resolve({ browser: true }),
			commonjs(),
			terser()
		]
	},

	{
		input: 'src/svg.js',
		output: [
			{ file: 'dist/receipt-printer-renderer-svg.cjs', exports: 'named', format: 'cjs' },
			{ file: 'dist/receipt-printer-renderer-svg.mjs', exports: 'named', format: 'es' }
		]
	},

	{
		input: 'dist/tmp/src/svg.d.ts',
		output: {
			file: 'dist/receipt-printer-renderer-svg.d.ts',
			format: 'es'
		},
		plugins: [
			dts()
		]
	}
];
