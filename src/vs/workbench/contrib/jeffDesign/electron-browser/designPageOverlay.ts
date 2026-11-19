/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IBrowserViewCDPService, IBrowserViewModel } from '../../browserView/common/browserView.js';
import {
	ALL_MEASURE_CATEGORIES,
	DEFAULT_MEASURE_CATEGORIES,
	DESIGN_OVERLAY_BINDING,
	DESIGN_OVERLAY_GLOBAL_KEY,
	DESIGN_OVERLAY_VERSION,
	DesignGuideAxis,
	DesignMeasureCategory,
	EMPTY_DESIGN_OVERLAY_STATE,
	IDesignGuide,
	IDesignOverlayCover,
	IDesignOverlayRect,
	IDesignOverlayScriptConfig,
	IDesignOverlayState,
	IDesignOverlayViewport,
	parseDesignOverlayNotification,
} from '../common/designOverlay.js';
import { DesignCdpSession } from './designCdpSession.js';
import { designOverlayMain } from './designOverlayScript.js';
import { CONTEXT_DESIGN_MEASURE_CATEGORIES } from './designToolbar.js';

let overlaySource: string | undefined;

/** Source of the script that installs the overlay in a page; see {@link designOverlayMain}. */
function getOverlaySource(): string {
	if (!overlaySource) {
		const config: IDesignOverlayScriptConfig = { bindingName: DESIGN_OVERLAY_BINDING, globalKey: DESIGN_OVERLAY_GLOBAL_KEY, version: DESIGN_OVERLAY_VERSION };
		overlaySource = `(${designOverlayMain.toString()})(${JSON.stringify(config)});`;
	}
	return overlaySource;
}

/** An expression calling a method of the page API; it evaluates to `false` when the overlay is missing. */
function pageCall(method: string, args: readonly unknown[]): string {
	const key = JSON.stringify(DESIGN_OVERLAY_GLOBAL_KEY);
	const values = args.map(arg => arg === undefined ? 'undefined' : JSON.stringify(arg)).join(', ');
	return `(() => { const api = globalThis[Symbol.for(${key})]; if (!api || api.version !== ${DESIGN_OVERLAY_VERSION}) { return false; } api.${method}(${values}); return true; })()`;
}

interface IEvaluateResponse {
	readonly result?: { readonly value?: unknown };
	readonly exceptionDetails?: { readonly text?: string; readonly exception?: { readonly description?: string } };
}

/** Attempts to reconnect after the page's debugging session closed while a feature was on. */
const maxReconnectAttempts = 5;

/** A zoom or a move asked by the page with Zoom and Pan, in CSS px of the visible part of the page. */
interface IPendingZoomInput {
	readonly x: number;
	readonly y: number;
	/** For a zoom, the factor; for a move, the distance in screen px. */
	readonly factor: number;
	readonly dx: number;
	readonly dy: number;
}

/**
 * Speed of the pinch that zooms the page, in px per second: fast enough to finish in a frame or two.
 * A pinch rather than a page zoom, so the layout of the page does not change.
 */
const zoomPinchSpeed = 100_000;

/**
 * The design overlay of one integrated browser page: ruler guides, the Measure tool and the
 * mirror placeholder are drawn by a script injected in the page (see `designOverlayScript.ts`),
 * because nothing of the workbench can be drawn over the page. This class keeps the state of that
 * script, injects it while at least one feature needs it, and relays what the page reports.
 */
export class DesignPageOverlay extends Disposable {

	private _state: IDesignOverlayState = EMPTY_DESIGN_OVERLAY_STATE;
	private _viewportTrackers = 0;
	private _viewport: IDesignOverlayViewport | undefined;
	private _focusRect: IDesignOverlayRect | undefined;

	private _session: DesignCdpSession | undefined;
	private readonly _sessionStore = this._register(new DisposableStore());
	private _pushQueued = false;
	private _pushing = false;
	private _reconnectAttempts = 0;
	private readonly _reconnect = this._register(new RunOnceScheduler(() => this._schedulePush(), 750));

	private _draft: { readonly axis: DesignGuideAxis; readonly position: number | null } | undefined;

	/** Zooms and moves asked by the page, merged while one is being sent. */
	private _pendingZoom: IPendingZoomInput | undefined;
	private _pendingPan: IPendingZoomInput | undefined;
	private _sendingZoomInput = false;
	private _zoomReset: Promise<void> | undefined;
	private _draftQueued = false;
	/** Draft guide positions and commits are sent in order, one at a time. */
	private _draftChain: Promise<void> = Promise.resolve();

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	/** Fires when {@link state} changes, including when the user edits guides or leaves the Measure tool in the page. */
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onDidChangeViewport = this._register(new Emitter<IDesignOverlayViewport>());
	/** Fires when the page scrolls or resizes, while at least one {@link trackViewport} is held. */
	readonly onDidChangeViewport: Event<IDesignOverlayViewport> = this._onDidChangeViewport.event;

	private readonly _onDidChangeFocusRect = this._register(new Emitter<IDesignOverlayRect | undefined>());
	/** Fires when the element hovered with the Measure tool changes. */
	readonly onDidChangeFocusRect: Event<IDesignOverlayRect | undefined> = this._onDidChangeFocusRect.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;

	constructor(
		readonly model: IBrowserViewModel,
		@IBrowserViewCDPService private readonly _cdpService: IBrowserViewCDPService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get state(): IDesignOverlayState { return this._state; }
	get viewport(): IDesignOverlayViewport | undefined { return this._viewport; }
	get focusRect(): IDesignOverlayRect | undefined { return this._focusRect; }

	setRulers(rulers: boolean): void {
		this._update({ rulers });
	}

	setGuides(guides: readonly IDesignGuide[]): void {
		this._update({ guides });
	}

	setMeasure(measure: boolean): void {
		this._update({ measure });
		if (!measure && this._focusRect) {
			this._focusRect = undefined;
			this._onDidChangeFocusRect.fire(undefined);
		}
	}

	setCategories(categories: readonly DesignMeasureCategory[]): void {
		this._update({ categories });
	}

	setCover(cover: IDesignOverlayCover | undefined): void {
		this._update({ cover });
	}

	setZoom(zoom: boolean): void {
		if (!zoom && this._state.zoom) {
			// Leaving Zoom and Pan shows the page at 100% again, before the page's session may close.
			this._zoomReset = this._resetZoom();
		}
		this._update({ zoom });
	}

	/** Asks the page to report its scroll position and size until the returned disposable is disposed. */
	trackViewport(): IDisposable {
		this._viewportTrackers++;
		this._update({ reportViewport: true });
		let disposed = false;
		return toDisposable(() => {
			if (disposed) {
				return;
			}
			disposed = true;
			this._viewportTrackers--;
			if (this._viewportTrackers === 0 && !this._store.isDisposed) {
				this._update({ reportViewport: false });
			}
		});
	}

	/** Shows the guide being dragged out of a ruler, at a position in document px; `undefined` hides it. */
	setDraftGuide(axis: DesignGuideAxis, position: number | undefined): void {
		// Positions arriving while one is being sent are merged: only the latest is sent next.
		this._draft = { axis, position: position ?? null };
		if (!this._draftQueued) {
			this._draftQueued = true;
			this._draftChain = this._draftChain.then(() => this._flushDraft());
		}
	}

	/** Turns the guide being dragged into a guide. The page reports the new guides. */
	commitDraftGuide(): void {
		this._draftChain = this._draftChain
			.then(() => this._flushDraft())
			.then(() => this._callIfConnected('commitDraftGuide', []));
	}

	clearMeasurements(): void {
		void this._callIfConnected('clearMeasurements', []);
	}

	scrollTo(x: number, y: number): void {
		void this._callIfConnected('scrollTo', [x, y]);
	}

	private _update(partial: Partial<IDesignOverlayState>): void {
		const next: IDesignOverlayState = { ...this._state, ...partial };
		if (equals(next, this._state)) {
			return;
		}
		this._state = next;
		this._onDidChangeState.fire();
		this._schedulePush();
	}

	private get _active(): boolean {
		const state = this._state;
		return state.rulers || state.measure || state.zoom || !!state.cover || this._viewportTrackers > 0;
	}

	// -- Pushing the state to the page ---------------------------------------------------------

	private _schedulePush(): void {
		this._pushQueued = true;
		if (!this._pushing) {
			void this._pushLoop();
		}
	}

	/** Sends the latest state; calls made while a push is in flight are merged into the next one. */
	private async _pushLoop(): Promise<void> {
		this._pushing = true;
		try {
			while (this._pushQueued && !this._store.isDisposed) {
				this._pushQueued = false;
				if (this._active) {
					await this._pushState();
				} else if (this._session) {
					await this._zoomReset;
					await this._call('destroy', []);
					this._disconnect();
				}
			}
		} catch (error) {
			this._logService.debug('[JeffDesign] updating the page overlay failed', error);
			if (this._active && !this._session && this._reconnectAttempts < maxReconnectAttempts) {
				this._reconnectAttempts++;
				this._reconnect.schedule();
			}
		} finally {
			this._pushing = false;
		}
	}

	private async _pushState(): Promise<void> {
		if (!this._session || this._session.closed) {
			await this._connect();
		}
		if (await this._call('setState', [this._state])) {
			this._reconnectAttempts = 0;
			return;
		}
		// The overlay is missing (the page was replaced before the new document ran the script) or is
		// an older version: install it and try again.
		await this._install();
		await this._call('setState', [this._state]);
	}

	private async _connect(): Promise<void> {
		this._disconnect();
		const session = await DesignCdpSession.attach(this._cdpService, this.model);
		if (this._store.isDisposed) {
			session.dispose();
			return;
		}
		this._session = session;
		this._sessionStore.add(session.onEvent(event => {
			switch (event.method) {
				case 'Runtime.bindingCalled': {
					const { name, payload } = event.params as { name?: unknown; payload?: unknown };
					if (name === DESIGN_OVERLAY_BINDING && typeof payload === 'string') {
						this._onNotification(payload);
					}
					break;
				}
				case 'Page.domContentEventFired':
				case 'Page.loadEventFired':
					// A new document: its overlay normally asks for the state itself ('ready'), but make
					// sure it gets it even if that notification was sent before the binding existed.
					this._schedulePush();
					break;
			}
		}));
		this._sessionStore.add(session.onDidClose(() => {
			if (this._session !== session) {
				return;
			}
			this._disconnect();
			if (this._active && !this._store.isDisposed && this._reconnectAttempts < maxReconnectAttempts) {
				this._reconnectAttempts++;
				this._reconnect.schedule();
			}
		}));
		try {
			await session.send('Page.enable');
			// Without the Runtime domain, the binding is only added to the current document: pages
			// loaded later (reload, navigation) could no longer report anything.
			await session.send('Runtime.enable');
			await session.send('Runtime.addBinding', { name: DESIGN_OVERLAY_BINDING });
			// Documents loaded later (navigation, reload) get the overlay before their own scripts run.
			await session.send('Page.addScriptToEvaluateOnNewDocument', { source: getOverlaySource() });
			await this._install();
		} catch (error) {
			if (this._session === session) {
				this._disconnect();
			}
			throw error;
		}
	}

	private async _install(): Promise<void> {
		const response = await this._session?.send<IEvaluateResponse>('Runtime.evaluate', { expression: getOverlaySource(), returnByValue: true });
		if (response?.exceptionDetails) {
			throw new Error(`Installing the design overlay failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
		}
	}

	private _disconnect(): void {
		const session = this._session;
		this._session = undefined;
		this._sessionStore.clear();
		session?.dispose();
	}

	private async _call(method: string, args: readonly unknown[]): Promise<boolean> {
		const session = this._session;
		if (!session || session.closed) {
			return false;
		}
		const response = await session.send<IEvaluateResponse>('Runtime.evaluate', { expression: pageCall(method, args), returnByValue: true });
		if (response.exceptionDetails) {
			this._logService.debug(`[JeffDesign] overlay call ${method} failed`, response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
			return false;
		}
		return response.result?.value === true;
	}

	private async _callIfConnected(method: string, args: readonly unknown[]): Promise<void> {
		try {
			await this._call(method, args);
		} catch (error) {
			this._logService.debug(`[JeffDesign] overlay call ${method} failed`, error);
		}
	}

	private async _flushDraft(): Promise<void> {
		this._draftQueued = false;
		const draft = this._draft;
		this._draft = undefined;
		if (draft) {
			await this._callIfConnected('setDraftGuide', [draft.axis, draft.position]);
		}
	}

	// -- Notifications from the page -----------------------------------------------------------

	private _onNotification(payload: string): void {
		const notification = parseDesignOverlayNotification(payload);
		if (!notification) {
			return;
		}
		switch (notification.type) {
			case 'ready':
				// A new document ran the overlay script: give it the state.
				this._schedulePush();
				break;
			case 'viewport':
				this._viewport = notification.viewport;
				this._onDidChangeViewport.fire(notification.viewport);
				break;
			case 'guides':
				// The page already shows these guides: record them without pushing them back.
				if (!equals(notification.guides, this._state.guides)) {
					this._state = { ...this._state, guides: notification.guides };
					this._onDidChangeState.fire();
				}
				break;
			case 'measureExit':
				this.setMeasure(false);
				break;
			case 'focus':
				if (!equals(notification.rect, this._focusRect)) {
					this._focusRect = notification.rect;
					this._onDidChangeFocusRect.fire(notification.rect);
				}
				break;
			case 'zoom': {
				const previous = this._pendingZoom;
				this._pendingZoom = { x: notification.x, y: notification.y, factor: (previous?.factor ?? 1) * notification.factor, dx: 0, dy: 0 };
				void this._sendZoomInput();
				break;
			}
			case 'pan': {
				const previous = this._pendingPan;
				this._pendingPan = { x: notification.x, y: notification.y, factor: 1, dx: (previous?.dx ?? 0) + notification.dx, dy: (previous?.dy ?? 0) + notification.dy };
				void this._sendZoomInput();
				break;
			}
		}
	}

	private async _resetZoom(): Promise<void> {
		this._pendingZoom = this._pendingPan = undefined;
		const session = this._session;
		if (!session || session.closed) {
			return;
		}
		try {
			const response = await session.send<IEvaluateResponse>('Runtime.evaluate', { expression: 'globalThis.visualViewport ? globalThis.visualViewport.scale : 1', returnByValue: true });
			const scale = response.result?.value;
			if (typeof scale === 'number' && scale > 1.001) {
				await this._pinch(session, 0, 0, 1 / scale);
			}
		} catch (error) {
			this._logService.debug('[JeffDesign] resetting the zoom failed', error);
		}
	}

	/** Pinches the page at (`x`, `y`), in CSS px of its visible part, as a touchpad would. */
	private async _pinch(session: DesignCdpSession, x: number, y: number, factor: number): Promise<void> {
		// A touchpad pinch sends the page a Ctrl+wheel event, which the overlay must let through.
		await this._call('setPinching', [true]);
		try {
			await session.send('Input.synthesizePinchGesture', { x, y, scaleFactor: factor, relativeSpeed: zoomPinchSpeed, gestureSourceType: 'mouse' });
		} finally {
			await this._call('setPinching', [false]);
		}
	}

	/**
	 * Zooms the page as a pinch of the touchpad would, at the pointer, and moves around in it as the
	 * wheel would. The page cannot do either itself: a script can neither zoom a page in without
	 * changing its layout nor move the visible part of a zoomed-in page.
	 */
	private async _sendZoomInput(): Promise<void> {
		if (this._sendingZoomInput) {
			return;
		}
		this._sendingZoomInput = true;
		try {
			while (this._pendingZoom || this._pendingPan) {
				const session = this._session;
				if (!session || session.closed) {
					this._pendingZoom = this._pendingPan = undefined;
					return;
				}
				const zoom = this._pendingZoom;
				const pan = this._pendingPan;
				this._pendingZoom = this._pendingPan = undefined;
				try {
					if (zoom && Math.abs(zoom.factor - 1) > 0.001) {
						await this._pinch(session, zoom.x, zoom.y, zoom.factor);
					}
					if (pan) {
						// Over the layer the page shows while moving around, so the page itself scrolls,
						// never an element under the pointer.
						await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pan.x, y: pan.y, deltaX: -pan.dx, deltaY: -pan.dy });
					}
				} catch (error) {
					this._logService.debug('[JeffDesign] zooming the page failed', error);
				}
			}
		} finally {
			this._sendingZoomInput = false;
		}
	}

	override dispose(): void {
		this._onWillDispose.fire();
		const session = this._session;
		this._session = undefined;
		this._sessionStore.clear();
		if (session && !session.closed) {
			// Remove what the overlay added to the page before closing the debugging session.
			session.send('Runtime.evaluate', { expression: pageCall('destroy', []) })
				.catch(() => { /* the page is gone */ })
				.finally(() => session.dispose());
		} else {
			session?.dispose();
		}
		super.dispose();
	}
}

export const IDesignOverlayService = createDecorator<IDesignOverlayService>('jeffDesignOverlayService');

export interface IDesignOverlayService {
	readonly _serviceBrand: undefined;

	/** Kinds of measurements the Measure tool shows; a preference shared by all pages. */
	readonly categories: readonly DesignMeasureCategory[];
	readonly onDidChangeCategories: Event<void>;
	setCategoryEnabled(category: DesignMeasureCategory, enabled: boolean): void;

	/** The overlay of a browser page; created on first use and disposed with the page's model. */
	getOverlay(model: IBrowserViewModel): DesignPageOverlay;
}

const categoriesStorageKey = 'jeffDesign.measure.categories';

class DesignOverlayService extends Disposable implements IDesignOverlayService {

	declare readonly _serviceBrand: undefined;

	private readonly _overlays = this._register(new DisposableMap<IBrowserViewModel, DesignPageOverlay>());
	private readonly _overlayListeners = this._register(new DisposableMap<IBrowserViewModel>());
	private _categories: readonly DesignMeasureCategory[];
	private readonly _categoryKeys: ReadonlyMap<DesignMeasureCategory, IContextKey<boolean>>;

	private readonly _onDidChangeCategories = this._register(new Emitter<void>());
	readonly onDidChangeCategories: Event<void> = this._onDidChangeCategories.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._categories = this._readCategories();
		this._categoryKeys = new Map(ALL_MEASURE_CATEGORIES.map(category => [category, CONTEXT_DESIGN_MEASURE_CATEGORIES[category].bindTo(contextKeyService)]));
		this._updateCategoryKeys();
	}

	get categories(): readonly DesignMeasureCategory[] {
		return this._categories;
	}

	setCategoryEnabled(category: DesignMeasureCategory, enabled: boolean): void {
		if (this._categories.includes(category) === enabled) {
			return;
		}
		// Keep the canonical order so the state sent to pages does not depend on the click order.
		this._categories = ALL_MEASURE_CATEGORIES.filter(c => c === category ? enabled : this._categories.includes(c));
		this._storageService.store(categoriesStorageKey, JSON.stringify(this._categories), StorageScope.PROFILE, StorageTarget.USER);
		this._updateCategoryKeys();
		for (const overlay of this._overlays.values()) {
			overlay.setCategories(this._categories);
		}
		this._onDidChangeCategories.fire();
	}

	getOverlay(model: IBrowserViewModel): DesignPageOverlay {
		let overlay = this._overlays.get(model);
		if (!overlay) {
			overlay = this._instantiationService.createInstance(DesignPageOverlay, model);
			overlay.setCategories(this._categories);
			this._overlays.set(model, overlay);
			const listeners = new DisposableStore();
			listeners.add(model.onWillDispose(() => {
				this._overlayListeners.deleteAndDispose(model);
				this._overlays.deleteAndDispose(model);
			}));
			this._overlayListeners.set(model, listeners);
		}
		return overlay;
	}

	private _readCategories(): readonly DesignMeasureCategory[] {
		const raw = this._storageService.get(categoriesStorageKey, StorageScope.PROFILE);
		if (raw) {
			try {
				const parsed: unknown = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return ALL_MEASURE_CATEGORIES.filter(category => parsed.includes(category));
				}
			} catch {
				// Fall back to the defaults.
			}
		}
		return DEFAULT_MEASURE_CATEGORIES;
	}

	private _updateCategoryKeys(): void {
		for (const [category, key] of this._categoryKeys) {
			key.set(this._categories.includes(category));
		}
	}
}

registerSingleton(IDesignOverlayService, DesignOverlayService, InstantiationType.Delayed);
