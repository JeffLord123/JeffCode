/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { computeRulerTicks, IRulerTick } from '../../common/designRulerTicks.js';

/** Writes each tick as its position on the ruler, followed by `=label` for major ticks. */
function summarize(ticks: readonly IRulerTick[]): string[] {
	return ticks.map(tick => tick.major ? `${tick.position}=${tick.label}` : `${tick.position}`);
}

suite('JeffDesign - designRulerTicks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('describes each tick with its position, page value and label', () => {
		assert.deepStrictEqual(computeRulerTicks(45, 10, 1), [
			{ position: 0, value: 45, major: false },
			{ position: 5, value: 50, major: true, label: '50' },
			{ position: 10, value: 55, major: false },
		]);
	});

	test('at 100%, labels every 50 px and minor ticks every 5 px', () => {
		assert.deepStrictEqual(summarize(computeRulerTicks(0, 60, 1)), ['0=0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50=50', '55', '60']);
	});

	test('zoomed in, labels every 25 page px and minor ticks every 2.5 page px', () => {
		assert.deepStrictEqual(summarize(computeRulerTicks(0, 60, 2)), ['0=0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50=25', '55', '60']);
	});

	test('picks the smallest major step at least 50 workbench px apart', () => {
		const majorStep = (scale: number) => {
			const [first, second] = computeRulerTicks(0, 1000, scale).filter(tick => tick.major);
			return second.value - first.value;
		};
		assert.deepStrictEqual(
			[0.001, 0.01, 0.1, 0.25, 0.5, 1, 1.25, 2, 3, 10, 50].map(majorStep),
			[50000, 5000, 500, 200, 100, 50, 50, 25, 20, 5, 1]
		);
	});

	test('follows the scroll offset, including negative and fractional coordinates', () => {
		assert.deepStrictEqual([
			summarize(computeRulerTicks(-60, 70, 1)),
			summarize(computeRulerTicks(47.5, 20, 1)),
		], [
			['0', '5', '10=-50', '15', '20', '25', '30', '35', '40', '45', '50', '55', '60=0', '65', '70'],
			['2.5=50', '7.5', '12.5', '17.5'],
		]);
	});

	test('returns no ticks for invalid input', () => {
		assert.deepStrictEqual([
			computeRulerTicks(0, 100, 0),
			computeRulerTicks(0, 100, -1),
			computeRulerTicks(0, 100, Number.NaN),
			computeRulerTicks(0, -1, 1),
			computeRulerTicks(Number.POSITIVE_INFINITY, 100, 1),
			computeRulerTicks(0, 100, Number.MIN_VALUE),
		], [[], [], [], [], [], []]);
	});
});
