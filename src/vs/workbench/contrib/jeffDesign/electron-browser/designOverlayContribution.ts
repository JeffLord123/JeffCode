/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILocalizedString, localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionCategory, BrowserEditor, BrowserEditorContribution, IContainerLayoutOverride } from '../../browserView/electron-browser/browserEditor.js';
import { ALL_MEASURE_CATEGORIES, DesignMeasureCategory } from '../common/designOverlay.js';
import { DesignPageOverlay, IDesignOverlayService } from './designPageOverlay.js';
import { DESIGN_RULER_SIZE, DesignRulers } from './designRulers.js';
import { CONTEXT_DESIGN_MEASURE, CONTEXT_DESIGN_MEASURE_CATEGORIES, CONTEXT_DESIGN_RULERS, CONTEXT_DESIGN_ZOOM, DESIGN_PAGE_PRECONDITION, DESIGN_TOOLBAR_GROUP, DesignToolbarOrder, JeffDesignMeasureMenu } from './designToolbar.js';

/**
 * The rulers and the Measure tool of one integrated browser editor. What is drawn over the page
 * (guides, measurements) is drawn by the page's {@link DesignPageOverlay}; this contribution shows
 * the rulers around the page, reserves their room, and keeps the toolbar state in sync.
 */
export class BrowserEditorOverlayContribution extends BrowserEditorContribution {

	private readonly _rulersKey: IContextKey<boolean>;
	private readonly _measureKey: IContextKey<boolean>;
	private readonly _zoomKey: IContextKey<boolean>;
	private readonly _rulers: DesignRulers;
	private _overlay: DesignPageOverlay | undefined;
	private _container: HTMLElement | undefined;
	/** Whether the room of the rulers is reserved around the page. */
	private _rulersShown = false;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IDesignOverlayService private readonly _overlayService: IDesignOverlayService,
	) {
		super(editor);
		this._rulersKey = CONTEXT_DESIGN_RULERS.bindTo(contextKeyService);
		this._measureKey = CONTEXT_DESIGN_MEASURE.bindTo(contextKeyService);
		this._zoomKey = CONTEXT_DESIGN_ZOOM.bindTo(contextKeyService);
		this._rulers = this._register(instantiationService.createInstance(DesignRulers));
	}

	override onContainerCreated(container: HTMLElement): void {
		this._container = container;
		// The wrapper is positioned and clips its content: the rulers sit in the room reserved around the page.
		container.parentElement?.appendChild(this._rulers.element);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		const overlay = this._overlay = this._overlayService.getOverlay(model);
		this._rulers.setOverlay(overlay);
		store.add(overlay.onDidChangeState(() => this._update()));
		store.add(overlay.onWillDispose(() => {
			if (this._overlay === overlay) {
				this._setOverlay(undefined);
			}
		}));
		this._update();
	}

	override onModelDetached(): void {
		this._setOverlay(undefined);
	}

	override beforeContainerLayout(): IContainerLayoutOverride | undefined {
		return this._rulersShown ? { padding: { top: DESIGN_RULER_SIZE, left: DESIGN_RULER_SIZE } } : undefined;
	}

	override afterContainerLayout(): void {
		this._layoutRulers();
	}

	toggleRulers(): void {
		this._overlay?.setRulers(!this._overlay.state.rulers);
	}

	toggleMeasure(): void {
		this.setMeasure(!this._overlay?.state.measure);
	}

	setMeasure(measure: boolean): void {
		this._overlay?.setMeasure(measure);
	}

	clearMeasurements(): void {
		this._overlay?.clearMeasurements();
	}

	toggleZoom(): void {
		const zoom = !this._overlay?.state.zoom;
		this._overlay?.setZoom(zoom);
		if (zoom) {
			// The page needs the keyboard for Space+drag; the toolbar button would take Space as a click.
			this.editor.ensureBrowserFocus();
		}
	}

	private _setOverlay(overlay: DesignPageOverlay | undefined): void {
		this._overlay = overlay;
		this._rulers.setOverlay(overlay);
		this._update();
	}

	private _update(): void {
		const state = this._overlay?.state;
		const rulers = !!state?.rulers;
		this._rulersKey.set(rulers);
		this._measureKey.set(!!state?.measure);
		this._zoomKey.set(!!state?.zoom);
		this._rulers.setVisible(rulers);
		if (rulers !== this._rulersShown) {
			this._rulersShown = rulers;
			// Reserve (or give back) the room of the rulers around the page.
			this.editor.layoutBrowserContainer();
		}
	}

	private _layoutRulers(): void {
		const container = this._container;
		if (!container || !this._rulersShown) {
			return;
		}
		// The editor positions the page container in the wrapper with inline styles, in CSS px.
		this._rulers.layout({
			left: parseFloat(container.style.left) || 0,
			top: parseFloat(container.style.top) || 0,
			width: parseFloat(container.style.width) || 0,
			height: parseFloat(container.style.height) || 0,
		});
	}
}

BrowserEditor.registerContribution(BrowserEditorOverlayContribution);

function getOverlayContribution(accessor: ServicesAccessor, browserEditor: unknown): BrowserEditorOverlayContribution | undefined {
	const editor = browserEditor instanceof BrowserEditor ? browserEditor : accessor.get(IEditorService).activeEditorPane;
	return editor instanceof BrowserEditor ? editor.getContribution(BrowserEditorOverlayContribution) : undefined;
}

class ToggleRulersAction extends Action2 {
	static readonly ID = 'jeffcode.design.toggleRulers';

	constructor() {
		super({
			id: ToggleRulersAction.ID,
			title: localize2('jeffDesign.toggleRulers', "Rulers"),
			category: BrowserActionCategory,
			icon: Codicon.symbolRuler,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_RULERS.key, true),
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: DESIGN_TOOLBAR_GROUP,
				order: DesignToolbarOrder.Rulers,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		getOverlayContribution(accessor, browserEditor)?.toggleRulers();
	}
}

class ToggleMeasureAction extends Action2 {
	static readonly ID = 'jeffcode.design.toggleMeasure';

	constructor() {
		super({
			id: ToggleMeasureAction.ID,
			title: localize2('jeffDesign.toggleMeasure', "Measure"),
			category: BrowserActionCategory,
			icon: Codicon.arrowBoth,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_MEASURE.key, true),
			// The first item of the dropdown is the main part of the split button.
			menu: {
				id: JeffDesignMeasureMenu,
				group: '0_measure',
				order: 0,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		getOverlayContribution(accessor, browserEditor)?.toggleMeasure();
	}
}

/**
 * Escape leaves the Measure tool, like in Figma. The page handles Escape itself when it has the
 * keyboard focus; this covers the case where the focus is still on the browser's toolbar.
 */
class ExitMeasureAction extends Action2 {
	static readonly ID = 'jeffcode.design.exitMeasure';

	constructor() {
		super({
			id: ExitMeasureAction.ID,
			title: localize2('jeffDesign.exitMeasure', "Exit Measure Tool"),
			category: BrowserActionCategory,
			f1: false,
			precondition: ContextKeyExpr.equals(CONTEXT_DESIGN_MEASURE.key, true),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 50,
				when: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, ContextKeyExpr.equals(CONTEXT_DESIGN_MEASURE.key, true)),
				primary: KeyCode.Escape,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		getOverlayContribution(accessor, browserEditor)?.setMeasure(false);
	}
}

const measureCategoryTitles: { readonly [K in DesignMeasureCategory]: ILocalizedString } = {
	gap: localize2('jeffDesign.measureCategory.gap', "Gaps"),
	padding: localize2('jeffDesign.measureCategory.padding', "Padding"),
	margin: localize2('jeffDesign.measureCategory.margin', "Margins"),
	components: localize2('jeffDesign.measureCategory.components', "Components and Sizes"),
	typography: localize2('jeffDesign.measureCategory.typography', "Font Sizes"),
};

/** One toggle per kind of measurement in the dropdown of the Measure button. */
function registerMeasureCategoryAction(category: DesignMeasureCategory, order: number): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: `jeffcode.design.measure.${category}`,
				title: measureCategoryTitles[category],
				category: BrowserActionCategory,
				f1: false,
				toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_MEASURE_CATEGORIES[category].key, true),
				menu: {
					id: JeffDesignMeasureMenu,
					group: '1_categories',
					order,
				},
			});
		}

		run(accessor: ServicesAccessor, browserEditor?: unknown): void {
			const overlayService = accessor.get(IDesignOverlayService);
			const enable = !overlayService.categories.includes(category);
			overlayService.setCategoryEnabled(category, enable);
			if (enable) {
				// Choosing what to measure means measuring now.
				getOverlayContribution(accessor, browserEditor)?.setMeasure(true);
			}
		}
	});
}

class ClearMeasurementsAction extends Action2 {
	static readonly ID = 'jeffcode.design.clearMeasurements';

	constructor() {
		super({
			id: ClearMeasurementsAction.ID,
			title: localize2('jeffDesign.clearMeasurements', "Clear Placed Measurements"),
			category: BrowserActionCategory,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			menu: {
				id: JeffDesignMeasureMenu,
				group: '2_clear',
				order: 0,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		getOverlayContribution(accessor, browserEditor)?.clearMeasurements();
	}
}

/**
 * Zoom and Pan, like a Figma canvas: Ctrl/Cmd+wheel zooms in at the pointer (the layout of the page
 * does not change), Space+drag or a middle-button drag moves around, Shift+0 goes back to 100%.
 * Works with the rulers and the Measure tool, whose annotations are zoomed with the page.
 */
class ToggleZoomAction extends Action2 {
	static readonly ID = 'jeffcode.design.toggleZoom';

	constructor() {
		super({
			id: ToggleZoomAction.ID,
			title: localize2('jeffDesign.toggleZoom', "Zoom and Pan"),
			tooltip: localize('jeffDesign.toggleZoomTooltip', "Zoom and Pan: Ctrl/Cmd+Wheel to Zoom, Space+Drag to Move, Shift+0 for 100%"),
			category: BrowserActionCategory,
			icon: Codicon.zoomIn,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_ZOOM.key, true),
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: DESIGN_TOOLBAR_GROUP,
				order: DesignToolbarOrder.Zoom,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		getOverlayContribution(accessor, browserEditor)?.toggleZoom();
	}
}

registerAction2(ToggleRulersAction);
registerAction2(ToggleZoomAction);
registerAction2(ToggleMeasureAction);
registerAction2(ExitMeasureAction);
ALL_MEASURE_CATEGORIES.forEach((category, index) => registerMeasureCategoryAction(category, index));
registerAction2(ClearMeasurementsAction);

// The Measure button: its main part toggles the tool, its arrow opens the choice of measurements.
MenuRegistry.appendMenuItem(MenuId.BrowserActionsToolbar, {
	submenu: JeffDesignMeasureMenu,
	title: localize2('jeffDesign.measureMenu', "Measure"),
	icon: Codicon.arrowBoth,
	group: DESIGN_TOOLBAR_GROUP,
	order: DesignToolbarOrder.Measure,
	isSplitButton: true,
});
