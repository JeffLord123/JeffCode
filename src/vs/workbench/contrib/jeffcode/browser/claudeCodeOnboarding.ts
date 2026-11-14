/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, NeverShowAgainScope, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';

export const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

export function isClaudeCodeInstalled(installedIds: readonly string[]): boolean {
	return installedIds.some(id => id.toLowerCase() === CLAUDE_CODE_EXTENSION_ID);
}

/**
 * On startup, offers a one-click install of the Claude Code extension when it is missing.
 * The extension is not bundled (it is proprietary); it is installed from the configured gallery (Open VSX).
 */
export class ClaudeCodeOnboardingContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.jeffcode.claudeCodeOnboarding';

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this.check().catch(onUnexpectedError);
	}

	private async check(): Promise<void> {
		const installed = await this.extensionsWorkbenchService.queryLocal();
		if (isClaudeCodeInstalled(installed.map(e => e.identifier.id))) {
			return;
		}

		this.notificationService.prompt(
			Severity.Info,
			localize('jeffcode.claudeCode.prompt', "JeffCode uses the Claude Code extension as its agent. Install it now?"),
			[{
				label: localize('jeffcode.claudeCode.install', "Install Claude Code"),
				run: () => this.install()
			}, {
				label: localize('jeffcode.claudeCode.later', "Later"),
				run: () => { }
			}],
			{
				neverShowAgain: {
					id: 'jeffcode.claudeCode.onboarding.neverShowAgain',
					scope: NeverShowAgainScope.APPLICATION,
					isSecondary: true,
				}
			}
		);
	}

	private async install(): Promise<void> {
		try {
			await this.extensionsWorkbenchService.install(CLAUDE_CODE_EXTENSION_ID);
		} catch (error) {
			this.notificationService.prompt(
				Severity.Error,
				localize('jeffcode.claudeCode.installFailed', "Could not install Claude Code: {0}", error instanceof Error ? error.message : String(error)),
				[{
					label: localize('jeffcode.claudeCode.openPage', "Open Extension Page"),
					run: () => this.commandService.executeCommand('extension.open', CLAUDE_CODE_EXTENSION_ID)
				}]
			);
		}
	}
}
