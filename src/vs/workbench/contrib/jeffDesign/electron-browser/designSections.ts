/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { formatCssNumber, parseCssLength } from '../common/designCss.js';
import { CheckboxField, ColorField, designIcon, DesignIcons, NumberField, SegmentedControl, SelectField, TextField } from './designControls.js';

/** Where the Design tab reads values from and writes edits to. */
export interface IDesignStyleTarget {
	/** Current value of a longhand property of the selected element. */
	styleValue(property: string): string;
	/** Applies longhand property values to the selected element. */
	setStyles(entries: readonly (readonly [property: string, value: string])[]): void;
}

const paddingSides = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const;
const marginSides = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;
const radiusCorners = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'] as const;
const borderWidths = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'] as const;
const borderStyles = ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'] as const;
const borderColors = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'] as const;

const fontSuggestions = ['system-ui', 'Inter', 'Roboto', 'Arial', 'Helvetica', 'Georgia', '"Times New Roman"', '"Courier New"', 'sans-serif', 'serif', 'monospace'];

/**
 * The Design tab: Figma-like controls for layout, size, spacing, appearance, text, fill and
 * border of the selected element.
 */
export class DesignSections extends Disposable {

	readonly element: HTMLElement;
	private readonly _updaters: (() => void)[] = [];

	constructor(private readonly _target: IDesignStyleTarget) {
		super();
		this.element = $('.jeff-design-sections');
		this._createFlow();
		this._createDimensions();
		this._createSpacing('Padding', paddingSides, 0, 'Clip content', () => this._createClipContent());
		this._createSpacing('Margin', marginSides, undefined, 'Border box', () => this._createBorderBox());
		this._createAppearance();
		this._createText();
		this._createFill();
		this._createBorder();
	}

	/** Refreshes every control from the selected element's styles. */
	update(): void {
		for (const updater of this._updaters) {
			updater();
		}
	}

	// -- Building blocks --------------------------------------------------------------------

	private _section(title: string, divider = false): { header: HTMLElement; body: HTMLElement } {
		const section = append(this.element, $('.jeff-design-section'));
		section.classList.toggle('divider', divider);
		const header = append(section, $('.jeff-design-section-header'));
		append(header, $('.jeff-design-section-title')).textContent = title;
		return { header, body: append(section, $('.jeff-design-section-body')) };
	}

	private _row(parent: HTMLElement, ...children: HTMLElement[]): HTMLElement {
		const row = append(parent, $('.jeff-design-row'));
		for (const child of children) {
			row.appendChild(child);
		}
		return row;
	}

	private _toggleButton(parent: HTMLElement, title: string, icon: string, onToggle: (active: boolean) => void): void {
		const button = append(parent, $<HTMLButtonElement>('button.jeff-design-icon-button'));
		button.type = 'button';
		button.title = title;
		button.setAttribute('aria-label', title);
		button.setAttribute('aria-pressed', 'false');
		button.appendChild(designIcon(icon));
		this._register(addDisposableListener(button, EventType.CLICK, () => {
			const active = !button.classList.contains('active');
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			onToggle(active);
		}));
	}

	/** Binds a field to one or more longhands that are edited together. */
	private _bind(field: NumberField | ColorField | SelectField, properties: readonly string[]): void {
		this._register(field.onDidChange(value => this._target.setStyles(properties.map(property => [property, value] as const))));
		this._updaters.push(() => {
			const values = properties.map(property => this._target.styleValue(property));
			if (values.every(value => value === values[0])) {
				field.setValue(values[0]);
			} else if (field instanceof SelectField) {
				field.setValue('');
			} else {
				field.setMixed();
			}
		});
	}

	private _number(title: string, properties: readonly string[], options: { label?: string; icon?: string; min?: number; units?: readonly string[]; keywords?: readonly string[]; step?: number } = {}): NumberField {
		const field = this._register(new NumberField({ title, unit: 'px', ...options }));
		this._bind(field, properties);
		return field;
	}

	// -- Sections ---------------------------------------------------------------------------

	private _createFlow(): void {
		const { body } = this._section('Flow');
		const segments = this._register(new SegmentedControl([
			{ id: 'row', title: 'Horizontal (flex row)', icon: DesignIcons.flowRow },
			{ id: 'column', title: 'Vertical (flex column)', icon: DesignIcons.flowColumn },
			{ id: 'wrap', title: 'Wrap (flex wrap)', icon: DesignIcons.flowWrap },
			{ id: 'grid', title: 'Grid', icon: DesignIcons.flowGrid },
		]));
		body.appendChild(segments.element);
		this._register(segments.onDidSelect(id => {
			switch (id) {
				case 'row': this._target.setStyles([['display', 'flex'], ['flex-direction', 'row'], ['flex-wrap', 'nowrap']]); break;
				case 'column': this._target.setStyles([['display', 'flex'], ['flex-direction', 'column'], ['flex-wrap', 'nowrap']]); break;
				case 'wrap': this._target.setStyles([['display', 'flex'], ['flex-direction', 'row'], ['flex-wrap', 'wrap']]); break;
				case 'grid': this._target.setStyles([['display', 'grid']]); break;
			}
		}));

		const gap = this._number('Gap', ['row-gap', 'column-gap'], { icon: DesignIcons.gap, min: 0 });
		const justify = this._register(new SelectField('Justify content', [
			{ value: 'normal', label: 'Normal' },
			{ value: 'flex-start', label: 'Start' },
			{ value: 'center', label: 'Center' },
			{ value: 'flex-end', label: 'End' },
			{ value: 'space-between', label: 'Space between' },
			{ value: 'space-around', label: 'Space around' },
			{ value: 'space-evenly', label: 'Space evenly' },
		], 'J'));
		this._bind(justify, ['justify-content']);
		const align = this._register(new SelectField('Align items', [
			{ value: 'normal', label: 'Normal' },
			{ value: 'stretch', label: 'Stretch' },
			{ value: 'flex-start', label: 'Start' },
			{ value: 'center', label: 'Center' },
			{ value: 'flex-end', label: 'End' },
			{ value: 'baseline', label: 'Baseline' },
		], 'A'));
		this._bind(align, ['align-items']);
		const extras = append(body, $('.jeff-design-flow-extras'));
		this._row(extras, gap.element);
		this._row(extras, justify.element, align.element);

		this._updaters.push(() => {
			const display = this._target.styleValue('display');
			const isFlex = display === 'flex' || display === 'inline-flex';
			const isGrid = display === 'grid' || display === 'inline-grid';
			let active: string | undefined;
			if (isGrid) {
				active = 'grid';
			} else if (isFlex) {
				active = this._target.styleValue('flex-wrap').startsWith('wrap') ? 'wrap'
					: this._target.styleValue('flex-direction').startsWith('column') ? 'column' : 'row';
			}
			segments.setActive(active);
			extras.hidden = !isFlex && !isGrid;
		});
	}

	private _createDimensions(): void {
		const { body } = this._section('Dimensions');
		const keywords = ['auto', 'fit-content'];
		const width = this._number('Width', ['width'], { label: 'W', min: 0, units: ['px', '%', 'rem', 'em', 'vw'], keywords });
		const height = this._number('Height', ['height'], { label: 'H', min: 0, units: ['px', '%', 'rem', 'em', 'vh'], keywords });
		this._row(body, width.element, height.element);
	}

	private _createSpacing(title: string, sides: readonly string[], min: number | undefined, checkboxLabel: string, createCheckbox: () => HTMLElement): void {
		const { header, body } = this._section(title);
		const [top, right, bottom, left] = sides;

		const axes = this._row(body,
			this._number(`${title} top and bottom`, [top, bottom], { icon: DesignIcons.spaceVertical, min }).element,
			this._number(`${title} left and right`, [left, right], { icon: DesignIcons.spaceHorizontal, min }).element,
		);
		const individual = append(body, $('.jeff-design-individual'));
		this._row(individual,
			this._number(`${title} top`, [top], { icon: DesignIcons.sideTop, min }).element,
			this._number(`${title} right`, [right], { icon: DesignIcons.sideRight, min }).element,
		);
		this._row(individual,
			this._number(`${title} bottom`, [bottom], { icon: DesignIcons.sideBottom, min }).element,
			this._number(`${title} left`, [left], { icon: DesignIcons.sideLeft, min }).element,
		);
		individual.hidden = true;
		this._toggleButton(header, `${title} per side`, DesignIcons.sides, active => {
			axes.hidden = active;
			individual.hidden = !active;
		});

		const checkbox = createCheckbox();
		checkbox.title = checkboxLabel;
		body.appendChild(checkbox);
	}

	private _createClipContent(): HTMLElement {
		const checkbox = this._register(new CheckboxField('Clip content'));
		this._register(checkbox.onDidChange(checked => {
			const value = checked ? 'hidden' : 'visible';
			this._target.setStyles([['overflow-x', value], ['overflow-y', value]]);
		}));
		this._updaters.push(() => {
			const clipped = (value: string) => value === 'hidden' || value === 'clip';
			checkbox.setValue(clipped(this._target.styleValue('overflow-x')) && clipped(this._target.styleValue('overflow-y')));
		});
		return checkbox.element;
	}

	private _createBorderBox(): HTMLElement {
		const checkbox = this._register(new CheckboxField('Border box'));
		this._register(checkbox.onDidChange(checked => this._target.setStyles([['box-sizing', checked ? 'border-box' : 'content-box']])));
		this._updaters.push(() => checkbox.setValue(this._target.styleValue('box-sizing') === 'border-box'));
		return checkbox.element;
	}

	private _createAppearance(): void {
		const { header, body } = this._section('Appearance', true);

		const opacity = this._register(new NumberField({ title: 'Opacity', icon: DesignIcons.opacity, unit: '%', min: 0, max: 100 }));
		this._register(opacity.onDidChange(value => {
			const percent = parseCssLength(value)?.value;
			if (percent !== undefined) {
				this._target.setStyles([['opacity', formatCssNumber(percent / 100)]]);
			}
		}));
		this._updaters.push(() => {
			const value = Number(this._target.styleValue('opacity'));
			opacity.setValue(Number.isNaN(value) ? '100%' : `${formatCssNumber(Math.round(value * 100))}%`);
		});

		const radius = this._number('Corner radius', radiusCorners, { icon: DesignIcons.radius, min: 0 });
		this._row(body, opacity.element, radius.element);

		const corners = append(body, $('.jeff-design-individual'));
		this._row(corners,
			this._number('Top left radius', [radiusCorners[0]], { icon: DesignIcons.cornerTopLeft, min: 0 }).element,
			this._number('Top right radius', [radiusCorners[1]], { icon: DesignIcons.cornerTopRight, min: 0 }).element,
		);
		this._row(corners,
			this._number('Bottom left radius', [radiusCorners[3]], { icon: DesignIcons.cornerBottomLeft, min: 0 }).element,
			this._number('Bottom right radius', [radiusCorners[2]], { icon: DesignIcons.cornerBottomRight, min: 0 }).element,
		);
		corners.hidden = true;
		this._toggleButton(header, 'Radius per corner', DesignIcons.corners, active => {
			radius.element.style.visibility = active ? 'hidden' : '';
			corners.hidden = !active;
		});
	}

	private _createText(): void {
		const { body } = this._section('Text', true);

		const family = this._register(new TextField('Font family', fontSuggestions));
		this._register(family.onDidChange(value => this._target.setStyles([['font-family', value]])));
		this._updaters.push(() => family.setValue(this._target.styleValue('font-family')));
		this._row(body, family.element);

		const weight = this._register(new SelectField('Font weight', [
			{ value: '100', label: '100 Thin' },
			{ value: '200', label: '200 Extra light' },
			{ value: '300', label: '300 Light' },
			{ value: '400', label: '400 Regular' },
			{ value: '500', label: '500 Medium' },
			{ value: '600', label: '600 Semibold' },
			{ value: '700', label: '700 Bold' },
			{ value: '800', label: '800 Extra bold' },
			{ value: '900', label: '900 Black' },
		]));
		this._bind(weight, ['font-weight']);
		const size = this._number('Font size', ['font-size'], { min: 0 });
		this._row(body, weight.element, size.element);

		const lineHeight = this._number('Line height', ['line-height'], { icon: DesignIcons.lineHeight, min: 0 });
		const letterSpacing = this._number('Letter spacing', ['letter-spacing'], { icon: DesignIcons.letterSpacing, step: 0.1 });
		this._row(body, lineHeight.element, letterSpacing.element);

		const align = this._register(new SegmentedControl([
			{ id: 'left', title: 'Align left', icon: DesignIcons.alignLeft },
			{ id: 'center', title: 'Align center', icon: DesignIcons.alignCenter },
			{ id: 'right', title: 'Align right', icon: DesignIcons.alignRight },
			{ id: 'justify', title: 'Justify', icon: DesignIcons.alignJustify },
		]));
		this._register(align.onDidSelect(id => this._target.setStyles([['text-align', id]])));
		this._updaters.push(() => {
			const value = this._target.styleValue('text-align');
			align.setActive(value === 'start' ? 'left' : value === 'end' ? 'right' : value);
		});
		body.appendChild(align.element);

		append(body, $('.jeff-design-label')).textContent = 'Color';
		const color = this._register(new ColorField('Text color'));
		this._bind(color, ['color']);
		this._row(body, color.element);
	}

	private _createFill(): void {
		const { body } = this._section('Background', true);
		const color = this._register(new ColorField('Background color'));
		this._bind(color, ['background-color']);
		this._row(body, color.element);
	}

	private _createBorder(): void {
		const { body } = this._section('Border', true);

		const width = this._register(new NumberField({ title: 'Border width', icon: DesignIcons.borderWidth, unit: 'px', min: 0 }));
		this._register(width.onDidChange(value => {
			const entries: (readonly [string, string])[] = borderWidths.map(property => [property, value] as const);
			if (borderStyles.every(property => this._target.styleValue(property) === 'none')) {
				// A width has no effect without a style, so give the border one.
				entries.push(...borderStyles.map(property => [property, 'solid'] as const));
			}
			this._target.setStyles(entries);
		}));
		this._updaters.push(() => {
			const values = borderWidths.map(property => this._target.styleValue(property));
			if (values.every(value => value === values[0])) {
				width.setValue(values[0]);
			} else {
				width.setMixed();
			}
		});

		const style = this._register(new SelectField('Border style', [
			{ value: 'none', label: 'None' },
			{ value: 'solid', label: 'Solid' },
			{ value: 'dashed', label: 'Dashed' },
			{ value: 'dotted', label: 'Dotted' },
			{ value: 'double', label: 'Double' },
		]));
		this._bind(style, borderStyles);
		this._row(body, width.element, style.element);

		const color = this._register(new ColorField('Border color'));
		this._bind(color, borderColors);
		this._row(body, color.element);
	}
}
