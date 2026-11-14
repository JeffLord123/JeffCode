/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CLAUDE_CODE_EXTENSION_ID, isClaudeCodeInstalled } from '../../browser/claudeCodeOnboarding.js';

suite('JeffCode - Claude Code onboarding', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('extension id is the official Anthropic one', () => {
		assert.strictEqual(CLAUDE_CODE_EXTENSION_ID, 'anthropic.claude-code');
	});

	test('not installed when no extension matches', () => {
		assert.strictEqual(isClaudeCodeInstalled([]), false);
		assert.strictEqual(isClaudeCodeInstalled(['esbenp.prettier-vscode']), false);
	});

	test('installed when the id matches, case-insensitively', () => {
		assert.strictEqual(isClaudeCodeInstalled(['anthropic.claude-code']), true);
		assert.strictEqual(isClaudeCodeInstalled(['Anthropic.Claude-Code']), true);
	});
});
