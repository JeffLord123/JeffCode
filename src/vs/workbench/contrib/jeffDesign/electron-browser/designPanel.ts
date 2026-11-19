/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/jeffDesign.css';
import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../base/common/async.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { changesToCss, changesToPrompt } from '../common/designChanges.js';
import { DesignCssView } from './designCssView.js';
import { DesignInspector, designNodeLabel } from './designInspector.js';
import { DesignSections } from './designSections.js';
import { DesignTreeView } from './designTreeView.js';

/** Command of the Claude Code extension that opens a conversation with an initial prompt. */
const CLAUDE_CODE_OPEN_COMMAND = 'claude-vscode.editor.open';

type DesignTab = 'design' | 'css';

/**
 * The Design panel shown beside the integrated browser: element picker, Components tree,
 * Design and CSS tabs, and the bar that hands the recorded changes to Claude Code.
 */
export class DesignPanel extends Disposable {

	readonly element: HTMLElement;

	private readonly _pickButton: HTMLButtonElement;
	private readonly _selectionLabel: HTMLElement;
	private readonly _banner: HTMLElement;
	private readonly _tabButtons = new Map<DesignTab, HTMLButtonElement>();
	private readonly _empty: HTMLElement;
	private readonly _sections: DesignSections;
	private readonly _cssView: DesignCssView;
	private readonly _changesLabel: HTMLElement;
	private readonly _footerButtons: HTMLButtonElement[] = [];
	private _tab: DesignTab = 'design';
	private readonly _copiedReset = this._register(new MutableDisposable());

	constructor(
		private readonly _inspector: DesignInspector,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this.element = $('.jeff-design-panel');

		// Header: element picker and the name of the selected element.
		const header = append(this.element, $('.jeff-design-header'));
		this._pickButton = append(header, $<HTMLButtonElement>('button.jeff-design-icon-button.codicon.codicon-inspect'));
		this._pickButton.type = 'button';
		this._pickButton.title = 'Select an element in the page';
		this._pickButton.setAttribute('aria-label', this._pickButton.title);
		this._register(addDisposableListener(this._pickButton, EventType.CLICK, () => {
			_inspector.setPicking(!_inspector.picking).catch(error => this._logService.error('[JeffDesign] toggling the element picker failed', error));
		}));
		append(header, $('.jeff-design-title')).textContent = 'Components';
		this._selectionLabel = append(header, $('.jeff-design-selection'));

		this._banner = append(this.element, $('.jeff-design-banner'));
		append(this._banner, $('span')).textContent = 'Not connected to the page.';
		const reconnect = append(this._banner, $<HTMLButtonElement>('button.jeff-design-link'));
		reconnect.type = 'button';
		reconnect.textContent = 'Reconnect';
		this._register(addDisposableListener(reconnect, EventType.CLICK, () => this.connect()));
		this._banner.hidden = true;

		const tree = this._register(new DesignTreeView(_inspector));
		this.element.appendChild(tree.element);

		// Tabs
		const tabs = append(this.element, $('.jeff-design-tabs'));
		tabs.setAttribute('role', 'tablist');
		for (const [tab, label] of [['design', 'Design'], ['css', 'CSS']] as const) {
			const button = append(tabs, $<HTMLButtonElement>('button.jeff-design-tab'));
			button.type = 'button';
			button.textContent = label;
			button.setAttribute('role', 'tab');
			this._tabButtons.set(tab, button);
			this._register(addDisposableListener(button, EventType.CLICK, () => this._showTab(tab)));
		}

		// Content
		const content = append(this.element, $('.jeff-design-content'));
		this._empty = append(content, $('.jeff-design-empty'));
		append(this._empty, $('p')).textContent = 'Select an element to edit its design.';
		const pick = append(this._empty, $<HTMLButtonElement>('button.jeff-design-button.primary'));
		pick.type = 'button';
		pick.textContent = 'Select element';
		this._register(addDisposableListener(pick, EventType.CLICK, () => {
			_inspector.setPicking(true).catch(error => this._logService.error('[JeffDesign] starting the element picker failed', error));
		}));

		this._sections = this._register(new DesignSections(_inspector));
		content.appendChild(this._sections.element);
		this._cssView = this._register(new DesignCssView(_inspector));
		content.appendChild(this._cssView.element);

		// Footer: the journal of changes and what to do with it.
		const footer = append(this.element, $('.jeff-design-footer'));
		this._changesLabel = append(footer, $('.jeff-design-changes'));
		const actions = append(footer, $('.jeff-design-footer-actions'));
		this._footerButton(actions, 'Reset', 'Undo all changes in the page', false, () => _inspector.resetAll());
		this._footerButton(actions, 'Copy CSS', 'Copy the changes as CSS', false, button => this._copyCss(button));
		this._footerButton(actions, 'Send to Claude', 'Write the changes into a new Claude Code conversation, which applies them to the source code once you send it', true, () => this._apply());

		this._register(_inspector.onDidChangeSelection(() => this._updateSelection()));
		this._register(_inspector.onDidChangeStyles(() => this._updateStyles()));
		this._register(_inspector.onDidChangePicking(picking => {
			this._pickButton.classList.toggle('active', picking);
			this._pickButton.setAttribute('aria-pressed', String(picking));
		}));
		this._register(_inspector.onDidDisconnect(() => this._banner.hidden = false));
		this._register(_inspector.changes.onDidChange(() => this._updateChanges()));

		this._showTab('design');
		this._updateSelection();
		this._updateChanges();
	}

	/** Connects the inspector to the page, showing the reconnect banner if that fails. */
	connect(): void {
		this._inspector.connect().then(
			() => this._banner.hidden = true,
			error => {
				this._logService.error('[JeffDesign] connecting to the page failed', error);
				this._banner.hidden = false;
			});
	}

	private _footerButton(parent: HTMLElement, label: string, title: string, primary: boolean, run: (button: HTMLButtonElement) => Promise<void>): void {
		const button = append(parent, $<HTMLButtonElement>(`button.jeff-design-button${primary ? '.primary' : ''}`));
		button.type = 'button';
		button.textContent = label;
		button.title = title;
		this._footerButtons.push(button);
		this._register(addDisposableListener(button, EventType.CLICK, () => {
			run(button).catch(error => {
				this._logService.error(`[JeffDesign] ${label} failed`, error);
				this._notificationService.error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		}));
	}

	private _showTab(tab: DesignTab): void {
		this._tab = tab;
		for (const [id, button] of this._tabButtons) {
			button.classList.toggle('active', id === tab);
			button.setAttribute('aria-selected', String(id === tab));
		}
		this._updateStyles();
	}

	private _updateSelection(): void {
		const selected = this._inspector.selected;
		this._selectionLabel.textContent = selected ? designNodeLabel(selected) : '';
		this._updateStyles();
	}

	private _updateStyles(): void {
		const hasStyles = !!this._inspector.selected && !!this._inspector.styles;
		this._empty.hidden = !!this._inspector.selected;
		this._sections.element.hidden = !hasStyles || this._tab !== 'design';
		this._cssView.element.hidden = !hasStyles || this._tab !== 'css';
		if (!hasStyles) {
			return;
		}
		if (this._tab === 'design') {
			this._sections.update();
		} else {
			this._cssView.update();
		}
	}

	private _updateChanges(): void {
		const count = this._inspector.changes.count;
		const stale = this._inspector.changes.elements.filter(e => e.stale).length;
		this._changesLabel.textContent = count === 0 ? 'No changes' : count === 1 ? '1 change' : `${count} changes`;
		this._changesLabel.title = stale > 0
			? `${stale} edited element${stale === 1 ? ' was' : 's were'} not found after the page reloaded. Their changes are still included when you copy or apply.`
			: '';
		this._changesLabel.classList.toggle('warning', stale > 0);
		for (const button of this._footerButtons) {
			button.disabled = count === 0;
		}
	}

	private async _copyCss(button: HTMLButtonElement): Promise<void> {
		await this._clipboardService.writeText(changesToCss(this._inspector.url, this._inspector.changes.elements));
		// Confirm on the button itself: a notification toast over the page would pause the browser view.
		const label = button.textContent;
		button.textContent = 'Copied';
		this._copiedReset.value = disposableTimeout(() => button.textContent = label, 1500);
	}

	private async _apply(): Promise<void> {
		const prompt = changesToPrompt(this._inspector.url, this._inspector.changes.elements);
		try {
			await this._commandService.executeCommand(CLAUDE_CODE_OPEN_COMMAND, undefined, prompt);
		} catch (error) {
			this._logService.warn('[JeffDesign] could not open Claude Code', error);
			await this._clipboardService.writeText(prompt);
			this._notificationService.warn('Claude Code could not be opened. The instructions were copied to the clipboard: paste them into your agent.');
			return;
		}
		this._inspector.commit();
	}
}
