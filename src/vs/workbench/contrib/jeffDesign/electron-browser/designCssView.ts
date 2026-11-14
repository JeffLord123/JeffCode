/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DesignInspector, IDesignDeclaration } from './designInspector.js';

/**
 * The CSS tab: the declarations that apply to the selected element. Editing a value, or adding
 * a declaration, previews it on the element and records it in the journal like any other edit.
 */
export class DesignCssView extends Disposable {

	readonly element: HTMLElement;

	constructor(private readonly _inspector: DesignInspector) {
		super();
		this.element = $('.jeff-design-css');
	}

	update(): void {
		this.element.replaceChildren();
		const styles = this._inspector.styles;
		if (!styles) {
			return;
		}

		const inline = this._block('element.style', undefined);
		for (const declaration of styles.inline) {
			this._declaration(inline, declaration, true);
		}
		this._newDeclaration(inline);

		for (const rule of styles.rules) {
			const block = this._block(rule.selector, rule.source);
			for (const declaration of rule.declarations) {
				this._declaration(block, declaration, false);
			}
		}
	}

	private _block(selector: string, source: string | undefined): HTMLElement {
		const block = append(this.element, $('.jeff-design-css-block'));
		const header = append(block, $('.jeff-design-css-header'));
		append(header, $('span.jeff-design-css-selector')).textContent = `${selector} {`;
		if (source) {
			append(header, $('span.jeff-design-css-source')).textContent = source;
		}
		const body = append(block, $('.jeff-design-css-body'));
		append(block, $('.jeff-design-css-footer')).textContent = '}';
		return body;
	}

	private _declaration(parent: HTMLElement, declaration: IDesignDeclaration, removable: boolean): void {
		const row = append(parent, $('.jeff-design-css-declaration'));
		append(row, $('span.jeff-design-css-name')).textContent = `${declaration.name}:`;
		const input = append(row, $<HTMLInputElement>('input.jeff-design-css-value'));
		input.type = 'text';
		input.spellcheck = false;
		input.value = declaration.value + (declaration.important ? ' !important' : '');
		input.setAttribute('aria-label', declaration.name);
		input.addEventListener('focus', () => input.select());
		input.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				input.blur();
			} else if (e.key === 'Escape') {
				input.value = declaration.value;
				input.blur();
			}
		});
		input.addEventListener('change', () => {
			const value = input.value.replace(/\s*!important\s*$/, '').replace(/;\s*$/, '').trim();
			if (value !== declaration.value) {
				this._inspector.setStyles([[declaration.name, value]]);
			}
		});
		if (removable) {
			const remove = append(row, $<HTMLButtonElement>('button.jeff-design-css-remove.codicon.codicon-close'));
			remove.type = 'button';
			remove.title = `Remove ${declaration.name}`;
			remove.setAttribute('aria-label', remove.title);
			remove.addEventListener('click', () => this._inspector.setStyles([[declaration.name, '']]));
		}
	}

	private _newDeclaration(parent: HTMLElement): void {
		const row = append(parent, $('.jeff-design-css-declaration.new'));
		const name = append(row, $<HTMLInputElement>('input.jeff-design-css-new-name'));
		name.type = 'text';
		name.spellcheck = false;
		name.placeholder = 'property';
		name.setAttribute('aria-label', 'New property name');
		const value = append(row, $<HTMLInputElement>('input.jeff-design-css-value'));
		value.type = 'text';
		value.spellcheck = false;
		value.placeholder = 'value';
		value.setAttribute('aria-label', 'New property value');

		const commit = () => {
			const property = name.value.replace(/:\s*$/, '').trim().toLowerCase();
			const text = value.value.replace(/;\s*$/, '').trim();
			if (property && text) {
				this._inspector.setStyles([[property, text]]);
			}
		};
		name.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ':') {
				e.preventDefault();
				value.focus();
			}
		});
		value.addEventListener('keydown', e => {
			if (e.key === 'Enter') {
				e.preventDefault();
				commit();
			}
		});
		value.addEventListener('change', commit);
	}
}
