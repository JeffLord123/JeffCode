/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getWindow } from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { formatCssColor, formatCssNumber, IRgba, parseCssColor, parseCssLength, rgbaToHex } from '../common/designCss.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A 16x16 stroked icon drawn from SVG path data. */
export function designIcon(pathData: string): SVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.classList.add('jeff-design-icon');
	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', pathData);
	svg.appendChild(path);
	return svg;
}

export const DesignIcons = {
	flowRow: 'M2.5 4.5h4.5v7H2.5z M9 4.5h4.5v7H9z',
	flowColumn: 'M4.5 2.5h7V7h-7z M4.5 9h7v4.5h-7z',
	flowWrap: 'M2.5 3.5h4.5v3.5H2.5z M9 3.5h4.5v3.5H9z M2.5 9h4.5v3.5H2.5z',
	flowGrid: 'M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z M9 9h4.5v4.5H9z',
	gap: 'M2.5 3.5h3v9h-3z M10.5 3.5h3v9h-3z M8 5.5v5',
	spaceVertical: 'M2.5 2.5h11 M2.5 13.5h11 M5.5 5.5h5v5h-5z',
	spaceHorizontal: 'M2.5 2.5v11 M13.5 2.5v11 M5.5 5.5h5v5h-5z',
	sideTop: 'M2.5 2.5h11 M5.5 6h5v5h-5z',
	sideRight: 'M13.5 2.5v11 M5 5.5h5v5H5z',
	sideBottom: 'M2.5 13.5h11 M5.5 5h5v5h-5z',
	sideLeft: 'M2.5 2.5v11 M6 5.5h5v5H6z',
	sides: 'M5.5 2.5h5 M5.5 13.5h5 M2.5 5.5v5 M13.5 5.5v5',
	radius: 'M3 13V8a5 5 0 0 1 5-5h5',
	cornerTopLeft: 'M3 13V8a5 5 0 0 1 5-5h5',
	cornerTopRight: 'M3 3h5a5 5 0 0 1 5 5v5',
	cornerBottomRight: 'M13 3v5a5 5 0 0 1-5 5H3',
	cornerBottomLeft: 'M3 3v5a5 5 0 0 0 5 5h5',
	corners: 'M2.5 6V4a1.5 1.5 0 0 1 1.5-1.5h2 M10 2.5h2A1.5 1.5 0 0 1 13.5 4v2 M13.5 10v2a1.5 1.5 0 0 1-1.5 1.5h-2 M6 13.5H4A1.5 1.5 0 0 1 2.5 12v-2',
	opacity: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M8 2.5v11 M10.5 3.5v9 M12.7 5.5v5',
	lineHeight: 'M2.5 2.5h11 M2.5 13.5h11 M6 11l2-6 2 6 M6.7 9h2.6',
	letterSpacing: 'M2.5 2.5v11 M13.5 2.5v11 M5.5 11l2.5-6 2.5 6 M6.4 9h3.2',
	alignLeft: 'M2.5 4h11 M2.5 8h7 M2.5 12h9',
	alignCenter: 'M2.5 4h11 M4.5 8h7 M3.5 12h9',
	alignRight: 'M2.5 4h11 M6.5 8h7 M4.5 12h9',
	alignJustify: 'M2.5 4h11 M2.5 8h11 M2.5 12h11',
	borderWidth: 'M2.5 4h11 M2.5 8h11 M2.5 12.5h11',
} as const;

export interface INumberFieldOptions {
	/** Short text shown before the value, e.g. `W`. */
	readonly label?: string;
	/** Icon path data shown before the value. */
	readonly icon?: string;
	readonly title: string;
	/** Unit appended to plain numbers the user types. An empty string means the property is unitless. */
	readonly unit: string;
	/** Units offered in a dropdown. Without it the unit is shown as static text. */
	readonly units?: readonly string[];
	/** Keywords offered in the unit dropdown, e.g. `auto`. */
	readonly keywords?: readonly string[];
	readonly min?: number;
	readonly max?: number;
	readonly step?: number;
}

/**
 * A numeric CSS value editor: type a value, use the arrow keys, or drag the label sideways to
 * scrub. Emits the CSS text to apply.
 */
export class NumberField extends Disposable {

	readonly element: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _unitSelect: HTMLSelectElement | undefined;
	private readonly _unitLabel: HTMLElement | undefined;

	private _number: number | undefined;
	private _unit: string;
	private _scrubbing = false;

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(private readonly _options: INumberFieldOptions) {
		super();
		this._unit = _options.unit;
		this.element = $('.jeff-design-field.jeff-design-number');
		this.element.title = _options.title;

		const handle = append(this.element, $('.jeff-design-field-handle'));
		if (_options.icon) {
			handle.appendChild(designIcon(_options.icon));
		} else if (_options.label) {
			handle.textContent = _options.label;
		}

		this._input = append(this.element, $<HTMLInputElement>('input.jeff-design-input'));
		this._input.type = 'text';
		this._input.spellcheck = false;
		this._input.setAttribute('aria-label', _options.title);

		if (_options.units || _options.keywords) {
			this._unitSelect = append(this.element, $<HTMLSelectElement>('select.jeff-design-unit'));
			this._unitSelect.setAttribute('aria-label', `${_options.title} unit`);
			for (const unit of [...(_options.units ?? []), ...(_options.keywords ?? [])]) {
				const option = append(this._unitSelect, $<HTMLOptionElement>('option'));
				option.value = unit;
				option.textContent = unit;
			}
			this._register(addDisposableListener(this._unitSelect, EventType.CHANGE, () => this._onUnitSelected()));
		} else if (_options.unit) {
			this._unitLabel = append(this.element, $('.jeff-design-unit-label'));
			this._unitLabel.textContent = _options.unit;
		}

		this._register(addDisposableListener(this._input, EventType.KEY_DOWN, e => this._onKeyDown(e)));
		this._register(addDisposableListener(this._input, EventType.CHANGE, () => this._commitText()));
		this._register(addDisposableListener(this._input, EventType.FOCUS, () => this._input.select()));
		this._register(addDisposableListener(handle, EventType.POINTER_DOWN, e => this._startScrub(e, handle)));
	}

	/** Shows a CSS value. Ignored while the user is scrubbing or typing in the field. */
	setValue(cssValue: string): void {
		if (this._scrubbing || this._input.ownerDocument.activeElement === this._input) {
			return;
		}
		this._show(cssValue);
	}

	/** Shows that the edited properties do not share one value. */
	setMixed(): void {
		if (this._scrubbing || this._input.ownerDocument.activeElement === this._input) {
			return;
		}
		this._number = undefined;
		this._input.value = '';
		this._input.placeholder = 'Mixed';
	}

	private _show(cssValue: string): void {
		this._input.placeholder = '';
		const length = parseCssLength(cssValue);
		if (length) {
			this._number = length.value;
			this._unit = length.unit || this._options.unit;
			this._input.value = formatCssNumber(length.value);
		} else {
			this._number = undefined;
			this._input.value = cssValue;
		}
		if (this._unitSelect) {
			const shown = length ? this._unit : cssValue;
			if (![...this._unitSelect.options].some(o => o.value === shown)) {
				const option = append(this._unitSelect, $<HTMLOptionElement>('option'));
				option.value = shown;
				option.textContent = shown;
			}
			this._unitSelect.value = shown;
		} else if (this._unitLabel) {
			this._unitLabel.textContent = length ? this._unit : '';
		}
	}

	private _clamp(value: number): number {
		const { min, max } = this._options;
		return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
	}

	private _emitNumber(value: number): void {
		this._number = this._clamp(value);
		this._input.value = formatCssNumber(this._number);
		this._input.placeholder = '';
		if (this._unitSelect && this._options.keywords?.includes(this._unitSelect.value)) {
			this._unitSelect.value = this._unit;
		}
		this._onDidChange.fire(`${formatCssNumber(this._number)}${this._unit}`);
	}

	private _commitText(): void {
		const text = this._input.value.trim();
		if (text === '') {
			return;
		}
		const length = parseCssLength(text);
		if (!length) {
			// A keyword or an expression such as `auto` or `calc(100% - 8px)`.
			this._number = undefined;
			this._onDidChange.fire(text);
			return;
		}
		if (length.unit) {
			this._unit = length.unit;
		}
		this._emitNumber(length.value);
		this._show(`${formatCssNumber(this._number!)}${this._unit}`);
	}

	private _onUnitSelected(): void {
		const selected = this._unitSelect!.value;
		if (this._options.keywords?.includes(selected)) {
			this._number = undefined;
			this._input.value = selected;
			this._onDidChange.fire(selected);
			return;
		}
		this._unit = selected;
		this._emitNumber(this._number ?? 0);
	}

	private _onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const step = (this._options.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
			const current = parseCssLength(this._input.value)?.value ?? this._number ?? 0;
			this._emitNumber(current + step);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			this._commitText();
			this._input.select();
		} else if (e.key === 'Escape') {
			this._input.blur();
		}
	}

	private _startScrub(e: PointerEvent, handle: HTMLElement): void {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault();
		const startX = e.clientX;
		const startValue = this._number ?? 0;
		const step = this._options.step ?? 1;
		let moved = false;
		handle.setPointerCapture(e.pointerId);

		const onMove = (event: PointerEvent) => {
			const delta = Math.round(event.clientX - startX);
			if (!moved && Math.abs(delta) < 2) {
				return;
			}
			moved = true;
			this._scrubbing = true;
			this.element.classList.add('scrubbing');
			this._emitNumber(startValue + delta * step * (event.shiftKey ? 10 : 1));
		};
		const onUp = () => {
			handle.removeEventListener('pointermove', onMove);
			handle.removeEventListener('pointerup', onUp);
			handle.removeEventListener('pointercancel', onUp);
			this._scrubbing = false;
			this.element.classList.remove('scrubbing');
			if (!moved) {
				this._input.focus();
			}
		};
		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp);
		handle.addEventListener('pointercancel', onUp);
	}
}

/** A color editor: swatch with the system color picker, hex text and opacity. */
export class ColorField extends Disposable {

	readonly element: HTMLElement;
	private readonly _swatch: HTMLElement;
	private readonly _picker: HTMLInputElement;
	private readonly _text: HTMLInputElement;
	private readonly _alpha: HTMLInputElement;
	private _color: IRgba | undefined;

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(title: string) {
		super();
		this.element = $('.jeff-design-field.jeff-design-color');
		this.element.title = title;

		const swatchWrapper = append(this.element, $('.jeff-design-swatch'));
		this._swatch = append(swatchWrapper, $('.jeff-design-swatch-fill'));
		this._picker = append(swatchWrapper, $<HTMLInputElement>('input.jeff-design-swatch-picker'));
		this._picker.type = 'color';
		this._picker.setAttribute('aria-label', `${title} picker`);

		this._text = append(this.element, $<HTMLInputElement>('input.jeff-design-input'));
		this._text.type = 'text';
		this._text.spellcheck = false;
		this._text.setAttribute('aria-label', title);

		this._alpha = append(this.element, $<HTMLInputElement>('input.jeff-design-input.jeff-design-alpha'));
		this._alpha.type = 'text';
		this._alpha.setAttribute('aria-label', `${title} opacity`);
		append(this.element, $('.jeff-design-unit-label')).textContent = '%';

		this._register(addDisposableListener(this._picker, EventType.INPUT, () => {
			const picked = parseCssColor(this._picker.value);
			if (picked) {
				this._emit({ ...picked, a: this._color?.a || 1 });
			}
		}));
		this._register(addDisposableListener(this._text, EventType.CHANGE, () => {
			const text = this._text.value.trim();
			const parsed = parseCssColor(text) ?? parseCssColor(`#${text}`);
			if (parsed) {
				this._emit(parsed);
			} else if (text) {
				// A named color, a gradient or a notation we do not parse: apply it as typed.
				this._color = undefined;
				this._onDidChange.fire(text);
			}
		}));
		this._register(addDisposableListener(this._alpha, EventType.CHANGE, () => {
			const percent = Number(this._alpha.value.replace('%', ''));
			if (this._color && !Number.isNaN(percent)) {
				this._emit({ ...this._color, a: Math.max(0, Math.min(100, percent)) / 100 });
			}
		}));
		for (const input of [this._text, this._alpha]) {
			this._register(addDisposableListener(input, EventType.FOCUS, () => input.select()));
			this._register(addDisposableListener(input, EventType.KEY_DOWN, e => {
				if (e.key === 'Enter') {
					input.blur();
				}
			}));
		}
	}

	setValue(cssValue: string): void {
		const active = this._text.ownerDocument.activeElement;
		if (active === this._text || active === this._alpha) {
			return;
		}
		this._color = parseCssColor(cssValue);
		this._render(cssValue);
	}

	setMixed(): void {
		this._color = undefined;
		this._render('Mixed');
	}

	private _emit(color: IRgba): void {
		this._color = color;
		const css = formatCssColor(color);
		this._render(css);
		this._onDidChange.fire(css);
	}

	private _render(fallbackText: string): void {
		if (this._color) {
			const hex = rgbaToHex(this._color);
			this._text.value = hex;
			this._picker.value = hex.toLowerCase();
			this._alpha.value = formatCssNumber(Math.round(this._color.a * 100));
			this._alpha.disabled = false;
			this._swatch.style.background = formatCssColor(this._color);
		} else {
			this._text.value = fallbackText;
			this._alpha.value = '';
			this._alpha.disabled = true;
			this._swatch.style.background = 'transparent';
		}
	}
}

export interface ISegment {
	readonly id: string;
	readonly title: string;
	readonly icon: string;
}

/** A row of icon buttons where at most one is active. */
export class SegmentedControl extends Disposable {

	readonly element: HTMLElement;
	private readonly _buttons = new Map<string, HTMLButtonElement>();

	private readonly _onDidSelect = this._register(new Emitter<string>());
	readonly onDidSelect: Event<string> = this._onDidSelect.event;

	constructor(segments: readonly ISegment[]) {
		super();
		this.element = $('.jeff-design-segments');
		for (const segment of segments) {
			const button = append(this.element, $<HTMLButtonElement>('button.jeff-design-segment'));
			button.type = 'button';
			button.title = segment.title;
			button.setAttribute('aria-label', segment.title);
			button.appendChild(designIcon(segment.icon));
			this._buttons.set(segment.id, button);
			this._register(addDisposableListener(button, EventType.CLICK, () => this._onDidSelect.fire(segment.id)));
		}
	}

	setActive(id: string | undefined): void {
		for (const [segmentId, button] of this._buttons) {
			const active = segmentId === id;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		}
	}
}

export interface ISelectOption {
	readonly value: string;
	readonly label: string;
}

/** A dropdown for keyword properties. Values missing from the options are added when shown. */
export class SelectField extends Disposable {

	readonly element: HTMLElement;
	private readonly _select: HTMLSelectElement;

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	constructor(title: string, options: readonly ISelectOption[], label?: string) {
		super();
		this.element = $('.jeff-design-field.jeff-design-select');
		this.element.title = title;
		if (label) {
			append(this.element, $('.jeff-design-field-handle.static')).textContent = label;
		}
		this._select = append(this.element, $<HTMLSelectElement>('select.jeff-design-input'));
		this._select.setAttribute('aria-label', title);
		for (const option of options) {
			this._addOption(option.value, option.label);
		}
		this._register(addDisposableListener(this._select, EventType.CHANGE, () => this._onDidChange.fire(this._select.value)));
	}

	private _addOption(value: string, label: string): void {
		const option = append(this._select, $<HTMLOptionElement>('option'));
		option.value = value;
		option.textContent = label;
	}

	setValue(value: string): void {
		if (value && ![...this._select.options].some(o => o.value === value)) {
			this._addOption(value, value);
		}
		this._select.value = value;
	}
}

/** A labelled checkbox. */
export class CheckboxField extends Disposable {

	readonly element: HTMLLabelElement;
	private readonly _input: HTMLInputElement;

	private readonly _onDidChange = this._register(new Emitter<boolean>());
	readonly onDidChange: Event<boolean> = this._onDidChange.event;

	constructor(label: string) {
		super();
		this.element = $<HTMLLabelElement>('label.jeff-design-checkbox');
		this._input = append(this.element, $<HTMLInputElement>('input'));
		this._input.type = 'checkbox';
		append(this.element, $('span')).textContent = label;
		this._register(addDisposableListener(this._input, EventType.CHANGE, () => this._onDidChange.fire(this._input.checked)));
	}

	setValue(checked: boolean): void {
		this._input.checked = checked;
	}
}

/** A text input with suggestions, used for the font family. */
export class TextField extends Disposable {

	readonly element: HTMLElement;
	private readonly _input: HTMLInputElement;
	private readonly _list: HTMLDataListElement;

	private readonly _onDidChange = this._register(new Emitter<string>());
	readonly onDidChange: Event<string> = this._onDidChange.event;

	private static _nextListId = 0;

	constructor(title: string, suggestions: readonly string[]) {
		super();
		this.element = $('.jeff-design-field.jeff-design-text');
		this.element.title = title;
		this._input = append(this.element, $<HTMLInputElement>('input.jeff-design-input'));
		this._input.type = 'text';
		this._input.spellcheck = false;
		this._input.setAttribute('aria-label', title);
		this._list = append(this.element, $<HTMLDataListElement>('datalist'));
		this._list.id = `jeff-design-list-${TextField._nextListId++}`;
		this._input.setAttribute('list', this._list.id);
		this.setSuggestions(suggestions);
		this._register(addDisposableListener(this._input, EventType.CHANGE, () => {
			const value = this._input.value.trim();
			if (value) {
				this._onDidChange.fire(value);
			}
		}));
		this._register(addDisposableListener(this._input, EventType.FOCUS, () => this._input.select()));
		this._register(addDisposableListener(this._input, EventType.KEY_DOWN, e => {
			if (e.key === 'Enter') {
				this._input.blur();
			}
		}));
	}

	setSuggestions(suggestions: readonly string[]): void {
		this._list.replaceChildren();
		for (const suggestion of suggestions) {
			append(this._list, $<HTMLOptionElement>('option')).value = suggestion;
		}
	}

	setValue(value: string): void {
		if (getWindow(this._input).document.activeElement !== this._input) {
			this._input.value = value;
		}
	}
}
