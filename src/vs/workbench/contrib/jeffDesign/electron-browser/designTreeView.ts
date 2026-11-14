/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { DesignInspector, IDesignNode } from './designInspector.js';

/**
 * The Components tree: the elements of the page, collapsible, in sync with the selection.
 * Hovering a row highlights the element in the page; clicking selects it.
 */
export class DesignTreeView extends Disposable {

	readonly element: HTMLElement;
	/** Expanded elements, by backend node id so expansion survives tree reloads. */
	private readonly _expanded = new Set<number>();
	private _visible: IDesignNode[] = [];
	private readonly _rows = new Map<number, HTMLElement>();

	constructor(private readonly _inspector: DesignInspector) {
		super();
		this.element = $('.jeff-design-tree');
		this.element.tabIndex = 0;
		this.element.setAttribute('role', 'tree');
		this.element.setAttribute('aria-label', 'Components');

		this._register(_inspector.onDidChangeTree(() => this.render()));
		this._register(_inspector.onDidChangeSelection(() => this._onSelectionChanged()));
		this._register(addDisposableListener(this.element, EventType.MOUSE_LEAVE, () => _inspector.hover(undefined)));
		this._register(addDisposableListener(this.element, EventType.KEY_DOWN, e => this._onKeyDown(e)));
		this.render();
	}

	render(): void {
		const root = this._inspector.root;
		this.element.replaceChildren();
		this._rows.clear();
		this._visible = [];
		if (!root) {
			append(this.element, $('.jeff-design-tree-empty')).textContent = 'No page loaded';
			return;
		}
		if (this._expanded.size === 0) {
			this._expanded.add(root.backendNodeId);
		}
		this._expandAncestors(this._inspector.selected);
		this._renderNode(root, 0);
	}

	private _renderNode(node: IDesignNode, depth: number): void {
		const expanded = this._expanded.has(node.backendNodeId);
		const hasChildren = node.children.length > 0;
		const selected = this._inspector.selected === node;

		const row = append(this.element, $('.jeff-design-tree-row'));
		row.classList.toggle('selected', selected);
		row.style.paddingLeft = `${6 + depth * 12}px`;
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-selected', String(selected));
		if (hasChildren) {
			row.setAttribute('aria-expanded', String(expanded));
		}

		const twistie = append(row, $(`span.jeff-design-twistie.codicon${hasChildren ? (expanded ? '.codicon-chevron-down' : '.codicon-chevron-right') : ''}`));
		append(row, $('span.jeff-design-tree-tag')).textContent = node.tag;
		const id = node.attributes.get('id');
		const classes = (node.attributes.get('class') ?? '').split(/\s+/).filter(c => c.length > 0);
		const suffix = (id ? `#${id}` : '') + classes.slice(0, 3).map(c => `.${c}`).join('');
		if (suffix) {
			append(row, $('span.jeff-design-tree-suffix')).textContent = suffix;
		}
		if (node.text) {
			append(row, $('span.jeff-design-tree-text')).textContent = node.text;
		}

		row.addEventListener('click', () => {
			this._inspector.select(node).catch(() => { /* reported by the inspector */ });
		});
		row.addEventListener('mouseenter', () => this._inspector.hover(node));
		twistie.addEventListener('click', event => {
			if (hasChildren) {
				event.stopPropagation();
				this._toggle(node);
			}
		});

		this._visible.push(node);
		this._rows.set(node.backendNodeId, row);
		if (expanded) {
			for (const child of node.children) {
				this._renderNode(child, depth + 1);
			}
		}
	}

	private _toggle(node: IDesignNode): void {
		if (this._expanded.has(node.backendNodeId)) {
			this._expanded.delete(node.backendNodeId);
		} else {
			this._expanded.add(node.backendNodeId);
		}
		this.render();
	}

	private _expandAncestors(node: IDesignNode | undefined): void {
		for (let ancestor = node?.parent; ancestor; ancestor = ancestor.parent) {
			this._expanded.add(ancestor.backendNodeId);
		}
	}

	private _onSelectionChanged(): void {
		this.render();
		const selected = this._inspector.selected;
		if (selected) {
			this._rows.get(selected.backendNodeId)?.scrollIntoView({ block: 'nearest' });
		}
	}

	private _onKeyDown(e: KeyboardEvent): void {
		const selected = this._inspector.selected;
		const index = selected ? this._visible.indexOf(selected) : -1;
		let target: IDesignNode | undefined;
		switch (e.key) {
			case 'ArrowDown': target = this._visible[Math.min(this._visible.length - 1, index + 1)]; break;
			case 'ArrowUp': target = this._visible[Math.max(0, index - 1)]; break;
			case 'ArrowRight':
				if (selected && selected.children.length > 0) {
					if (this._expanded.has(selected.backendNodeId)) {
						target = selected.children[0];
					} else {
						this._toggle(selected);
					}
				}
				break;
			case 'ArrowLeft':
				if (selected && this._expanded.has(selected.backendNodeId) && selected.children.length > 0) {
					this._toggle(selected);
				} else {
					target = selected?.parent;
				}
				break;
			default: return;
		}
		e.preventDefault();
		if (target && target !== selected) {
			this._inspector.select(target).catch(() => { /* reported by the inspector */ });
		}
	}
}
