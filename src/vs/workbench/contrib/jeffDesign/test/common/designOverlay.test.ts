/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseDesignOverlayNotification } from '../../common/designOverlay.js';

suite('JeffDesign - designOverlay', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const viewport = { scrollX: 0, scrollY: 120, innerWidth: 1280, innerHeight: 720, clientWidth: 1265, clientHeight: 720, documentWidth: 1265, documentHeight: 3000 };

	test('parses the notifications the overlay sends', () => {
		const payloads = [
			{ type: 'ready' },
			{ type: 'measureExit' },
			{ type: 'viewport', viewport: { ...viewport, programmatic: true } },
			{ type: 'viewport', viewport },
			{ type: 'guides', guides: [{ id: 'g1', axis: 'x', position: 120 }, { id: 'g2', axis: 'y', position: -4.5 }] },
			{ type: 'focus', rect: { x: 10, y: 20, width: 30, height: 40 } },
			{ type: 'focus' },
			{ type: 'focus', rect: null },
		];
		assert.deepStrictEqual(payloads.map(payload => parseDesignOverlayNotification(JSON.stringify(payload))), [
			{ type: 'ready' },
			{ type: 'measureExit' },
			{ type: 'viewport', viewport: { ...viewport, programmatic: true } },
			{ type: 'viewport', viewport: { ...viewport, programmatic: false } },
			{ type: 'guides', guides: [{ id: 'g1', axis: 'x', position: 120 }, { id: 'g2', axis: 'y', position: -4.5 }] },
			{ type: 'focus', rect: { x: 10, y: 20, width: 30, height: 40 } },
			{ type: 'focus', rect: undefined },
			{ type: 'focus', rect: undefined },
		]);
	});

	test('rejects anything else, since any script of the page can call the binding', () => {
		const payloads = [
			'not json',
			'null',
			'[]',
			JSON.stringify({ type: 'unknown' }),
			JSON.stringify({ type: 'viewport', viewport: { ...viewport, scrollY: 'far' } }),
			JSON.stringify({ type: 'guides', guides: [{ id: 'g1', axis: 'z', position: 1 }] }),
			JSON.stringify({ type: 'guides', guides: [{ id: '', axis: 'x', position: 1 }] }),
			JSON.stringify({ type: 'guides', guides: [{ id: 'g1', axis: 'x', position: null }] }),
			JSON.stringify({ type: 'guides', guides: 'all' }),
			JSON.stringify({ type: 'focus', rect: { x: 1, y: 2, width: -3, height: 4 } }),
			JSON.stringify({ type: 'guides', guides: Array.from({ length: 501 }, (_, i) => ({ id: `g${i}`, axis: 'x', position: i })) }),
		];
		assert.deepStrictEqual(payloads.map(payload => parseDesignOverlayNotification(payload)), payloads.map(() => undefined));
	});
});
