/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/** What we know about an edited element, enough for a person or an agent to find it in source code. */
export interface IDesignElementDescriptor {
	/** Unique CSS selector path from the document root. */
	readonly selector: string;
	/** Short label such as `button.cta`. */
	readonly label: string;
	/** Opening tag of the element, truncated. */
	readonly html: string;
	/** Visible text of the element, truncated. */
	readonly text?: string;
	/** Names of the framework components that render the element, outermost first. */
	readonly components?: readonly string[];
}

export interface IDesignPropertyChange {
	readonly property: string;
	readonly before: string;
	readonly after: string;
}

export interface IDesignElementChanges {
	readonly key: string;
	readonly element: IDesignElementDescriptor;
	readonly changes: readonly IDesignPropertyChange[];
	/** The element could not be found again after the page reloaded. */
	readonly stale: boolean;
}

interface IMutableElementChanges {
	key: string;
	element: IDesignElementDescriptor;
	changes: Map<string, IDesignPropertyChange>;
	stale: boolean;
}

/** The journal of visual edits made in the Design panel, grouped by element. */
export class DesignChangeSet extends Disposable {

	private readonly _elements = new Map<string, IMutableElementChanges>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/** Number of changed properties across all elements. */
	get count(): number {
		let count = 0;
		for (const element of this._elements.values()) {
			count += element.changes.size;
		}
		return count;
	}

	get elements(): IDesignElementChanges[] {
		return [...this._elements.values()].map(e => ({ ...e, changes: [...e.changes.values()] }));
	}

	has(key: string): boolean {
		return this._elements.has(key);
	}

	get(key: string): IDesignElementChanges | undefined {
		const element = this._elements.get(key);
		return element ? { ...element, changes: [...element.changes.values()] } : undefined;
	}

	/**
	 * Records that `property` of the element went from `before` to `after`. The first `before`
	 * recorded for a property is kept, and a change back to it removes the entry.
	 */
	record(key: string, element: IDesignElementDescriptor, property: string, before: string, after: string): void {
		let entry = this._elements.get(key);
		if (!entry) {
			entry = { key, element, changes: new Map(), stale: false };
			this._elements.set(key, entry);
		}
		const original = entry.changes.get(property)?.before ?? before;
		if (original === after) {
			entry.changes.delete(property);
			if (entry.changes.size === 0) {
				this._elements.delete(key);
			}
		} else {
			entry.changes.set(property, { property, before: original, after });
		}
		this._onDidChange.fire();
	}

	/** Moves an element's changes to a new key, used when the page reloads and nodes get new identities. */
	rekey(oldKey: string, newKey: string): void {
		const entry = this._elements.get(oldKey);
		if (!entry || oldKey === newKey) {
			return;
		}
		this._elements.delete(oldKey);
		entry.key = newKey;
		this._elements.set(newKey, entry);
	}

	setStale(key: string, stale: boolean): void {
		const entry = this._elements.get(key);
		if (entry && entry.stale !== stale) {
			entry.stale = stale;
			this._onDidChange.fire();
		}
	}

	clear(): void {
		if (this._elements.size > 0) {
			this._elements.clear();
			this._onDidChange.fire();
		}
	}
}

/** Shorthands whose longhands are listed in the order the shorthand takes its values. */
const shorthandGroups: readonly { readonly shorthand: string; readonly longhands: readonly string[] }[] = [
	{ shorthand: 'padding', longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] },
	{ shorthand: 'margin', longhands: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] },
	{ shorthand: 'border-radius', longhands: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] },
	{ shorthand: 'border-width', longhands: ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] },
	{ shorthand: 'border-style', longhands: ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'] },
	{ shorthand: 'border-color', longhands: ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] },
	{ shorthand: 'gap', longhands: ['row-gap', 'column-gap'] },
	{ shorthand: 'overflow', longhands: ['overflow-x', 'overflow-y'] },
];

function collapseValues(values: readonly string[]): string {
	if (values.length === 2) {
		return values[0] === values[1] ? values[0] : values.join(' ');
	}
	const [top, right, bottom, left] = values;
	if (right === left) {
		if (top === bottom) {
			return top === right ? top : `${top} ${right}`;
		}
		return `${top} ${right} ${bottom}`;
	}
	return values.join(' ');
}

/**
 * Merges longhand changes into their shorthand when every longhand of the shorthand changed,
 * e.g. the four `padding-*` changes become one `padding` change.
 */
export function collapseChanges(changes: readonly IDesignPropertyChange[]): IDesignPropertyChange[] {
	let result = [...changes];
	for (const group of shorthandGroups) {
		const members = group.longhands.map(longhand => result.find(c => c.property === longhand));
		if (members.some(m => m === undefined || /\s/.test(m.before.trim()) || /\s/.test(m.after.trim()))) {
			continue;
		}
		const found = members as IDesignPropertyChange[];
		const merged: IDesignPropertyChange = {
			property: group.shorthand,
			before: collapseValues(found.map(m => m.before.trim())),
			after: collapseValues(found.map(m => m.after.trim())),
		};
		const position = Math.min(...found.map(m => result.indexOf(m)));
		result = result.filter(c => !found.includes(c));
		result.splice(position, 0, merged);
	}
	return result;
}

/** Renders the changes as CSS rules, one per element, with the previous value as a comment. */
export function changesToCss(url: string, elements: readonly IDesignElementChanges[]): string {
	const lines: string[] = [`/* Design changes on ${url} */`];
	for (const element of elements) {
		if (element.changes.length === 0) {
			continue;
		}
		lines.push('', `${element.element.selector} {`);
		for (const change of collapseChanges(element.changes)) {
			lines.push(`\t${change.property}: ${change.after}; /* was ${change.before} */`);
		}
		lines.push('}');
	}
	return lines.join('\n') + '\n';
}

/** Renders the changes as instructions for a coding agent. */
export function changesToPrompt(url: string, elements: readonly IDesignElementChanges[]): string {
	const lines: string[] = [
		`Apply these visual design changes to the source code. I made them in the browser Design panel on ${url}; right now they only exist as a live preview in the page.`,
		'',
		'For each element, find where its styles are defined in this project (stylesheet, utility classes such as Tailwind, CSS-in-JS, component props or design tokens) and make the change there, following the conventions the code already uses. Prefer an existing design token or utility class when one matches the new value. Do not add inline styles unless the element already uses them. If a style is shared by other elements that should not change, tell me before editing it.',
	];
	let index = 1;
	for (const element of elements) {
		if (element.changes.length === 0) {
			continue;
		}
		lines.push('', `${index}. Element \`${element.element.label}\``);
		lines.push(`   - Selector: \`${element.element.selector}\``);
		if (element.element.components && element.element.components.length > 0) {
			lines.push(`   - Component: ${element.element.components.join(' > ')}`);
		}
		lines.push(`   - HTML: \`${element.element.html}\``);
		if (element.element.text) {
			lines.push(`   - Text: "${element.element.text}"`);
		}
		lines.push('   - Changes:');
		for (const change of collapseChanges(element.changes)) {
			lines.push(`     - \`${change.property}\`: \`${change.before}\` → \`${change.after}\``);
		}
		index++;
	}
	return lines.join('\n') + '\n';
}
