import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

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
	}
];
