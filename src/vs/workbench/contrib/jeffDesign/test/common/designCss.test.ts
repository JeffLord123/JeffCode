/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { formatCssColor, formatCssLength, formatCssNumber, parseCssColor, parseCssLength, rgbaToHex } from '../../common/designCss.js';

suite('JeffDesign - designCss', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseCssLength reads numbers with and without units', () => {
		assert.deepStrictEqual(parseCssLength('12px'), { value: 12, unit: 'px' });
		assert.deepStrictEqual(parseCssLength(' -0.5EM '), { value: -0.5, unit: 'em' });
		assert.deepStrictEqual(parseCssLength('50%'), { value: 50, unit: '%' });
		assert.deepStrictEqual(parseCssLength('1.5'), { value: 1.5, unit: '' });
		assert.deepStrictEqual(parseCssLength('.25rem'), { value: 0.25, unit: 'rem' });
	});

	test('parseCssLength rejects keywords and expressions', () => {
		assert.strictEqual(parseCssLength('auto'), undefined);
		assert.strictEqual(parseCssLength('calc(1px + 2px)'), undefined);
		assert.strictEqual(parseCssLength(''), undefined);
		assert.strictEqual(parseCssLength('10px 20px'), undefined);
	});

	test('formatCssNumber trims decimals', () => {
		assert.strictEqual(formatCssNumber(12), '12');
		assert.strictEqual(formatCssNumber(0.30000000000000004), '0.3');
		assert.strictEqual(formatCssNumber(1.23456), '1.235');
		assert.strictEqual(formatCssNumber(-0), '0');
		assert.strictEqual(formatCssLength({ value: 1.5, unit: 'rem' }), '1.5rem');
	});

	test('parseCssColor reads computed-style notations', () => {
		assert.deepStrictEqual(parseCssColor('rgb(232, 234, 242)'), { r: 232, g: 234, b: 242, a: 1 });
		assert.deepStrictEqual(parseCssColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
		assert.deepStrictEqual(parseCssColor('rgb(10 20 30 / 25%)'), { r: 10, g: 20, b: 30, a: 0.25 });
		assert.deepStrictEqual(parseCssColor('color(srgb 1 0 0 / 0.5)'), { r: 255, g: 0, b: 0, a: 0.5 });
		assert.deepStrictEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
	});

	test('parseCssColor reads hex in all lengths', () => {
		assert.deepStrictEqual(parseCssColor('#E8EAF2'), { r: 232, g: 234, b: 242, a: 1 });
		assert.deepStrictEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
		assert.deepStrictEqual(parseCssColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 });
	});

	test('parseCssColor rejects what it does not understand', () => {
		assert.strictEqual(parseCssColor('oklch(0.7 0.1 200)'), undefined);
		assert.strictEqual(parseCssColor('#12'), undefined);
		assert.strictEqual(parseCssColor('red'), undefined);
		assert.strictEqual(parseCssColor('rgb(a, b, c)'), undefined);
	});

	test('colors format as hex when opaque and rgba otherwise', () => {
		assert.strictEqual(rgbaToHex({ r: 232, g: 234, b: 242, a: 0.2 }), '#E8EAF2');
		assert.strictEqual(formatCssColor({ r: 232, g: 234, b: 242, a: 1 }), '#E8EAF2');
		assert.strictEqual(formatCssColor({ r: 0, g: 0, b: 0, a: 0.5 }), 'rgba(0, 0, 0, 0.5)');
	});
});
