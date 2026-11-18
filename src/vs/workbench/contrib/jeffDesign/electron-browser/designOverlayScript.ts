/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	DesignGuideAxis,
	DesignMeasureCategory,
	DesignOverlayNotification,
	IDesignOverlayCover,
	IDesignOverlayDebugAnnotation,
	IDesignOverlayDebugSnapshot,
	IDesignOverlayPageApi,
	IDesignOverlayRect,
	IDesignOverlayScriptConfig,
	IDesignOverlayState,
	IDesignOverlayViewport,
} from '../common/designOverlay.js';

/*
 * The design overlay runs inside the page of an integrated browser view. `designOverlayMain` is
 * injected as source text (`designOverlayMain.toString()`), so its body must not reference anything
 * declared outside of it. The types below are erased at compile time; every value and helper is
 * declared inside the function.
 */

/** Side of an element's border box. */
type OverlaySide = 'left' | 'right' | 'top' | 'bottom';

/** Edges of a box in px; a `DOMRect` is one. */
interface IOverlayBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** A ruler guide as the overlay keeps it: its position changes while it is dragged. */
interface IOverlayGuide {
	readonly id: string;
	readonly axis: DesignGuideAxis;
	position: number;
}

/** An edge of an element's border box near the pointer, in client px. */
interface IOverlayEdge {
	readonly element: Element;
	readonly side: OverlaySide;
	/** Position of the edge on its axis: x for `left` and `right`, y for `top` and `bottom`. */
	readonly position: number;
	/** Extent of the edge on the other axis. */
	readonly from: number;
	readonly to: number;
	/** Distance from the pointer to the edge. */
	readonly distance: number;
	/** Area of the element: between edges at the same distance, the smaller element wins. */
	readonly area: number;
}

/** One end of a measurement, in document px. It follows its element or guide while they exist. */
interface IOverlayAnchor {
	readonly element: Element | undefined;
	readonly side: OverlaySide | undefined;
	readonly guideId: string | undefined;
	/** Position on the measurement axis, updated whenever the element or the guide is found. */
	position: number;
	/** Extent of the anchored edge on the other axis; `undefined` for free points and guides. */
	from: number | undefined;
	to: number | undefined;
}

/** A measurement placed with the Measure tool. */
interface IOverlayMeasurement {
	readonly id: string;
	readonly axis: DesignGuideAxis;
	readonly start: IOverlayAnchor;
	readonly end: IOverlayAnchor;
	/** Document position of the line on the other axis. */
	cross: number;
}

/** A distance shown while hovering an element, in client px. */
interface IOverlayDistance {
	readonly axis: DesignGuideAxis;
	readonly from: number;
	readonly to: number;
	readonly cross: number;
}

/** A gap, padding, margin, component or typography annotation, in document px. */
interface IOverlayAnnotation {
	readonly kind: IDesignOverlayDebugAnnotation['kind'];
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly label: string;
	readonly labelX: number;
	readonly labelY: number;
	readonly labelWidth: number;
	/** False when the label would cover the label of a more important annotation. */
	labelVisible: boolean;
}

/** Where the label and the delete button of a placed measurement were drawn, in client px. */
interface IOverlayMeasurementHit {
	readonly id: string;
	readonly label: IOverlayBox;
	readonly buttonX: number;
	readonly buttonY: number;
}

/** Dragging out a new measurement. */
interface IOverlayCreateDrag {
	readonly kind: 'create';
	/** Document position of the press. */
	readonly originX: number;
	readonly originY: number;
	/** The edge the drag started on, if any. */
	readonly startEdge: IOverlayEdge | undefined;
	/** Known from the start edge, or once the pointer moved far enough. */
	axis: DesignGuideAxis | undefined;
	start: IOverlayAnchor | undefined;
	end: IOverlayAnchor | undefined;
	/** The edge the end snapped to, highlighted while dragging. */
	endEdge: IOverlayEdge | undefined;
	cross: number;
}

/** Moving the line of a placed measurement by its label. */
interface IOverlayCrossDrag {
	readonly kind: 'cross';
	readonly id: string;
	readonly original: number;
}

/** Moving a guide. */
interface IOverlayGuideDrag {
	readonly kind: 'guide';
	readonly id: string;
	readonly original: number;
}

/** What the primary button is dragging. */
type OverlayDrag = IOverlayCreateDrag | IOverlayCrossDrag | IOverlayGuideDrag;

/**
 * Installs the design overlay in the page it runs in and exposes {@link IDesignOverlayPageApi} on
 * `window[Symbol.for(config.globalKey)]`. It draws ruler guides, the Measure tool and the mirror
 * cover in a canvas over the page, and reports to the workbench through the binding named
 * `config.bindingName`.
 *
 * The page runs it at the start of every new document and when the workbench installs it, so it
 * must not break the page: nothing is added to the DOM until something has to be drawn, every
 * handler is guarded, and nothing runs while no feature is active.
 */
export function designOverlayMain(config: IDesignOverlayScriptConfig): void {
	const win = globalThis as unknown as Window & typeof globalThis;
	try {
		if (win.top !== win) {
			return;
		}
	} catch {
		// A cross-origin parent: not the top frame.
		return;
	}

	const globals = win as unknown as Record<string | symbol, unknown>;
	const key = Symbol.for(config.globalKey);
	try {
		const installed = globals[key];
		if (typeof installed === 'object' && installed !== null) {
			const previous = installed as Partial<IDesignOverlayPageApi>;
			if (previous.version === config.version) {
				return;
			}
			previous.destroy?.();
		}
	} catch {
		// A broken older overlay is replaced anyway.
	}

	// -- Constants ----------------------------------------------------------------------------

	const measureColor = '#F24822';
	const guideColor = '#FF3366';
	const gapColor = '#E5007E';
	const gapFill = 'rgba(229, 0, 126, 0.16)';
	const gapHatch = 'rgba(229, 0, 126, 0.5)';
	const paddingColor = '#2E7CF6';
	const paddingFill = 'rgba(46, 124, 246, 0.15)';
	const marginColor = '#F59E0B';
	const marginFill = 'rgba(245, 158, 11, 0.16)';
	const componentColor = '#9747FF';
	const typographyColor = '#0E9F6E';
	const labelColor = '#FFFFFF';
	const kindColors: { readonly [K in IDesignOverlayDebugAnnotation['kind']]: string } = {
		gap: gapColor,
		padding: paddingColor,
		margin: marginColor,
		component: componentColor,
		typography: typographyColor,
	};
	const labelFont = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
	const pillHeight = 16;
	const pillPadding = 4;
	const pillRadius = 3;
	/** How close the pointer must be to an element edge or a guide to snap to it. */
	const snapDistance = 6;
	/** How close the pointer must be to a guide to grab it. */
	const guideGrabDistance = 4;
	/** How far the pointer moves before a drag started away from any edge picks its axis. */
	const dragThreshold = 3;
	const capSize = 6;
	const deleteRadius = 7;
	const componentDash = [4, 3];
	const extensionDash = [3, 3];
	const noDash: number[] = [];
	/** Annotations are computed for the viewport grown by this many px on each side. */
	const annotationMargin = 100;
	const maxScannedElements = 6000;
	const maxVisitedElements = 30000;
	const maxGapItems = 60;
	const maxAnnotations = 1500;
	const maxGuides = 500;
	const maxSiblings = 1000;
	const maxCanvasPixels = 16_000_000;
	const hostTag = 'jeff-design-overlay';
	const skippedTags = new Set(['script', 'style', 'link', 'meta', 'head', 'title', 'noscript', 'template', 'br', 'wbr']);
	const measureCategories: readonly DesignMeasureCategory[] = ['gap', 'padding', 'margin', 'components', 'typography'];

	// -- State --------------------------------------------------------------------------------

	let destroyed = false;
	let state: IDesignOverlayState = { rulers: false, guides: [], measure: false, categories: [], cover: undefined, reportViewport: false };
	let guides: IOverlayGuide[] = [];
	let draftAxis: DesignGuideAxis | undefined;
	let draftPosition: number | undefined;
	/** The page saw the draft guide move under a pressed button: commit it on release. */
	let draftMoved = false;
	let measurements: IOverlayMeasurement[] = [];
	let annotations: IOverlayAnnotation[] = [];
	let drag: OverlayDrag | undefined;
	let programmaticUntil = 0;
	let lastViewport = '';

	let pointerX = 0;
	let pointerY = 0;
	let pointerInside = false;
	let hoverTarget: Element | undefined;
	let hoverEdge: IOverlayEdge | undefined;
	let hoverDistances: IOverlayDistance[] = [];
	let hoverMeasurementId: string | undefined;
	let hoverGuideId: string | undefined;
	let measurementHits: IOverlayMeasurementHit[] = [];
	let focusRect: IDesignOverlayRect | undefined;

	/** The host may only be added once the page is loaded, so that it never meets a hydration. */
	let hostAllowed = false;
	let host: HTMLElement | undefined;
	let canvas: HTMLCanvasElement | undefined;
	let context: CanvasRenderingContext2D | undefined;
	let coverElement: HTMLElement | undefined;
	let coverTitle: HTMLElement | undefined;
	let coverDetail: HTMLElement | undefined;
	let hostWidth = 0;
	let hostHeight = 0;
	let scaleX = 1;
	let scaleY = 1;
	let hatch: CanvasPattern | undefined;
	let hatchScale = 0;
	let cursorSheet: CSSStyleSheet | undefined;
	let cursorValue: string | undefined;
	let measureContext: CanvasRenderingContext2D | null | undefined;
	const textWidths = new Map<string, number>();

	let frameHandle = 0;
	let intervalHandle = 0;
	let mutationTimer = 0;
	let loadTimer = 0;
	let fallbackTimer = 0;
	let mutationObserver: MutationObserver | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let removeLoadListener: (() => void) | undefined;
	let removeClickSwallow: (() => void) | undefined;
	const listenerGroups = new Map<string, (() => void)[]>();

	let viewportDirty = false;
	let annotationsDirty = false;
	let hoverDirty = false;

	// -- Helpers ------------------------------------------------------------------------------

	const isRecord = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;

	const px = (value: string): number => {
		const parsed = parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	};

	const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

	/** At most two decimals, no trailing zeros: 16, 15.5, 0.33. */
	const formatNumber = (value: number): string => String(Math.round(value * 100) / 100);

	const formatSize = (width: number, height: number): string => `${formatNumber(width)} × ${formatNumber(height)}`;

	const createId = (prefix: string): string => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

	const overlaps = (a: IOverlayBox, b: IOverlayBox): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

	const sameRect = (a: IDesignOverlayRect | undefined, b: IDesignOverlayRect | undefined): boolean => {
		if (!a || !b) {
			return a === b;
		}
		return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
	};

	const toDocumentRect = (rect: DOMRect): IDesignOverlayRect => ({ x: rect.left + win.scrollX, y: rect.top + win.scrollY, width: rect.width, height: rect.height });

	const block = (event: Event): void => {
		event.preventDefault();
		event.stopImmediatePropagation();
	};

	const notify = (message: DesignOverlayNotification): void => {
		try {
			const binding = globals[config.bindingName];
			if (typeof binding === 'function') {
				(binding as (payload: string) => void)(JSON.stringify(message));
			}
		} catch {
			// The workbench is not listening.
		}
	};

	/** Adds a guarded listener and returns what removes it. */
	const listen = <E extends Event>(target: EventTarget, type: string, handler: (event: E) => void, options: AddEventListenerOptions): (() => void) => {
		const listener = (event: Event): void => {
			if (destroyed) {
				return;
			}
			try {
				handler(event as E);
			} catch {
				// A failure of the overlay must never break the page.
			}
		};
		target.addEventListener(type, listener, options);
		return () => target.removeEventListener(type, listener, options);
	};

	/** Adds a group of listeners while `enabled`, removes them otherwise. */
	const setListeners = (name: string, enabled: boolean, add: () => (() => void)[]): void => {
		const current = listenerGroups.get(name);
		if (enabled && !current) {
			listenerGroups.set(name, add());
		} else if (!enabled && current) {
			listenerGroups.delete(name);
			for (const remove of current) {
				remove();
			}
		}
	};

	const isEditableFocused = (): boolean => {
		let active: Element | null = win.document.activeElement;
		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement;
		}
		if (!active) {
			return false;
		}
		const tag = active.localName;
		return tag === 'input' || tag === 'textarea' || tag === 'select' || (active as HTMLElement).isContentEditable === true;
	};

	const findGuide = (id: string | undefined): IOverlayGuide | undefined => id === undefined ? undefined : guides.find(guide => guide.id === id);

	const findMeasurement = (id: string | undefined): IOverlayMeasurement | undefined => id === undefined ? undefined : measurements.find(measurement => measurement.id === id);

	// -- Viewport -----------------------------------------------------------------------------

	/** Size of the viewport without scrollbars, in CSS px. */
	const getViewportSize = (): { readonly width: number; readonly height: number } => {
		const doc = win.document;
		const root = doc.documentElement;
		let width = root ? root.clientWidth : 0;
		let height = root ? root.clientHeight : 0;
		if (doc.compatMode === 'BackCompat' && doc.body) {
			// In quirks mode the body reports the viewport.
			width = doc.body.clientWidth;
			height = doc.body.clientHeight;
		}
		return { width: width || win.innerWidth, height: height || win.innerHeight };
	};

	const readViewport = (): IDesignOverlayViewport => {
		const doc = win.document;
		const size = getViewportSize();
		const scroller = doc.scrollingElement ?? doc.documentElement;
		return {
			scrollX: win.scrollX,
			scrollY: win.scrollY,
			innerWidth: win.innerWidth,
			innerHeight: win.innerHeight,
			clientWidth: size.width,
			clientHeight: size.height,
			documentWidth: scroller ? scroller.scrollWidth : size.width,
			documentHeight: scroller ? scroller.scrollHeight : size.height,
			programmatic: win.performance.now() < programmaticUntil,
		};
	};

	const reportViewportNow = (): void => {
		const viewport = readViewport();
		lastViewport = JSON.stringify(viewport);
		notify({ type: 'viewport', viewport });
	};

	// -- Host ---------------------------------------------------------------------------------

	const setStyles = (element: HTMLElement, styles: readonly (readonly [string, string])[]): void => {
		for (const [property, value] of styles) {
			element.style.setProperty(property, value, 'important');
		}
	};

	const hostNeeded = (): boolean => state.measure || !!state.cover || draftAxis !== undefined || (state.rulers && guides.length > 0);

	const guidesInteractive = (): boolean => !state.measure && state.rulers && guides.length > 0;

	const updateCover = (): void => {
		const element = coverElement;
		if (!element || !coverTitle || !coverDetail) {
			return;
		}
		const cover = state.cover;
		if (!cover) {
			element.style.setProperty('display', 'none', 'important');
			coverTitle.textContent = '';
			coverDetail.textContent = '';
			return;
		}
		element.style.setProperty('display', 'flex', 'important');
		element.style.setProperty('background', cover.background, 'important');
		element.style.setProperty('color', cover.foreground, 'important');
		coverTitle.textContent = cover.title;
		coverDetail.textContent = cover.detail;
		coverDetail.style.setProperty('display', cover.detail ? 'block' : 'none', 'important');
	};

	const createHost = (doc: Document): HTMLElement => {
		const element = doc.createElement(hostTag);
		setStyles(element, [
			['all', 'initial'],
			['position', 'fixed'],
			['top', '0'],
			['left', '0'],
			['width', '0px'],
			['height', '0px'],
			['z-index', '2147483647'],
			['pointer-events', 'none'],
			['display', 'block'],
			['contain', 'strict'],
			['overflow', 'hidden'],
			['margin', '0'],
			['padding', '0'],
			['border', '0'],
			['background', 'transparent'],
		]);
		const shadow = element.attachShadow({ mode: 'closed' });

		const surface = doc.createElement('canvas');
		setStyles(surface, [
			['position', 'absolute'],
			['top', '0'],
			['left', '0'],
			['display', 'block'],
			['margin', '0'],
			['padding', '0'],
			['border', '0'],
			['pointer-events', 'none'],
		]);
		shadow.appendChild(surface);

		const cover = doc.createElement('div');
		setStyles(cover, [
			['position', 'absolute'],
			['top', '0'],
			['right', '0'],
			['bottom', '0'],
			['left', '0'],
			['display', 'none'],
			['flex-direction', 'column'],
			['align-items', 'center'],
			['justify-content', 'center'],
			['gap', '6px'],
			['padding', '24px'],
			['box-sizing', 'border-box'],
			['text-align', 'center'],
			['font-family', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'],
			['pointer-events', 'auto'],
			['user-select', 'none'],
			['cursor', 'default'],
		]);
		const title = doc.createElement('div');
		setStyles(title, [['font-weight', '600'], ['font-size', '15px'], ['line-height', '1.4']]);
		const detail = doc.createElement('div');
		setStyles(detail, [['font-size', '13px'], ['line-height', '1.5'], ['opacity', '0.8'], ['max-width', '420px']]);
		cover.append(title, detail);
		shadow.appendChild(cover);

		canvas = surface;
		context = surface.getContext('2d') ?? undefined;
		coverElement = cover;
		coverTitle = title;
		coverDetail = detail;
		hostWidth = -1;
		hostHeight = -1;
		hatch = undefined;
		return element;
	};

	/** Sizes the host to the viewport and the canvas to the device pixels it covers. */
	const sizeHost = (element: HTMLElement): void => {
		const surface = canvas;
		if (!surface) {
			return;
		}
		const { width, height } = getViewportSize();
		if (width !== hostWidth || height !== hostHeight) {
			hostWidth = width;
			hostHeight = height;
			element.style.setProperty('width', `${width}px`, 'important');
			element.style.setProperty('height', `${height}px`, 'important');
			surface.style.setProperty('width', `${width}px`, 'important');
			surface.style.setProperty('height', `${height}px`, 'important');
		}
		let ratio = win.devicePixelRatio || 1;
		if (width * height * ratio * ratio > maxCanvasPixels) {
			ratio = Math.sqrt(maxCanvasPixels / Math.max(1, width * height));
		}
		const pixelWidth = Math.max(1, Math.round(width * ratio));
		const pixelHeight = Math.max(1, Math.round(height * ratio));
		if (surface.width !== pixelWidth) {
			surface.width = pixelWidth;
		}
		if (surface.height !== pixelHeight) {
			surface.height = pixelHeight;
		}
		scaleX = width > 0 ? pixelWidth / width : 1;
		scaleY = height > 0 ? pixelHeight / height : 1;
	};

	/** Creates the host if needed and makes sure it is attached; false while it may not exist yet. */
	const ensureHost = (): boolean => {
		const doc = win.document;
		const root = doc.documentElement;
		if (!hostAllowed || !root) {
			return false;
		}
		let element = host;
		if (!element) {
			element = createHost(doc);
			host = element;
			updateCover();
		}
		if (element.parentNode !== root) {
			root.appendChild(element);
		}
		sizeHost(element);
		return true;
	};

	const removeHost = (): void => {
		host?.remove();
	};

	// -- Cursor -------------------------------------------------------------------------------

	const setCursor = (cursor: string | undefined): void => {
		try {
			const doc = win.document;
			if (!cursor) {
				const sheet = cursorSheet;
				if (sheet && doc.adoptedStyleSheets.includes(sheet)) {
					doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(candidate => candidate !== sheet);
				}
				cursorValue = undefined;
				return;
			}
			let sheet = cursorSheet;
			if (!sheet) {
				sheet = new win.CSSStyleSheet();
				cursorSheet = sheet;
			}
			if (cursorValue !== cursor) {
				sheet.replaceSync(`*, *::before, *::after { cursor: ${cursor} !important; }`);
				cursorValue = cursor;
			}
			if (!doc.adoptedStyleSheets.includes(sheet)) {
				doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
			}
		} catch {
			// The page keeps its cursor.
		}
	};

	const updateCursor = (): void => {
		if (state.measure) {
			if (drag?.kind === 'cross') {
				setCursor(findMeasurement(drag.id)?.axis === 'y' ? 'col-resize' : 'row-resize');
			} else {
				setCursor(hoverMeasurementId !== undefined && !drag ? 'pointer' : 'crosshair');
			}
			return;
		}
		const guide = findGuide(drag?.kind === 'guide' ? drag.id : hoverGuideId);
		setCursor(guide && state.rulers ? (guide.axis === 'x' ? 'col-resize' : 'row-resize') : undefined);
	};

	// -- Drawing primitives -------------------------------------------------------------------

	const measureText = (text: string): number => {
		let width = textWidths.get(text);
		if (width === undefined) {
			if (measureContext === undefined) {
				measureContext = win.document.createElement('canvas').getContext('2d');
				if (measureContext) {
					measureContext.font = labelFont;
				}
			}
			width = measureContext ? measureContext.measureText(text).width : text.length * 7;
			if (textWidths.size > 2000) {
				textWidths.clear();
			}
			textWidths.set(text, width);
		}
		return width;
	};

	const pillWidth = (text: string): number => Math.ceil(measureText(text)) + pillPadding * 2;

	/** Draws a label; returns its box in client px. */
	const drawPill = (ctx: CanvasRenderingContext2D, text: string, left: number, top: number, color: string): IOverlayBox => {
		const width = pillWidth(text);
		const x = Math.round(left);
		const y = Math.round(top);
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.roundRect(x, y, width, pillHeight, pillRadius);
		ctx.fill();
		ctx.fillStyle = labelColor;
		ctx.fillText(text, x + pillPadding, y + pillHeight / 2 + 0.5);
		return { left: x, top: y, right: x + width, bottom: y + pillHeight };
	};

	const drawCenteredPill = (ctx: CanvasRenderingContext2D, text: string, centerX: number, centerY: number, color: string): IOverlayBox =>
		drawPill(ctx, text, centerX - pillWidth(text) / 2, centerY - pillHeight / 2, color);

	/** Strokes a line; horizontal and vertical lines are snapped to whole pixels to stay crisp. */
	const strokeLine = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string, dash: number[] = noDash): void => {
		const offset = width % 2 === 1 ? 0.5 : 0;
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.setLineDash(dash);
		ctx.beginPath();
		if (x1 === x2) {
			const x = Math.round(x1) + offset;
			ctx.moveTo(x, y1);
			ctx.lineTo(x, y2);
		} else if (y1 === y2) {
			const y = Math.round(y1) + offset;
			ctx.moveTo(x1, y);
			ctx.lineTo(x2, y);
		} else {
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
		}
		ctx.stroke();
		if (dash !== noDash) {
			ctx.setLineDash(noDash);
		}
	};

	const strokeBox = (ctx: CanvasRenderingContext2D, box: IOverlayBox, color: string, dash: number[] = noDash): void => {
		const left = Math.round(box.left);
		const top = Math.round(box.top);
		const width = Math.round(box.right) - left;
		const height = Math.round(box.bottom) - top;
		ctx.strokeStyle = color;
		ctx.lineWidth = 1;
		ctx.setLineDash(dash);
		ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
		if (dash !== noDash) {
			ctx.setLineDash(noDash);
		}
	};

	/** Fills a rectangle given in client px, snapped to whole pixels. */
	const fillBox = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void => {
		const left = Math.round(x);
		const top = Math.round(y);
		ctx.fillRect(left, top, Math.round(x + width) - left, Math.round(y + height) - top);
	};

	/** A line with end caps, e.g. a distance between two edges. */
	const drawDimension = (ctx: CanvasRenderingContext2D, axis: DesignGuideAxis, from: number, to: number, cross: number, width: number): void => {
		const half = capSize / 2;
		if (axis === 'x') {
			strokeLine(ctx, from, cross, to, cross, width, measureColor);
			strokeLine(ctx, from, cross - half, from, cross + half, 1, measureColor);
			strokeLine(ctx, to, cross - half, to, cross + half, 1, measureColor);
		} else {
			strokeLine(ctx, cross, from, cross, to, width, measureColor);
			strokeLine(ctx, cross - half, from, cross + half, from, 1, measureColor);
			strokeLine(ctx, cross - half, to, cross + half, to, 1, measureColor);
		}
	};

	const drawEdge = (ctx: CanvasRenderingContext2D, edge: IOverlayEdge): void => {
		if (edge.side === 'left' || edge.side === 'right') {
			strokeLine(ctx, edge.position, edge.from, edge.position, edge.to, 2, measureColor);
		} else {
			strokeLine(ctx, edge.from, edge.position, edge.to, edge.position, 2, measureColor);
		}
	};

	const drawDeleteButton = (ctx: CanvasRenderingContext2D, x: number, y: number): void => {
		ctx.fillStyle = measureColor;
		ctx.beginPath();
		ctx.arc(x, y, deleteRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = labelColor;
		ctx.lineWidth = 1;
		ctx.setLineDash(noDash);
		ctx.stroke();
		const arm = 2.5;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(x - arm, y - arm);
		ctx.lineTo(x + arm, y + arm);
		ctx.moveTo(x + arm, y - arm);
		ctx.lineTo(x - arm, y + arm);
		ctx.stroke();
	};

	/** The 45-degree hatch of gap annotations, one canvas pixel per device pixel. */
	const getHatch = (ctx: CanvasRenderingContext2D): CanvasPattern | undefined => {
		const scale = scaleX;
		if (hatch && hatchScale === scale) {
			return hatch;
		}
		hatch = undefined;
		hatchScale = scale;
		const size = Math.max(2, Math.round(6 * scale));
		const tile = win.document.createElement('canvas');
		tile.width = size;
		tile.height = size;
		const tileContext = tile.getContext('2d');
		if (!tileContext) {
			return undefined;
		}
		tileContext.strokeStyle = gapHatch;
		tileContext.lineWidth = Math.max(1, scale);
		tileContext.beginPath();
		tileContext.moveTo(0, size);
		tileContext.lineTo(size, 0);
		tileContext.moveTo(-size / 2, size / 2);
		tileContext.lineTo(size / 2, -size / 2);
		tileContext.moveTo(size / 2, size * 1.5);
		tileContext.lineTo(size * 1.5, size / 2);
		tileContext.stroke();
		const pattern = ctx.createPattern(tile, 'repeat');
		if (pattern) {
			pattern.setTransform({ a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: 0, f: 0 });
			hatch = pattern;
		}
		return hatch;
	};

	// -- Elements under the pointer -----------------------------------------------------------

	const elementsAt = (x: number, y: number): Element[] => win.document.elementsFromPoint(x, y).filter(element => element !== host);

	/** The elements at the pointer and around it, the candidates for edge snapping. */
	const probeElements = (x: number, y: number, stack: readonly Element[]): Element[] => {
		const found = new Set<Element>(stack);
		const offsets: readonly (readonly [number, number])[] = [[-snapDistance, 0], [snapDistance, 0], [0, -snapDistance], [0, snapDistance]];
		for (const [dx, dy] of offsets) {
			for (const element of elementsAt(x + dx, y + dy)) {
				found.add(element);
			}
		}
		return [...found];
	};

	/** The edge nearest to the pointer within {@link snapDistance}; ties go to the smaller element. */
	const findEdge = (x: number, y: number, candidates: readonly Element[], vertical: boolean, horizontal: boolean): IOverlayEdge | undefined => {
		let best: IOverlayEdge | undefined;
		for (const element of candidates) {
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 && rect.height <= 0) {
				continue;
			}
			const area = rect.width * rect.height;
			const edges: IOverlayEdge[] = [];
			if (vertical && y >= rect.top - snapDistance && y <= rect.bottom + snapDistance) {
				edges.push({ element, side: 'left', position: rect.left, from: rect.top, to: rect.bottom, distance: Math.abs(x - rect.left), area });
				edges.push({ element, side: 'right', position: rect.right, from: rect.top, to: rect.bottom, distance: Math.abs(x - rect.right), area });
			}
			if (horizontal && x >= rect.left - snapDistance && x <= rect.right + snapDistance) {
				edges.push({ element, side: 'top', position: rect.top, from: rect.left, to: rect.right, distance: Math.abs(y - rect.top), area });
				edges.push({ element, side: 'bottom', position: rect.bottom, from: rect.left, to: rect.right, distance: Math.abs(y - rect.bottom), area });
			}
			for (const edge of edges) {
				if (edge.distance > snapDistance) {
					continue;
				}
				if (!best || edge.distance < best.distance - 0.01 || (Math.abs(edge.distance - best.distance) <= 0.01 && edge.area < best.area)) {
					best = edge;
				}
			}
		}
		return best;
	};

	/** The guide nearest to a client point within `maxDistance`, optionally of one axis. */
	const nearestGuide = (x: number, y: number, axis: DesignGuideAxis | undefined, maxDistance: number): { readonly guide: IOverlayGuide; readonly distance: number } | undefined => {
		const sx = win.scrollX;
		const sy = win.scrollY;
		let best: { readonly guide: IOverlayGuide; readonly distance: number } | undefined;
		for (const guide of guides) {
			if (axis && guide.axis !== axis) {
				continue;
			}
			const distance = guide.axis === 'x' ? Math.abs(x - (guide.position - sx)) : Math.abs(y - (guide.position - sy));
			if (distance <= maxDistance && (!best || distance < best.distance)) {
				best = { guide, distance };
			}
		}
		return best;
	};

	/**
	 * Distances from an element to its neighbours, like Figma: on each side, the nearest sibling of
	 * the element (or of the ancestor sharing its box) that faces it, otherwise the padding box of
	 * the container.
	 */
	const computeDistances = (target: Element): IOverlayDistance[] => {
		const box = target.getBoundingClientRect();
		let child = target;
		let container = target.parentElement;
		let containerBox: DOMRect | undefined;
		while (container) {
			const rect = container.getBoundingClientRect();
			const differs = Math.abs(rect.left - box.left) > 0.5 || Math.abs(rect.top - box.top) > 0.5 || Math.abs(rect.right - box.right) > 0.5 || Math.abs(rect.bottom - box.bottom) > 0.5;
			if (differs && rect.width > 0 && rect.height > 0) {
				containerBox = rect;
				break;
			}
			child = container;
			container = container.parentElement;
		}
		if (!container || !containerBox) {
			return [];
		}

		let left: IOverlayDistance | undefined;
		let right: IOverlayDistance | undefined;
		let top: IOverlayDistance | undefined;
		let bottom: IOverlayDistance | undefined;
		let count = 0;
		for (let sibling = container.firstElementChild; sibling && count < maxSiblings; sibling = sibling.nextElementSibling) {
			count++;
			if (sibling === child || sibling === host) {
				continue;
			}
			const rect = sibling.getBoundingClientRect();
			if (rect.width <= 0 && rect.height <= 0) {
				continue;
			}
			const overlapTop = Math.max(rect.top, box.top);
			const overlapBottom = Math.min(rect.bottom, box.bottom);
			if (overlapBottom - overlapTop > 0) {
				const cross = (overlapTop + overlapBottom) / 2;
				if (rect.left >= box.right - 0.5 && (!right || rect.left - box.right < right.to - right.from)) {
					right = { axis: 'x', from: box.right, to: rect.left, cross };
				}
				if (rect.right <= box.left + 0.5 && (!left || box.left - rect.right < left.to - left.from)) {
					left = { axis: 'x', from: rect.right, to: box.left, cross };
				}
			}
			const overlapLeft = Math.max(rect.left, box.left);
			const overlapRight = Math.min(rect.right, box.right);
			if (overlapRight - overlapLeft > 0) {
				const cross = (overlapLeft + overlapRight) / 2;
				if (rect.top >= box.bottom - 0.5 && (!bottom || rect.top - box.bottom < bottom.to - bottom.from)) {
					bottom = { axis: 'y', from: box.bottom, to: rect.top, cross };
				}
				if (rect.bottom <= box.top + 0.5 && (!top || box.top - rect.bottom < top.to - top.from)) {
					top = { axis: 'y', from: rect.bottom, to: box.top, cross };
				}
			}
		}

		if (!left || !right || !top || !bottom) {
			const style = win.getComputedStyle(container);
			const paddingLeft = containerBox.left + px(style.borderLeftWidth);
			const paddingRight = containerBox.right - px(style.borderRightWidth);
			const paddingTop = containerBox.top + px(style.borderTopWidth);
			const paddingBottom = containerBox.bottom - px(style.borderBottomWidth);
			const middleX = (box.left + box.right) / 2;
			const middleY = (box.top + box.bottom) / 2;
			left ??= box.left > paddingLeft ? { axis: 'x', from: paddingLeft, to: box.left, cross: middleY } : undefined;
			right ??= paddingRight > box.right ? { axis: 'x', from: box.right, to: paddingRight, cross: middleY } : undefined;
			top ??= box.top > paddingTop ? { axis: 'y', from: paddingTop, to: box.top, cross: middleX } : undefined;
			bottom ??= paddingBottom > box.bottom ? { axis: 'y', from: box.bottom, to: paddingBottom, cross: middleX } : undefined;
		}

		const distances: IOverlayDistance[] = [];
		for (const distance of [left, right, top, bottom]) {
			if (distance && distance.to - distance.from >= 0.5) {
				distances.push(distance);
			}
		}
		return distances;
	};

	// -- Measurements -------------------------------------------------------------------------

	const pointAnchor = (position: number): IOverlayAnchor => ({ element: undefined, side: undefined, guideId: undefined, position, from: undefined, to: undefined });

	const guideAnchor = (guide: IOverlayGuide): IOverlayAnchor => ({ element: undefined, side: undefined, guideId: guide.id, position: guide.position, from: undefined, to: undefined });

	const edgeAnchor = (edge: IOverlayEdge): IOverlayAnchor => {
		const vertical = edge.side === 'left' || edge.side === 'right';
		const along = vertical ? win.scrollX : win.scrollY;
		const across = vertical ? win.scrollY : win.scrollX;
		return { element: edge.element, side: edge.side, guideId: undefined, position: edge.position + along, from: edge.from + across, to: edge.to + across };
	};

	/** The document position of an anchor, read from its element or guide while they exist. */
	const resolveAnchor = (anchor: IOverlayAnchor): number => {
		if (anchor.guideId !== undefined) {
			const guide = findGuide(anchor.guideId);
			if (guide) {
				anchor.position = guide.position;
			}
		} else if (anchor.element && anchor.side && anchor.element.isConnected) {
			const rect = anchor.element.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				const sx = win.scrollX;
				const sy = win.scrollY;
				switch (anchor.side) {
					case 'left':
					case 'right':
						anchor.position = (anchor.side === 'left' ? rect.left : rect.right) + sx;
						anchor.from = rect.top + sy;
						anchor.to = rect.bottom + sy;
						break;
					case 'top':
					case 'bottom':
						anchor.position = (anchor.side === 'top' ? rect.top : rect.bottom) + sy;
						anchor.from = rect.left + sx;
						anchor.to = rect.right + sx;
						break;
				}
			}
		}
		return anchor.position;
	};

	/**
	 * Draws a measurement between two anchors: the line at `cross`, its end caps, dashed extension
	 * lines to anchored edges that do not reach the line, and the distance label. Returns the label.
	 */
	const drawMeasurement = (ctx: CanvasRenderingContext2D, axis: DesignGuideAxis, start: IOverlayAnchor, end: IOverlayAnchor, cross: number, width: number): IOverlayBox => {
		const startPosition = resolveAnchor(start);
		const endPosition = resolveAnchor(end);
		const horizontal = axis === 'x';
		const along = horizontal ? win.scrollX : win.scrollY;
		const across = horizontal ? win.scrollY : win.scrollX;
		const line = cross - across;
		for (const anchor of [start, end]) {
			if (anchor.from === undefined || anchor.to === undefined) {
				continue;
			}
			const position = anchor.position - along;
			const from = anchor.from - across;
			const to = anchor.to - across;
			const reach = line < from ? from : line > to ? to : undefined;
			if (reach !== undefined) {
				if (horizontal) {
					strokeLine(ctx, position, reach, position, line, 1, measureColor, extensionDash);
				} else {
					strokeLine(ctx, reach, position, line, position, 1, measureColor, extensionDash);
				}
			}
		}
		const a = startPosition - along;
		const b = endPosition - along;
		drawDimension(ctx, axis, a, b, line, width);
		const label = formatNumber(Math.abs(endPosition - startPosition));
		return horizontal ? drawCenteredPill(ctx, label, (a + b) / 2, line, measureColor) : drawCenteredPill(ctx, label, line, (a + b) / 2, measureColor);
	};

	const hitMeasurement = (x: number, y: number): { readonly id: string; readonly button: boolean } | undefined => {
		for (let index = measurementHits.length - 1; index >= 0; index--) {
			const hit = measurementHits[index];
			const dx = x - hit.buttonX;
			const dy = y - hit.buttonY;
			if (dx * dx + dy * dy <= (deleteRadius + 1) * (deleteRadius + 1)) {
				return { id: hit.id, button: true };
			}
			if (x >= hit.label.left - 2 && x <= hit.buttonX && y >= hit.label.top - 2 && y <= hit.label.bottom + 2) {
				return { id: hit.id, button: false };
			}
		}
		return undefined;
	};

	const removeMeasurement = (id: string): void => {
		measurements = measurements.filter(measurement => measurement.id !== id);
		if (hoverMeasurementId === id) {
			hoverMeasurementId = undefined;
		}
	};

	// -- Guides -------------------------------------------------------------------------------

	const notifyGuides = (): void => {
		notify({ type: 'guides', guides: guides.map(guide => ({ id: guide.id, axis: guide.axis, position: guide.position })) });
	};

	const commitDraft = (): void => {
		if (draftAxis === undefined || draftPosition === undefined) {
			return;
		}
		if (guides.length < maxGuides) {
			guides.push({ id: createId('g'), axis: draftAxis, position: Math.round(draftPosition) });
		}
		draftAxis = undefined;
		draftPosition = undefined;
		draftMoved = false;
		notifyGuides();
		syncFeatures();
	};

	/** After a guide drag, the page gets a click; it must not activate what is under the pointer. */
	const swallowNextClick = (): void => {
		removeClickSwallow?.();
		let timer = 0;
		const cleanup = (): void => {
			win.clearTimeout(timer);
			remove();
			if (removeClickSwallow === cleanup) {
				removeClickSwallow = undefined;
			}
		};
		const remove = listen<MouseEvent>(win, 'click', event => {
			block(event);
			cleanup();
		}, { capture: true });
		timer = win.setTimeout(cleanup, 300);
		removeClickSwallow = cleanup;
	};

	// -- Drags --------------------------------------------------------------------------------

	const updateCreateDrag = (current: IOverlayCreateDrag): void => {
		const docX = pointerX + win.scrollX;
		const docY = pointerY + win.scrollY;
		if (!current.axis) {
			const dx = docX - current.originX;
			const dy = docY - current.originY;
			if (Math.abs(dx) < dragThreshold && Math.abs(dy) < dragThreshold) {
				return;
			}
			current.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
		}
		const horizontal = current.axis === 'x';
		current.start ??= pointAnchor(horizontal ? current.originX : current.originY);
		current.cross = horizontal ? docY : docX;
		const edge = findEdge(pointerX, pointerY, probeElements(pointerX, pointerY, elementsAt(pointerX, pointerY)), horizontal, !horizontal);
		const guide = state.rulers ? nearestGuide(pointerX, pointerY, current.axis, snapDistance) : undefined;
		if (guide && (!edge || guide.distance <= edge.distance)) {
			current.end = guideAnchor(guide.guide);
			current.endEdge = undefined;
		} else if (edge) {
			current.end = edgeAnchor(edge);
			current.endEdge = edge;
		} else {
			current.end = pointAnchor(horizontal ? docX : docY);
			current.endEdge = undefined;
		}
	};

	const moveCross = (current: IOverlayCrossDrag): void => {
		const measurement = findMeasurement(current.id);
		if (measurement) {
			measurement.cross = measurement.axis === 'x' ? pointerY + win.scrollY : pointerX + win.scrollX;
		}
	};

	const moveGuide = (current: IOverlayGuideDrag): void => {
		const guide = findGuide(current.id);
		if (guide) {
			guide.position = Math.round(guide.axis === 'x' ? pointerX + win.scrollX : pointerY + win.scrollY);
		}
	};

	const startMeasureDrag = (x: number, y: number): void => {
		const hit = hitMeasurement(x, y);
		if (hit) {
			if (hit.button) {
				removeMeasurement(hit.id);
			} else {
				const measurement = findMeasurement(hit.id);
				if (measurement) {
					drag = { kind: 'cross', id: measurement.id, original: measurement.cross };
				}
			}
			return;
		}
		const sx = win.scrollX;
		const sy = win.scrollY;
		const edge = findEdge(x, y, probeElements(x, y, elementsAt(x, y)), true, true);
		const guide = state.rulers ? nearestGuide(x, y, undefined, snapDistance) : undefined;
		let axis: DesignGuideAxis | undefined;
		let start: IOverlayAnchor | undefined;
		let startEdge: IOverlayEdge | undefined;
		if (guide && (!edge || guide.distance < edge.distance)) {
			axis = guide.guide.axis;
			start = guideAnchor(guide.guide);
		} else if (edge) {
			axis = edge.side === 'left' || edge.side === 'right' ? 'x' : 'y';
			start = edgeAnchor(edge);
			startEdge = edge;
		}
		drag = { kind: 'create', originX: x + sx, originY: y + sy, startEdge, axis, start, end: undefined, endEdge: undefined, cross: axis === 'y' ? x + sx : y + sy };
		hoverTarget = undefined;
		hoverEdge = undefined;
		hoverDistances = [];
	};

	/** Ends the drag in progress; `commit` false restores what the drag changed. */
	const finishDrag = (commit: boolean): void => {
		const current = drag;
		if (!current) {
			return;
		}
		drag = undefined;
		switch (current.kind) {
			case 'create':
				if (commit) {
					updateCreateDrag(current);
					if (current.axis && current.start && current.end && Math.abs(resolveAnchor(current.end) - resolveAnchor(current.start)) >= 1) {
						measurements.push({ id: createId('m'), axis: current.axis, start: current.start, end: current.end, cross: current.cross });
					}
				}
				break;
			case 'cross':
				if (!commit) {
					const measurement = findMeasurement(current.id);
					if (measurement) {
						measurement.cross = current.original;
					}
				}
				break;
			case 'guide': {
				const guide = findGuide(current.id);
				if (guide && !commit) {
					guide.position = current.original;
				} else if (guide) {
					// Released over the ruler: the guide goes back where it came from.
					if (guide.axis === 'x' ? pointerX < 0 : pointerY < 0) {
						guides = guides.filter(candidate => candidate !== guide);
					} else {
						moveGuide(current);
					}
					notifyGuides();
					swallowNextClick();
				}
				break;
			}
		}
		hoverDirty = true;
		syncFeatures();
	};

	// -- Pointer state --------------------------------------------------------------------------

	const sendFocus = (rect: IDesignOverlayRect | undefined): void => {
		if (sameRect(rect, focusRect)) {
			return;
		}
		focusRect = rect;
		notify({ type: 'focus', rect });
	};

	const clearMeasureHover = (): void => {
		hoverTarget = undefined;
		hoverEdge = undefined;
		hoverDistances = [];
		hoverMeasurementId = undefined;
	};

	const updateMeasureHover = (): void => {
		clearMeasureHover();
		if (!pointerInside || drag) {
			if (!pointerInside) {
				sendFocus(undefined);
			}
			return;
		}
		const hit = hitMeasurement(pointerX, pointerY);
		if (hit) {
			hoverMeasurementId = hit.id;
			return;
		}
		const stack = elementsAt(pointerX, pointerY);
		const target = stack[0];
		if (!target) {
			sendFocus(undefined);
			return;
		}
		hoverTarget = target;
		hoverEdge = findEdge(pointerX, pointerY, probeElements(pointerX, pointerY, stack), true, true);
		hoverDistances = computeDistances(target);
		sendFocus(toDocumentRect(target.getBoundingClientRect()));
	};

	/** Brings drags, hovers and the cursor up to date with the pointer and the layout. */
	const updatePointerState = (): void => {
		if (drag?.kind === 'create') {
			updateCreateDrag(drag);
		} else if (drag?.kind === 'cross') {
			moveCross(drag);
		} else if (drag?.kind === 'guide') {
			moveGuide(drag);
		}
		if (state.measure) {
			updateMeasureHover();
		} else {
			clearMeasureHover();
		}
		if (!drag) {
			hoverGuideId = pointerInside && guidesInteractive() ? nearestGuide(pointerX, pointerY, undefined, guideGrabDistance)?.guide.id : undefined;
		}
		updateCursor();
	};

	// -- Pointer and keyboard handlers ----------------------------------------------------------

	const onPointerMove = (event: PointerEvent): void => {
		if (!event.isPrimary) {
			return;
		}
		pointerX = event.clientX;
		pointerY = event.clientY;
		pointerInside = true;
		const pressed = (event.buttons & 1) === 1;
		if (drag && !pressed) {
			// The button was released where the page could not see it.
			finishDrag(true);
			return;
		}
		if (!drag && pressed && draftAxis !== undefined) {
			// A guide dragged from the workbench ruler, when the page gets the pointer events.
			draftPosition = Math.round(draftAxis === 'x' ? pointerX + win.scrollX : pointerY + win.scrollY);
			draftMoved = true;
		}
		if (drag?.kind === 'guide') {
			moveGuide(drag);
		} else if (!drag && guidesInteractive()) {
			const id = nearestGuide(pointerX, pointerY, undefined, guideGrabDistance)?.guide.id;
			if (id !== hoverGuideId) {
				hoverGuideId = id;
				updateCursor();
			}
		}
		hoverDirty = true;
		requestFrame();
	};

	const onPointerOut = (event: PointerEvent): void => {
		if (event.isPrimary && event.relatedTarget === null) {
			pointerInside = false;
			hoverDirty = true;
			requestFrame();
		}
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (state.measure) {
			block(event);
			if (event.button === 0 && event.isPrimary && !drag) {
				pointerX = event.clientX;
				pointerY = event.clientY;
				pointerInside = true;
				startMeasureDrag(pointerX, pointerY);
				hoverDirty = true;
				syncFeatures();
			}
			return;
		}
		if (event.button !== 0 || !event.isPrimary || drag || !guidesInteractive()) {
			return;
		}
		const guide = nearestGuide(event.clientX, event.clientY, undefined, guideGrabDistance)?.guide;
		if (guide) {
			block(event);
			pointerX = event.clientX;
			pointerY = event.clientY;
			drag = { kind: 'guide', id: guide.id, original: guide.position };
			hoverGuideId = guide.id;
			syncFeatures();
		}
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (!event.isPrimary) {
			return;
		}
		pointerX = event.clientX;
		pointerY = event.clientY;
		if (!drag && draftMoved && draftAxis !== undefined) {
			commitDraft();
		}
		if (state.measure) {
			block(event);
			if (drag && event.button === 0) {
				finishDrag(true);
			}
		} else if (drag?.kind === 'guide' && event.button === 0) {
			block(event);
			finishDrag(true);
		}
	};

	const onPointerCancel = (): void => {
		finishDrag(false);
	};

	const exitMeasure = (): void => {
		applyState({ ...state, measure: false });
		notify({ type: 'measureExit' });
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		const deleting = event.key === 'Delete' || event.key === 'Backspace';
		if (state.measure) {
			if (event.key === 'Escape') {
				block(event);
				if (drag) {
					finishDrag(false);
				} else {
					exitMeasure();
				}
			} else if (deleting && hoverMeasurementId !== undefined && !drag && !isEditableFocused()) {
				block(event);
				removeMeasurement(hoverMeasurementId);
				hoverDirty = true;
				requestFrame();
			}
			return;
		}
		if (event.key === 'Escape' && drag?.kind === 'guide') {
			block(event);
			finishDrag(false);
			return;
		}
		const guide = findGuide(hoverGuideId);
		if (deleting && guide && !drag && state.rulers && !isEditableFocused()) {
			block(event);
			guides = guides.filter(candidate => candidate !== guide);
			hoverGuideId = undefined;
			notifyGuides();
			syncFeatures();
		}
	};

	const onBlur = (): void => {
		finishDrag(false);
	};

	const onVisibilityChange = (): void => {
		if (win.document.visibilityState === 'hidden') {
			finishDrag(false);
		}
	};

	const onScroll = (event: Event): void => {
		const doc = win.document;
		if (state.reportViewport && (event.target === doc || event.target === doc.documentElement || event.target === doc.scrollingElement)) {
			viewportDirty = true;
		}
		if (state.measure) {
			annotationsDirty = true;
		}
		hoverDirty = true;
		requestFrame();
	};

	const onResize = (): void => {
		viewportDirty = state.reportViewport;
		annotationsDirty = state.measure;
		hoverDirty = true;
		requestFrame();
	};

	const onUserInput = (): void => {
		programmaticUntil = 0;
	};

	const onMutations = (records: MutationRecord[]): void => {
		if (destroyed || mutationTimer) {
			return;
		}
		const ownRecord = (record: MutationRecord): boolean => {
			if (record.target === host) {
				return true;
			}
			if (record.type !== 'childList') {
				return false;
			}
			const nodes = [...record.addedNodes, ...record.removedNodes];
			return nodes.length > 0 && nodes.every(node => node === host);
		};
		if (records.every(ownRecord)) {
			return;
		}
		mutationTimer = win.setTimeout(() => {
			mutationTimer = 0;
			annotationsDirty = true;
			hoverDirty = true;
			requestFrame();
		}, 120);
	};

	const onInterval = (): void => {
		if (destroyed || !hostNeeded()) {
			return;
		}
		if (hostAllowed && (!host || !host.isConnected)) {
			// The page replaced the document element or removed the host.
			requestFrame();
		}
		if (state.measure) {
			annotationsDirty = true;
			hoverDirty = true;
			requestFrame();
		}
		if (cursorValue) {
			// Some pages reset the adopted style sheets.
			setCursor(cursorValue);
		}
	};

	// -- Listener groups ----------------------------------------------------------------------

	const addPointerListeners = (): (() => void)[] => [
		listen<PointerEvent>(win, 'pointermove', onPointerMove, { capture: true, passive: true }),
		listen<PointerEvent>(win, 'pointerout', onPointerOut, { capture: true, passive: true }),
		listen<PointerEvent>(win, 'pointerdown', onPointerDown, { capture: true }),
		listen<PointerEvent>(win, 'pointerup', onPointerUp, { capture: true }),
		listen<PointerEvent>(win, 'pointercancel', onPointerCancel, { capture: true, passive: true }),
		listen<KeyboardEvent>(win, 'keydown', onKeyDown, { capture: true }),
		listen<FocusEvent>(win, 'blur', onBlur, { passive: true }),
		listen<Event>(win.document, 'visibilitychange', onVisibilityChange, { passive: true }),
	];

	/** While measuring, a click measures instead of activating the page. */
	const addBlockingListeners = (): (() => void)[] =>
		['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart', 'selectstart', 'touchstart', 'touchend']
			.map(type => listen<Event>(win, type, block, { capture: true }));

	const addLayoutListeners = (): (() => void)[] => [
		listen<Event>(win, 'scroll', onScroll, { capture: true, passive: true }),
		listen<UIEvent>(win, 'resize', onResize, { passive: true }),
	];

	const addInputListeners = (): (() => void)[] =>
		['wheel', 'keydown', 'pointerdown', 'touchstart'].map(type => listen<Event>(win, type, onUserInput, { capture: true, passive: true }));

	// -- Annotations --------------------------------------------------------------------------

	const isGoodComponentName = (name: unknown): name is string => typeof name === 'string' && (name.length >= 3 || /^[A-Z][A-Z0-9]$/.test(name));

	/** Name of a React component type: function, class, memo or forwardRef. */
	const reactTypeName = (type: unknown): string | undefined => {
		if (!isRecord(type)) {
			return undefined;
		}
		const render = type.render;
		const inner = type.type;
		const candidates = [
			type.displayName,
			type.name,
			isRecord(render) ? render.displayName : undefined,
			isRecord(render) ? render.name : undefined,
			isRecord(inner) ? inner.displayName : undefined,
			isRecord(inner) ? inner.name : undefined,
		];
		return candidates.find(isGoodComponentName);
	};

	const reactComposite = (type: unknown): boolean => {
		if (typeof type === 'function') {
			return true;
		}
		if (!isRecord(type)) {
			return false;
		}
		return type.$$typeof === Symbol.for('react.memo') || type.$$typeof === Symbol.for('react.forward_ref');
	};

	/** The outermost React component whose first DOM element is `element`. */
	const reactComponentName = (element: Element, record: Record<string, unknown>): string | undefined => {
		let fiber: unknown;
		for (const name of Object.keys(record)) {
			if (name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')) {
				fiber = record[name];
				break;
			}
		}
		if (!isRecord(fiber)) {
			return undefined;
		}
		let found: string | undefined;
		let parent = fiber.return;
		for (let depth = 0; isRecord(parent) && typeof parent.type !== 'string' && depth < 100; depth++) {
			if (reactComposite(parent.type)) {
				let node: unknown = parent.child;
				for (let steps = 0; isRecord(node) && typeof node.type !== 'string' && steps < 100; steps++) {
					node = node.child;
				}
				if (!isRecord(node) || node.stateNode !== element) {
					// Components further out render other elements first.
					break;
				}
				found = reactTypeName(parent.type) ?? found;
			}
			parent = parent.return;
		}
		return found;
	};

	/** The outermost Vue 3 component whose root element is `element`. */
	const vueComponentName = (element: Element, record: Record<string, unknown>): string | undefined => {
		let found: string | undefined;
		let instance = record.__vueParentComponent;
		for (let depth = 0; isRecord(instance) && depth < 100; depth++) {
			const subTree = instance.subTree;
			if (!isRecord(subTree) || subTree.el !== element) {
				break;
			}
			const type = instance.type;
			if (isRecord(type)) {
				const name = type.name ?? type.__name;
				if (typeof name === 'string' && name) {
					found = name;
				}
			}
			instance = instance.parent;
		}
		if (found) {
			return found;
		}
		const vue2 = record.__vue__;
		if (isRecord(vue2) && vue2.$el === element && isRecord(vue2.$options)) {
			const name = vue2.$options.name || vue2.$options._componentTag;
			if (typeof name === 'string' && name) {
				return name;
			}
		}
		return undefined;
	};

	const angularComponentName = (element: Element, ng: unknown): string | undefined => {
		if (!isRecord(ng) || typeof ng.getComponent !== 'function') {
			return undefined;
		}
		const component: unknown = (ng.getComponent as (element: Element) => unknown)(element);
		if (!isRecord(component) || !isRecord(component.constructor)) {
			return undefined;
		}
		const name = component.constructor.name;
		return typeof name === 'string' && name ? name : undefined;
	};

	/** The component an element is the root of, in React, Vue, Angular or as a custom element. */
	const componentName = (element: Element, ng: unknown): string | undefined => {
		const record = element as unknown as Record<string, unknown>;
		try {
			const name = reactComponentName(element, record) ?? vueComponentName(element, record) ?? angularComponentName(element, ng);
			if (name) {
				return name;
			}
		} catch {
			// Framework internals changed; fall back to the tag.
		}
		return element.localName.includes('-') && element.localName !== hostTag ? element.localName : undefined;
	};

	/** Elements worth an outline when the page has no detectable components. */
	const notableName = (element: Element, style: CSSStyleDeclaration): string | undefined => {
		const tag = element.localName;
		switch (tag) {
			case 'button':
			case 'select':
			case 'textarea':
			case 'img':
			case 'video':
			case 'canvas':
			case 'iframe':
				return tag;
			case 'a':
				return element.hasAttribute('href') && style.display !== 'inline' ? tag : undefined;
			case 'input':
				return (element as HTMLInputElement).type !== 'hidden' ? tag : undefined;
			case 'svg':
				return (element as SVGSVGElement).ownerSVGElement ? undefined : tag;
		}
		return element.getAttribute('role') === 'button' ? 'button' : undefined;
	};

	const hasDirectText = (element: Element): boolean => {
		let count = 0;
		for (let node = element.firstChild; node && count < 200; node = node.nextSibling) {
			count++;
			if (node.nodeType === 3 && /\S/.test(node.nodeValue ?? '')) {
				return true;
			}
		}
		return false;
	};

	const lineHeightLabel = (lineHeight: string, fontSize: number): string => {
		if (lineHeight === 'normal') {
			return lineHeight;
		}
		const value = parseFloat(lineHeight);
		if (!Number.isFinite(value)) {
			return lineHeight;
		}
		return formatNumber(lineHeight.endsWith('px') ? value : value * fontSize);
	};

	/** Flex and grid items of a container, in client px; `display: contents` children are expanded. */
	const collectLayoutItems = (container: Element, items: DOMRect[], depth: number): void => {
		for (let child = container.firstElementChild; child && items.length < maxGapItems; child = child.nextElementSibling) {
			if (skippedTags.has(child.localName) || child === host) {
				continue;
			}
			const style = win.getComputedStyle(child);
			if (style.display === 'none') {
				continue;
			}
			if (style.display === 'contents') {
				if (depth < 3) {
					collectLayoutItems(child, items, depth + 1);
				}
				continue;
			}
			if (style.position === 'absolute' || style.position === 'fixed') {
				continue;
			}
			const rect = child.getBoundingClientRect();
			if (rect.width > 0 || rect.height > 0) {
				items.push(rect);
			}
		}
	};

	/**
	 * Computes the annotations of the elements in and around the viewport, in document px, then
	 * hides the labels that would cover the label of a more important annotation.
	 */
	const computeAnnotations = (): void => {
		annotations = [];
		const doc = win.document;
		const body = doc.body;
		if (!state.measure || !body || state.categories.length === 0) {
			return;
		}
		const wantGap = state.categories.includes('gap');
		const wantPadding = state.categories.includes('padding');
		const wantMargin = state.categories.includes('margin');
		const wantComponents = state.categories.includes('components');
		const wantTypography = state.categories.includes('typography');
		const size = getViewportSize();
		const sx = win.scrollX;
		const sy = win.scrollY;
		const ng = wantComponents ? globals.ng : undefined;

		const gaps: IOverlayAnnotation[] = [];
		const paddings: IOverlayAnnotation[] = [];
		const margins: IOverlayAnnotation[] = [];
		const components: IOverlayAnnotation[] = [];
		const notables: IOverlayAnnotation[] = [];
		const texts: IOverlayAnnotation[] = [];
		const gapKeys = new Set<string>();

		/** A band labelled with its size, the label centered in it. Coordinates in document px. */
		const band = (kind: 'gap' | 'padding' | 'margin', x: number, y: number, width: number, height: number, value: number): IOverlayAnnotation => {
			const label = formatNumber(value);
			const labelWidth = pillWidth(label);
			return { kind, x, y, width, height, label, labelX: x + width / 2 - labelWidth / 2, labelY: y + height / 2 - pillHeight / 2, labelWidth, labelVisible: true };
		};

		const outline = (name: string, rect: DOMRect): IOverlayAnnotation => {
			const label = `${name} ${formatSize(rect.width, rect.height)}`;
			const labelWidth = pillWidth(label);
			const above = rect.top - pillHeight - 2 >= 0;
			return {
				kind: 'component', x: rect.left + sx, y: rect.top + sy, width: rect.width, height: rect.height, label,
				labelX: rect.left + sx + (above ? 0 : 2), labelY: rect.top + sy + (above ? -pillHeight - 2 : 2), labelWidth, labelVisible: true,
			};
		};

		const addGaps = (element: Element): void => {
			const items: DOMRect[] = [];
			collectLayoutItems(element, items, 0);
			const add = (x: number, y: number, width: number, height: number, value: number): void => {
				const key = [x, y, width, height].map(value => Math.round(value * 10)).join(',');
				if (!gapKeys.has(key)) {
					gapKeys.add(key);
					gaps.push(band('gap', x + sx, y + sy, width, height, value));
				}
			};
			for (const a of items) {
				let right: DOMRect | undefined;
				let below: DOMRect | undefined;
				for (const b of items) {
					if (b === a) {
						continue;
					}
					if (b.left >= a.right - 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 && (!right || b.left < right.left)) {
						right = b;
					}
					if (b.top >= a.bottom - 0.5 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && (!below || b.top < below.top)) {
						below = b;
					}
				}
				if (right && right.left - a.right >= 0.5) {
					const top = Math.max(a.top, right.top);
					add(a.right, top, right.left - a.right, Math.min(a.bottom, right.bottom) - top, right.left - a.right);
				}
				if (below && below.top - a.bottom >= 0.5) {
					const left = Math.max(a.left, below.left);
					add(left, a.bottom, Math.min(a.right, below.right) - left, below.top - a.bottom, below.top - a.bottom);
				}
			}
		};

		let scanned = 0;
		let visited = 0;
		let element: Element | null = body.firstElementChild;
		while (element && scanned < maxScannedElements && visited < maxVisitedElements) {
			visited++;
			const current: Element = element;
			const skipped = skippedTags.has(current.localName) || current === host;
			if (!skipped) {
				const rect = current.getBoundingClientRect();
				if (rect.width >= 1 && rect.height >= 1 && rect.right > -annotationMargin && rect.bottom > -annotationMargin && rect.left < size.width + annotationMargin && rect.top < size.height + annotationMargin) {
					scanned++;
					const style = win.getComputedStyle(current);
					const display = style.display;
					if (display !== 'none' && display !== 'contents' && style.visibility !== 'hidden' && style.visibility !== 'collapse') {
						const left = rect.left + sx;
						const top = rect.top + sy;
						const right = rect.right + sx;
						const bottom = rect.bottom + sy;
						const tablePart = display.startsWith('table-') && display !== 'table-caption';
						if (wantPadding && display !== 'inline' && (!tablePart || display === 'table-cell')) {
							const borderLeft = px(style.borderLeftWidth);
							const borderRight = px(style.borderRightWidth);
							const borderTop = px(style.borderTopWidth);
							const borderBottom = px(style.borderBottomWidth);
							const paddingTop = px(style.paddingTop);
							const paddingRight = px(style.paddingRight);
							const paddingBottom = px(style.paddingBottom);
							const paddingLeft = px(style.paddingLeft);
							const innerLeft = left + borderLeft;
							const innerRight = right - borderRight;
							const innerTop = top + borderTop;
							const innerBottom = bottom - borderBottom;
							const bandWidth = innerRight - innerLeft;
							const sideTop = innerTop + paddingTop;
							const sideHeight = innerBottom - paddingBottom - sideTop;
							if (paddingTop > 0.5 && bandWidth > 0) {
								paddings.push(band('padding', innerLeft, innerTop, bandWidth, paddingTop, paddingTop));
							}
							if (paddingBottom > 0.5 && bandWidth > 0) {
								paddings.push(band('padding', innerLeft, innerBottom - paddingBottom, bandWidth, paddingBottom, paddingBottom));
							}
							if (paddingLeft > 0.5 && sideHeight > 0) {
								paddings.push(band('padding', innerLeft, sideTop, paddingLeft, sideHeight, paddingLeft));
							}
							if (paddingRight > 0.5 && sideHeight > 0) {
								paddings.push(band('padding', innerRight - paddingRight, sideTop, paddingRight, sideHeight, paddingRight));
							}
						}
						if (wantMargin && display !== 'inline' && !tablePart) {
							const marginTop = px(style.marginTop);
							const marginRight = px(style.marginRight);
							const marginBottom = px(style.marginBottom);
							const marginLeft = px(style.marginLeft);
							if (marginTop > 0.5) {
								margins.push(band('margin', left, top - marginTop, rect.width, marginTop, marginTop));
							}
							if (marginBottom > 0.5) {
								margins.push(band('margin', left, bottom, rect.width, marginBottom, marginBottom));
							}
							if (marginLeft > 0.5) {
								margins.push(band('margin', left - marginLeft, top, marginLeft, rect.height, marginLeft));
							}
							if (marginRight > 0.5) {
								margins.push(band('margin', right, top, marginRight, rect.height, marginRight));
							}
						}
						if (wantGap && (display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid')) {
							addGaps(current);
						}
						if (wantComponents) {
							const name = componentName(current, ng);
							if (name) {
								components.push(outline(name, rect));
							} else if (components.length === 0) {
								const notable = notableName(current, style);
								if (notable) {
									notables.push(outline(notable, rect));
								}
							}
						}
						if (wantTypography && hasDirectText(current)) {
							const fontSize = px(style.fontSize);
							if (fontSize > 0) {
								const label = `${formatNumber(fontSize)}/${lineHeightLabel(style.lineHeight, fontSize)} · ${style.fontWeight}`;
								texts.push({ kind: 'typography', x: left, y: top, width: rect.width, height: rect.height, label, labelX: left, labelY: top, labelWidth: pillWidth(label), labelVisible: true });
							}
						}
					}
				}
			}

			// Next element in document order; the subtree of a skipped element is skipped too.
			let next: Element | null = skipped ? null : current.firstElementChild;
			let climb: Element | null = current;
			while (!next && climb && climb !== body) {
				next = climb.nextElementSibling;
				climb = climb.parentElement;
			}
			element = next;
		}

		// The most important labels are placed first; a label covering a placed one is hidden.
		const ordered = [...gaps, ...paddings, ...(components.length ? components : notables), ...texts, ...margins].slice(0, maxAnnotations);
		const cellSize = 64;
		const cells = new Map<string, IOverlayBox[]>();
		for (const annotation of ordered) {
			const box: IOverlayBox = { left: annotation.labelX, top: annotation.labelY, right: annotation.labelX + annotation.labelWidth, bottom: annotation.labelY + pillHeight };
			const firstColumn = Math.floor(box.left / cellSize);
			const lastColumn = Math.floor(box.right / cellSize);
			const firstRow = Math.floor(box.top / cellSize);
			const lastRow = Math.floor(box.bottom / cellSize);
			let covered = false;
			for (let column = firstColumn; column <= lastColumn && !covered; column++) {
				for (let row = firstRow; row <= lastRow && !covered; row++) {
					covered = !!cells.get(`${column},${row}`)?.some(other => overlaps(box, other));
				}
			}
			annotation.labelVisible = !covered;
			if (!covered) {
				for (let column = firstColumn; column <= lastColumn; column++) {
					for (let row = firstRow; row <= lastRow; row++) {
						const cellKey = `${column},${row}`;
						const cell = cells.get(cellKey);
						if (cell) {
							cell.push(box);
						} else {
							cells.set(cellKey, [box]);
						}
					}
				}
			}
		}
		annotations = ordered;
	};

	// -- Drawing ------------------------------------------------------------------------------

	const drawAnnotations = (ctx: CanvasRenderingContext2D, sx: number, sy: number): void => {
		const visible = annotations.filter(annotation => annotation.x - sx < hostWidth && annotation.x + annotation.width - sx > 0 && annotation.y - sy < hostHeight && annotation.y + annotation.height - sy > 0);
		const fills: readonly (readonly [IDesignOverlayDebugAnnotation['kind'], string])[] = [['margin', marginFill], ['padding', paddingFill], ['gap', gapFill]];
		for (const [kind, fill] of fills) {
			ctx.fillStyle = fill;
			for (const annotation of visible) {
				if (annotation.kind === kind) {
					fillBox(ctx, annotation.x - sx, annotation.y - sy, annotation.width, annotation.height);
				}
			}
		}
		const pattern = visible.some(annotation => annotation.kind === 'gap') ? getHatch(ctx) : undefined;
		if (pattern) {
			ctx.fillStyle = pattern;
			for (const annotation of visible) {
				if (annotation.kind === 'gap') {
					fillBox(ctx, annotation.x - sx, annotation.y - sy, annotation.width, annotation.height);
				}
			}
		}
		for (const annotation of visible) {
			if (annotation.kind === 'component') {
				const left = annotation.x - sx;
				const top = annotation.y - sy;
				strokeBox(ctx, { left, top, right: left + annotation.width, bottom: top + annotation.height }, componentColor, componentDash);
			}
		}
		for (const annotation of annotations) {
			const left = annotation.labelX - sx;
			const top = annotation.labelY - sy;
			if (annotation.labelVisible && left < hostWidth && left + annotation.labelWidth > 0 && top < hostHeight && top + pillHeight > 0) {
				drawPill(ctx, annotation.label, left, top, kindColors[annotation.kind]);
			}
		}
	};

	const drawGuides = (ctx: CanvasRenderingContext2D, sx: number, sy: number): void => {
		const activeId = drag?.kind === 'guide' ? drag.id : hoverGuideId;
		for (const guide of guides) {
			const width = guide.id === activeId && !state.measure ? 2 : 1;
			if (guide.axis === 'x') {
				const x = guide.position - sx;
				if (x >= -2 && x <= hostWidth + 2) {
					strokeLine(ctx, x, 0, x, hostHeight, width, guideColor);
				}
			} else {
				const y = guide.position - sy;
				if (y >= -2 && y <= hostHeight + 2) {
					strokeLine(ctx, 0, y, hostWidth, y, width, guideColor);
				}
			}
		}
	};

	const drawDraft = (ctx: CanvasRenderingContext2D, sx: number, sy: number): void => {
		if (draftAxis === undefined || draftPosition === undefined) {
			return;
		}
		const label = formatNumber(Math.round(draftPosition));
		if (draftAxis === 'x') {
			const x = draftPosition - sx;
			strokeLine(ctx, x, 0, x, hostHeight, 1, guideColor);
			drawPill(ctx, label, clamp(x + 4, 0, hostWidth - pillWidth(label)), 4, guideColor);
		} else {
			const y = draftPosition - sy;
			strokeLine(ctx, 0, y, hostWidth, y, 1, guideColor);
			drawPill(ctx, label, 4, clamp(y + 4, 0, hostHeight - pillHeight), guideColor);
		}
	};

	const drawMeasurements = (ctx: CanvasRenderingContext2D): void => {
		for (const measurement of measurements) {
			const active = measurement.id === hoverMeasurementId || (drag?.kind === 'cross' && drag.id === measurement.id);
			const label = drawMeasurement(ctx, measurement.axis, measurement.start, measurement.end, measurement.cross, active ? 2 : 1);
			const buttonX = label.right + 4 + deleteRadius;
			const buttonY = (label.top + label.bottom) / 2;
			measurementHits.push({ id: measurement.id, label, buttonX, buttonY });
			if (active && !drag) {
				drawDeleteButton(ctx, buttonX, buttonY);
			}
		}
	};

	const drawCreateDrag = (ctx: CanvasRenderingContext2D, current: IOverlayCreateDrag): void => {
		if (current.axis && current.start && current.end) {
			drawMeasurement(ctx, current.axis, current.start, current.end, current.cross, 1);
			if (current.endEdge) {
				drawEdge(ctx, current.endEdge);
			}
		} else if (current.startEdge) {
			drawEdge(ctx, current.startEdge);
		}
	};

	const drawHover = (ctx: CanvasRenderingContext2D): void => {
		const target = hoverTarget;
		if (!target || !target.isConnected || drag) {
			return;
		}
		const rect = target.getBoundingClientRect();
		strokeBox(ctx, rect, measureColor);
		for (const distance of hoverDistances) {
			drawDimension(ctx, distance.axis, distance.from, distance.to, distance.cross, 1);
			const label = formatNumber(distance.to - distance.from);
			const middle = (distance.from + distance.to) / 2;
			if (distance.axis === 'x') {
				drawCenteredPill(ctx, label, middle, distance.cross, measureColor);
			} else {
				drawCenteredPill(ctx, label, distance.cross, middle, measureColor);
			}
		}
		const size = formatSize(rect.width, rect.height);
		const width = pillWidth(size);
		let top = rect.bottom + 4;
		if (top + pillHeight > hostHeight) {
			top = rect.top - 4 - pillHeight;
			if (top < 0) {
				top = clamp(rect.bottom - pillHeight - 4, 0, hostHeight - pillHeight);
			}
		}
		drawPill(ctx, size, clamp((rect.left + rect.right) / 2 - width / 2, 2, hostWidth - width - 2), top, measureColor);
		if (hoverEdge) {
			drawEdge(ctx, hoverEdge);
		}
	};

	/** The position of the guide under the pointer, next to the pointer. */
	const drawGuideLabel = (ctx: CanvasRenderingContext2D, sx: number, sy: number): void => {
		const guide = findGuide(drag?.kind === 'guide' ? drag.id : hoverGuideId);
		if (!guide || !state.rulers || state.measure) {
			return;
		}
		const label = formatNumber(guide.position);
		const width = pillWidth(label);
		if (guide.axis === 'x') {
			drawPill(ctx, label, clamp(guide.position - sx + 6, 0, hostWidth - width), clamp(pointerY + 10, 0, hostHeight - pillHeight), guideColor);
		} else {
			drawPill(ctx, label, clamp(pointerX + 10, 0, hostWidth - width), clamp(guide.position - sy + 6, 0, hostHeight - pillHeight), guideColor);
		}
	};

	const draw = (): void => {
		if (!hostNeeded()) {
			removeHost();
			return;
		}
		const surface = canvas;
		if (!ensureHost() || !surface || !context) {
			return;
		}
		const ctx = context;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, surface.width, surface.height);
		ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
		ctx.font = labelFont;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		const sx = win.scrollX;
		const sy = win.scrollY;
		measurementHits = [];
		if (state.measure) {
			drawAnnotations(ctx, sx, sy);
		}
		if (state.rulers) {
			drawGuides(ctx, sx, sy);
		}
		drawDraft(ctx, sx, sy);
		if (state.measure) {
			drawMeasurements(ctx);
			if (drag?.kind === 'create') {
				drawCreateDrag(ctx, drag);
			}
			drawHover(ctx);
		}
		drawGuideLabel(ctx, sx, sy);
	};

	// -- Frames -------------------------------------------------------------------------------

	const runFrame = (): void => {
		if (viewportDirty) {
			viewportDirty = false;
			if (state.reportViewport) {
				const viewport = readViewport();
				const serialized = JSON.stringify(viewport);
				if (serialized !== lastViewport) {
					lastViewport = serialized;
					notify({ type: 'viewport', viewport });
				}
			}
		}
		if (annotationsDirty) {
			annotationsDirty = false;
			if (state.measure) {
				computeAnnotations();
			}
		}
		if (hoverDirty) {
			hoverDirty = false;
			updatePointerState();
		}
		draw();
	};

	/** Everything is drawn and reported once per frame at most. */
	const requestFrame = (): void => {
		if (destroyed || frameHandle) {
			return;
		}
		frameHandle = win.requestAnimationFrame(() => {
			frameHandle = 0;
			if (destroyed) {
				return;
			}
			try {
				runFrame();
			} catch {
				// A failure of the overlay must never break the page.
			}
		});
	};

	// -- Features -----------------------------------------------------------------------------

	/** Adds what the active features need (listeners, observers, timers, host) and removes the rest. */
	const syncFeatures = (): void => {
		if (destroyed) {
			return;
		}
		const needHost = hostNeeded();
		setListeners('pointer', state.measure || guidesInteractive() || draftAxis !== undefined || drag !== undefined, addPointerListeners);
		setListeners('block', state.measure, addBlockingListeners);
		setListeners('layout', needHost || state.reportViewport, addLayoutListeners);
		setListeners('input', state.reportViewport, addInputListeners);

		if (state.measure && !mutationObserver) {
			mutationObserver = new win.MutationObserver(records => {
				try {
					onMutations(records);
				} catch {
					// A failure of the overlay must never break the page.
				}
			});
			mutationObserver.observe(win.document, { subtree: true, childList: true, attributes: true, characterData: true });
		} else if (!state.measure && mutationObserver) {
			mutationObserver.disconnect();
			mutationObserver = undefined;
			win.clearTimeout(mutationTimer);
			mutationTimer = 0;
		}

		const root = win.document.documentElement;
		if (state.reportViewport && !resizeObserver && root) {
			// The document grows and shrinks without scrolling, e.g. while content loads.
			resizeObserver = new win.ResizeObserver(() => {
				viewportDirty = true;
				requestFrame();
			});
			resizeObserver.observe(root);
		} else if (!state.reportViewport && resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = undefined;
		}

		if (needHost && !intervalHandle) {
			intervalHandle = win.setInterval(onInterval, 1000);
		} else if (!needHost && intervalHandle) {
			win.clearInterval(intervalHandle);
			intervalHandle = 0;
		}

		if (needHost) {
			ensureHost();
		} else {
			removeHost();
		}
		updateCursor();
		if (needHost || host) {
			requestFrame();
		}
	};

	const sanitizeState = (value: unknown): IDesignOverlayState => {
		const input = isRecord(value) ? value : {};
		const guideList: IOverlayGuide[] = [];
		if (Array.isArray(input.guides)) {
			for (const item of input.guides.slice(0, maxGuides)) {
				if (isRecord(item) && typeof item.id === 'string' && (item.axis === 'x' || item.axis === 'y') && typeof item.position === 'number' && Number.isFinite(item.position)) {
					guideList.push({ id: item.id, axis: item.axis, position: item.position });
				}
			}
		}
		const categories = Array.isArray(input.categories) ? measureCategories.filter(category => (input.categories as unknown[]).includes(category)) : [];
		const rawCover = input.cover;
		let cover: IDesignOverlayCover | undefined;
		if (isRecord(rawCover)) {
			cover = {
				title: typeof rawCover.title === 'string' ? rawCover.title : '',
				detail: typeof rawCover.detail === 'string' ? rawCover.detail : '',
				background: typeof rawCover.background === 'string' ? rawCover.background : '#1F1F1F',
				foreground: typeof rawCover.foreground === 'string' ? rawCover.foreground : '#CCCCCC',
			};
		}
		return { rulers: input.rulers === true, guides: guideList, measure: input.measure === true, categories, cover, reportViewport: input.reportViewport === true };
	};

	/** Applies a whole state, as sent by the workbench or changed locally. */
	const applyState = (next: IDesignOverlayState): void => {
		const previous = state;
		state = next;
		guides = next.guides.map(guide => ({ id: guide.id, axis: guide.axis, position: guide.position }));
		if (drag?.kind === 'guide') {
			const dragged = findGuide(drag.id);
			if (dragged) {
				moveGuide(drag);
			} else {
				drag = undefined;
			}
		}
		if (!findGuide(hoverGuideId)) {
			hoverGuideId = undefined;
		}
		if (previous.measure && !next.measure) {
			if (drag?.kind === 'create' || drag?.kind === 'cross') {
				finishDrag(false);
			}
			clearMeasureHover();
			annotations = [];
			sendFocus(undefined);
		}
		if (next.measure && (!previous.measure || previous.categories.join() !== next.categories.join())) {
			annotationsDirty = true;
		}
		if (next.reportViewport && !previous.reportViewport) {
			reportViewportNow();
		}
		if (previous.cover !== next.cover) {
			updateCover();
		}
		hoverDirty = true;
		syncFeatures();
	};

	const allowHost = (): void => {
		if (destroyed || hostAllowed) {
			return;
		}
		hostAllowed = true;
		win.clearTimeout(loadTimer);
		win.clearTimeout(fallbackTimer);
		removeLoadListener?.();
		removeLoadListener = undefined;
		syncFeatures();
	};

	const destroy = (): void => {
		if (destroyed) {
			return;
		}
		setCursor(undefined);
		destroyed = true;
		for (const removers of listenerGroups.values()) {
			for (const remove of removers) {
				remove();
			}
		}
		listenerGroups.clear();
		removeLoadListener?.();
		removeLoadListener = undefined;
		removeClickSwallow?.();
		win.clearTimeout(loadTimer);
		win.clearTimeout(fallbackTimer);
		win.clearTimeout(mutationTimer);
		win.clearInterval(intervalHandle);
		if (frameHandle) {
			win.cancelAnimationFrame(frameHandle);
			frameHandle = 0;
		}
		mutationObserver?.disconnect();
		mutationObserver = undefined;
		resizeObserver?.disconnect();
		resizeObserver = undefined;
		host?.remove();
		host = undefined;
		canvas = undefined;
		context = undefined;
		coverElement = undefined;
		coverTitle = undefined;
		coverDetail = undefined;
		hatch = undefined;
		measurements = [];
		annotations = [];
		guides = [];
		drag = undefined;
		clearMeasureHover();
		measurementHits = [];
		if (globals[key] === api) {
			delete globals[key];
		}
	};

	/** Runs an API call; a failure must never reach the caller or the page. */
	const guard = (action: () => void): void => {
		if (destroyed) {
			return;
		}
		try {
			action();
		} catch {
			// Ignored, see above.
		}
	};

	// -- API ----------------------------------------------------------------------------------

	const api: IDesignOverlayPageApi = {
		version: config.version,
		setState: next => guard(() => applyState(sanitizeState(next))),
		setDraftGuide: (axis, position) => guard(() => {
			if (axis !== 'x' && axis !== 'y') {
				return;
			}
			if (typeof position === 'number' && Number.isFinite(position)) {
				if (draftAxis !== axis) {
					draftMoved = false;
				}
				draftAxis = axis;
				draftPosition = position;
			} else {
				draftAxis = undefined;
				draftPosition = undefined;
				draftMoved = false;
			}
			syncFeatures();
		}),
		commitDraftGuide: () => guard(commitDraft),
		clearMeasurements: () => guard(() => {
			measurements = [];
			hoverMeasurementId = undefined;
			if (drag?.kind === 'cross') {
				drag = undefined;
			}
			hoverDirty = true;
			syncFeatures();
		}),
		scrollTo: (x, y) => guard(() => {
			if (Number.isFinite(x) && Number.isFinite(y)) {
				programmaticUntil = win.performance.now() + 300;
				win.scrollTo({ left: x, top: y, behavior: 'instant' });
			}
		}),
		getViewport: () => {
			try {
				return readViewport();
			} catch {
				return { scrollX: 0, scrollY: 0, innerWidth: 0, innerHeight: 0, clientWidth: 0, clientHeight: 0, documentWidth: 0, documentHeight: 0, programmatic: false };
			}
		},
		destroy: () => {
			try {
				destroy();
			} catch {
				// Ignored: the page goes on.
			}
		},
		debugSnapshot: (): IDesignOverlayDebugSnapshot => {
			try {
				if (state.measure && !destroyed) {
					computeAnnotations();
				}
				return {
					hostAttached: !!host && host.isConnected,
					annotations: annotations.map(annotation => ({
						kind: annotation.kind,
						rect: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
						label: annotation.label,
					})),
					guides: guides.map(guide => ({ id: guide.id, axis: guide.axis, position: guide.position })),
					measurements: measurements.map(measurement => {
						const from = resolveAnchor(measurement.start);
						const to = resolveAnchor(measurement.end);
						return { axis: measurement.axis, from, to, value: Math.round(Math.abs(to - from) * 100) / 100 };
					}),
				};
			} catch {
				return { hostAttached: false, annotations: [], guides: [], measurements: [] };
			}
		},
	};

	// -- Install ------------------------------------------------------------------------------

	try {
		hostAllowed = win.document.readyState === 'complete';
		if (!hostAllowed) {
			// Frameworks hydrate the document while it loads: they must not meet a foreign node.
			removeLoadListener = listen<Event>(win, 'load', () => {
				win.clearTimeout(loadTimer);
				loadTimer = win.setTimeout(allowHost, 1500);
			}, { once: true });
			// Some pages never finish loading (long polling, streaming).
			fallbackTimer = win.setTimeout(allowHost, 10000);
		}
		Object.defineProperty(win, key, { value: api, configurable: true, enumerable: false, writable: true });
	} catch {
		return;
	}
	notify({ type: 'ready' });
}
