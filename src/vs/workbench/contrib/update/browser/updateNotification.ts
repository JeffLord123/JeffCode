/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, State as UpdateState, StateType } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

/**
 * Shows a notification when an update is ready to install (restart to apply it) or available to download,
 * once per update version.
 */
export class UpdateNotificationContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.updateNotification';

	private readonly notification = this._register(new MutableDisposable());
	private notifiedKey: string | undefined;

	constructor(
		@IUpdateService private readonly updateService: IUpdateService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		this._register(updateService.onStateChange(state => this.onUpdateStateChange(state)));
		this.onUpdateStateChange(updateService.state);
	}

	private onUpdateStateChange(state: UpdateState): void {
		if (state.type !== StateType.Ready && state.type !== StateType.AvailableForDownload) {
			if (state.type !== StateType.Restarting) {
				this.notification.clear();
			}
			return;
		}

		const key = `${state.type}:${state.update.version}`;
		if (this.notifiedKey === key) {
			return;
		}
		this.notifiedKey = key;

		const version = state.update.productVersion ?? state.update.version;
		const handle = state.type === StateType.Ready
			? this.notificationService.prompt(
				Severity.Info,
				nls.localize('updateReady', "A new version of {0} ({1}) is ready. Restart to finish updating.", this.productService.nameShort, version),
				[
					{ label: nls.localize('restartToUpdate', "Restart to Update"), run: () => this.updateService.quitAndInstall() },
					{ label: nls.localize('later', "Later"), run: () => { } },
				],
				{ sticky: true }
			)
			: this.notificationService.prompt(
				Severity.Info,
				nls.localize('updateAvailable', "A new version of {0} ({1}) is available.", this.productService.nameShort, version),
				[
					{ label: nls.localize('downloadUpdate', "Download Update"), run: () => this.updateService.downloadUpdate(true) },
					{ label: nls.localize('later', "Later"), run: () => { } },
				],
				{ sticky: true }
			);

		this.notification.value = toDisposable(() => handle.close());
	}
}
