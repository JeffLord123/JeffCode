/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { changesToCss, changesToPrompt, collapseChanges, DesignChangeSet, IDesignElementDescriptor } from '../../common/designChanges.js';

const button: IDesignElementDescriptor = {
	selector: 'main > button.cta',
	label: 'button.cta',
	html: '<button class="cta">',
	text: 'Get started',
	components: ['Hero', 'Button'],
};

const title: IDesignElementDescriptor = { selector: 'h1', label: 'h1', html: '<h1>' };

suite('JeffDesign - designChanges', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('records changes per element and counts properties', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'padding-left', '16px', '24px');
		set.record('1', button, 'color', 'rgb(0, 0, 0)', '#FF0000');
		set.record('2', title, 'font-size', '32px', '40px');

		assert.strictEqual(set.count, 3);
		assert.strictEqual(set.elements.length, 2);
		assert.deepStrictEqual(set.get('1')?.changes.map(c => c.property), ['padding-left', 'color']);
	});

	test('keeps the first before value across successive edits', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'padding-left', '16px', '20px');
		set.record('1', button, 'padding-left', '20px', '24px');

		assert.deepStrictEqual(set.get('1')?.changes, [{ property: 'padding-left', before: '16px', after: '24px' }]);
	});

	test('a change back to the original value removes the entry', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'padding-left', '16px', '20px');
		set.record('1', button, 'padding-left', '20px', '16px');

		assert.strictEqual(set.count, 0);
		assert.strictEqual(set.has('1'), false);
	});

	test('fires onDidChange on record, stale change and clear', () => {
		const set = store.add(new DesignChangeSet());
		let fired = 0;
		store.add(set.onDidChange(() => fired++));

		set.record('1', button, 'opacity', '1', '0.5');
		set.setStale('1', true);
		set.setStale('1', true);
		set.clear();
		set.clear();

		assert.strictEqual(fired, 3);
	});

	test('rekey moves changes to the new key', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'opacity', '1', '0.5');
		set.rekey('1', '9');

		assert.strictEqual(set.has('1'), false);
		assert.strictEqual(set.get('9')?.key, '9');
		assert.strictEqual(set.count, 1);
	});

	test('collapseChanges merges complete longhand groups into shorthands', () => {
		const uniform = collapseChanges([
			{ property: 'color', before: 'red', after: 'blue' },
			{ property: 'padding-top', before: '8px', after: '16px' },
			{ property: 'padding-right', before: '8px', after: '16px' },
			{ property: 'padding-bottom', before: '8px', after: '16px' },
			{ property: 'padding-left', before: '8px', after: '16px' },
		]);
		assert.deepStrictEqual(uniform, [
			{ property: 'color', before: 'red', after: 'blue' },
			{ property: 'padding', before: '8px', after: '16px' },
		]);

		const perAxis = collapseChanges([
			{ property: 'margin-top', before: '0px', after: '8px' },
			{ property: 'margin-right', before: '0px', after: '24px' },
			{ property: 'margin-bottom', before: '4px', after: '8px' },
			{ property: 'margin-left', before: '0px', after: '24px' },
		]);
		assert.deepStrictEqual(perAxis, [{ property: 'margin', before: '0px 0px 4px', after: '8px 24px' }]);

		const gap = collapseChanges([
			{ property: 'row-gap', before: 'normal', after: '8px' },
			{ property: 'column-gap', before: 'normal', after: '12px' },
		]);
		assert.deepStrictEqual(gap, [{ property: 'gap', before: 'normal', after: '8px 12px' }]);
	});

	test('collapseChanges leaves incomplete groups and multi-value longhands alone', () => {
		const incomplete = [
			{ property: 'padding-top', before: '8px', after: '16px' },
			{ property: 'padding-bottom', before: '8px', after: '16px' },
		];
		assert.deepStrictEqual(collapseChanges(incomplete), incomplete);

		const elliptical = [
			{ property: 'border-top-left-radius', before: '0px', after: '10px 20px' },
			{ property: 'border-top-right-radius', before: '0px', after: '4px' },
			{ property: 'border-bottom-right-radius', before: '0px', after: '4px' },
			{ property: 'border-bottom-left-radius', before: '0px', after: '4px' },
		];
		assert.deepStrictEqual(collapseChanges(elliptical), elliptical);
	});

	test('changesToCss writes one rule per element with previous values', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'padding-left', '16px', '24px');
		set.record('2', title, 'font-size', '32px', '40px');

		assert.strictEqual(changesToCss('http://localhost:3000/', set.elements), [
			'/* Design changes on http://localhost:3000/ */',
			'',
			'main > button.cta {',
			'\tpadding-left: 24px; /* was 16px */',
			'}',
			'',
			'h1 {',
			'\tfont-size: 40px; /* was 32px */',
			'}',
			'',
		].join('\n'));
	});

	test('changesToPrompt describes each element and its changes', () => {
		const set = store.add(new DesignChangeSet());
		set.record('1', button, 'padding-left', '16px', '24px');
		set.record('2', title, 'font-size', '32px', '40px');

		const prompt = changesToPrompt('http://localhost:3000/', set.elements);

		assert.ok(prompt.includes('on http://localhost:3000/'));
		assert.ok(prompt.includes('1. Element `button.cta`'));
		assert.ok(prompt.includes('   - Selector: `main > button.cta`'));
		assert.ok(prompt.includes('   - Component: Hero > Button'));
		assert.ok(prompt.includes('   - Text: "Get started"'));
		assert.ok(prompt.includes('     - `padding-left`: `16px` → `24px`'));
		assert.ok(prompt.includes('2. Element `h1`'));
		assert.ok(!prompt.includes('2. Element `h1`\n   - Selector: `h1`\n   - Component'));
	});
});
