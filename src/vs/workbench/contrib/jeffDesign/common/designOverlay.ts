/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Protocol between the workbench and the design overlay that JeffCode injects into the page of an
 * integrated browser view. The overlay draws ruler guides, measurements and the mirror placeholder
 * inside the page, because nothing of the workbench can be drawn over the page itself.
 *
 * Workbench -> page: methods of {@link IDesignOverlayPageApi}, called with `Runtime.evaluate`.
 * Page -> workbench: JSON payloads passed to the binding named {@link DESIGN_OVERLAY_BINDING}
 * (`Runtime.addBinding`), read back with {@link parseDesignOverlayNotification}.
 */

/** Name of the function the page calls to notify the workbench. */
export const DESIGN_OVERLAY_BINDING = '__jeffcodeDesignOverlayNotify';

/** Key of `Symbol.for(key)`, the property of the page's `window` that holds {@link IDesignOverlayPageApi}. */
export const DESIGN_OVERLAY_GLOBAL_KEY = 'jeffcode.designOverlay';

/** Bumped when the page API changes, so a page still holding an older overlay gets the new one. */
export const DESIGN_OVERLAY_VERSION = 2;

/** Configuration passed to the overlay script when it is installed in a page. */
export interface IDesignOverlayScriptConfig {
	readonly bindingName: string;
	readonly globalKey: string;
	readonly version: number;
}

/**
 * Axis of a ruler guide. An `x` guide is a vertical line at a horizontal position (dragged from the
 * left ruler); a `y` guide is a horizontal line at a vertical position (dragged from the top ruler).
 */
export type DesignGuideAxis = 'x' | 'y';

export interface IDesignGuide {
	readonly id: string;
	readonly axis: DesignGuideAxis;
	/** Position in CSS px of the page document, so the guide scrolls with the page. */
	readonly position: number;
}

/** Kinds of measurements that the Measure tool shows on every visible element. */
export type DesignMeasureCategory = 'gap' | 'padding' | 'margin' | 'components' | 'typography';

export const ALL_MEASURE_CATEGORIES: readonly DesignMeasureCategory[] = ['gap', 'padding', 'margin', 'components', 'typography'];

export const DEFAULT_MEASURE_CATEGORIES: readonly DesignMeasureCategory[] = ['gap', 'padding'];

/** Opaque layer shown over the whole page with a message, e.g. "No uncommitted changes". */
export interface IDesignOverlayCover {
	readonly title: string;
	readonly detail: string;
	/** CSS colors, taken from the workbench theme. */
	readonly background: string;
	readonly foreground: string;
}

/** Everything the overlay draws. The workbench always sends the whole state. */
export interface IDesignOverlayState {
	/** Rulers are shown in the workbench: draw the guides and let the user move or remove them. */
	readonly rulers: boolean;
	/** Guides are kept while the rulers are hidden, but only drawn when {@link rulers} is true. */
	readonly guides: readonly IDesignGuide[];
	/** The Measure tool is active: hover and drag measurements, and the {@link categories} annotations. */
	readonly measure: boolean;
	/** Annotations shown on every visible element while {@link measure} is true. */
	readonly categories: readonly DesignMeasureCategory[];
	readonly cover: IDesignOverlayCover | undefined;
	/** Send `viewport` notifications when the page scrolls or resizes. */
	readonly reportViewport: boolean;
	/**
	 * Zoom and pan, like a Figma canvas: Ctrl/Cmd+wheel zooms the page in at the pointer and
	 * Space+drag moves around in it. The page reports what the user does (`zoom`, `pan`) and the
	 * workbench zooms the page as a pinch would, so its layout never changes.
	 */
	readonly zoom: boolean;
}

export const EMPTY_DESIGN_OVERLAY_STATE: IDesignOverlayState = {
	rulers: false,
	guides: [],
	measure: false,
	categories: DEFAULT_MEASURE_CATEGORIES,
	cover: undefined,
	reportViewport: false,
	zoom: false,
};

/** Scroll position and size of the page, in CSS px of the page. */
export interface IDesignOverlayViewport {
	readonly scrollX: number;
	readonly scrollY: number;
	/** `window.innerWidth` / `innerHeight`: the layout viewport including scrollbars. */
	readonly innerWidth: number;
	readonly innerHeight: number;
	/** `document.documentElement.clientWidth` / `clientHeight`: without scrollbars. */
	readonly clientWidth: number;
	readonly clientHeight: number;
	/** `document.documentElement.scrollWidth` / `scrollHeight`. */
	readonly documentWidth: number;
	readonly documentHeight: number;
	/** True when this scroll was caused by {@link IDesignOverlayPageApi.scrollTo}. */
	readonly programmatic: boolean;
	/** `visualViewport.offsetLeft` / `offsetTop`: the part of the page shown when zoomed in. */
	readonly visualX: number;
	readonly visualY: number;
	/** `visualViewport.scale`: 1 unless the page is zoomed in (pinch or Zoom and Pan). */
	readonly visualScale: number;
}

/** A rectangle in CSS px of the page document. */
export interface IDesignOverlayRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export type DesignOverlayNotification =
	/** The overlay was installed in a new document and waits for its state. */
	| { readonly type: 'ready' }
	| { readonly type: 'viewport'; readonly viewport: IDesignOverlayViewport }
	/** The user added, moved or removed guides in the page. */
	| { readonly type: 'guides'; readonly guides: readonly IDesignGuide[] }
	/** The user pressed Escape in the Measure tool. */
	| { readonly type: 'measureExit' }
	/** The element hovered with the Measure tool, for the rulers to highlight; `undefined` when none. */
	| { readonly type: 'focus'; readonly rect: IDesignOverlayRect | undefined }
	/**
	 * Zoom and Pan: zoom by `factor` keeping the point (`x`, `y`) in place. The point is in CSS px
	 * of the visible part of the page (relative to the visual viewport).
	 */
	| { readonly type: 'zoom'; readonly x: number; readonly y: number; readonly factor: number }
	/** Zoom and Pan: move the page by (`dx`, `dy`) screen px; (`x`, `y`) is the pointer, as for `zoom`. */
	| { readonly type: 'pan'; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number };

/** One annotation computed by the overlay, in CSS px of the page document. Used by tests. */
export interface IDesignOverlayDebugAnnotation {
	readonly kind: 'gap' | 'padding' | 'margin' | 'component' | 'typography';
	readonly rect: IDesignOverlayRect;
	/** The text drawn in the label, e.g. `16` or `Button 120 × 40`. */
	readonly label: string;
}

/** What the overlay currently computes and draws. Used by tests. */
export interface IDesignOverlayDebugSnapshot {
	readonly hostAttached: boolean;
	readonly annotations: readonly IDesignOverlayDebugAnnotation[];
	readonly guides: readonly IDesignGuide[];
	readonly measurements: readonly { readonly axis: DesignGuideAxis; readonly from: number; readonly to: number; readonly value: number }[];
}

/** The object the overlay script puts on the page's `window[Symbol.for(DESIGN_OVERLAY_GLOBAL_KEY)]`. */
export interface IDesignOverlayPageApi {
	readonly version: number;
	setState(state: IDesignOverlayState): void;
	/** Shows (or, with `null`, hides) the guide being dragged out of a ruler. Position in document px. */
	setDraftGuide(axis: DesignGuideAxis, position: number | null): void;
	/** Turns the guide being dragged into a real guide and sends a `guides` notification. */
	commitDraftGuide(): void;
	/** Removes the measurements the user placed with the Measure tool. */
	clearMeasurements(): void;
	/**
	 * Zoom and Pan: the workbench is pinching the page. A pinch sends the page a Ctrl+wheel event,
	 * which the overlay must then let through instead of turning it into another zoom.
	 */
	setPinching(pinching: boolean): void;
	/** Scrolls the window; the resulting `viewport` notification has `programmatic: true`. */
	scrollTo(x: number, y: number): void;
	getViewport(): IDesignOverlayViewport;
	/** Removes everything the overlay added to the page. */
	destroy(): void;
	debugSnapshot(): IDesignOverlayDebugSnapshot;
}

const maxGuides = 500;

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGuide(value: unknown): IDesignGuide | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const { id, axis, position } = value;
	if (typeof id !== 'string' || id.length === 0 || id.length > 64 || (axis !== 'x' && axis !== 'y') || !isFiniteNumber(position)) {
		return undefined;
	}
	return { id, axis, position };
}

function parseRect(value: unknown): IDesignOverlayRect | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const { x, y, width, height } = value;
	if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) {
		return undefined;
	}
	return { x, y, width, height };
}

function parseViewport(value: unknown): IDesignOverlayViewport | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const numbers = ['scrollX', 'scrollY', 'innerWidth', 'innerHeight', 'clientWidth', 'clientHeight', 'documentWidth', 'documentHeight'] as const;
	for (const key of numbers) {
		if (!isFiniteNumber(value[key])) {
			return undefined;
		}
	}
	const optionalNumber = (key: string, fallback: number): number => isFiniteNumber(value[key]) ? value[key] as number : fallback;
	return {
		scrollX: value.scrollX as number,
		scrollY: value.scrollY as number,
		innerWidth: value.innerWidth as number,
		innerHeight: value.innerHeight as number,
		clientWidth: value.clientWidth as number,
		clientHeight: value.clientHeight as number,
		documentWidth: value.documentWidth as number,
		documentHeight: value.documentHeight as number,
		programmatic: value.programmatic === true,
		visualX: optionalNumber('visualX', 0),
		visualY: optionalNumber('visualY', 0),
		visualScale: Math.max(0.01, optionalNumber('visualScale', 1)),
	};
}

/**
 * Reads a payload the page passed to the binding. Any script of the page can call the binding, so
 * everything is validated; an invalid payload yields `undefined`.
 */
export function parseDesignOverlayNotification(payload: string): DesignOverlayNotification | undefined {
	if (payload.length > 200_000) {
		return undefined;
	}
	let value: unknown;
	try {
		value = JSON.parse(payload);
	} catch {
		return undefined;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	switch (value.type) {
		case 'ready':
			return { type: 'ready' };
		case 'measureExit':
			return { type: 'measureExit' };
		case 'zoom': {
			const { x, y, factor } = value;
			return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(factor) && factor > 0 ? { type: 'zoom', x, y, factor } : undefined;
		}
		case 'pan': {
			const { x, y, dx, dy } = value;
			return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(dx) && isFiniteNumber(dy) ? { type: 'pan', x, y, dx, dy } : undefined;
		}
		case 'viewport': {
			const viewport = parseViewport(value.viewport);
			return viewport ? { type: 'viewport', viewport } : undefined;
		}
		case 'guides': {
			if (!Array.isArray(value.guides) || value.guides.length > maxGuides) {
				return undefined;
			}
			const guides: IDesignGuide[] = [];
			for (const item of value.guides) {
				const guide = parseGuide(item);
				if (!guide) {
					return undefined;
				}
				guides.push(guide);
			}
			return { type: 'guides', guides };
		}
		case 'focus': {
			if (value.rect === undefined || value.rect === null) {
				return { type: 'focus', rect: undefined };
			}
			const rect = parseRect(value.rect);
			return rect ? { type: 'focus', rect } : undefined;
		}
		default:
			return undefined;
	}
}
