/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { GroupModelChangeKind } from '../../../common/editor.js';
import { DEFAULT_EDITOR_MIN_DIMENSIONS } from '../../../browser/parts/editor/editor.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';

/** View type of the conversation panels of the Claude Code extension (`createWebviewPanel`). */
const CLAUDE_CODE_PANEL_VIEW_TYPE = 'claudeVSCodePanel';

/** Width a new Claude Code group gets beyond the minimum width of an editor group, in CSS px. */
const CLAUDE_CODE_GROUP_EXTRA_WIDTH = 64;

function isClaudeCodePanel(editor: EditorInput | undefined): boolean {
	// The workbench prefixes the view types of extension webview panels (`mainThreadWebview-`).
	return editor instanceof WebviewInput && (editor.viewType === CLAUDE_CODE_PANEL_VIEW_TYPE || editor.viewType.endsWith(`-${CLAUDE_CODE_PANEL_VIEW_TYPE}`));
}

/**
 * Claude Code opens its first conversation in a new editor group to the right, which the workbench
 * gives half of the room. That group starts narrow instead, at the minimum width of an editor group
 * plus {@link CLAUDE_CODE_GROUP_EXTRA_WIDTH}; the user can still resize it, and it is resized only
 * when it is created.
 */
export class ClaudeCodeGroupSizeContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.jeffcode.claudeCodeGroupSize';

	/** Groups created empty, until their first editor opens. */
	private readonly _newGroups = this._register(new DisposableMap<IEditorGroup, DisposableStore>());

	constructor(
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
	) {
		super();
		this._register(_editorGroupsService.onDidAddGroup(group => this._watch(group)));
	}

	private _watch(group: IEditorGroup): void {
		if (!group.isEmpty) {
			return; // A group created with editors: moved or copied, not opened for Claude Code.
		}
		const store = new DisposableStore();
		store.add(group.onDidModelChange(event => {
			if (event.kind !== GroupModelChangeKind.EDITOR_OPEN) {
				return;
			}
			this._newGroups.deleteAndDispose(group);
			if (isClaudeCodePanel(event.editor) && group.count === 1) {
				this._shrink(group);
			}
		}));
		store.add(group.onWillDispose(() => this._newGroups.deleteAndDispose(group)));
		this._newGroups.set(group, store);
	}

	private _shrink(group: IEditorGroup): void {
		const size = this._editorGroupsService.getSize(group);
		const width = DEFAULT_EDITOR_MIN_DIMENSIONS.width + CLAUDE_CODE_GROUP_EXTRA_WIDTH;
		if (size.width > width) {
			this._editorGroupsService.setSize(group, { width, height: size.height });
		}
	}
}
