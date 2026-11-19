/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { BrowserViewCommandId } from '../../../../platform/browserView/common/browserView.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionCategory, BrowserEditor, BrowserEditorContribution, IContainerLayoutOverride } from '../../browserView/electron-browser/browserEditor.js';
import { DesignInspector } from './designInspector.js';
import { DesignPanel } from './designPanel.js';
import { DESIGN_PAGE_PRECONDITION, DESIGN_TOOLBAR_GROUP, DesignToolbarOrder } from './designToolbar.js';

// The other design tools of the integrated browser: rulers, Measure tool, Mirror Mode.
import './designPageOverlay.js';
import './designOverlayContribution.js';
import './designMirrorService.js';
import './designMirrorContribution.js';
import './designMirrorActions.js';

const CONTEXT_DESIGN_PANEL_OPEN = new RawContextKey<boolean>('jeffDesignPanelOpen', false, localize('jeffDesign.panelOpen', "Whether the Design panel is open in the current browser view"));
const CONTEXT_DESIGN_PICKING = new RawContextKey<boolean>('jeffDesignPicking', false, localize('jeffDesign.picking', "Whether an element is being picked for the Design panel in the current browser view"));

/** Width the Design panel takes from the page, in CSS px. */
const PANEL_WIDTH = 300;

/**
 * Adds the Design panel to the integrated browser: it reserves room beside the page and owns
 * the inspector of the page currently shown.
 */
class BrowserEditorDesignContribution extends BrowserEditorContribution {

	private readonly _openContext: IContextKey<boolean>;
	private readonly _pickingContext: IContextKey<boolean>;
	private readonly _host: HTMLElement;
	/** Inspector and panel of the current page; kept while the panel is hidden so the journal survives. */
	private readonly _current = this._register(new MutableDisposable<DisposableStore>());
	private _inspector: DesignInspector | undefined;
	private _open = false;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		super(editor);
		// The page outlives a window reload, so its debugging session must be closed explicitly;
		// a session left behind keeps its highlight in the page and swallows element picking.
		this._register(lifecycleService.onWillShutdown(() => this._unmount()));
		this._openContext = CONTEXT_DESIGN_PANEL_OPEN.bindTo(contextKeyService);
		this._pickingContext = CONTEXT_DESIGN_PICKING.bindTo(contextKeyService);
		this._host = $('.jeff-design-host');
		this._host.style.width = `${PANEL_WIDTH}px`;
		this._host.hidden = true;
	}

	override onContainerCreated(container: HTMLElement): void {
		container.parentElement?.appendChild(this._host);
	}

	override beforeContainerLayout(): IContainerLayoutOverride | undefined {
		return this._open ? { padding: { right: PANEL_WIDTH } } : undefined;
	}

	protected override onModelAttached(): void {
		this._unmount();
		if (this._open) {
			this._mount();
		}
	}

	override onModelDetached(): void {
		this._unmount();
	}

	override onPaneVisibilityChanged(visible: boolean): void {
		if (!visible && this._inspector?.picking) {
			this._inspector.setPicking(false).catch(() => { /* the page is gone */ });
		}
	}

	get isOpen(): boolean {
		return this._open;
	}

	setOpen(open: boolean): void {
		if (this._open === open) {
			return;
		}
		this._open = open;
		this._openContext.set(open);
		this._host.hidden = !open;
		if (open) {
			this._mount();
		} else if (this._inspector) {
			this._inspector.setPicking(false).catch(() => { /* the page is gone */ });
			this._inspector.hover(undefined);
			this._inspector.hideHighlight();
		}
		this.editor.layoutBrowserContainer();
	}

	/** Opens the panel if needed and toggles "click an element in the page". */
	async togglePicking(): Promise<void> {
		this.setOpen(true);
		if (this._inspector) {
			await this._inspector.setPicking(!this._inspector.picking);
		}
	}

	private _mount(): void {
		const model: IBrowserViewModel | undefined = this.editor.model;
		if (!model) {
			return;
		}
		if (this._inspector) {
			// Reopened on the same page: reconnect if needed and show the selection again.
			this._inspector.connect()
				.then(() => this._inspector?.select(this._inspector.selected))
				.catch(error => this._logService.error('[JeffDesign] reconnecting to the page failed', error));
			return;
		}
		const store = new DisposableStore();
		const inspector = this._inspector = store.add(this._instantiationService.createInstance(DesignInspector, model));
		const panel = store.add(this._instantiationService.createInstance(DesignPanel, inspector));
		store.add(inspector.onDidChangePicking(picking => this._pickingContext.set(picking)));
		this._host.replaceChildren(panel.element);
		this._current.value = store;
		panel.connect();
	}

	private _unmount(): void {
		this._current.clear();
		this._inspector = undefined;
		this._pickingContext.set(false);
		this._host.replaceChildren();
	}
}

BrowserEditor.registerContribution(BrowserEditorDesignContribution);

function getDesignContribution(accessor: ServicesAccessor, browserEditor: unknown): BrowserEditorDesignContribution | undefined {
	const editor = browserEditor instanceof BrowserEditor ? browserEditor : accessor.get(IEditorService).activeEditorPane;
	return editor instanceof BrowserEditor ? editor.getContribution(BrowserEditorDesignContribution) : undefined;
}

/**
 * Opens a new integrated browser tab from the design tools, so the browser is one click away
 * instead of a trip through the Command Palette.
 */
class OpenIntegratedBrowserAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.openBrowser',
			title: localize2('jeffDesign.openBrowser', "Open Integrated Browser"),
			category: BrowserActionCategory,
			icon: Codicon.globe,
			f1: false,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: DESIGN_TOOLBAR_GROUP,
				order: DesignToolbarOrder.OpenBrowser,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Called without arguments: the toolbar passes its editor, which the upstream command would take for options.
		await accessor.get(ICommandService).executeCommand(BrowserViewCommandId.Open);
	}
}

class ToggleDesignPanelAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.togglePanel',
			title: localize2('jeffDesign.togglePanel', "Design Panel"),
			category: BrowserActionCategory,
			icon: Codicon.symbolColor,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_PANEL_OPEN.key, true),
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: DESIGN_TOOLBAR_GROUP,
				order: DesignToolbarOrder.Panel,
			},
		});
	}

	run(accessor: ServicesAccessor, browserEditor?: unknown): void {
		const contribution = getDesignContribution(accessor, browserEditor);
		contribution?.setOpen(!contribution.isOpen);
	}
}

class SelectDesignElementAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.selectElement',
			title: localize2('jeffDesign.selectElement', "Select Element to Design"),
			category: BrowserActionCategory,
			icon: Codicon.inspect,
			f1: true,
			precondition: DESIGN_PAGE_PRECONDITION,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_PICKING.key, true),
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: DESIGN_TOOLBAR_GROUP,
				order: DesignToolbarOrder.SelectElement,
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 1,
				when: BROWSER_EDITOR_ACTIVE,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getDesignContribution(accessor, browserEditor)?.togglePicking();
	}
}

registerAction2(OpenIntegratedBrowserAction);
registerAction2(ToggleDesignPanelAction);
registerAction2(SelectDesignElementAction);

// Keep the Integrated Browser button of the title bar visible even when no browser is open, so the
// browser can always be opened with one click. Users can still hide it from the title bar menu.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		'workbench.browser.showInTitleBar': true,
		// Pages show at their real size (1 CSS pixel = 1 pixel), not at the zoom of the interface:
		// what a designer measures in the page must match the design. "Reset Zoom" comes back to 100%.
		'workbench.browser.pageZoom': '100%',
	},
}]);
