import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import dts from 'rollup-plugin-dts';

export default [

	// Browser-friendly UMD build
	{
		input: 'src/receipt-printer-renderer.js',
		output: {
			name: 'ReceiptPrinterRenderer',
			file: 'dist/receipt-printer-renderer.umd.js',
			sourcemap: true,
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
			{ file: 'dist/receipt-printer-renderer.cjs', format: 'cjs' },
			{ file: 'dist/receipt-printer-renderer.mjs', format: 'es' }
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
