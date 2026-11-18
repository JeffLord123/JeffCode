/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/designMirror.css';
import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { BrowserEditor, BrowserEditorContribution, BrowserWidgetLocation, IBrowserEditorWidget } from '../../browserView/electron-browser/browserEditor.js';
import { IDesignMirrorService, IDesignMirrorSide } from './designMirrorService.js';

/**
 * What Mirror Mode shows in a browser editor that takes part in it: the progress (or failure) of
 * the last commit's side while its site starts, and a badge before the address telling which side
 * is which.
 */
class BrowserEditorMirrorContribution extends BrowserEditorContribution {

	private readonly _placeholder: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _detail: HTMLElement;
	private readonly _revision: HTMLElement;
	private readonly _addressButton: HTMLButtonElement;
	private readonly _badge: HTMLElement;
	private readonly _badgeIcon: HTMLElement;
	private readonly _badgeLabel: HTMLElement;
	private _badgeTooltip = '';
	private _viewId: string | undefined;

	constructor(
		editor: BrowserEditor,
		@IDesignMirrorService private readonly _mirrorService: IDesignMirrorService,
		@IHoverService hoverService: IHoverService,
		@ILogService private readonly _logService: ILogService,
	) {
		super(editor);

		// Shown in place of the page (which has no address yet) on the last commit's side.
		this._placeholder = $('.jeff-mirror-placeholder');
		const content = append(this._placeholder, $('.jeff-mirror-placeholder-content'));
		append(content, renderIcon(Codicon.diffSidebyside)).classList.add('jeff-mirror-placeholder-icon');
		this._title = append(content, $('.jeff-mirror-placeholder-title'));
		this._detail = append(content, $('.jeff-mirror-placeholder-detail'));
		this._revision = append(content, $('.jeff-mirror-placeholder-revision'));
		const buttons = append(content, $('.jeff-mirror-placeholder-buttons'));
		this._button(buttons, localize('jeffDesign.mirror.showTerminal', "Show Terminal"), () => this._mirrorService.showServerTerminal());
		this._addressButton = this._button(buttons, localize('jeffDesign.mirror.enterAddress', "Enter Address…"), () => this._mirrorService.enterUrlManually());
		this._button(buttons, localize('jeffDesign.mirror.stop', "Stop Mirror Mode"), () => this._mirrorService.stop());

		this._badge = $('.jeff-mirror-badge');
		this._badgeIcon = append(this._badge, $('span'));
		this._badgeLabel = append(this._badge, $('span.jeff-mirror-badge-label'));
		this._register(hoverService.setupDelayedHover(this._badge, () => ({ content: this._badgeTooltip })));

		this._register(_mirrorService.onDidChange(() => this._render()));
		this._render();
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [
			{ location: BrowserWidgetLocation.ContentArea, element: this._placeholder, order: 60 },
			{ location: BrowserWidgetLocation.PreUrl, element: this._badge, order: 10 },
		];
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this._viewId = input.id;
		this._render();
	}

	protected override onModelAttached(model: IBrowserViewModel): void {
		this._viewId = model.id;
		this._render();
	}

	override onModelDetached(): void {
		this._viewId = undefined;
		this._render();
	}

	private _button(parent: HTMLElement, label: string, run: () => Promise<void>): HTMLButtonElement {
		const button = append(parent, $<HTMLButtonElement>('button.jeff-mirror-button'));
		button.type = 'button';
		button.textContent = label;
		this._register(addDisposableListener(button, EventType.CLICK, () => {
			run().catch(error => this._logService.error('[JeffDesign] Mirror Mode action failed', error));
		}));
		return button;
	}

	private _render(): void {
		const side = this._viewId ? this._mirrorService.getSide(this._viewId) : undefined;

		const placeholder = side?.side === 'head' && side.status !== 'ready';
		this._placeholder.style.display = placeholder ? '' : 'none';
		if (side && placeholder) {
			const failed = side.status === 'failed';
			this._placeholder.classList.toggle('failed', failed);
			this._title.textContent = failed
				? localize('jeffDesign.mirror.placeholderFailed', "Mirror Mode could not start")
				: side.pinned
					? localize('jeffDesign.mirror.placeholderPreparingChosen', "Preparing the chosen commit…")
					: localize('jeffDesign.mirror.placeholderPreparing', "Preparing the last commit…");
			this._detail.textContent = (failed ? side.message : side.step) ?? '';
			this._revision.textContent = side.revision ? revisionLabel(side) : '';
			this._addressButton.style.display = failed ? '' : 'none';
		}

		this._badge.style.display = side ? '' : 'none';
		if (!side) {
			return;
		}
		const failed = side.status === 'failed';
		const icon = side.side === 'head' ? (failed ? Codicon.warning : Codicon.gitCommit) : Codicon.diffModified;
		this._badgeIcon.className = ThemeIcon.asClassName(icon);
		this._badge.classList.toggle('head', side.side === 'head');
		this._badge.classList.toggle('failed', failed);
		if (side.side === 'head') {
			this._badgeLabel.textContent = revisionLabel(side);
			this._badgeTooltip = failed && side.message
				? side.message
				: side.pinned
					? localize('jeffDesign.mirror.badgeChosenTooltip', "Mirror Mode: this side runs your site as it is in the chosen commit. Choose another one from the arrow of the Mirror Mode button.")
					: localize('jeffDesign.mirror.badgeHeadTooltip', "Mirror Mode: this side runs your site as it is in the last commit.");
		} else {
			this._badgeLabel.textContent = side.pinned
				? localize('jeffDesign.mirror.badgeWorkingPinned', "Working copy")
				: localize('jeffDesign.mirror.badgeWorking', "Uncommitted");
			this._badgeTooltip = side.pinned
				? localize('jeffDesign.mirror.badgeWorkingPinnedTooltip', "Mirror Mode: this side shows your site as it is in your files now.")
				: localize('jeffDesign.mirror.badgeWorkingTooltip', "Mirror Mode: this side shows your site with your uncommitted changes.");
		}
	}
}

/** `Last commit abc1234`, or for a chosen commit `main abc1234` / `Commit abc1234`. */
function revisionLabel(side: IDesignMirrorSide): string {
	const revision = side.revision ?? '';
	if (!side.pinned) {
		return localize('jeffDesign.mirror.badgeHead', "Last commit {0}", revision);
	}
	return side.refName
		? localize('jeffDesign.mirror.badgeRef', "{0} {1}", side.refName, revision)
		: localize('jeffDesign.mirror.badgeCommit', "Commit {0}", revision);
}

BrowserEditor.registerContribution(BrowserEditorMirrorContribution);
