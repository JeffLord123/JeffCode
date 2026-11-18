/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';

/*
 * Pure helpers of Mirror Mode, which runs the last commit of the user's site beside the working
 * copy: they recognize the command that starts the site, adapt it so that the copy of the last
 * commit listens on another port, and find the address that copy prints.
 */

/** Package managers whose lockfiles and commands Mirror Mode knows. */
export type MirrorPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Shell family a command line is written for: `cmd.exe` on Windows, `/bin/sh` elsewhere. */
export type MirrorShellOs = 'windows' | 'posix';

const packageManagers: readonly MirrorPackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/** Lockfiles in the order they are looked for, with the package manager that writes each. */
export const MIRROR_LOCKFILES: readonly { readonly name: string; readonly packageManager: MirrorPackageManager }[] = [
	{ name: 'pnpm-lock.yaml', packageManager: 'pnpm' },
	{ name: 'yarn.lock', packageManager: 'yarn' },
	{ name: 'bun.lock', packageManager: 'bun' },
	{ name: 'bun.lockb', packageManager: 'bun' },
	{ name: 'package-lock.json', packageManager: 'npm' },
	{ name: 'npm-shrinkwrap.json', packageManager: 'npm' },
];

/**
 * The package manager of a folder: the `packageManager` field of its `package.json` wins, then the
 * lockfile found among `fileNames` (the names of the folder's files). npm by default.
 */
export function detectPackageManager(fileNames: readonly string[], packageManagerField?: string): MirrorPackageManager {
	const field = packageManagerField?.trim() ?? '';
	const declared = packageManagers.find(name => field === name || field.startsWith(`${name}@`));
	if (declared) {
		return declared;
	}
	return MIRROR_LOCKFILES.find(lockfile => fileNames.includes(lockfile.name))?.packageManager ?? 'npm';
}

/** The command that installs the dependencies of a folder with the given package manager. */
export function installCommand(packageManager: MirrorPackageManager): string {
	switch (packageManager) {
		case 'npm': return 'npm install --no-audit --no-fund';
		case 'pnpm': return 'pnpm install';
		case 'yarn': return 'yarn install';
		case 'bun': return 'bun install';
	}
}

/** Scripts that usually start a development server, most likely first. */
const startScripts = ['dev', 'start', 'serve', 'develop'];

/** A guess of the command that starts the site, from the scripts of its `package.json`. */
export function guessStartCommand(scripts: Readonly<Record<string, string>> | undefined, packageManager: MirrorPackageManager): string | undefined {
	const script = startScripts.find(name => typeof scripts?.[name] === 'string');
	if (!script) {
		return undefined;
	}
	if (packageManager === 'npm' && script === 'start') {
		return 'npm start';
	}
	return `${packageManager} run ${script}`;
}

// -- Command lines --------------------------------------------------------------------------------

interface IShellToken {
	/** The word without its quotes, or the operator itself. */
	readonly value: string;
	/** Offsets of the token in the command line, quotes included. */
	readonly start: number;
	readonly end: number;
	/** The token is a shell operator such as `&&`, `|`, `;` or a redirection. */
	readonly operator: boolean;
}

const operatorPattern = /^(?:&&|\|\||[|;&<>])/;

/** Splits a command line into words and operators, the way a shell roughly does. */
function tokenize(text: string): IShellToken[] {
	const tokens: IShellToken[] = [];
	let index = 0;
	while (index < text.length) {
		if (/\s/.test(text[index])) {
			index++;
			continue;
		}
		const operator = operatorPattern.exec(text.slice(index));
		if (operator) {
			tokens.push({ value: operator[0], start: index, end: index + operator[0].length, operator: true });
			index += operator[0].length;
			continue;
		}
		const start = index;
		let value = '';
		while (index < text.length && !/[\s|;&<>]/.test(text[index])) {
			const char = text[index];
			if (char === '"' || char === '\'') {
				const close = text.indexOf(char, index + 1);
				const end = close === -1 ? text.length : close;
				value += text.slice(index + 1, end);
				index = close === -1 ? text.length : close + 1;
			} else {
				value += char;
				index++;
			}
		}
		tokens.push({ value, start, end: index, operator: false });
	}
	return tokens;
}

/** The tokens of the last command of a `a && b` or `a; b` chain. */
function lastCommand(tokens: readonly IShellToken[]): readonly IShellToken[] {
	for (let index = tokens.length - 1; index >= 0; index--) {
		const token = tokens[index];
		if (token.operator && (token.value === '&&' || token.value === ';')) {
			return tokens.slice(index + 1);
		}
	}
	return tokens;
}

interface ITextEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

function applyTextEdits(text: string, edits: readonly ITextEdit[]): string {
	let result = text;
	for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
		result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
	}
	return result;
}

function appendText(text: string, suffix: string): string {
	return `${text.trimEnd()}${suffix}`;
}

/** The name of an executable without its folder and extension, e.g. `vite` for `./node_modules/.bin/vite.cmd`. */
function executableName(value: string): string {
	const name = value.split(/[\\/]/).pop() ?? value;
	return name.replace(/\.(?:cmd|exe|ps1|js|mjs|cjs)$/i, '').toLowerCase();
}

const environmentAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
const envCmdOptionsWithValue = new Set(['-f', '--file', '-e', '--environments', '-r', '--rc-file']);

interface IEnvironmentPrefix {
	/** Index of the first token after the environment prefix. */
	readonly index: number;
	/** A `PORT=N` assignment of the prefix. */
	readonly portAssignment: IShellToken | undefined;
}

/** Skips environment assignments and wrappers such as `cross-env A=B`, `env A=B`, `dotenv -e .env --` or `env-cmd -f .env`. */
function skipEnvironment(tokens: readonly IShellToken[], from: number): IEnvironmentPrefix {
	let index = from;
	let portAssignment: IShellToken | undefined;
	while (index < tokens.length && !tokens[index].operator) {
		const value = tokens[index].value;
		if (environmentAssignment.test(value)) {
			if (value.startsWith('PORT=')) {
				portAssignment = tokens[index];
			}
			index++;
		} else if (value === 'cross-env' || value === 'cross-env-shell' || value === 'env') {
			index++;
		} else if (value === 'dotenv' || value === 'dotenvx') {
			const separator = tokens.findIndex((token, tokenIndex) => tokenIndex > index && token.value === '--');
			if (separator === -1) {
				return { index: tokens.length, portAssignment };
			}
			index = separator + 1;
		} else if (value === 'env-cmd') {
			index++;
			while (index < tokens.length && !tokens[index].operator && tokens[index].value.startsWith('-')) {
				index += envCmdOptionsWithValue.has(tokens[index].value) ? 2 : 1;
			}
		} else {
			break;
		}
	}
	return { index, portAssignment };
}

function replacePortAssignment(token: IShellToken, port: number): ITextEdit {
	return { start: token.start, end: token.end, text: `PORT=${port}` };
}

/** Skips the program that runs the real executable: `npx`, `pnpm exec`, `bunx`, `bundle exec`, `poetry run`, `pnpm vite`... */
function skipRunner(tokens: readonly IShellToken[], from: number): number {
	let index = from;
	const first = tokens[index]?.operator ? undefined : tokens[index]?.value;
	const second = tokens[index + 1]?.operator ? undefined : tokens[index + 1]?.value;
	if (first === 'npx' || first === 'bunx' || first === 'pnpx') {
		index++;
	} else if ((first === 'npm' || first === 'pnpm' || first === 'yarn' || first === 'bun') && (second === 'exec' || second === 'dlx' || second === 'x')) {
		index += 2;
	} else if ((first === 'bundle' && second === 'exec') || ((first === 'uv' || first === 'poetry' || first === 'pipenv') && second === 'run')) {
		index += 2;
	} else if ((first === 'pnpm' || first === 'yarn' || first === 'bun') && second !== undefined && !second.startsWith('-')) {
		// `pnpm vite` runs the `vite` executable of the project when no script has that name.
		index++;
	} else {
		return index;
	}
	while (index < tokens.length && !tokens[index].operator && tokens[index].value.startsWith('-')) {
		index++;
	}
	return index;
}

/** Replaces the value of the first port flag found from `from` on, e.g. `--port 3000`, `--port=3000`, `-p 3000`. */
type PortFlagEdit = (port: number) => ITextEdit;

function findPortFlag(tokens: readonly IShellToken[], from: number, flags: readonly string[]): PortFlagEdit | undefined {
	for (let index = from; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.operator) {
			return undefined;
		}
		for (const flag of flags) {
			const next = tokens[index + 1];
			if (token.value === flag && next && !next.operator) {
				return port => ({ start: next.start, end: next.end, text: String(port) });
			}
			if (token.value.startsWith(`${flag}=`)) {
				return port => ({ start: token.start, end: token.end, text: `${flag}=${port}` });
			}
		}
	}
	return undefined;
}

const defaultPortFlags = ['--port', '-p'];

type CliPlan =
	/** The command already sets a port: these edits replace it. */
	| { readonly kind: 'replace'; readonly edits: readonly ITextEdit[] }
	/** The port is set by appending `suffix`; `portFlag` when it is the `--port P` flag of a JavaScript dev server. */
	| { readonly kind: 'append'; readonly suffix: string; readonly portFlag: boolean }
	/** The port cannot be set on the command line (it may come from the `PORT` environment variable). */
	| { readonly kind: 'none' };

const noPlan: CliPlan = { kind: 'none' };

function replaceOrAppend(tokens: readonly IShellToken[], from: number, flags: readonly string[], port: number, suffix: string, portFlag = false): CliPlan {
	const flag = findPortFlag(tokens, from, flags);
	return flag ? { kind: 'replace', edits: [flag(port)] } : { kind: 'append', suffix, portFlag };
}

/** JavaScript development servers that take `--port`, given their executable and first argument. */
function isPortFlagServer(executable: string, argument: string | undefined): boolean {
	const subcommand = argument === undefined || argument.startsWith('-') ? undefined : argument;
	switch (executable) {
		case 'vite': return subcommand !== 'build' && subcommand !== 'optimize';
		case 'astro': return subcommand === 'dev' || subcommand === 'preview';
		case 'nuxt':
		case 'nuxi': return subcommand === undefined || subcommand === 'dev';
		case 'ng': return subcommand === 'serve' || subcommand === 's';
		case 'vue-cli-service': return subcommand === 'serve';
		case 'webpack':
		case 'webpack-cli': return subcommand === 'serve' || subcommand === 'server' || subcommand === 's';
		case 'webpack-dev-server': return true;
		case 'remix': return subcommand === 'vite:dev';
		case 'react-router': return subcommand === 'dev';
		case 'svelte-kit': return subcommand === 'dev';
		case 'parcel': return subcommand !== 'build';
		case 'next': return subcommand === undefined || subcommand === 'dev' || subcommand === 'start';
		case 'gatsby': return subcommand === 'develop' || subcommand === 'serve';
		case 'storybook': return subcommand === 'dev';
		case 'start-storybook': return true;
		case 'ember': return subcommand === 'serve' || subcommand === 's';
		case 'http-server': return true;
		default: return false;
	}
}

/** Python options that take a value, so that the value is not read as a positional argument. */
const httpServerOptionsWithValue = new Set(['-b', '--bind', '-d', '--directory', '-p', '--protocol']);
const runserverOptionsWithValue = new Set(['--settings', '--pythonpath', '-v', '--verbosity']);

/** Positional arguments from `from` on, skipping options and their values. */
function positionalArguments(tokens: readonly IShellToken[], from: number, optionsWithValue: ReadonlySet<string>): IShellToken[] {
	const result: IShellToken[] = [];
	for (let index = from; index < tokens.length && !tokens[index].operator; index++) {
		const value = tokens[index].value;
		if (value.startsWith('-')) {
			if (optionsWithValue.has(value)) {
				index++;
			}
			continue;
		}
		result.push(tokens[index]);
	}
	return result;
}

/** `python -m http.server [port]`: the port is the first positional argument. */
function planHttpServer(tokens: readonly IShellToken[], from: number, port: number): CliPlan {
	const portArgument = positionalArguments(tokens, from, httpServerOptionsWithValue).find(token => /^\d+$/.test(token.value));
	return portArgument
		? { kind: 'replace', edits: [{ start: portArgument.start, end: portArgument.end, text: String(port) }] }
		: { kind: 'append', suffix: ` ${port}`, portFlag: false };
}

/** `manage.py runserver [addr:port | port]`: replaces the port and keeps the address. */
function planRunserver(tokens: readonly IShellToken[], from: number, port: number): CliPlan {
	const address = positionalArguments(tokens, from, runserverOptionsWithValue)[0];
	if (!address) {
		return { kind: 'append', suffix: ` ${port}`, portFlag: false };
	}
	const match = /^(?<host>.*:)?(?<port>\d+)$/.exec(address.value);
	if (!match?.groups) {
		return noPlan;
	}
	return { kind: 'replace', edits: [{ start: address.start, end: address.end, text: `${match.groups.host ?? ''}${port}` }] };
}

/** `php -S host:port`: replaces the port of the address. */
function planPhpServer(tokens: readonly IShellToken[], index: number, port: number): CliPlan {
	const address = tokens[index];
	const match = address && !address.operator ? /^(?<host>.+):\d+$/.exec(address.value) : null;
	if (!address || !match?.groups) {
		return noPlan;
	}
	return { kind: 'replace', edits: [{ start: address.start, end: address.end, text: `${match.groups.host}:${port}` }] };
}

const pythonExecutable = /^(?:python|python3(?:\.\d+)?|py|pypy3?)$/;
const manageScript = /(?:^|[\\/])manage\.py$/;

/** How to make the program at `index` (after its environment and runner) listen on `port`. */
function planCli(tokens: readonly IShellToken[], index: number, port: number): CliPlan {
	const token = tokens[index];
	if (!token || token.operator) {
		return noPlan;
	}
	const executable = executableName(token.value);
	const arg = (offset: number) => {
		const next = tokens[index + offset];
		return next && !next.operator ? next.value : undefined;
	};
	const sub = arg(1);
	if (isPortFlagServer(executable, sub)) {
		return replaceOrAppend(tokens, index + 1, defaultPortFlags, port, ` --port ${port}`, true);
	}
	if (executable === 'live-server') {
		return replaceOrAppend(tokens, index + 1, ['--port'], port, ` --port=${port}`);
	}
	if (pythonExecutable.test(executable)) {
		if (sub === '-m') {
			switch (arg(2)) {
				case 'http.server': return planHttpServer(tokens, index + 3, port);
				case 'flask': return arg(3) === 'run' ? replaceOrAppend(tokens, index + 4, defaultPortFlags, port, ` --port ${port}`) : noPlan;
				case 'uvicorn': return replaceOrAppend(tokens, index + 3, ['--port'], port, ` --port ${port}`);
				case 'django': return arg(3) === 'runserver' ? planRunserver(tokens, index + 4, port) : noPlan;
				default: return noPlan;
			}
		}
		return sub !== undefined && manageScript.test(sub) && arg(2) === 'runserver' ? planRunserver(tokens, index + 3, port) : noPlan;
	}
	if ((manageScript.test(token.value) || executable === 'django-admin') && sub === 'runserver') {
		return planRunserver(tokens, index + 2, port);
	}
	switch (executable) {
		case 'flask': return sub === 'run' ? replaceOrAppend(tokens, index + 2, defaultPortFlags, port, ` --port ${port}`) : noPlan;
		case 'uvicorn': return replaceOrAppend(tokens, index + 1, ['--port'], port, ` --port ${port}`);
		case 'php':
			if (sub === '-S') {
				return planPhpServer(tokens, index + 2, port);
			}
			return sub === 'artisan' && arg(2) === 'serve' ? replaceOrAppend(tokens, index + 3, ['--port'], port, ` --port=${port}`) : noPlan;
		case 'rails': return sub === 's' || sub === 'server' ? replaceOrAppend(tokens, index + 2, defaultPortFlags, port, ` -p ${port}`) : noPlan;
		case 'hugo': return sub === 'server' || sub === 'serve' ? replaceOrAppend(tokens, index + 2, defaultPortFlags, port, ` --port ${port}`) : noPlan;
		case 'jekyll': return sub === 'serve' || sub === 's' || sub === 'server' ? replaceOrAppend(tokens, index + 2, ['--port', '-P'], port, ` --port ${port}`) : noPlan;
		default: return noPlan;
	}
}

interface IScriptRun {
	readonly packageManager: MirrorPackageManager;
	readonly script: string;
	/** Index of the first token after the script name: arguments passed to the script. */
	readonly argsIndex: number;
}

/** A run of a `package.json` script: `npm run X`, `npm start`, `pnpm [run] X`, `yarn [run] X`, `bun run X`. */
function parseScriptRun(tokens: readonly IShellToken[], index: number, scripts: Readonly<Record<string, string>> | undefined): IScriptRun | undefined {
	const packageManager = packageManagers.find(name => !tokens[index]?.operator && tokens[index]?.value === name);
	const command = tokens[index + 1];
	if (!packageManager || !command || command.operator) {
		return undefined;
	}
	const named = (nameIndex: number): IScriptRun | undefined => {
		const name = tokens[nameIndex];
		return name && !name.operator && !name.value.startsWith('-') ? { packageManager, script: name.value, argsIndex: nameIndex + 1 } : undefined;
	};
	if (command.value === 'run' || command.value === 'run-script') {
		let nameIndex = index + 2;
		while (tokens[nameIndex] && !tokens[nameIndex].operator && tokens[nameIndex].value.startsWith('-')) {
			nameIndex++;
		}
		return named(nameIndex);
	}
	if (packageManager === 'npm') {
		return command.value === 'start' ? { packageManager, script: 'start', argsIndex: index + 2 } : undefined;
	}
	return typeof scripts?.[command.value] === 'string' ? named(index + 1) : undefined;
}

/** Tools that run several commands, whose ports cannot be adapted. */
const compoundTools = new Set(['concurrently', 'run-p', 'run-s', 'npm-run-all', 'npm-run-all2', 'turbo', 'nx']);

type ScriptPlan =
	| { readonly kind: 'patch'; readonly name: string; readonly value: string }
	/** Append `--port P` to the command that runs the script. */
	| { readonly kind: 'append' }
	| undefined;

function planScript(name: string, script: string, port: number, scripts: Readonly<Record<string, string>> | undefined, nested: boolean): ScriptPlan {
	const tokens = tokenize(script);
	if (tokens.some(token => token.operator)) {
		return undefined;
	}
	const { index, portAssignment } = skipEnvironment(tokens, 0);
	const cliIndex = skipRunner(tokens, index);
	if (tokens[cliIndex] && compoundTools.has(executableName(tokens[cliIndex].value))) {
		return undefined;
	}
	const edits = portAssignment ? [replacePortAssignment(portAssignment, port)] : [];
	const patch = (value: string): ScriptPlan => ({ kind: 'patch', name, value });

	// A script that runs another script, e.g. `"dev": "npm run dev:web"`.
	const inner = nested ? undefined : parseScriptRun(tokens, index, scripts);
	if (inner) {
		const flag = findPortFlag(tokens, inner.argsIndex, defaultPortFlags);
		if (flag) {
			return patch(applyTextEdits(script, [...edits, flag(port)]));
		}
		const innerScript = scripts?.[inner.script];
		const innerPlan = innerScript === undefined || inner.script === name ? undefined : planScript(inner.script, innerScript, port, scripts, true);
		if (innerPlan?.kind === 'patch') {
			return innerPlan;
		}
		if (innerPlan?.kind === 'append' && innerScript !== undefined) {
			return { kind: 'patch', name: inner.script, value: appendText(innerScript, ` --port ${port}`) };
		}
		return edits.length ? patch(applyTextEdits(script, edits)) : undefined;
	}

	const cli = planCli(tokens, cliIndex, port);
	switch (cli.kind) {
		case 'replace':
			return patch(applyTextEdits(script, [...edits, ...cli.edits]));
		case 'append':
			if (cli.portFlag && !edits.length) {
				return { kind: 'append' };
			}
			return patch(appendText(applyTextEdits(script, edits), cli.suffix));
		case 'none':
			return edits.length ? patch(applyTextEdits(script, edits)) : undefined;
	}
}

/** How to run a copy of the site: the command line, and a `package.json` script to rewrite first. */
export interface IMirrorCommandPlan {
	readonly commandLine: string;
	/** A script of the copy's `package.json` to replace before running {@link commandLine}. */
	readonly scriptPatch?: { readonly name: string; readonly value: string };
}

/**
 * Adapts the command that starts the user's site so that a copy of it listens on `port`.
 *
 * - Runs of `package.json` scripts (`npm run X`, `npm start`, `pnpm [run] X`, `yarn [run] X`,
 *   `bun run X`) look up the script in `scripts`. When it starts a known development server that
 *   already sets a port, the script is rewritten (`scriptPatch`); otherwise `--port P` is passed
 *   through the package manager. Compound scripts stay unchanged, and so do `react-scripts start`
 *   and `craco start`, which read the `PORT` environment variable.
 * - Development servers run directly (`vite`, `npx next dev`, `ng serve`...) get their port flag
 *   replaced or `--port P` appended.
 * - Python, PHP, Ruby, Hugo and Jekyll servers get their own port syntax.
 * - A `PORT=N` assignment before the command or in the script is replaced too.
 *
 * Anything else stays unchanged: the copy then gets the port through the `PORT` variable only.
 */
export function planMirrorCommand(command: string, port: number, scripts: Readonly<Record<string, string>> | undefined): IMirrorCommandPlan {
	const tokens = lastCommand(tokenize(command));
	if (!tokens.length || tokens.some(token => token.operator)) {
		return { commandLine: command };
	}
	const { index, portAssignment } = skipEnvironment(tokens, 0);
	const edits = portAssignment ? [replacePortAssignment(portAssignment, port)] : [];

	const scriptRun = parseScriptRun(tokens, index, scripts);
	if (scriptRun) {
		const flag = findPortFlag(tokens, scriptRun.argsIndex, defaultPortFlags);
		if (flag) {
			return { commandLine: applyTextEdits(command, [...edits, flag(port)]) };
		}
		const commandLine = applyTextEdits(command, edits);
		const script = scripts?.[scriptRun.script];
		const plan = script === undefined ? undefined : planScript(scriptRun.script, script, port, scripts, false);
		if (plan?.kind === 'patch') {
			return { commandLine, scriptPatch: { name: plan.name, value: plan.value } };
		}
		if (plan?.kind === 'append') {
			const passesArguments = scriptRun.packageManager !== 'npm' || tokens.slice(scriptRun.argsIndex).some(token => token.value === '--');
			return { commandLine: appendText(commandLine, passesArguments ? ` --port ${port}` : ` -- --port ${port}`) };
		}
		return { commandLine };
	}

	const cli = planCli(tokens, skipRunner(tokens, index), port);
	switch (cli.kind) {
		case 'replace': return { commandLine: applyTextEdits(command, [...edits, ...cli.edits]) };
		case 'append': return { commandLine: appendText(applyTextEdits(command, edits), cli.suffix) };
		case 'none': return { commandLine: applyTextEdits(command, edits) };
	}
}

/**
 * The command of a task terminal, read from its shell arguments: the text after `/c` (cmd),
 * `-c` (sh, bash, zsh), `-Command` (PowerShell) or `-e` (WSL).
 */
export function extractShellCommand(args: string | readonly string[] | undefined): string | undefined {
	if (typeof args === 'string') {
		const match = /(?:^|\s)(?:\/c|-c|-command|-e)\s+(?<command>.+)$/is.exec(args);
		const command = match?.groups?.command.trim().replace(/^"(?<inner>.*)"$/s, '$<inner>').trim();
		return command || undefined;
	}
	if (!args) {
		return undefined;
	}
	for (let index = args.length - 2; index >= 0; index--) {
		if (/^(?:\/c|-c|-command|-e)$/i.test(args[index])) {
			return args.slice(index + 1).join(' ').trim() || undefined;
		}
	}
	return undefined;
}

// -- Server output --------------------------------------------------------------------------------

const localUrlPattern = /\bhttps?:\/\/(?:localhost|[\w-]+\.localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{1,5})?(?![\w.-])/gi;
const serverWords = /\b(?:local|loopback|listening|running|ready|started|server|serving|available)\b/i;
const proxyWords = /\bprox(?:y|ying|ied)\b/i;

/**
 * The origin of the server announced on a line of its output, e.g. `http://localhost:5174` for
 * `➜  Local:   http://localhost:5174/`. A local URL is accepted when its port is the chosen port,
 * or when the line announces a server and the port is not the one of the live site (servers that
 * pick another port when theirs is taken). `0.0.0.0` and `[::]` are read as `localhost`.
 */
export function findServerUrl(line: string, ports: { readonly chosenPort: number; readonly livePort: number | undefined }): string | undefined {
	const text = removeAnsiEscapeCodes(line);
	if (proxyWords.test(text)) {
		return undefined;
	}
	const announcesServer = serverWords.test(text);
	for (const match of text.matchAll(localUrlPattern)) {
		const url = URL.parse(match[0]);
		if (!url) {
			continue;
		}
		const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
		if (port === ports.chosenPort || (announcesServer && port !== ports.livePort)) {
			const host = url.hostname === '0.0.0.0' || url.hostname === '[::]' ? 'localhost' : url.hostname;
			return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
		}
	}
	return undefined;
}

/** Whether a line of output asks to use another port, as Create React App, Angular and Gatsby do when theirs is taken. */
export function isPortPrompt(line: string): boolean {
	const text = removeAnsiEscapeCodes(line);
	return /\b(?:another|different)\s+port\b/i.test(text) && /\?|\(y\/n\)/i.test(text);
}

/** A port the copy could not listen on because it is taken, and the files of the project that chose it. */
export interface IMirrorPortConflict {
	readonly port: number;
	/** Paths relative to the copy's root, with `/` separators, outside `node_modules`; may be empty. */
	readonly files: readonly string[];
}

/**
 * Finds in the output of a server that stopped an `EADDRINUSE` error and, in its stack trace, the
 * files of the copy (rooted at `root`) that opened the port: e.g. a Vite plugin that starts a proxy
 * on a fixed port, which the live server already uses.
 */
export function findPortConflict(lines: readonly string[], root: string): IMirrorPortConflict | undefined {
	const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
	const rootPath = normalize(root);
	const windows = /^[a-z]:/i.test(rootPath);
	const comparable = (path: string) => windows ? path.toLowerCase() : path;
	let port: number | undefined;
	const files: string[] = [];
	for (const line of lines) {
		const text = removeAnsiEscapeCodes(line).trim();
		const error = /EADDRINUSE.*?(?<port>\d{2,5})$/.exec(text);
		if (port === undefined && error?.groups) {
			port = Number(error.groups.port);
		}
		const frame = /^at\s+(?:.*?\()?(?<location>[^()]+?):\d+:\d+\)?$/.exec(text);
		if (!frame?.groups) {
			continue;
		}
		let path = frame.groups.location.replace(/^file:\/\//, '');
		try {
			path = decodeURIComponent(path);
		} catch {
			// Not encoded.
		}
		path = normalize(path).replace(/^\/(?=[a-z]:\/)/i, '');
		if (comparable(path).startsWith(comparable(rootPath) + '/')) {
			const relative = path.slice(rootPath.length + 1);
			if (!relative.split('/').includes('node_modules') && !files.includes(relative)) {
				files.push(relative);
			}
		}
	}
	return port !== undefined && port > 0 && port < 65536 ? { port, files } : undefined;
}

/**
 * The variables of a dotenv file (`.env`, `.env.development`…) that set a port to the given value,
 * e.g. `VITE_PROXY_PORT` for `VITE_PROXY_PORT=4111`. Only names that mention a port count.
 */
export function findEnvPortVariables(content: string, port: number): string[] {
	const names: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<quote>["']?)(?<value>\d{1,5})\k<quote>\s*(?:#.*)?$/.exec(line);
		if (match?.groups && /port/i.test(match.groups.name) && Number(match.groups.value) === port && !names.includes(match.groups.name)) {
			names.push(match.groups.name);
		}
	}
	return names;
}

/** Replaces a port number written in source code, as a whole number: `4111` but not `14111` or `4111.5`. */
export function replacePortInSource(source: string, from: number, to: number): string {
	return source.replace(new RegExp(`(?<![\\w.])${from}(?![\\w.])`, 'g'), String(to));
}

/** Whether a line of terminal output mentions a local address with the given port, e.g. `http://localhost:5173/`. */
export function lineMentionsPort(line: string, port: number): boolean {
	const text = removeAnsiEscapeCodes(line);
	for (const match of text.matchAll(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(?<port>\d{1,5})(?!\d)/gi)) {
		if (Number(match.groups?.port) === port) {
			return true;
		}
	}
	return false;
}

// -- Addresses ------------------------------------------------------------------------------------

/** Decoded path of a file URL, with the drive letter in lower case, e.g. `/c:/dev/site`. */
function normalizeFilePath(pathname: string): string {
	let path = pathname;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		// Keep the encoded path.
	}
	return path.replace(/^\/(?<drive>[A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}:`);
}

/**
 * Moves a URL from one site to the other: `url` must be within `fromOrigin` (an origin such as
 * `http://localhost:5173`, or a `file:` URL of a folder) and keeps its path, query and fragment
 * under `toOrigin`. `undefined` when `url` is not within `fromOrigin`.
 */
export function mapMirrorUrl(url: string, fromOrigin: string, toOrigin: string): string | undefined {
	const parsed = URL.parse(url);
	const from = URL.parse(fromOrigin);
	const to = URL.parse(toOrigin);
	if (!parsed || !from || !to) {
		return undefined;
	}
	if (from.protocol === 'file:') {
		if (parsed.protocol !== 'file:' || to.protocol !== 'file:' || parsed.host !== from.host) {
			return undefined;
		}
		const prefix = normalizeFilePath(from.pathname).replace(/\/+$/, '');
		const path = normalizeFilePath(parsed.pathname);
		// Windows paths (with a drive letter) are compared without case.
		const windowsPath = /^\/[a-z]:/.test(prefix);
		const comparablePath = windowsPath ? path.toLowerCase() : path;
		const comparablePrefix = windowsPath ? prefix.toLowerCase() : prefix;
		if (comparablePath !== comparablePrefix && !comparablePath.startsWith(`${comparablePrefix}/`)) {
			return undefined;
		}
		const result = new URL(to.href);
		result.pathname = `${to.pathname.replace(/\/+$/, '')}${path.slice(prefix.length)}`;
		result.search = parsed.search;
		result.hash = parsed.hash;
		return result.href;
	}
	if (parsed.origin !== from.origin || to.origin === 'null') {
		return undefined;
	}
	return `${to.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Whether a URL is served by a development server on this machine or the local network:
 * `localhost`, `*.localhost`, `127.x.x.x`, `0.0.0.0`, `[::1]` or a private IPv4 address.
 */
export function isLocalDevUrl(url: string): boolean {
	const parsed = URL.parse(url);
	if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
		return false;
	}
	const host = parsed.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '[::1]') {
		return true;
	}
	const ipv4 = /^(?<a>\d{1,3})\.(?<b>\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
	if (!ipv4?.groups) {
		return false;
	}
	const a = Number(ipv4.groups.a);
	const b = Number(ipv4.groups.b);
	return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// -- Shell ----------------------------------------------------------------------------------------

/** Quotes an argument of a `cmd.exe` command line when needed. */
export function quoteWindowsArg(value: string): string {
	if (/^[\w\-.:\\/@+]+$/.test(value)) {
		return value;
	}
	// A backslash before the closing quote would escape it: double the trailing backslashes.
	return `"${value.replace(/"/g, '""').replace(/(?<slashes>\\+)$/, '$<slashes>$<slashes>')}"`;
}

/** Quotes an argument of a POSIX shell command line when needed. */
export function quotePosixArg(value: string): string {
	if (/^[\w\-.,:/@+=%]+$/.test(value)) {
		return value;
	}
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The executable and arguments that run a command line through the shell: `cmd.exe` on Windows,
 * where a string of arguments is passed as is, and `/bin/sh -c` elsewhere.
 */
export function shellInvocation(os: MirrorShellOs, commandLine: string): { readonly executable: string; readonly args: string[] | string } {
	return os === 'windows'
		? { executable: 'cmd.exe', args: `/d /s /c "${commandLine}"` }
		: { executable: '/bin/sh', args: ['-c', commandLine] };
}

/** The text of a Node.js version file (`.nvmrc`, `.node-version`): its first line that is not a comment. */
function versionFileValue(content: string | undefined): string | undefined {
	const line = content?.split(/\r?\n/).map(text => text.replace(/#.*$/, '').trim()).find(text => text);
	return line && /^[\w.\-/*]+$/.test(line) ? line : undefined;
}

/**
 * The Node.js version a project asks for, as nvm understands it: the content of `.nvmrc`, else of
 * `.node-version`, else the major version that `engines.node` pins (`24` for `24.22.3` or `^24.1`).
 * A range open on several majors (`>=20`, `20 || 22`) asks for none.
 */
export function projectNodeVersion(files: { readonly nvmrc?: string; readonly nodeVersion?: string; readonly engines?: string }): string | undefined {
	const fromFile = versionFileValue(files.nvmrc) ?? versionFileValue(files.nodeVersion);
	if (fromFile) {
		return fromFile;
	}
	const match = /^\s*[\^~=v]*\s*(?<major>\d+)(?:\.(?:\d+|[xX*])){0,2}\s*$/.exec(files.engines ?? '');
	return match?.groups?.major;
}

/**
 * A POSIX command line that first loads nvm when it is installed, and switches to the project's
 * Node.js version: a terminal started by JeffCode does not read the shell's startup files, where
 * nvm is usually loaded. Windows command lines are returned as they are (nvm-windows is global).
 */
export function withNodeVersionManager(os: MirrorShellOs, commandLine: string, nodeVersion: string | undefined): string {
	if (os === 'windows') {
		return commandLine;
	}
	const script = '"${NVM_DIR:-$HOME/.nvm}/nvm.sh"';
	const use = nodeVersion ? ` nvm use ${quotePosixArg(nodeVersion)};` : '';
	return `if [ -s ${script} ]; then . ${script} >/dev/null 2>&1;${use} fi; ${commandLine}`;
}

/**
 * Whether a commit hash, branch or tag typed by the user can be passed to git as a revision: the
 * characters of git ref names, no option (`-x`) and no range (`a..b`).
 */
export function isSafeGitRef(ref: string): boolean {
	return /^[\w./@~^-]+$/.test(ref) && !ref.startsWith('-') && !ref.includes('..') && ref.length <= 250;
}

/** A folder name made of safe characters only, e.g. `My-Site` for `My Site!`. */
export function sanitizeFolderName(name: string): string {
	const sanitized = name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.slice(0, 48)
		.replace(/^[-.]+|[-.]+$/g, '');
	return sanitized || 'site';
}
