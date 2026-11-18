/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { BrowserActionCategory, BrowserEditor } from '../../browserView/electron-browser/browserEditor.js';
import { IDesignMirrorService } from './designMirrorService.js';
import { CONTEXT_DESIGN_MIRROR_ACTIVE, CONTEXT_DESIGN_MIRROR_SYNC_SCROLL, DESIGN_PAGE_PRECONDITION, DESIGN_TOOLBAR_GROUP, DesignToolbarOrder, JeffDesignMirrorMenu } from './designToolbar.js';

class ToggleMirrorAction extends Action2 {
	static readonly ID = 'jeffcode.design.toggleMirror';

	constructor() {
		super({
			id: ToggleMirrorAction.ID,
			title: localize2('jeffDesign.toggleMirror', "Mirror Mode"),
			metadata: { description: localize2('jeffDesign.toggleMirrorDescription', "Show the last commit of the site on the left and your uncommitted changes on the right") },
			category: BrowserActionCategory,
			icon: Codicon.diffSidebyside,
			f1: true,
			precondition: ContextKeyExpr.or(CONTEXT_DESIGN_MIRROR_ACTIVE, DESIGN_PAGE_PRECONDITION),
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_MIRROR_ACTIVE.key, true),
			// The first item of the dropdown is the main part of the split button.
			menu: {
				id: JeffDesignMirrorMenu,
				group: '0_mirror',
				order: 0,
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		const mirrorService = accessor.get(IDesignMirrorService);
		if (mirrorService.isActive) {
			await mirrorService.stop();
			return;
		}
		const editor = browserEditor instanceof BrowserEditor ? browserEditor : accessor.get(IEditorService).activeEditorPane;
		if (editor instanceof BrowserEditor) {
			await mirrorService.toggle(editor);
		}
	}
}

class ToggleMirrorSyncScrollAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.mirror.syncScroll',
			title: localize2('jeffDesign.mirrorSyncScroll', "Sync Scrolling"),
			category: BrowserActionCategory,
			f1: true,
			toggled: ContextKeyExpr.equals(CONTEXT_DESIGN_MIRROR_SYNC_SCROLL.key, true),
			menu: {
				id: JeffDesignMirrorMenu,
				group: '1_options',
				order: 0,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		const mirrorService = accessor.get(IDesignMirrorService);
		mirrorService.setSyncScroll(!mirrorService.syncScroll);
	}
}

class ChooseMirrorCommitAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.mirror.chooseCommit',
			title: localize2('jeffDesign.mirrorChooseCommit', "Choose Mirror Commit..."),
			metadata: { description: localize2('jeffDesign.mirrorChooseCommitDescription', "Choose the commit, branch or tag shown on the left in Mirror Mode") },
			category: BrowserActionCategory,
			icon: Codicon.gitCommit,
			f1: true,
			precondition: CONTEXT_DESIGN_MIRROR_ACTIVE,
			menu: {
				id: JeffDesignMirrorMenu,
				group: '0_mirror',
				order: 1,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IDesignMirrorService).chooseCommit();
	}
}

class ShowMirrorTerminalAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.mirror.showTerminal',
			title: localize2('jeffDesign.mirrorShowTerminal', "Show Mirror Server Terminal"),
			category: BrowserActionCategory,
			f1: true,
			precondition: CONTEXT_DESIGN_MIRROR_ACTIVE,
			menu: {
				id: JeffDesignMirrorMenu,
				group: '2_tools',
				order: 0,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IDesignMirrorService).showServerTerminal();
	}
}

class ChangeMirrorCommandAction extends Action2 {
	constructor() {
		super({
			id: 'jeffcode.design.mirror.changeCommand',
			title: localize2('jeffDesign.mirrorChangeCommand', "Change Mirror Start Command..."),
			category: BrowserActionCategory,
			f1: true,
			menu: {
				id: JeffDesignMirrorMenu,
				group: '2_tools',
				order: 1,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IDesignMirrorService).changeStartCommand();
	}
}

registerAction2(ToggleMirrorAction);
registerAction2(ChooseMirrorCommitAction);
registerAction2(ToggleMirrorSyncScrollAction);
registerAction2(ShowMirrorTerminalAction);
registerAction2(ChangeMirrorCommandAction);

// The Mirror Mode button: its main part starts or stops the mode, its arrow opens the options.
MenuRegistry.appendMenuItem(MenuId.BrowserActionsToolbar, {
	submenu: JeffDesignMirrorMenu,
	title: localize2('jeffDesign.mirrorMenu', "Mirror Mode"),
	icon: Codicon.diffSidebyside,
	group: DESIGN_TOOLBAR_GROUP,
	order: DesignToolbarOrder.Mirror,
	isSplitButton: true,
});
