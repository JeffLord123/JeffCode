/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { CDPEvent, CDPResponse, CDPTargetInfo } from '../../../../platform/browserView/common/cdp/types.js';
import { IBrowserViewCDPService, IBrowserViewModel } from '../../browserView/common/browserView.js';

export interface IDesignCdpEvent {
	readonly method: string;
	readonly params: unknown;
}

interface IPendingRequest {
	resolve(result: unknown): void;
	reject(error: Error): void;
}

/**
 * A Chrome DevTools Protocol session attached to the page of one integrated browser view.
 * Commands are sent to the page target; events of that target are exposed through {@link onEvent}.
 */
export class DesignCdpSession extends Disposable {

	private _nextId = 1;
	private readonly _pending = new Map<number, IPendingRequest>();
	private _pageSessionId: string | undefined;
	private _closed = false;

	private readonly _onEvent = this._register(new Emitter<IDesignCdpEvent>());
	readonly onEvent: Event<IDesignCdpEvent> = this._onEvent.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	static async attach(cdpService: IBrowserViewCDPService, model: IBrowserViewModel): Promise<DesignCdpSession> {
		const groupId = await cdpService.createSessionGroup(model.id, model.network);
		const session = new DesignCdpSession(cdpService, groupId);
		try {
			const { targetInfos } = await session._send<{ targetInfos: CDPTargetInfo[] }>('Target.getTargets', {}, undefined);
			const target = targetInfos.find(t => t.vscodeBrowserViewId === model.id) ?? targetInfos.find(t => t.type === 'page');
			if (!target) {
				throw new Error('No page target found for the browser view');
			}
			const { sessionId } = await session._send<{ sessionId: string }>('Target.attachToTarget', { targetId: target.targetId, flatten: true }, undefined);
			session._pageSessionId = sessionId;
			return session;
		} catch (error) {
			session.dispose();
			throw error;
		}
	}

	private constructor(
		private readonly _cdpService: IBrowserViewCDPService,
		private readonly _groupId: string,
	) {
		super();
		this._register(_cdpService.onCDPMessage(_groupId)(message => this._onMessage(message)));
		this._register(_cdpService.onDidDestroy(_groupId)(() => this._close()));
	}

	get closed(): boolean {
		return this._closed;
	}

	/** Sends a command to the page and resolves with its result. */
	send<T = unknown>(method: string, params: object = {}): Promise<T> {
		return this._send<T>(method, params, this._pageSessionId);
	}

	private _send<T>(method: string, params: object, sessionId: string | undefined): Promise<T> {
		if (this._closed) {
			return Promise.reject(new Error('The design session is closed'));
		}
		const id = this._nextId++;
		return new Promise<T>((resolve, reject) => {
			this._pending.set(id, { resolve: result => resolve(result as T), reject });
			this._cdpService.sendCDPMessage(this._groupId, { id, method, params, sessionId }).catch(error => {
				this._pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			});
		});
	}

	private _onMessage(message: CDPResponse | CDPEvent): void {
		if ('id' in message && typeof message.id === 'number') {
			const pending = this._pending.get(message.id);
			if (pending) {
				this._pending.delete(message.id);
				if (message.error) {
					pending.reject(new Error(message.error.message));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}
		const event = message as CDPEvent;
		if (event.sessionId === this._pageSessionId) {
			this._onEvent.fire({ method: event.method, params: event.params });
		}
	}

	private _close(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		for (const pending of this._pending.values()) {
			pending.reject(new Error('The design session was closed'));
		}
		this._pending.clear();
		this._onDidClose.fire();
	}

	override dispose(): void {
		const wasClosed = this._closed;
		this._close();
		if (!wasClosed) {
			this._cdpService.destroySessionGroup(this._groupId).catch(() => { /* the group is already gone */ });
		}
		super.dispose();
	}
}
