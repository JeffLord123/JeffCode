/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserViewCDPService, IBrowserViewModel } from '../../browserView/common/browserView.js';
import { DesignChangeSet, IDesignElementDescriptor } from '../common/designChanges.js';
import { DesignCdpSession, IDesignCdpEvent } from './designCdpSession.js';

// -- Chrome DevTools Protocol shapes (only the fields used here) ----------------------------

interface ICdpNode {
	readonly nodeId: number;
	readonly backendNodeId: number;
	readonly nodeType: number;
	readonly localName: string;
	readonly nodeValue: string;
	readonly attributes?: string[];
	readonly children?: ICdpNode[];
}

interface ICdpProperty {
	readonly name: string;
	readonly value: string;
	readonly important?: boolean;
	readonly disabled?: boolean;
	readonly text?: string;
}

interface ICdpStyle {
	readonly cssProperties: ICdpProperty[];
}

interface ICdpRuleMatch {
	readonly rule: {
		readonly selectorList: { readonly text: string };
		readonly origin: string;
		readonly style: ICdpStyle;
		readonly styleSheetId?: string;
	};
}

interface ICdpMatchedStyles {
	readonly inlineStyle?: ICdpStyle;
	readonly matchedCSSRules?: ICdpRuleMatch[];
}

interface ICdpRgba { r: number; g: number; b: number; a: number }

// -- Public model ---------------------------------------------------------------------------

/** An element of the inspected page, as shown in the Components tree. */
export interface IDesignNode {
	readonly nodeId: number;
	readonly backendNodeId: number;
	readonly tag: string;
	readonly attributes: Map<string, string>;
	readonly parent: IDesignNode | undefined;
	readonly children: IDesignNode[];
	/** Text directly inside the element, when it has no child elements. */
	readonly text: string | undefined;
}

export interface IDesignDeclaration {
	readonly name: string;
	readonly value: string;
	readonly important: boolean;
}

export interface IDesignRule {
	readonly selector: string;
	/** File name of the stylesheet, when known. */
	readonly source: string | undefined;
	readonly declarations: IDesignDeclaration[];
}

export interface IDesignStyles {
	/** Computed value of every longhand property. */
	readonly computed: ReadonlyMap<string, string>;
	/** Declarations of the element's `style` attribute. */
	readonly inline: IDesignDeclaration[];
	/** Author rules that match the element, most specific first. */
	readonly rules: IDesignRule[];
}

/** `tag#id.class.class`, the way the Components tree and the journal name an element. */
export function designNodeLabel(node: IDesignNode): string {
	const id = node.attributes.get('id');
	const classes = (node.attributes.get('class') ?? '').split(/\s+/).filter(c => c.length > 0).slice(0, 2);
	return node.tag + (id ? `#${id}` : '') + classes.map(c => `.${c}`).join('');
}

const hiddenTags = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'title', 'base']);

const rgba = (r: number, g: number, b: number, a: number): ICdpRgba => ({ r, g, b, a });

/** Overlay shown while hovering a tree row or picking in the page. */
const hoverHighlight = {
	showInfo: true,
	showAccessibilityInfo: false,
	contentColor: rgba(111, 168, 220, 0.5),
	paddingColor: rgba(147, 196, 125, 0.45),
	borderColor: rgba(255, 229, 153, 0.55),
	marginColor: rgba(246, 178, 107, 0.5),
};

/** Overlay kept on the selected element. */
const selectionHighlight = {
	showInfo: true,
	showAccessibilityInfo: false,
	showExtensionLines: true,
	contentColor: rgba(56, 132, 255, 0.10),
	paddingColor: rgba(147, 196, 125, 0.18),
	borderColor: rgba(56, 132, 255, 0.55),
	marginColor: rgba(246, 178, 107, 0.18),
};

// -- Functions evaluated in the page --------------------------------------------------------
// They are sent as source text and run with `this` bound to the element.

const describeElementFunction = `function () {
	const el = this;
	const esc = value => CSS.escape(value);
	const segment = node => {
		if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
			return '#' + esc(node.id);
		}
		let text = node.localName + Array.from(node.classList).slice(0, 3).map(c => '.' + esc(c)).join('');
		const parent = node.parentElement;
		if (parent) {
			const siblings = Array.from(parent.children).filter(c => c.localName === node.localName);
			if (siblings.length > 1) {
				text += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
			}
		}
		return text;
	};
	const parts = [];
	let current = el;
	while (current && current.nodeType === 1 && current !== document.documentElement) {
		const text = segment(current);
		parts.unshift(text);
		if (text.charAt(0) === '#' || current === document.body) {
			break;
		}
		current = current.parentElement;
	}
	const shallow = el.cloneNode(false);
	let html = shallow.outerHTML.replace(/<\\/[^>]+>$/, '');
	if (html.length > 300) {
		html = html.slice(0, 300) + '…';
	}
	let text = (el.innerText || '').trim().replace(/\\s+/g, ' ');
	if (text.length > 80) {
		text = text.slice(0, 80) + '…';
	}
	const components = [];
	const fiberKey = Object.keys(el).find(k => k.indexOf('__reactFiber$') === 0);
	let fiber = fiberKey ? el[fiberKey] : undefined;
	while (fiber && components.length < 3) {
		const type = fiber.type;
		const name = typeof type === 'function' ? (type.displayName || type.name) : (type && typeof type === 'object' ? type.displayName : undefined);
		if (name && components[0] !== name) {
			components.unshift(name);
		}
		fiber = fiber.return;
	}
	let vue = el.__vueParentComponent;
	while (!fiberKey && vue && components.length < 3) {
		const name = vue.type && (vue.type.name || vue.type.__name);
		if (name) {
			components.unshift(name);
		}
		vue = vue.parent;
	}
	const classes = Array.from(el.classList).slice(0, 2).map(c => '.' + c).join('');
	return {
		selector: parts.join(' > '),
		label: el.localName + (el.id ? '#' + el.id : '') + classes,
		html: html,
		text: text || undefined,
		components: components.length ? components : undefined
	};
}`;

const applyStylesFunction = `function (entries) {
	const previous = [];
	for (const entry of entries) {
		const value = this.style.getPropertyValue(entry[0]);
		const priority = this.style.getPropertyPriority(entry[0]);
		let accepted = true;
		if (entry[1] === '') {
			this.style.removeProperty(entry[0]);
		} else {
			// The browser ignores values that are invalid for the property; detect that.
			this.style.removeProperty(entry[0]);
			this.style.setProperty(entry[0], entry[1], entry[2] || '');
			accepted = this.style.getPropertyValue(entry[0]) !== '';
			if (!accepted && value !== '') {
				this.style.setProperty(entry[0], value, priority);
			}
		}
		previous.push([entry[0], value, priority, accepted]);
	}
	return previous;
}`;

/** What the page's inline style held for a property before an edit, and whether the edit was valid CSS. */
type InlineOriginal = readonly [property: string, value: string, priority: string, accepted?: boolean];

/**
 * Inspects and edits the page of one integrated browser view: the element tree, element picking,
 * the styles of the selected element, live style edits and the journal of those edits.
 */
export class DesignInspector extends Disposable {

	readonly changes = this._register(new DesignChangeSet());

	private _session: DesignCdpSession | undefined;
	private readonly _sessionListeners = this._register(new DisposableStore());
	private _connecting: Promise<void> | undefined;
	private _documentNodeId = 0;
	private _root: IDesignNode | undefined;
	private readonly _nodesById = new Map<number, IDesignNode>();
	private readonly _nodesByBackendId = new Map<number, IDesignNode>();
	private readonly _styleSheetSources = new Map<string, string>();

	private _selected: IDesignNode | undefined;
	private _styles: IDesignStyles | undefined;
	private _stylesRequest = 0;
	private _picking = false;
	private _hovered: IDesignNode | undefined;

	/** Inline values the page had before we edited them, per element key. */
	private readonly _inlineOriginals = new Map<string, Map<string, InlineOriginal>>();

	private _pendingStyles = new Map<string, string>();
	private _applying = false;

	private readonly _treeRefresh = this._register(new RunOnceScheduler(() => this._loadTree(false), 400));
	private readonly _documentReload = this._register(new RunOnceScheduler(() => this._loadTree(true), 150));

	private readonly _onDidChangeTree = this._register(new Emitter<void>());
	readonly onDidChangeTree: Event<void> = this._onDidChangeTree.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection: Event<void> = this._onDidChangeSelection.event;

	private readonly _onDidChangeStyles = this._register(new Emitter<void>());
	readonly onDidChangeStyles: Event<void> = this._onDidChangeStyles.event;

	private readonly _onDidChangePicking = this._register(new Emitter<boolean>());
	readonly onDidChangePicking: Event<boolean> = this._onDidChangePicking.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	constructor(
		private readonly _model: IBrowserViewModel,
		@IBrowserViewCDPService private readonly _cdpService: IBrowserViewCDPService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get url(): string { return this._model.url; }
	get root(): IDesignNode | undefined { return this._root; }
	get selected(): IDesignNode | undefined { return this._selected; }
	get styles(): IDesignStyles | undefined { return this._styles; }
	get picking(): boolean { return this._picking; }
	get connected(): boolean { return !!this._session && !this._session.closed; }

	// -- Connection -------------------------------------------------------------------------

	/** Connects to the page and loads the element tree. Safe to call again after a disconnect. */
	connect(): Promise<void> {
		if (this.connected) {
			return Promise.resolve();
		}
		if (!this._connecting) {
			this._connecting = this._connect().finally(() => this._connecting = undefined);
		}
		return this._connecting;
	}

	private async _connect(): Promise<void> {
		this._sessionListeners.clear();
		this._session?.dispose();
		const session = this._session = await DesignCdpSession.attach(this._cdpService, this._model);
		this._sessionListeners.add(session.onEvent(event => this._onEvent(event)));
		this._sessionListeners.add(session.onDidClose(() => {
			if (this._session === session) {
				this._picking = false;
				this._onDidChangePicking.fire(false);
				this._onDidDisconnect.fire();
			}
		}));
		await session.send('DOM.enable');
		await session.send('CSS.enable');
		await session.send('Overlay.enable');
		await session.send('Page.enable');
		await this._loadTree(this.changes.count > 0);
	}

	private _send<T = unknown>(method: string, params?: object): Promise<T> {
		if (!this._session) {
			return Promise.reject(new Error('Not connected to the page'));
		}
		return this._session.send<T>(method, params);
	}

	private _onEvent(event: IDesignCdpEvent): void {
		switch (event.method) {
			case 'DOM.documentUpdated':
				this._documentReload.schedule();
				break;
			case 'DOM.childNodeInserted':
			case 'DOM.childNodeRemoved':
			case 'DOM.setChildNodes':
				if (!this._documentReload.isScheduled()) {
					this._treeRefresh.schedule();
				}
				break;
			case 'DOM.attributeModified': {
				const { nodeId, name, value } = event.params as { nodeId: number; name: string; value: string };
				const node = this._nodesById.get(nodeId);
				if (node && name !== 'style' && node.attributes.get(name) !== value) {
					node.attributes.set(name, value);
					this._onDidChangeTree.fire();
				}
				break;
			}
			case 'DOM.attributeRemoved': {
				const { nodeId, name } = event.params as { nodeId: number; name: string };
				if (this._nodesById.get(nodeId)?.attributes.delete(name) && name !== 'style') {
					this._onDidChangeTree.fire();
				}
				break;
			}
			case 'CSS.styleSheetAdded': {
				const { header } = event.params as { header: { styleSheetId: string; sourceURL?: string } };
				if (header.sourceURL) {
					this._styleSheetSources.set(header.styleSheetId, header.sourceURL);
				}
				break;
			}
			case 'CSS.styleSheetChanged':
				this._refreshStyles().catch(error => this._logService.debug('[JeffDesign] refresh after stylesheet change failed', error));
				break;
			case 'Overlay.inspectNodeRequested': {
				const { backendNodeId } = event.params as { backendNodeId: number };
				this._onPicked(backendNodeId).catch(error => this._logService.error('[JeffDesign] picking an element failed', error));
				break;
			}
		}
	}

	// -- Tree -------------------------------------------------------------------------------

	private async _loadTree(reapplyChanges: boolean): Promise<void> {
		if (!this.connected) {
			return;
		}
		try {
			const { root } = await this._send<{ root: ICdpNode }>('DOM.getDocument', { depth: -1 });
			this._documentNodeId = root.nodeId;
			this._nodesById.clear();
			this._nodesByBackendId.clear();

			const html = root.children?.find(c => c.nodeType === 1);
			const body = html?.children?.find(c => c.localName === 'body') ?? html;
			this._root = body ? this._buildNode(body, undefined) : undefined;

			if (reapplyChanges) {
				await this._reapplyChanges();
			}

			const previous = this._selected;
			this._selected = previous ? this._nodesByBackendId.get(previous.backendNodeId) : undefined;
			this._onDidChangeTree.fire();
			if (previous && !this._selected) {
				this._styles = undefined;
				this._onDidChangeSelection.fire();
				this._onDidChangeStyles.fire();
			} else if (this._selected) {
				await this._refreshStyles();
				this._showHighlight();
			}
		} catch (error) {
			this._logService.error('[JeffDesign] loading the element tree failed', error);
		}
	}

	private _buildNode(source: ICdpNode, parent: IDesignNode | undefined): IDesignNode {
		const attributes = new Map<string, string>();
		for (let i = 0; i + 1 < (source.attributes?.length ?? 0); i += 2) {
			attributes.set(source.attributes![i], source.attributes![i + 1]);
		}
		const sourceChildren = source.children ?? [];
		const elementChildren = sourceChildren.filter(c => c.nodeType === 1 && !hiddenTags.has(c.localName));
		const textChild = elementChildren.length === 0 ? sourceChildren.find(c => c.nodeType === 3 && c.nodeValue.trim().length > 0) : undefined;
		const children: IDesignNode[] = [];
		const node: IDesignNode = {
			nodeId: source.nodeId,
			backendNodeId: source.backendNodeId,
			tag: source.localName,
			attributes,
			parent,
			children,
			text: textChild ? textChild.nodeValue.trim().replace(/\s+/g, ' ').slice(0, 40) : undefined,
		};
		this._nodesById.set(node.nodeId, node);
		this._nodesByBackendId.set(node.backendNodeId, node);
		for (const child of elementChildren) {
			children.push(this._buildNode(child, node));
		}
		return node;
	}

	// -- Picking and selection --------------------------------------------------------------

	/** Turns "click an element in the page to select it" on or off. */
	async setPicking(picking: boolean): Promise<void> {
		if (picking && !this.connected) {
			await this.connect();
		}
		if (!this.connected) {
			return;
		}
		await this._send('Overlay.setInspectMode', { mode: picking ? 'searchForNode' : 'none', highlightConfig: hoverHighlight });
		if (this._picking !== picking) {
			this._picking = picking;
			this._onDidChangePicking.fire(picking);
		}
		if (!picking) {
			this._showHighlight();
		}
	}

	private async _onPicked(backendNodeId: number): Promise<void> {
		await this.setPicking(false);
		let node = this._nodesByBackendId.get(backendNodeId);
		if (!node) {
			await this._loadTree(false);
			node = this._nodesByBackendId.get(backendNodeId);
		}
		if (node) {
			await this.select(node);
		}
	}

	async select(node: IDesignNode | undefined): Promise<void> {
		this._selected = node;
		this._styles = undefined;
		this._onDidChangeSelection.fire();
		await this._refreshStyles();
		this._showHighlight();
	}

	/** Highlights an element in the page while it is hovered in the tree; `undefined` ends the hover. */
	hover(node: IDesignNode | undefined): void {
		this._hovered = node;
		this._showHighlight();
	}

	/** Removes every highlight from the page, e.g. when the panel is hidden. */
	hideHighlight(): void {
		if (this.connected) {
			this._send('Overlay.hideHighlight').catch(() => { /* the page is gone */ });
		}
	}

	private _showHighlight(): void {
		if (!this.connected || this._picking) {
			return;
		}
		const node = this._hovered ?? this._selected;
		const request = node
			? this._send('Overlay.highlightNode', { backendNodeId: node.backendNodeId, highlightConfig: this._hovered ? hoverHighlight : selectionHighlight })
			: this._send('Overlay.hideHighlight');
		request.catch(error => this._logService.debug('[JeffDesign] highlight failed', error));
	}

	// -- Styles -----------------------------------------------------------------------------

	private async _refreshStyles(): Promise<void> {
		const node = this._selected;
		if (!node || !this.connected) {
			return;
		}
		const request = ++this._stylesRequest;
		try {
			const [computed, matched] = await Promise.all([
				this._send<{ computedStyle: { name: string; value: string }[] }>('CSS.getComputedStyleForNode', { nodeId: node.nodeId }),
				this._send<ICdpMatchedStyles>('CSS.getMatchedStylesForNode', { nodeId: node.nodeId }),
			]);
			if (request !== this._stylesRequest || this._selected !== node) {
				return;
			}
			const toDeclarations = (style: ICdpStyle | undefined): IDesignDeclaration[] => (style?.cssProperties ?? [])
				.filter(p => p.text !== undefined && !p.disabled)
				.map(p => ({ name: p.name, value: p.value, important: !!p.important }));
			const rules: IDesignRule[] = [];
			for (const match of matched.matchedCSSRules ?? []) {
				if (match.rule.origin !== 'regular') {
					continue;
				}
				const sourceUrl = match.rule.styleSheetId ? this._styleSheetSources.get(match.rule.styleSheetId) : undefined;
				rules.unshift({
					selector: match.rule.selectorList.text,
					source: sourceUrl ? sourceUrl.split(/[?#]/)[0].split('/').pop() || undefined : undefined,
					declarations: toDeclarations(match.rule.style),
				});
			}
			this._styles = {
				computed: new Map(computed.computedStyle.map(p => [p.name, p.value])),
				inline: toDeclarations(matched.inlineStyle),
				rules,
			};
			this._onDidChangeStyles.fire();
		} catch (error) {
			this._logService.debug('[JeffDesign] reading styles failed', error);
		}
	}

	/**
	 * The value to show for a property of the selected element: what the user set in this
	 * session if anything, otherwise the computed value.
	 */
	styleValue(property: string): string {
		const node = this._selected;
		if (!node) {
			return '';
		}
		const changed = this.changes.get(String(node.backendNodeId))?.changes.find(c => c.property === property);
		return changed?.after ?? this._styles?.computed.get(property) ?? '';
	}

	/**
	 * Sets longhand properties on the selected element as a live preview and records them in the
	 * journal. An empty value removes the inline declaration. Calls made while a previous one is
	 * still being applied are merged, so dragging a value stays responsive.
	 */
	setStyles(entries: readonly (readonly [property: string, value: string])[]): void {
		if (!this._selected) {
			return;
		}
		for (const [property, value] of entries) {
			this._pendingStyles.set(property, value);
		}
		if (!this._applying) {
			this._applyPending().catch(error => this._logService.error('[JeffDesign] applying styles failed', error));
		}
	}

	private async _applyPending(): Promise<void> {
		this._applying = true;
		try {
			while (this._pendingStyles.size > 0 && this._selected && this.connected) {
				const node = this._selected;
				const entries = [...this._pendingStyles];
				this._pendingStyles = new Map();
				const key = String(node.backendNodeId);

				const objectId = await this._resolve(node.backendNodeId);
				let descriptor = this.changes.get(key)?.element;
				if (!descriptor) {
					descriptor = await this._callOn<IDesignElementDescriptor>(objectId, describeElementFunction, []);
				}
				const befores = entries.map(([property]) => this._styles?.computed.get(property) ?? this._declaredValue(property));
				const previous = await this._callOn<InlineOriginal[]>(objectId, applyStylesFunction, [entries]);

				let originals = this._inlineOriginals.get(key);
				if (!originals) {
					originals = new Map();
					this._inlineOriginals.set(key, originals);
				}
				for (const original of previous) {
					if (original[3] !== false && !originals.has(original[0])) {
						originals.set(original[0], original);
					}
				}

				await this._refreshStyles();
				entries.forEach(([property, value], index) => {
					if (previous[index][3] === false) {
						return; // Not valid CSS for this property: nothing changed in the page.
					}
					const after = value === '' ? (this._styles?.computed.get(property) ?? '') : value;
					this.changes.record(key, descriptor, property, befores[index], after);
				});
				if (!this.changes.has(key)) {
					this._inlineOriginals.delete(key);
				}
			}
		} finally {
			this._applying = false;
		}
	}

	/** The authored value of a property that has no computed value of its own, i.e. a shorthand. */
	private _declaredValue(property: string): string {
		const declarations = [...(this._styles?.inline ?? []), ...(this._styles?.rules ?? []).flatMap(rule => rule.declarations)];
		return declarations.find(declaration => declaration.name === property)?.value ?? '';
	}

	private async _resolve(backendNodeId: number): Promise<string> {
		const { object } = await this._send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId, objectGroup: 'jeffdesign' });
		return object.objectId;
	}

	private async _callOn<T>(objectId: string, functionDeclaration: string, args: unknown[]): Promise<T> {
		const response = await this._send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.callFunctionOn', {
			objectId,
			functionDeclaration,
			arguments: args.map(value => ({ value })),
			returnByValue: true,
		});
		if (response.exceptionDetails) {
			throw new Error(response.exceptionDetails.text);
		}
		return response.result.value;
	}

	// -- Journal ----------------------------------------------------------------------------

	/** Undoes every previewed change in the page and empties the journal. */
	async resetAll(): Promise<void> {
		this._pendingStyles.clear();
		for (const [key, originals] of this._inlineOriginals) {
			try {
				const objectId = await this._resolve(Number(key));
				await this._callOn(objectId, applyStylesFunction, [[...originals.values()]]);
			} catch {
				// The element no longer exists; nothing to undo.
			}
		}
		this._inlineOriginals.clear();
		this.changes.clear();
		await this._refreshStyles();
	}

	/** Empties the journal but leaves the previews in the page, after the changes were handed off. */
	commit(): void {
		this._inlineOriginals.clear();
		this.changes.clear();
	}

	/** After a reload, finds the edited elements again by selector and re-applies their previews. */
	private async _reapplyChanges(): Promise<void> {
		for (const element of this.changes.elements) {
			let found: IDesignNode | undefined;
			try {
				const { nodeId } = await this._send<{ nodeId: number }>('DOM.querySelector', { nodeId: this._documentNodeId, selector: element.element.selector });
				found = nodeId ? this._nodesById.get(nodeId) : undefined;
				if (found) {
					const objectId = await this._resolve(found.backendNodeId);
					const previous = await this._callOn<InlineOriginal[]>(objectId, applyStylesFunction, [element.changes.map(c => [c.property, c.after])]);
					const newKey = String(found.backendNodeId);
					this._inlineOriginals.delete(element.key);
					this._inlineOriginals.set(newKey, new Map(previous.map(original => [original[0], original])));
					if (this._selected?.backendNodeId === Number(element.key)) {
						this._selected = found;
					}
					this.changes.rekey(element.key, newKey);
					this.changes.setStale(newKey, false);
				}
			} catch (error) {
				this._logService.debug('[JeffDesign] re-applying changes failed', error);
			}
			if (!found) {
				this._inlineOriginals.delete(element.key);
				this.changes.setStale(element.key, true);
			}
		}
	}

	override dispose(): void {
		this._session?.dispose();
		this._session = undefined;
		super.dispose();
	}
}
