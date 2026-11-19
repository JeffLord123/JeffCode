/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ClaudeCodeGroupSizeContribution } from './claudeCodeGroupSize.js';
import { ClaudeCodeOnboardingContribution } from './claudeCodeOnboarding.js';

registerWorkbenchContribution2(ClaudeCodeOnboardingContribution.ID, ClaudeCodeOnboardingContribution, WorkbenchPhase.Eventually);
registerWorkbenchContribution2(ClaudeCodeGroupSizeContribution.ID, ClaudeCodeGroupSizeContribution, WorkbenchPhase.AfterRestored);
