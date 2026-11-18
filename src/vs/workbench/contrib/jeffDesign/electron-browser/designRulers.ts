/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/designRulers.css';
import { $, addDisposableListener, EventHelper, EventType, getWindow } from '../../../../base/browser/dom.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { PixelRatio } from '../../../../base/browser/pixelRatio.js';
import { HoverStyle } from '../../../../base/browser/ui/hover/hover.js';
import { HoverPosition } from '../../../../base/browser/ui/hover/hoverWidget.js';
import { toAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { DesignGuideAxis, IDesignGuide } from '../common/designOverlay.js';
import { computeRulerTicks } from '../common/designRulerTicks.js';
import { DesignPageOverlay } from './designPageOverlay.js';

/** Thickness of the rulers, in CSS px of the workbench. */
export const DESIGN_RULER_SIZE = 20;

/** Color of the guides, as the page overlay draws them. */
const guideColor = '#FF3366';
/** Color of the element hovered with the Measure tool. */
const focusColor = '#F24822';
const focusBandColor = 'rgba(242, 72, 34, 0.18)';

// Sizes in CSS px of the workbench.
const majorTickLength = 8;
const minorTickLength = 4;
const minorTickOpacity = 0.6;
const fontSize = 9;
/** Distance from the outer edge of a ruler to the baseline of its labels. */
const labelBaseline = 10;
/** Space between a graduation, a guide or an edge and its label. */
const labelGap = 3;
/** Graduation labels closer than this to a highlighted value are left out. */
const labelClearance = 4;
const markerHalfWidth = 3.5;
const markerHeight = 4.5;

/** The page rectangle, relative to the element holding the rulers, in CSS px of the workbench. */
interface IRulersLayout {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** What one ruler shows. Coordinates are page coordinates, in CSS px of the page document. */
interface IRulerContent {
	/** Length of the ruler, in workbench px. */
	readonly length: number;
	/** Page coordinate at the start of the ruler. */
	readonly start: number;
	/** Workbench px per page px. */
	readonly scale: number;
	readonly guides: readonly number[];
	/** The guide being dragged out of the other ruler. */
	readonly draft: number | undefined;
	/** Extent of the element hovered with the Measure tool. */
	readonly focus: { readonly start: number; readonly end: number } | undefined;
}

/** Colors of the rulers, read from `designRulers.css`, and the workbench font. */
interface IRulerStyle {
	readonly background: string;
	readonly foreground: string;
	readonly border: string;
	readonly fontFamily: string;
}

/** A label placed along a ruler, in device px. */
interface IRulerLabel {
	readonly text: string;
	readonly start: number;
	readonly width: number;
	readonly color: string;
	/** The position the label refers to, beside which it is placed. */
	readonly anchor: number;
}

/** A guide being dragged out of a ruler. */
interface IGuideDrag {
	/** `y` (a horizontal guide) when dragged out of the top ruler, `x` out of the left one. */
	readonly axis: DesignGuideAxis;
	readonly overlay: DesignPageOverlay;
	readonly canvas: HTMLCanvasElement;
	readonly pointerId: number;
	clientX: number;
	clientY: number;
	/** Where the guide would be dropped, in document px; `undefined` while the pointer is off the page. */
	position: number | undefined;
}

/** Formats a page coordinate for the rulers: at most one decimal, never `-0`. */
function formatRulerValue(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** Positions of the guides along an axis. */
function guidePositions(guides: readonly IDesignGuide[], axis: DesignGuideAxis): number[] {
	return guides.filter(guide => guide.axis === axis).map(guide => guide.position);
}

/** Places an absolutely positioned element, in CSS px. */
function placeElement(element: HTMLElement, left: number, top: number, width: number, height: number): void {
	element.style.left = `${left}px`;
	element.style.top = `${top}px`;
	element.style.width = `${Math.max(0, width)}px`;
	element.style.height = `${Math.max(0, height)}px`;
}

/**
 * One ruler: a canvas along the top edge of the page (measuring `x`) or its left edge (measuring
 * `y`). It paints in device px, with `u` along the ruler and `v` across it, from the outer edge to
 * the edge touching the page.
 */
class RulerCanvas {

	readonly element: HTMLCanvasElement;
	private readonly _horizontal: boolean;

	/** @param axis The page axis the ruler measures: `x` for the top ruler, `y` for the left one. */
	constructor(readonly axis: DesignGuideAxis) {
		this._horizontal = axis === 'x';
		this.element = $<HTMLCanvasElement>(this._horizontal ? 'canvas.jeff-design-ruler.horizontal' : 'canvas.jeff-design-ruler.vertical');
	}

	paint(content: IRulerContent, style: IRulerStyle, dpr: number): void {
		const horizontal = this._horizontal;
		const length = Math.max(0, Math.round(content.length * dpr));
		const thickness = Math.max(1, Math.round(DESIGN_RULER_SIZE * dpr));
		const canvas = this.element;
		const width = horizontal ? length : thickness;
		const height = horizontal ? thickness : length;
		if (canvas.width !== width) {
			canvas.width = width;
		}
		if (canvas.height !== height) {
			canvas.height = height;
		}
		const context = canvas.getContext('2d');
		if (!context || length === 0) {
			return;
		}

		const lineWidth = Math.max(1, Math.floor(dpr));
		const toRuler = (value: number) => (value - content.start) * content.scale * dpr;
		const fill = (u: number, v: number, du: number, dv: number, color: string) => {
			context.fillStyle = color;
			if (horizontal) {
				context.fillRect(u, v, du, dv);
			} else {
				context.fillRect(v, u, dv, du);
			}
		};
		/** A line across the ruler at `u`, from `v0` to `v1`, snapped to device pixels. */
		const hairline = (u: number, v0: number, v1: number, color: string) => fill(Math.round(u - lineWidth / 2), v0, lineWidth, v1 - v0, color);
		/** Adds a point to the current path; the first one starts it. */
		const point = (u: number, v: number) => {
			if (horizontal) {
				context.lineTo(u, v);
			} else {
				context.lineTo(v, u);
			}
		};
		const baseline = Math.round(labelBaseline * dpr);
		const drawLabel = (label: IRulerLabel) => {
			context.fillStyle = label.color;
			if (horizontal) {
				context.fillText(label.text, Math.round(label.start), baseline);
			} else {
				// Reads from bottom to top, its baseline toward the page like on the top ruler.
				context.save();
				context.translate(baseline, Math.round(label.start + label.width));
				context.rotate(-Math.PI / 2);
				context.fillText(label.text, 0, 0);
				context.restore();
			}
		};

		// Background, the band of the hovered element, and the border along the page.
		context.clearRect(0, 0, width, height);
		fill(0, 0, length, thickness, style.background);
		const focus = content.focus;
		if (focus) {
			const bandStart = Math.max(0, Math.round(toRuler(focus.start)));
			const bandEnd = Math.min(length, Math.round(toRuler(focus.end)));
			if (bandEnd > bandStart) {
				fill(bandStart, 0, bandEnd - bandStart, thickness, focusBandColor);
			}
		}
		const border = thickness - lineWidth;
		fill(0, border, length, lineWidth, style.border);

		// Graduations, standing on the border.
		const ticks = computeRulerTicks(content.start, content.length, content.scale);
		for (const tick of ticks) {
			context.globalAlpha = tick.major ? 1 : minorTickOpacity;
			const tickLength = Math.round((tick.major ? majorTickLength : minorTickLength) * dpr);
			hairline(tick.position * dpr, border - tickLength, border, style.foreground);
		}
		context.globalAlpha = 1;

		// The values of the hovered element and of the guide being dragged come first: the
		// graduation labels they would overlap are left out.
		const font = `${fontSize * dpr}px ${style.fontFamily}`;
		const strongFont = `600 ${font}`;
		const gap = labelGap * dpr;
		context.font = strongFont;
		/** A label beside `u`, on the preferred side unless only the other one fits in the ruler. */
		const labelBeside = (text: string, u: number, after: boolean, color: string): IRulerLabel => {
			const labelWidth = context.measureText(text).width;
			const fitsAfter = u + gap + labelWidth <= length;
			const fitsBefore = u - gap - labelWidth >= 0;
			const useAfter = after ? fitsAfter || !fitsBefore : fitsAfter && !fitsBefore;
			return { text, start: useAfter ? u + gap : u - gap - labelWidth, width: labelWidth, color, anchor: u };
		};
		const highlights: IRulerLabel[] = [];
		if (focus) {
			const startText = formatRulerValue(focus.start);
			const endText = formatRulerValue(focus.end);
			const focusStart = toRuler(focus.start);
			const focusEnd = toRuler(focus.end);
			if (focusStart >= 0 && focusStart <= length) {
				highlights.push(labelBeside(startText, focusStart, false, focusColor));
			}
			if (endText !== startText && focusEnd >= 0 && focusEnd <= length) {
				highlights.push(labelBeside(endText, focusEnd, true, focusColor));
			}
		}
		if (content.draft !== undefined) {
			const draft = toRuler(content.draft);
			if (draft >= 0 && draft <= length) {
				highlights.push(labelBeside(formatRulerValue(content.draft), draft, true, guideColor));
			}
		}
		// Highlights pushed against an edge of the ruler can meet: line them up.
		highlights.sort((a, b) => a.start - b.start);
		for (let i = 1; i < highlights.length; i++) {
			const previous = highlights[i - 1];
			const minStart = previous.start + previous.width + gap;
			if (highlights[i].start < minStart) {
				highlights[i] = { ...highlights[i], start: minStart };
			}
		}

		// A graduation label is left out when it, or its graduation, meets a highlighted value or the
		// position that value refers to: a value on a graduation would otherwise be written twice.
		context.font = font;
		const clearance = labelClearance * dpr;
		const isHighlighted = (from: number, to: number) => highlights.some(highlight =>
			from < Math.max(highlight.start + highlight.width, highlight.anchor) + clearance
			&& to > Math.min(highlight.start, highlight.anchor) - clearance);
		for (const tick of ticks) {
			if (tick.label === undefined) {
				continue;
			}
			const anchor = tick.position * dpr;
			const labelWidth = context.measureText(tick.label).width;
			if (isHighlighted(anchor, anchor + gap + labelWidth)) {
				continue;
			}
			drawLabel({ text: tick.label, start: anchor + gap, width: labelWidth, color: style.foreground, anchor });
		}

		// Guides: a line across the ruler and a small triangle on its outer edge, pointing at the page.
		const halfWidth = markerHalfWidth * dpr;
		const drawMarker = (position: number) => {
			const u = toRuler(position);
			if (u < -halfWidth || u > length + halfWidth) {
				return;
			}
			hairline(u, 0, thickness, guideColor);
			const center = Math.round(u - lineWidth / 2) + lineWidth / 2;
			context.beginPath();
			point(center - halfWidth, 0);
			point(center + halfWidth, 0);
			point(center, markerHeight * dpr);
			context.closePath();
			context.fillStyle = guideColor;
			context.fill();
		};
		for (const guide of content.guides) {
			drawMarker(guide);
		}
		if (content.draft !== undefined) {
			drawMarker(content.draft);
		}

		context.font = strongFont;
		for (const highlight of highlights) {
			drawLabel(highlight);
		}
	}
}

/**
 * Graduated rulers along the top and left edges of the integrated browser page, like Figma's. They
 * follow the page's scroll and zoom, mark the guides and the extent of the element hovered with the
 * Measure tool, and the user drags guides out of them onto the page. The guides themselves are drawn
 * in the page by its {@link DesignPageOverlay}.
 */
export class DesignRulers extends Disposable {

	/** Covers the wrapper of the page, where the owner appends it. Hidden until {@link setVisible}. */
	readonly element: HTMLElement;

	private readonly _top = new RulerCanvas('x');
	private readonly _left = new RulerCanvas('y');
	private readonly _corner: HTMLElement;

	private _overlay: DesignPageOverlay | undefined;
	/** Listeners of {@link _overlay}. */
	private readonly _overlayStore = this._register(new DisposableStore());
	private readonly _viewportTracking = this._register(new MutableDisposable());
	private _visible = false;
	private _page: IRulersLayout | undefined;

	private readonly _frame = this._register(new MutableDisposable());
	private _pixelRatioWindow: Window | undefined;
	private readonly _pixelRatioListener = this._register(new MutableDisposable());

	private _drag: IGuideDrag | undefined;
	private readonly _dragListeners = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IThemeService themeService: IThemeService,
	) {
		super();
		this.element = $('.jeff-design-rulers');
		this.element.hidden = true;
		this.element.setAttribute('aria-hidden', 'true');
		this._corner = $('.jeff-design-ruler-corner');
		this.element.append(this._top.element, this._left.element, this._corner);

		for (const ruler of [this._top, this._left]) {
			this._register(addDisposableListener(ruler.element, EventType.POINTER_DOWN, (e: PointerEvent) => this._startDrag(e, ruler)));
			this._register(addDisposableListener(ruler.element, EventType.CONTEXT_MENU, (e: MouseEvent) => this._showContextMenu(e)));
		}
		this._register(addDisposableListener(this._corner, EventType.CONTEXT_MENU, (e: MouseEvent) => this._showContextMenu(e)));

		// Beside the rulers rather than over the page: a hover over the page pauses the page view.
		const hint = localize('jeffDesign.rulerHover', "Drag onto the page to add a guide. Drag a guide back onto the ruler to remove it.");
		this._register(_hoverService.setupDelayedHover(this._top.element, { content: hint, style: HoverStyle.Mouse, position: { hoverPosition: HoverPosition.ABOVE } }));
		this._register(_hoverService.setupDelayedHover(this._left.element, { content: hint, style: HoverStyle.Pointer, position: { hoverPosition: HoverPosition.LEFT } }));

		this._register(themeService.onDidColorThemeChange(() => this._scheduleRender()));
	}

	/** Shows the scroll, zoom, guides and hovered element of this page overlay. */
	setOverlay(overlay: DesignPageOverlay | undefined): void {
		if (this._overlay === overlay) {
			return;
		}
		this._endDrag(false);
		this._viewportTracking.clear();
		this._overlayStore.clear();
		this._overlay = overlay;
		if (overlay) {
			this._overlayStore.add(overlay.onDidChangeViewport(() => this._onDidChangeGeometry()));
			this._overlayStore.add(overlay.onDidChangeState(() => this._scheduleRender()));
			this._overlayStore.add(overlay.onDidChangeFocusRect(() => this._scheduleRender()));
			this._overlayStore.add(overlay.onWillDispose(() => this.setOverlay(undefined)));
		}
		this._updateViewportTracking();
		this._scheduleRender();
	}

	setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this.element.hidden = !visible;
		if (!visible) {
			this._endDrag(false);
			this._frame.clear();
		}
		this._updateViewportTracking();
		this._scheduleRender();
	}

	/** Places the rulers along the page, given its rectangle relative to {@link element}, in CSS px. */
	layout(page: IRulersLayout): void {
		const { left, top } = page;
		const width = Math.max(0, page.width);
		const height = Math.max(0, page.height);
		this._page = { left, top, width, height };
		placeElement(this._top.element, left, top - DESIGN_RULER_SIZE, width, DESIGN_RULER_SIZE);
		placeElement(this._left.element, left - DESIGN_RULER_SIZE, top, DESIGN_RULER_SIZE, height);
		placeElement(this._corner, left - DESIGN_RULER_SIZE, top - DESIGN_RULER_SIZE, DESIGN_RULER_SIZE, DESIGN_RULER_SIZE);
		this._onDidChangeGeometry();
	}

	/** The rulers follow the page's scroll position only while they are shown. */
	private _updateViewportTracking(): void {
		const overlay = this._visible ? this._overlay : undefined;
		if (!overlay) {
			this._viewportTracking.clear();
			return;
		}
		if (this._viewportTracking.value) {
			return;
		}
		const tracking = overlay.trackViewport();
		// Tracking changes the overlay's state, whose listeners may have called back into this widget.
		if (this._viewportTracking.value || !this._visible || this._overlay !== overlay) {
			tracking.dispose();
		} else {
			this._viewportTracking.value = tracking;
		}
	}

	/** Workbench px per page px, and the page's scroll position. */
	private _mapping(page: IRulersLayout): { readonly scale: number; readonly scrollX: number; readonly scrollY: number } {
		const viewport = this._overlay?.viewport;
		if (!viewport) {
			return { scale: 1, scrollX: 0, scrollY: 0 };
		}
		const scale = viewport.innerWidth > 0 && page.width > 0 ? page.width / viewport.innerWidth : 1;
		return { scale, scrollX: viewport.scrollX, scrollY: viewport.scrollY };
	}

	private _onDidChangeGeometry(): void {
		// A guide being dragged stays under the pointer when the page moves beneath it.
		if (this._drag) {
			this._moveDraft(this._drag.clientX, this._drag.clientY);
		}
		this._scheduleRender();
	}

	// -- Painting --------------------------------------------------------------------------------

	/** Paints at the next frame, at most once per frame. */
	private _scheduleRender(): void {
		if (!this._visible || this._frame.value || this._store.isDisposed) {
			return;
		}
		const targetWindow = getWindow(this.element);
		const handle = targetWindow.requestAnimationFrame(() => {
			this._frame.clear();
			this._render();
		});
		this._frame.value = toDisposable(() => targetWindow.cancelAnimationFrame(handle));
	}

	private _render(): void {
		const page = this._page;
		if (!this._visible || !page) {
			return;
		}
		const targetWindow = getWindow(this.element);
		if (this._pixelRatioWindow !== targetWindow) {
			// Repaint at the new resolution when the window moves to a screen with another pixel ratio.
			this._pixelRatioWindow = targetWindow;
			this._pixelRatioListener.value = PixelRatio.getInstance(targetWindow).onDidChange(() => this._scheduleRender());
		}
		const dpr = targetWindow.devicePixelRatio || 1;
		const computed = targetWindow.getComputedStyle(this.element);
		const read = (name: string) => computed.getPropertyValue(name).trim();
		const style: IRulerStyle = {
			background: read('--jeff-design-ruler-background') || 'transparent',
			foreground: read('--jeff-design-ruler-foreground') || computed.color,
			border: read('--jeff-design-ruler-border') || 'transparent',
			// The workbench sets its UI font per platform on `.monaco-workbench`; the rulers inherit it.
			fontFamily: computed.fontFamily || 'sans-serif',
		};
		const { scale, scrollX, scrollY } = this._mapping(page);
		const guides = this._overlay?.state.guides ?? [];
		const focus = this._overlay?.focusRect;
		const drag = this._drag;
		this._top.paint({
			length: page.width,
			start: scrollX,
			scale,
			guides: guidePositions(guides, 'x'),
			draft: drag?.axis === 'x' ? drag.position : undefined,
			focus: focus && { start: focus.x, end: focus.x + focus.width },
		}, style, dpr);
		this._left.paint({
			length: page.height,
			start: scrollY,
			scale,
			guides: guidePositions(guides, 'y'),
			draft: drag?.axis === 'y' ? drag.position : undefined,
			focus: focus && { start: focus.y, end: focus.y + focus.height },
		}, style, dpr);
	}

	// -- Dragging guides out of the rulers -------------------------------------------------------

	private _startDrag(e: PointerEvent, ruler: RulerCanvas): void {
		const overlay = this._overlay;
		// Ctrl+click opens the context menu on macOS.
		if (e.button !== 0 || (isMacintosh && e.ctrlKey) || this._drag || !overlay || !this._page) {
			return;
		}
		this._hoverService.hideHover();
		const canvas = ruler.element;
		// The page is a native view: the capture keeps the pointer events coming while it is over it.
		canvas.setPointerCapture(e.pointerId);
		canvas.classList.add('dragging');
		const drag: IGuideDrag = {
			// The top ruler measures x: what comes out of it is a horizontal guide, at a y position.
			axis: ruler.axis === 'x' ? 'y' : 'x',
			overlay,
			canvas,
			pointerId: e.pointerId,
			clientX: e.clientX,
			clientY: e.clientY,
			position: undefined,
		};
		this._drag = drag;
		const store = new DisposableStore();
		store.add(addDisposableListener(canvas, EventType.POINTER_MOVE, (event: PointerEvent) => {
			if (event.pointerId === drag.pointerId) {
				this._moveDraft(event.clientX, event.clientY);
			}
		}));
		store.add(addDisposableListener(canvas, EventType.POINTER_UP, (event: PointerEvent) => {
			if (event.pointerId === drag.pointerId) {
				this._moveDraft(event.clientX, event.clientY);
				this._endDrag(true);
			}
		}));
		for (const type of ['pointercancel', 'lostpointercapture'] as const) {
			store.add(addDisposableListener(canvas, type, (event: PointerEvent) => {
				if (event.pointerId === drag.pointerId) {
					this._endDrag(false);
				}
			}));
		}
		store.add(addDisposableListener(getWindow(canvas), EventType.KEY_DOWN, (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				EventHelper.stop(event, true);
				this._endDrag(false);
			}
		}, true));
		this._dragListeners.value = store;
	}

	/** Shows the guide being dragged where the pointer is, or hides it while the pointer is off the page. */
	private _moveDraft(clientX: number, clientY: number): void {
		const drag = this._drag;
		if (!drag) {
			return;
		}
		drag.clientX = clientX;
		drag.clientY = clientY;
		const position = this._pagePosition(drag.axis, clientX, clientY);
		if (position !== drag.position) {
			drag.position = position;
			drag.overlay.setDraftGuide(drag.axis, position);
			this._scheduleRender();
		}
	}

	/** Turns the guide being dragged into a guide when `commit` and it is over the page, or drops it. */
	private _endDrag(commit: boolean): void {
		const drag = this._drag;
		if (!drag) {
			return;
		}
		this._drag = undefined;
		this._dragListeners.clear();
		drag.canvas.classList.remove('dragging');
		if (drag.canvas.hasPointerCapture(drag.pointerId)) {
			drag.canvas.releasePointerCapture(drag.pointerId);
		}
		if (drag.position !== undefined) {
			if (commit) {
				drag.overlay.commitDraftGuide();
			} else {
				drag.overlay.setDraftGuide(drag.axis, undefined);
			}
		}
		this._scheduleRender();
	}

	/**
	 * The document position, in whole page px, of a guide along `axis` dropped at these client
	 * coordinates; `undefined` when they are not over the page.
	 */
	private _pagePosition(axis: DesignGuideAxis, clientX: number, clientY: number): number | undefined {
		const page = this._page;
		if (!page) {
			return undefined;
		}
		const origin = this.element.getBoundingClientRect();
		const left = origin.left + page.left;
		const top = origin.top + page.top;
		if (clientX < left || clientX >= left + page.width || clientY < top || clientY >= top + page.height) {
			return undefined;
		}
		const { scale, scrollX, scrollY } = this._mapping(page);
		const position = axis === 'x' ? scrollX + (clientX - left) / scale : scrollY + (clientY - top) / scale;
		// Whole pixels, like guides in Figma.
		const rounded = Math.round(position);
		return Object.is(rounded, -0) ? 0 : rounded;
	}

	// -- Context menu ----------------------------------------------------------------------------

	private _showContextMenu(e: MouseEvent): void {
		EventHelper.stop(e, true);
		const overlay = this._overlay;
		if (!overlay) {
			return;
		}
		this._endDrag(false);
		const anchor = new StandardMouseEvent(getWindow(this.element), e);
		this._contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [toAction({
				id: 'jeffDesign.clearGuides',
				label: localize('jeffDesign.clearGuides', "Clear Guides"),
				enabled: overlay.state.guides.length > 0,
				run: () => overlay.setGuides([]),
			})],
		});
	}

	override dispose(): void {
		this._endDrag(false);
		this.element.remove();
		super.dispose();
	}
}
