/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { stringHash } from '../../../../base/common/hash.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { autorun } from '../../../../base/common/observable.js';
import { OperatingSystem, OS } from '../../../../base/common/platform.js';
import { basename, dirname, isEqual, isEqualOrParent, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { BrowserViewUri } from '../../../../platform/browserView/common/browserViewUri.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { editorBackground, editorForeground } from '../../../../platform/theme/common/colorRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { GroupDirection, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { BrowserEditor } from '../../browserView/electron-browser/browserEditor.js';
import { ISCMRepository, ISCMService } from '../../scm/common/scm.js';
import { ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import {
	detectPackageManager,
	extractShellCommand,
	findServerUrl,
	guessStartCommand,
	installCommand,
	isLocalDevUrl,
	isPortPrompt,
	lineMentionsPort,
	mapMirrorUrl,
	MIRROR_LOCKFILES,
	MirrorShellOs,
	planMirrorCommand,
	quotePosixArg,
	quoteWindowsArg,
	sanitizeFolderName,
	shellInvocation,
} from '../common/designMirrorCommand.js';
import { DesignPageOverlay, IDesignOverlayService } from './designPageOverlay.js';
import { CONTEXT_DESIGN_MIRROR_ACTIVE, CONTEXT_DESIGN_MIRROR_SYNC_SCROLL } from './designToolbar.js';

export const IDesignMirrorService = createDecorator<IDesignMirrorService>('jeffDesignMirrorService');

/** The part a browser view plays in Mirror Mode. */
export interface IDesignMirrorSide {
	/** `head` shows the last commit (left), `working` the uncommitted changes (right). */
	readonly side: 'head' | 'working';
	readonly status: 'preparing' | 'ready' | 'failed';
	/** Localized text of the current preparation step. */
	readonly step?: string;
	/** Localized error or hint, when failed. */
	readonly message?: string;
	/** Short hash of the last commit. */
	readonly revision?: string;
}

/**
 * Mirror Mode: shows the last commit of the site beside the uncommitted version. The last commit
 * is checked out in a git worktree outside the repository and started with the same command on
 * another port, so it is the real, working site, not a picture of it.
 */
export interface IDesignMirrorService {
	readonly _serviceBrand: undefined;

	readonly isActive: boolean;
	readonly onDidChange: Event<void>;

	/** The part of a browser view (by `IBrowserViewModel.id`) in the current session, if any. */
	getSide(browserViewId: string): IDesignMirrorSide | undefined;

	/** Starts Mirror Mode for the page of an editor, or stops it when it is on. */
	toggle(editor: BrowserEditor): Promise<void>;
	stop(): Promise<void>;
	showServerTerminal(): Promise<void>;
	/** Asks for the start command again, remembers it, and restarts the server of a running session. */
	changeStartCommand(): Promise<void>;
	/** When the address of the copy was not detected: asks for it and shows it. */
	enterUrlManually(): Promise<void>;

	readonly syncScroll: boolean;
	setSyncScroll(sync: boolean): void;
}

/** A failure to report to the user as is. */
class MirrorError extends Error { }

interface IStartCommand {
	readonly line: string;
	/** Folder the command runs in, relative to the repository root; '' for the root. */
	readonly cwd: string;
}

interface IInstallPlan {
	readonly root: URI;
	readonly command: string;
	/** The file whose content tells whether the dependencies changed: the lockfile, else package.json. */
	readonly fingerprint: URI;
}

interface IMirrorSession {
	readonly store: DisposableStore;
	readonly repository: ISCMRepository;
	readonly repoRoot: URI;
	readonly worktree: URI;
	readonly logFile: URI;
	readonly os: MirrorShellOs;
	readonly remote: boolean;
	readonly workingModel: IBrowserViewModel;
	readonly workingOverlay: DesignPageOverlay;
	readonly headId: string;
	/** Origin of the live site (`http://localhost:5173`), or the `file:` URL of the repository root. */
	readonly liveOrigin: string;
	readonly livePort: number | undefined;
	/** The command that starts the site; undefined for a file page. */
	command: IStartCommand | undefined;
	headModel: IBrowserViewModel | undefined;
	headGroup: IEditorGroup | undefined;
	headOverlay: DesignPageOverlay | undefined;
	/** Origin of the copy once known. */
	mirrorOrigin: string | undefined;
	/** Commit checked out in the worktree. */
	revision: string;
	status: IDesignMirrorSide['status'];
	step: string | undefined;
	message: string | undefined;
	readonly server: MutableDisposable<DisposableStore>;
	serverTerminal: ITerminalInstance | undefined;
	installTerminal: ITerminalInstance | undefined;
	/** Commit the worktree should move to once the current preparation is done. */
	pendingRevision: string | undefined;
	busy: boolean;
}

const commandStorageKey = (repoRoot: URI) => `jeffDesign.mirror.command:${repoRoot.toString()}`;
const headStorageKey = 'jeffDesign.mirror.headView';
const syncScrollStorageKey = 'jeffDesign.mirror.syncScroll';
const stampFileName = '.jeffcode-mirror-stamp';
const minute = 60_000;

class DesignMirrorService extends Disposable implements IDesignMirrorService {

	declare readonly _serviceBrand: undefined;

	private _session: IMirrorSession | undefined;
	private readonly _sessionStore = this._register(new MutableDisposable<DisposableStore>());
	private _syncScroll: boolean;
	private readonly _activeKey: IContextKey<boolean>;
	private readonly _syncScrollKey: IContextKey<boolean>;
	/** Terminals Mirror Mode created, so they are not mistaken for the user's dev server. */
	private readonly _ownTerminals = new Set<ITerminalInstance>();

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly _storageService: IStorageService,
		@ISCMService private readonly _scmService: ISCMService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IFileService private readonly _fileService: IFileService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IPathService private readonly _pathService: IPathService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IThemeService private readonly _themeService: IThemeService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDesignOverlayService private readonly _overlayService: IDesignOverlayService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._activeKey = CONTEXT_DESIGN_MIRROR_ACTIVE.bindTo(contextKeyService);
		this._syncScroll = this._storageService.getBoolean(syncScrollStorageKey, StorageScope.PROFILE, true);
		this._syncScrollKey = CONTEXT_DESIGN_MIRROR_SYNC_SCROLL.bindTo(contextKeyService);
		this._syncScrollKey.set(this._syncScroll);

		// The window was reloaded during a session: its last-commit tab came back but its server is gone.
		const staleHead = this._storageService.get(headStorageKey, StorageScope.WORKSPACE);
		if (staleHead) {
			this._storageService.remove(headStorageKey, StorageScope.WORKSPACE);
			lifecycleService.when(LifecyclePhase.Restored).then(() => this._closeHeadEditor(staleHead, undefined));
		}
	}

	get isActive(): boolean {
		return !!this._session;
	}

	get syncScroll(): boolean {
		return this._syncScroll;
	}

	getSide(browserViewId: string): IDesignMirrorSide | undefined {
		const session = this._session;
		if (!session) {
			return undefined;
		}
		const revision = session.revision.slice(0, 7);
		if (browserViewId === session.headId) {
			return { side: 'head', status: session.status, step: session.step, message: session.message, revision };
		}
		if (browserViewId === session.workingModel.id) {
			return { side: 'working', status: session.status, revision };
		}
		return undefined;
	}

	async toggle(editor: BrowserEditor): Promise<void> {
		if (this._session) {
			await this.stop();
			return;
		}
		const model = editor.model;
		if (!model) {
			return;
		}
		try {
			await this._start(editor, model);
		} catch (error) {
			this._logService.error('[JeffDesign] starting Mirror Mode failed', error);
			if (this._session) {
				this._fail(this._session, error);
			} else {
				this._notificationService.notify({ severity: Severity.Warning, message: error instanceof MirrorError ? error.message : localize('jeffDesign.mirror.startFailed', "Mirror Mode could not start: {0}", toErrorMessage(error)) });
			}
		}
	}

	async stop(): Promise<void> {
		const session = this._session;
		if (!session) {
			return;
		}
		this._session = undefined;
		this._sessionStore.clear();
		this._storageService.remove(headStorageKey, StorageScope.WORKSPACE);
		this._activeKey.set(false);
		this._onDidChange.fire();
		await this._closeHeadEditor(session.headId, session.headGroup);
	}

	async showServerTerminal(): Promise<void> {
		const terminal = this._session?.serverTerminal ?? this._session?.installTerminal;
		if (terminal && !terminal.isDisposed) {
			this._terminalService.setActiveInstance(terminal);
			await this._terminalService.revealTerminal(terminal);
		}
	}

	async changeStartCommand(): Promise<void> {
		const session = this._session;
		const repository = session?.repository ?? this._pickRepository(undefined);
		const repoRoot = repository?.provider.rootUri;
		if (!repoRoot) {
			this._notificationService.notify({ severity: Severity.Warning, message: localize('jeffDesign.mirror.noRepository', "Mirror Mode needs a Git repository in the workspace.") });
			return;
		}
		const current = session?.command ?? this._rememberedCommand(repoRoot) ?? await this._guessCommand(repoRoot);
		const command = await this._askCommand(repoRoot, current);
		if (!command || !session || session !== this._session || !session.command) {
			return;
		}
		session.command = command;
		await this._restartServer(session);
	}

	async enterUrlManually(): Promise<void> {
		const session = this._session;
		if (!session) {
			return;
		}
		const value = await this._quickInputService.input({
			prompt: localize('jeffDesign.mirror.addressPrompt', "Address of the site started from the last commit"),
			placeHolder: 'http://localhost:5174',
			validateInput: async text => URL.canParse(text.trim()) ? undefined : localize('jeffDesign.mirror.invalidAddress', "Enter a full address, such as http://localhost:5174"),
		});
		if (!value || session !== this._session) {
			return;
		}
		this._ready(session, new URL(value.trim()).origin);
	}

	setSyncScroll(sync: boolean): void {
		if (this._syncScroll === sync) {
			return;
		}
		this._syncScroll = sync;
		this._syncScrollKey.set(sync);
		this._storageService.store(syncScrollStorageKey, sync, StorageScope.PROFILE, StorageTarget.USER);
		if (this._session) {
			this._updateScrollSync(this._session);
		}
		this._onDidChange.fire();
	}

	// -- Start -------------------------------------------------------------------------------

	private async _start(editor: BrowserEditor, model: IBrowserViewModel): Promise<void> {
		const url = model.url;
		const fileMode = url.startsWith('file:');
		if (!fileMode && !isLocalDevUrl(url)) {
			throw new MirrorError(localize('jeffDesign.mirror.notLocal', "Mirror Mode compares your local development server. Open its localhost address in the browser first."));
		}
		const live = fileMode ? undefined : new URL(url);
		const livePort = live ? (Number(live.port) || (live.protocol === 'https:' ? 443 : 80)) : undefined;

		// Where the site comes from: the terminal running the dev server tells the command and its folder.
		const detected = livePort !== undefined ? await this._detectFromTerminals(livePort) : undefined;
		const repository = this._pickRepository(detected?.cwd ?? (fileMode ? URI.parse(url) : undefined));
		const repoRoot = repository?.provider.rootUri;
		if (!repository || !repoRoot) {
			throw new MirrorError(localize('jeffDesign.mirror.noRepository', "Mirror Mode needs a Git repository in the workspace."));
		}
		if (fileMode && !isEqualOrParent(URI.parse(url), repoRoot)) {
			throw new MirrorError(localize('jeffDesign.mirror.fileOutside', "This page is not in the Git repository of the workspace."));
		}

		let command: IStartCommand | undefined;
		if (!fileMode) {
			const detectedCwd = detected?.cwd && isEqualOrParent(detected.cwd, repoRoot) ? relativePath(repoRoot, detected.cwd) ?? '' : '';
			command = detected ? { line: detected.command, cwd: detectedCwd } : this._rememberedCommand(repoRoot);
			if (!command) {
				command = await this._askCommand(repoRoot, await this._guessCommand(repoRoot));
				if (!command) {
					return;
				}
			} else if (detected) {
				this._rememberCommand(repoRoot, command);
			}
		}

		const remote = !!this._remoteAgentService.getConnection();
		const os: MirrorShellOs = ((remote ? (await this._remoteAgentService.getEnvironment())?.os : undefined) ?? OS) === OperatingSystem.Windows ? 'windows' : 'posix';
		const home = await this._pathService.userHome();
		const folderName = `${sanitizeFolderName(basename(repoRoot))}-${(stringHash(repoRoot.toString(), 0) >>> 0).toString(16)}`;
		const mirrorFolder = joinPath(home, '.jeffcode', 'mirror');

		const store = new DisposableStore();
		const session: IMirrorSession = {
			store,
			repository,
			repoRoot,
			worktree: joinPath(mirrorFolder, folderName),
			logFile: joinPath(mirrorFolder, `${folderName}.log`),
			os,
			remote,
			workingModel: model,
			workingOverlay: this._overlayService.getOverlay(model),
			headId: generateUuid(),
			liveOrigin: live ? live.origin : `${repoRoot.toString(true)}/`,
			livePort,
			command,
			headModel: undefined,
			headGroup: undefined,
			headOverlay: undefined,
			mirrorOrigin: undefined,
			revision: repository.provider.historyProvider.get()?.historyItemRef.get()?.revision ?? '',
			status: 'preparing',
			step: localize('jeffDesign.mirror.stepOpening', "Opening the last commit…"),
			message: undefined,
			server: store.add(new MutableDisposable<DisposableStore>()),
			serverTerminal: undefined,
			installTerminal: undefined,
			pendingRevision: undefined,
			busy: true,
		};
		this._session = session;
		this._sessionStore.value = store;
		this._activeKey.set(true);
		this._storageService.store(headStorageKey, session.headId, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this._onDidChange.fire();

		this._watchChanges(session);
		await this._openHead(session, editor);
		if (session !== this._session) {
			return;
		}

		await this._prepareWorktree(session);
		if (session !== this._session) {
			return;
		}
		if (fileMode) {
			this._ready(session, `${session.worktree.toString(true)}/`);
		} else {
			await this._startServer(session, true);
		}
		session.busy = false;
		this._watchHead(session);
	}

	/** Opens the last commit's tab in a new editor group to the left of the page. */
	private async _openHead(session: IMirrorSession, editor: BrowserEditor): Promise<void> {
		const workingGroup = editor.group;
		const headGroup = session.headGroup = this._editorGroupsService.addGroup(workingGroup, GroupDirection.LEFT);
		const pane = await this._editorService.openEditor({ resource: BrowserViewUri.forId(session.headId), options: { pinned: true, preserveFocus: true } }, headGroup);
		const input = pane?.input;
		if (!(input instanceof BrowserEditorInput)) {
			throw new MirrorError(localize('jeffDesign.mirror.noTab', "Mirror Mode could not open the tab of the last commit."));
		}
		headGroup.lock(true);
		const headModel = session.headModel = await input.resolve();
		session.headOverlay = this._overlayService.getOverlay(headModel);

		// Closing either side ends Mirror Mode.
		session.store.add(headModel.onWillDispose(() => this._stopIf(session)));
		session.store.add(session.workingModel.onWillDispose(() => this._stopIf(session)));
		session.store.add(this._editorService.onDidCloseEditor(event => {
			if (event.editor instanceof BrowserEditorInput && (event.editor.id === session.headId || event.editor.id === session.workingModel.id)) {
				this._stopIf(session);
			}
		}));

		this._syncNavigation(session, headModel);
		this._updateScrollSync(session);
	}

	private _stopIf(session: IMirrorSession): void {
		if (this._session === session) {
			this.stop().catch(error => this._logService.error('[JeffDesign] stopping Mirror Mode failed', error));
		}
	}

	private async _closeHeadEditor(headId: string, group: IEditorGroup | undefined): Promise<void> {
		try {
			for (const candidate of group ? [group] : this._editorGroupsService.groups) {
				const editor = candidate.editors.find(e => e instanceof BrowserEditorInput && e.id === headId);
				if (!editor) {
					continue;
				}
				candidate.lock(false);
				await candidate.closeEditor(editor);
				if (candidate.isEmpty && this._editorGroupsService.groups.includes(candidate) && this._editorGroupsService.count > 1) {
					this._editorGroupsService.removeGroup(candidate);
				}
			}
		} catch (error) {
			this._logService.error('[JeffDesign] closing the last commit tab failed', error);
		}
	}

	// -- Worktree ----------------------------------------------------------------------------

	private async _prepareWorktree(session: IMirrorSession): Promise<void> {
		this._setStep(session, localize('jeffDesign.mirror.stepCheckout', "Copying the last commit…"));
		await this._fileService.createFolder(dirname(session.worktree));
		await this._fileService.writeFile(session.logFile, VSBuffer.fromString(''));
		const repo = this._quote(session, this._shellPath(session.repoRoot));
		const worktree = this._quote(session, this._shellPath(session.worktree));

		if (!session.revision) {
			session.revision = await this._resolveHead(session);
		}
		await this._git(session, `git -C ${repo} worktree prune`, true);
		if (await this._fileService.exists(joinPath(session.worktree, '.git'))) {
			await this._git(session, `git -C ${worktree} checkout --detach --force ${session.revision}`);
			await this._git(session, `git -C ${worktree} clean -fdq`);
		} else {
			if (await this._fileService.exists(session.worktree)) {
				// What is left of an attempt that failed: git would refuse to create the worktree there.
				await this._fileService.del(session.worktree, { recursive: true, useTrash: false });
			}
			await this._git(session, `git -C ${repo} worktree add --detach --force ${worktree} ${session.revision}`);
		}
		if (await this._fileService.exists(joinPath(session.worktree, '.gitmodules'))) {
			await this._git(session, `git -C ${worktree} submodule update --init --recursive`);
		}
		await this._copyEnvFiles(session);
		this._onDidChange.fire();
	}

	private async _resolveHead(session: IMirrorSession): Promise<string> {
		const output = joinPath(dirname(session.logFile), `${basename(session.worktree)}.head`);
		const repo = this._quote(session, this._shellPath(session.repoRoot));
		const target = this._quote(session, this._shellPath(output));
		const code = await this._runHidden(session, `git -C ${repo} rev-parse HEAD > ${target}`, session.repoRoot, false);
		const revision = code === 0 ? (await this._fileService.readFile(output)).value.toString().trim() : '';
		if (!/^[0-9a-f]{7,64}$/i.test(revision)) {
			throw new MirrorError(localize('jeffDesign.mirror.noCommit', "This repository has no commit yet: there is no last commit to compare with."));
		}
		return revision;
	}

	/** Runs a git command, its output going to the log; throws with the end of the log when it fails. */
	private async _git(session: IMirrorSession, commandLine: string, ignoreFailure = false): Promise<void> {
		const code = await this._runHidden(session, commandLine, session.repoRoot, true);
		if (code !== 0 && !ignoreFailure) {
			throw new MirrorError(localize('jeffDesign.mirror.gitFailed', "Copying the last commit failed: {0}", await this._logTail(session)));
		}
	}

	private async _logTail(session: IMirrorSession): Promise<string> {
		try {
			const lines = (await this._fileService.readFile(session.logFile)).value.toString().split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
			return lines.slice(-4).join(' ') || localize('jeffDesign.mirror.noDetails', "no details");
		} catch {
			return localize('jeffDesign.mirror.noDetails', "no details");
		}
	}

	/** `.env` files are usually ignored by git, yet the site needs them to run. */
	private async _copyEnvFiles(session: IMirrorSession): Promise<void> {
		const folders = [session.repoRoot];
		if (session.command?.cwd) {
			folders.push(joinPath(session.repoRoot, session.command.cwd));
		}
		for (const folder of folders) {
			try {
				const stat = await this._fileService.resolve(folder);
				for (const child of stat.children ?? []) {
					if (!child.isFile || !/^\.env(?:\..+)?$/.test(child.name)) {
						continue;
					}
					const relative = relativePath(session.repoRoot, child.resource);
					const target = relative !== undefined ? joinPath(session.worktree, relative) : undefined;
					if (target && !await this._fileService.exists(target)) {
						await this._fileService.copy(child.resource, target, false);
					}
				}
			} catch (error) {
				this._logService.debug('[JeffDesign] copying env files to the mirror failed', error);
			}
		}
	}

	// -- Dependencies and server -------------------------------------------------------------

	private async _startServer(session: IMirrorSession, firstStart: boolean): Promise<void> {
		const command = session.command;
		if (!command) {
			return;
		}
		const cwd = command.cwd ? joinPath(session.worktree, command.cwd) : session.worktree;
		const install = await this._installPlan(session, cwd);
		let installed = false;
		if (install && !await this._dependenciesUpToDate(install)) {
			await this._install(session, install);
			installed = true;
		}
		if (session !== this._session) {
			return;
		}

		this._setStep(session, localize('jeffDesign.mirror.stepServer', "Starting the site of the last commit…"));
		const port = await this._choosePort(session);
		const packageJson = joinPath(cwd, 'package.json');
		const scripts = await this._readScripts(packageJson);
		const plan = planMirrorCommand(command.line, port, scripts);
		if (plan.scriptPatch) {
			await this._patchScript(packageJson, plan.scriptPatch.name, plan.scriptPatch.value);
		}

		const serverStore = new DisposableStore();
		session.server.value = serverStore;
		const invocation = shellInvocation(session.os, plan.commandLine);
		const terminal = await this._terminalService.createTerminal({
			config: {
				name: localize('jeffDesign.mirror.serverTerminal', "JeffCode Mirror: last commit"),
				executable: invocation.executable,
				args: invocation.args,
				cwd,
				env: { PORT: String(port), BROWSER: 'none' },
				isFeatureTerminal: true,
				waitOnExit: true,
				icon: Codicon.diffSidebyside,
			},
		});
		this._ownTerminals.add(terminal);
		session.serverTerminal = terminal;
		serverStore.add(toDisposable(() => {
			this._ownTerminals.delete(terminal);
			if (session.serverTerminal === terminal) {
				session.serverTerminal = undefined;
			}
			terminal.dispose();
		}));

		this._setStep(session, localize('jeffDesign.mirror.stepAddress', "Waiting for the site of the last commit to start…"));
		const origin = await new Promise<string | undefined>(resolve => {
			const waiting = serverStore.add(new DisposableStore());
			const done = (value: string | undefined) => {
				waiting.dispose();
				resolve(value);
			};
			waiting.add(terminal.onLineData(line => {
				if (isPortPrompt(line)) {
					// The server asks whether to use another port: yes.
					void terminal.sendText('y', true);
					return;
				}
				const found = findServerUrl(line, { chosenPort: port, livePort: session.livePort });
				if (found) {
					done(found);
				}
			}));
			waiting.add(terminal.onExit(() => done(undefined)));
			waiting.add(terminal.onDisposed(() => done(undefined)));
			waiting.add(disposableTimeout(() => done(''), (installed || firstStart ? 10 : 3) * minute));
		});
		if (session !== this._session || session.server.value !== serverStore) {
			return;
		}
		if (origin === undefined) {
			throw new MirrorError(localize('jeffDesign.mirror.serverStopped', "The site of the last commit stopped. See the terminal \"JeffCode Mirror: last commit\"."));
		}
		if (origin === '') {
			throw new MirrorError(localize('jeffDesign.mirror.noAddress', "The site of the last commit did not show its address. See the terminal, or enter the address."));
		}
		serverStore.add(terminal.onExit(() => {
			if (this._session === session && session.server.value === serverStore) {
				this._fail(session, new MirrorError(localize('jeffDesign.mirror.serverStopped', "The site of the last commit stopped. See the terminal \"JeffCode Mirror: last commit\".")));
			}
		}));
		this._ready(session, origin);
	}

	private async _restartServer(session: IMirrorSession): Promise<void> {
		if (session.busy) {
			return;
		}
		session.busy = true;
		try {
			session.server.clear();
			session.mirrorOrigin = undefined;
			session.status = 'preparing';
			session.message = undefined;
			await this._startServer(session, false);
		} catch (error) {
			this._fail(session, error);
		} finally {
			session.busy = false;
		}
	}

	private async _choosePort(session: IMirrorSession): Promise<number> {
		const start = (session.livePort ?? 5173) + 1;
		if (session.remote) {
			return start;
		}
		try {
			return (await this._nativeHostService.findFreePort(start, 100, 1000)) || start;
		} catch {
			return start;
		}
	}

	/**
	 * Where and how to install the dependencies of the copy: the nearest folder with a lockfile from
	 * the command's folder up to the worktree root, else the nearest with a package.json.
	 */
	private async _installPlan(session: IMirrorSession, cwd: URI): Promise<IInstallPlan | undefined> {
		let packagePlan: IInstallPlan | undefined;
		for (let folder = cwd; isEqualOrParent(folder, session.worktree); folder = dirname(folder)) {
			let names: string[] = [];
			try {
				names = ((await this._fileService.resolve(folder)).children ?? []).map(child => child.name);
			} catch {
				// Not a folder of the worktree.
			}
			const lockfile = MIRROR_LOCKFILES.find(entry => names.includes(entry.name));
			if (lockfile || (!packagePlan && names.includes('package.json'))) {
				const manager = detectPackageManager(names, await this._packageManagerField(joinPath(folder, 'package.json')));
				const plan: IInstallPlan = { root: folder, command: installCommand(manager), fingerprint: joinPath(folder, lockfile ? lockfile.name : 'package.json') };
				if (lockfile) {
					return plan;
				}
				packagePlan = plan;
			}
			if (isEqual(folder, session.worktree)) {
				break;
			}
		}
		return packagePlan;
	}

	private async _packageManagerField(packageJson: URI): Promise<string | undefined> {
		try {
			const value: unknown = JSON.parse((await this._fileService.readFile(packageJson)).value.toString());
			const field = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).packageManager : undefined;
			return typeof field === 'string' ? field : undefined;
		} catch {
			return undefined;
		}
	}

	private async _dependenciesUpToDate(install: IInstallPlan): Promise<boolean> {
		try {
			const [fingerprint, stamp] = await Promise.all([
				this._fileService.readFile(install.fingerprint),
				this._fileService.readFile(joinPath(install.root, 'node_modules', stampFileName)),
			]);
			return fingerprint.value.toString() === stamp.value.toString();
		} catch {
			return false;
		}
	}

	private async _install(session: IMirrorSession, install: IInstallPlan): Promise<void> {
		this._setStep(session, localize('jeffDesign.mirror.stepInstall', "Installing the dependencies of the last commit… (only when they change)"));
		const invocation = shellInvocation(session.os, install.command);
		const terminal = await this._terminalService.createTerminal({
			config: {
				name: localize('jeffDesign.mirror.installTerminal', "JeffCode Mirror: installing dependencies"),
				executable: invocation.executable,
				args: invocation.args,
				cwd: install.root,
				env: { BROWSER: 'none' },
				isFeatureTerminal: true,
				icon: Codicon.diffSidebyside,
			},
		});
		this._ownTerminals.add(terminal);
		session.installTerminal = terminal;
		const code = await this._waitForExit(terminal, 30 * minute);
		if (code === 0) {
			session.installTerminal = undefined;
			this._ownTerminals.delete(terminal);
			terminal.dispose();
			const fingerprint = await this._fileService.readFile(install.fingerprint);
			await this._fileService.writeFile(joinPath(install.root, 'node_modules', stampFileName), fingerprint.value);
			return;
		}
		session.store.add(toDisposable(() => {
			this._ownTerminals.delete(terminal);
			terminal.dispose();
		}));
		throw new MirrorError(localize('jeffDesign.mirror.installFailed', "Installing the dependencies of the last commit failed. See the terminal \"JeffCode Mirror: installing dependencies\"."));
	}

	private async _readScripts(packageJson: URI): Promise<Record<string, string> | undefined> {
		try {
			const value: unknown = JSON.parse((await this._fileService.readFile(packageJson)).value.toString());
			const scripts = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).scripts : undefined;
			if (typeof scripts !== 'object' || scripts === null) {
				return undefined;
			}
			const result: Record<string, string> = {};
			for (const [name, script] of Object.entries(scripts)) {
				if (typeof script === 'string') {
					result[name] = script;
				}
			}
			return result;
		} catch {
			return undefined;
		}
	}

	/** Rewrites a script of the worktree's package.json: it is our copy, the next checkout restores it. */
	private async _patchScript(packageJson: URI, name: string, script: string): Promise<void> {
		const value = JSON.parse((await this._fileService.readFile(packageJson)).value.toString()) as { scripts?: Record<string, string> };
		value.scripts = { ...value.scripts, [name]: script };
		await this._fileService.writeFile(packageJson, VSBuffer.fromString(JSON.stringify(value, undefined, 2)));
	}

	// -- Ready, sync, changes ----------------------------------------------------------------

	private _ready(session: IMirrorSession, origin: string): void {
		session.mirrorOrigin = origin;
		session.status = 'ready';
		session.step = undefined;
		session.message = undefined;
		this._onDidChange.fire();
		const target = mapMirrorUrl(session.workingModel.url, session.liveOrigin, origin) ?? origin;
		if (session.headModel) {
			this._navigate(session, session.headModel, target);
		}
	}

	private _fail(session: IMirrorSession, error: unknown): void {
		if (session !== this._session) {
			return;
		}
		if (!(error instanceof MirrorError)) {
			this._logService.error('[JeffDesign] Mirror Mode failed', error);
		}
		session.status = 'failed';
		session.step = undefined;
		session.message = error instanceof MirrorError ? error.message : localize('jeffDesign.mirror.failed', "Mirror Mode failed: {0}", toErrorMessage(error));
		session.busy = false;
		this._onDidChange.fire();
	}

	private _setStep(session: IMirrorSession, step: string | undefined): void {
		session.step = step;
		this._onDidChange.fire();
	}

	/** Navigations made to follow the other side are not sent back, so the two sides cannot loop. */
	private readonly _followUntil = new Map<IBrowserViewModel, number>();

	private _navigate(session: IMirrorSession, model: IBrowserViewModel, url: string): void {
		if (model.url === url) {
			return;
		}
		this._followUntil.set(model, Date.now() + 2000);
		model.loadURL(url).catch(error => this._logService.debug('[JeffDesign] mirror navigation failed', error));
	}

	private _syncNavigation(session: IMirrorSession, headModel: IBrowserViewModel): void {
		const follow = (from: IBrowserViewModel, to: IBrowserViewModel, fromOrigin: () => string | undefined, toOrigin: () => string | undefined) => {
			session.store.add(from.onDidNavigate(event => {
				const followedUntil = this._followUntil.get(from) ?? 0;
				const source = fromOrigin();
				const destination = toOrigin();
				if (session !== this._session || session.status !== 'ready' || Date.now() < followedUntil || !source || !destination) {
					return;
				}
				const mapped = mapMirrorUrl(event.url, source, destination);
				if (mapped) {
					this._navigate(session, to, mapped);
				}
			}));
		};
		follow(session.workingModel, headModel, () => session.liveOrigin, () => session.mirrorOrigin);
		follow(headModel, session.workingModel, () => session.mirrorOrigin, () => session.liveOrigin);
		session.store.add(toDisposable(() => {
			this._followUntil.delete(session.workingModel);
			this._followUntil.delete(headModel);
		}));
	}

	private readonly _scrollSync = this._register(new MutableDisposable<DisposableStore>());

	private _updateScrollSync(session: IMirrorSession): void {
		const head = session.headOverlay;
		if (!this._syncScroll || !head) {
			this._scrollSync.clear();
			return;
		}
		const store = new DisposableStore();
		const working = session.workingOverlay;
		store.add(head.trackViewport());
		store.add(working.trackViewport());
		store.add(head.onDidChangeViewport(viewport => {
			if (!viewport.programmatic && session.status === 'ready') {
				working.scrollTo(viewport.scrollX, viewport.scrollY);
			}
		}));
		store.add(working.onDidChangeViewport(viewport => {
			if (!viewport.programmatic && session.status === 'ready') {
				head.scrollTo(viewport.scrollX, viewport.scrollY);
			}
		}));
		this._scrollSync.value = store;
		session.store.add(toDisposable(() => {
			if (this._scrollSync.value === store) {
				this._scrollSync.clear();
			}
		}));
	}

	/** Without uncommitted changes, there is nothing to show on the right: cover the page. */
	private _watchChanges(session: IMirrorSession): void {
		const provider = session.repository.provider;
		const update = () => {
			if (session !== this._session) {
				return;
			}
			const changes = provider.groups.reduce((count, group) => count + group.resources.length, 0);
			const theme = this._themeService.getColorTheme();
			session.workingOverlay.setCover(changes > 0 ? undefined : {
				title: localize('jeffDesign.mirror.noChangesTitle', "No uncommitted changes"),
				detail: localize('jeffDesign.mirror.noChangesDetail', "This side shows your uncommitted changes as soon as you edit a file. The left side keeps the last commit."),
				background: theme.getColor(editorBackground)?.toString() ?? '#ffffff',
				foreground: theme.getColor(editorForeground)?.toString() ?? '#000000',
			});
		};
		session.store.add(provider.onDidChangeResources(update));
		session.store.add(provider.onDidChangeResourceGroups(update));
		session.store.add(this._themeService.onDidColorThemeChange(update));
		session.store.add(toDisposable(() => session.workingOverlay.setCover(undefined)));
		update();
	}

	/** A new commit: move the copy to it. */
	private _watchHead(session: IMirrorSession): void {
		const provider = session.repository.provider;
		session.store.add(autorun(reader => {
			const revision = provider.historyProvider.read(reader)?.historyItemRef.read(reader)?.revision;
			if (revision && revision !== session.revision && session === this._session) {
				session.pendingRevision = revision;
				void this._followHead(session);
			}
		}));
	}

	private async _followHead(session: IMirrorSession): Promise<void> {
		if (session.busy) {
			return; // Picked up when the current preparation ends.
		}
		session.busy = true;
		try {
			while (session.pendingRevision && session === this._session) {
				session.revision = session.pendingRevision;
				session.pendingRevision = undefined;
				const fingerprintBefore = session.command ? await this._fingerprint(session) : undefined;
				await this._prepareWorktree(session);
				if (session.command && fingerprintBefore !== await this._fingerprint(session)) {
					session.busy = false;
					await this._restartServer(session);
					session.busy = true;
				} else if (session.headModel) {
					// Dev servers reload on their own; reload anyway for those that do not.
					const headModel = session.headModel;
					this._setStep(session, undefined);
					session.store.add(disposableTimeout(() => headModel.reload().catch(() => { /* the tab is gone */ }), 1000));
				}
			}
		} catch (error) {
			this._fail(session, error);
		} finally {
			session.busy = false;
		}
	}

	private async _fingerprint(session: IMirrorSession): Promise<string | undefined> {
		const cwd = session.command?.cwd ? joinPath(session.worktree, session.command.cwd) : session.worktree;
		const plan = await this._installPlan(session, cwd);
		if (!plan) {
			return undefined;
		}
		try {
			return (await this._fileService.readFile(plan.fingerprint)).value.toString();
		} catch {
			return undefined;
		}
	}

	// -- Start command -----------------------------------------------------------------------

	/** The command of the terminal whose output shows the address of the live site. */
	private async _detectFromTerminals(port: number): Promise<{ command: string; cwd: URI | undefined } | undefined> {
		for (const instance of this._terminalService.instances) {
			if (this._ownTerminals.has(instance) || !instance.xterm) {
				continue;
			}
			let found = false;
			let count = 0;
			for (const line of instance.xterm.getBufferReverseIterator()) {
				if (lineMentionsPort(line, port)) {
					found = true;
					break;
				}
				if (++count >= 2000) {
					break;
				}
			}
			if (!found) {
				continue;
			}
			const detection = instance.capabilities.get(TerminalCapability.CommandDetection);
			const command = detection?.executingCommand?.trim() || detection?.commands.at(-1)?.command.trim() || extractShellCommand(instance.shellLaunchConfig.args);
			if (!command) {
				continue;
			}
			let cwd: URI | undefined;
			try {
				cwd = await instance.getCwdResource();
			} catch {
				cwd = undefined;
			}
			return { command, cwd };
		}
		return undefined;
	}

	private _pickRepository(hint: URI | undefined): ISCMRepository | undefined {
		const repositories = [...this._scmService.repositories].filter(repository => repository.provider.providerId === 'git' && repository.provider.rootUri);
		if (hint) {
			const containing = repositories
				.filter(repository => isEqualOrParent(hint, repository.provider.rootUri!))
				.sort((a, b) => b.provider.rootUri!.path.length - a.provider.rootUri!.path.length);
			if (containing.length) {
				return containing[0];
			}
		}
		if (repositories.length <= 1) {
			return repositories[0];
		}
		const folder = this._workspaceContextService.getWorkspace().folders[0]?.uri;
		return (folder && repositories.find(repository => isEqualOrParent(folder, repository.provider.rootUri!) || isEqualOrParent(repository.provider.rootUri!, folder))) || repositories[0];
	}

	private _rememberedCommand(repoRoot: URI): IStartCommand | undefined {
		try {
			const value: unknown = JSON.parse(this._storageService.get(commandStorageKey(repoRoot), StorageScope.WORKSPACE) ?? 'null');
			if (typeof value === 'object' && value !== null) {
				const { line, cwd } = value as Record<string, unknown>;
				if (typeof line === 'string' && line.trim() && typeof cwd === 'string') {
					return { line, cwd };
				}
			}
		} catch {
			// Ask again.
		}
		return undefined;
	}

	private _rememberCommand(repoRoot: URI, command: IStartCommand): void {
		this._storageService.store(commandStorageKey(repoRoot), JSON.stringify(command), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private async _guessCommand(repoRoot: URI): Promise<IStartCommand | undefined> {
		try {
			const names = ((await this._fileService.resolve(repoRoot)).children ?? []).map(child => child.name);
			const packageJson = joinPath(repoRoot, 'package.json');
			const manager = detectPackageManager(names, await this._packageManagerField(packageJson));
			const line = guessStartCommand(await this._readScripts(packageJson), manager);
			return line ? { line, cwd: '' } : undefined;
		} catch {
			return undefined;
		}
	}

	private async _askCommand(repoRoot: URI, current: IStartCommand | undefined): Promise<IStartCommand | undefined> {
		const value = await this._quickInputService.input({
			value: current?.line ?? '',
			placeHolder: 'npm run dev',
			prompt: localize('jeffDesign.mirror.commandPrompt', "Command that starts your site. It runs in a copy of the last commit, from the folder of the repository."),
			validateInput: async text => text.trim() ? undefined : localize('jeffDesign.mirror.commandRequired', "Enter the command that starts your site, such as npm run dev"),
		});
		if (!value?.trim()) {
			return undefined;
		}
		const command: IStartCommand = { line: value.trim(), cwd: current?.cwd ?? '' };
		this._rememberCommand(repoRoot, command);
		return command;
	}

	// -- Processes ---------------------------------------------------------------------------

	private _shellPath(resource: URI): string {
		return resource.scheme === Schemas.file ? resource.fsPath : resource.path;
	}

	private _quote(session: IMirrorSession, value: string): string {
		return session.os === 'windows' ? quoteWindowsArg(value) : quotePosixArg(value);
	}

	/** Runs a command line in a hidden terminal and resolves with its exit code. */
	private async _runHidden(session: IMirrorSession, commandLine: string, cwd: URI, appendToLog: boolean): Promise<number | undefined> {
		const line = appendToLog ? `${commandLine} >> ${this._quote(session, this._shellPath(session.logFile))} 2>&1` : commandLine;
		const invocation = shellInvocation(session.os, line);
		const terminal = await this._terminalService.createTerminal({
			config: {
				name: 'JeffCode Mirror',
				executable: invocation.executable,
				args: invocation.args,
				cwd,
				hideFromUser: true,
				isFeatureTerminal: true,
			},
		});
		this._ownTerminals.add(terminal);
		try {
			return await this._waitForExit(terminal, 10 * minute);
		} finally {
			this._ownTerminals.delete(terminal);
			terminal.dispose();
		}
	}

	private _waitForExit(terminal: ITerminalInstance, timeout: number): Promise<number | undefined> {
		return new Promise<number | undefined>(resolve => {
			const store = new DisposableStore();
			const done = (code: number | undefined) => {
				store.dispose();
				resolve(code);
			};
			store.add(terminal.onExit(exit => done(typeof exit === 'number' ? exit : undefined)));
			store.add(terminal.onDisposed(() => done(undefined)));
			store.add(disposableTimeout(() => done(undefined), timeout));
		});
	}

	override dispose(): void {
		this._session = undefined;
		super.dispose();
	}
}

registerSingleton(IDesignMirrorService, DesignMirrorService, InstantiationType.Delayed);
