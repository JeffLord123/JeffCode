/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JeffCode contributors. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	detectPackageManager,
	extractShellCommand,
	findPortConflict,
	findServerUrl,
	guessStartCommand,
	installCommand,
	isLocalDevUrl,
	isPortPrompt,
	isSafeGitRef,
	lineMentionsPort,
	mapMirrorUrl,
	MirrorPackageManager,
	planMirrorCommand,
	projectNodeVersion,
	quotePosixArg,
	quoteWindowsArg,
	replacePortInSource,
	sanitizeFolderName,
	shellInvocation,
	withNodeVersionManager,
} from '../../common/designMirrorCommand.js';

suite('JeffDesign - designMirrorCommand', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detectPackageManager reads the packageManager field, then lockfiles', () => {
		const cases: [readonly string[], string | undefined][] = [
			[['package.json', 'pnpm-lock.yaml'], undefined],
			[['yarn.lock'], undefined],
			[['bun.lockb'], undefined],
			[['bun.lock'], undefined],
			[['package-lock.json'], undefined],
			[['package.json'], undefined],
			[['yarn.lock'], 'pnpm@9.12.0'],
			[['package-lock.json'], 'yarn@4.5.0+sha512.abc'],
			[['pnpm-lock.yaml'], 'unknown@1'],
		];
		assert.deepStrictEqual(cases.map(([files, field]) => detectPackageManager(files, field)), ['pnpm', 'yarn', 'bun', 'bun', 'npm', 'npm', 'pnpm', 'yarn', 'pnpm']);
	});

	test('installCommand and guessStartCommand', () => {
		const managers: MirrorPackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
		assert.deepStrictEqual(managers.map(installCommand), ['npm install --no-audit --no-fund', 'pnpm install', 'yarn install', 'bun install']);
		assert.deepStrictEqual([
			guessStartCommand({ build: 'vite build', dev: 'vite', start: 'node server.js' }, 'npm'),
			guessStartCommand({ start: 'react-scripts start' }, 'npm'),
			guessStartCommand({ start: 'next start' }, 'pnpm'),
			guessStartCommand({ serve: 'vue-cli-service serve' }, 'yarn'),
			guessStartCommand({ develop: 'gatsby develop' }, 'bun'),
			guessStartCommand({ build: 'tsc' }, 'npm'),
			guessStartCommand(undefined, 'npm'),
		], ['npm run dev', 'npm start', 'pnpm run start', 'yarn run serve', 'bun run develop', undefined, undefined]);
	});

	test('planMirrorCommand passes the port to package manager scripts', () => {
		const scripts = {
			dev: 'vite',
			start: 'react-scripts start',
			'dev:port': 'vite --port 5173',
			'dev:eq': 'vite --port=5173 --host',
			next: 'next dev -p 3000',
			nuxt: 'nuxi dev',
			ng: 'ng serve --open',
			env: 'cross-env NODE_ENV=development webpack serve --config webpack.dev.js',
			dotenv: 'dotenv -e .env.local -- next dev',
			both: 'vite & node api.js',
			chain: 'npm run build && vite preview',
			concurrent: 'concurrently "vite" "node api.js"',
			turbo: 'turbo run dev',
			craPort: 'cross-env PORT=4000 react-scripts start',
			node: 'node server.js',
			nodePort: 'PORT=4000 node server.js',
			outer: 'npm run inner',
			inner: 'astro dev',
			outerPort: 'pnpm run innerPort',
			innerPort: 'astro dev --port 4321',
			django: 'python manage.py runserver 0.0.0.0:8000',
		};
		const commands = [
			'npm run dev',
			'npm run dev -- --host',
			'npm start',
			'pnpm dev',
			'pnpm run dev',
			'yarn dev',
			'yarn run dev',
			'bun run dev',
			'npm run dev:port',
			'pnpm run dev:eq',
			'npm run next',
			'npm run nuxt',
			'npm run ng',
			'npm run env',
			'npm run dotenv',
			'npm run both',
			'npm run chain',
			'npm run concurrent',
			'npm run turbo',
			'npm run craPort',
			'npm run node',
			'npm run nodePort',
			'npm run outer',
			'npm run outerPort',
			'npm run django',
			'npm run missing',
			'npm run dev -- --port 5173',
			'yarn dev --port=5173',
			'cd web && npm run dev',
		];
		assert.deepStrictEqual(commands.map(command => planMirrorCommand(command, 5174, scripts)), [
			{ commandLine: 'npm run dev -- --port 5174' },
			{ commandLine: 'npm run dev -- --host --port 5174' },
			{ commandLine: 'npm start' },
			{ commandLine: 'pnpm dev --port 5174' },
			{ commandLine: 'pnpm run dev --port 5174' },
			{ commandLine: 'yarn dev --port 5174' },
			{ commandLine: 'yarn run dev --port 5174' },
			{ commandLine: 'bun run dev --port 5174' },
			{ commandLine: 'npm run dev:port', scriptPatch: { name: 'dev:port', value: 'vite --port 5174' } },
			{ commandLine: 'pnpm run dev:eq', scriptPatch: { name: 'dev:eq', value: 'vite --port=5174 --host' } },
			{ commandLine: 'npm run next', scriptPatch: { name: 'next', value: 'next dev -p 5174' } },
			{ commandLine: 'npm run nuxt -- --port 5174' },
			{ commandLine: 'npm run ng -- --port 5174' },
			{ commandLine: 'npm run env -- --port 5174' },
			{ commandLine: 'npm run dotenv -- --port 5174' },
			{ commandLine: 'npm run both' },
			{ commandLine: 'npm run chain' },
			{ commandLine: 'npm run concurrent' },
			{ commandLine: 'npm run turbo' },
			{ commandLine: 'npm run craPort', scriptPatch: { name: 'craPort', value: 'cross-env PORT=5174 react-scripts start' } },
			{ commandLine: 'npm run node' },
			{ commandLine: 'npm run nodePort', scriptPatch: { name: 'nodePort', value: 'PORT=5174 node server.js' } },
			{ commandLine: 'npm run outer', scriptPatch: { name: 'inner', value: 'astro dev --port 5174' } },
			{ commandLine: 'npm run outerPort', scriptPatch: { name: 'innerPort', value: 'astro dev --port 5174' } },
			{ commandLine: 'npm run django', scriptPatch: { name: 'django', value: 'python manage.py runserver 0.0.0.0:5174' } },
			{ commandLine: 'npm run missing' },
			{ commandLine: 'npm run dev -- --port 5174' },
			{ commandLine: 'yarn dev --port=5174' },
			{ commandLine: 'cd web && npm run dev -- --port 5174' },
		]);
	});

	test('planMirrorCommand adapts development servers run directly', () => {
		const commands = [
			'vite',
			'npx vite --host',
			'pnpm exec vite --port 3000',
			'pnpm vite',
			'npx next dev',
			'next dev -p 3000',
			'ng serve',
			'npx webpack serve --port=8080',
			'node_modules/.bin/vite.cmd',
			'vite build',
			'react-scripts start',
			'PORT=3000 react-scripts start',
			'npx http-server ./public -p 8080',
			'live-server --port=8080',
			'python -m http.server',
			'python3 -m http.server 8000 --bind 127.0.0.1',
			'python manage.py runserver',
			'python manage.py runserver 8000',
			'./manage.py runserver [::]:8000',
			'flask run',
			'python -m flask run -p 5000',
			'uvicorn main:app --reload',
			'poetry run uvicorn main:app --port 8000',
			'php -S localhost:8000 -t public',
			'php artisan serve',
			'php artisan serve --port=8000',
			'rails s',
			'bin/rails server -p 3000',
			'bundle exec rails s',
			'hugo server -D',
			'bundle exec jekyll serve',
			'jekyll serve -P 4000',
			'node server.js',
			'docker compose up',
			'vite | tee log.txt',
		];
		assert.deepStrictEqual(commands.map(command => planMirrorCommand(command, 5174, undefined).commandLine), [
			'vite --port 5174',
			'npx vite --host --port 5174',
			'pnpm exec vite --port 5174',
			'pnpm vite --port 5174',
			'npx next dev --port 5174',
			'next dev -p 5174',
			'ng serve --port 5174',
			'npx webpack serve --port=5174',
			'node_modules/.bin/vite.cmd --port 5174',
			'vite build',
			'react-scripts start',
			'PORT=5174 react-scripts start',
			'npx http-server ./public -p 5174',
			'live-server --port=5174',
			'python -m http.server 5174',
			'python3 -m http.server 5174 --bind 127.0.0.1',
			'python manage.py runserver 5174',
			'python manage.py runserver 5174',
			'./manage.py runserver [::]:5174',
			'flask run --port 5174',
			'python -m flask run -p 5174',
			'uvicorn main:app --reload --port 5174',
			'poetry run uvicorn main:app --port 5174',
			'php -S localhost:5174 -t public',
			'php artisan serve --port=5174',
			'php artisan serve --port=5174',
			'rails s -p 5174',
			'bin/rails server -p 5174',
			'bundle exec rails s -p 5174',
			'hugo server -D --port 5174',
			'bundle exec jekyll serve --port 5174',
			'jekyll serve -P 5174',
			'node server.js',
			'docker compose up',
			'vite | tee log.txt',
		]);
	});

	test('findServerUrl reads the address announced by development servers', () => {
		const ports = { chosenPort: 5174, livePort: 5173 };
		const lines = [
			'  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5174\x1b[22m/\x1b[39m',
			'  ➜  Network: use --host to expose',
			'   - Local:        http://localhost:5175',
			'  Local:            http://localhost:5176',
			'** Angular Live Development Server is listening on localhost:5177, open your browser on http://localhost:5177/ **',
			'Starting development server at http://127.0.0.1:5174/',
			'* Listening on http://[::1]:5174',
			'Serving HTTP on 0.0.0.0 port 5174 (http://0.0.0.0:5174/) ...',
			'INFO:     Uvicorn running on http://[::]:5178 (Press CTRL+C to quit)',
			'  ➜  Local:   http://localhost:5173/',
			'[HPM] Proxy created: /api  -> http://localhost:5174',
			'GET http://localhost:8080/api/users 200',
			'Visit https://localhost:5174/docs',
			'Port 5173 is in use, trying another one...',
		];
		assert.deepStrictEqual(lines.map(line => findServerUrl(line, ports)), [
			'http://localhost:5174',
			undefined,
			'http://localhost:5175',
			'http://localhost:5176',
			'http://localhost:5177',
			'http://127.0.0.1:5174',
			'http://[::1]:5174',
			'http://localhost:5174',
			'http://localhost:5178',
			undefined,
			undefined,
			undefined,
			'https://localhost:5174',
			undefined,
		]);
	});

	test('isPortPrompt and lineMentionsPort', () => {
		assert.deepStrictEqual([
			'? Would you like to run the app on another port instead? › (Y/n)',
			'Would you like to use a different port? (Y/n)',
			'? Something is already running at port 8000\nWould you like to run the app at another port instead? › (Y/n)',
			'Port 5173 is in use, trying another one...',
			'Something is already running on port 3000.',
		].map(isPortPrompt), [true, true, true, false, false]);
		assert.deepStrictEqual([
			'  ➜  Local:   http://localhost:5173/',
			'ready - started server on 0.0.0.0:5173, url: http://localhost:5173',
			'Listening on http://127.0.0.1:51730',
			'Listening on http://[::1]:5173',
			'GET /api 200 in 5173ms',
		].map(line => lineMentionsPort(line, 5173)), [true, true, false, true, false]);
	});

	test('mapMirrorUrl moves URLs between the live site and the copy', () => {
		assert.deepStrictEqual([
			mapMirrorUrl('http://localhost:5173/a/b?x=1#y', 'http://localhost:5173', 'http://localhost:5174'),
			mapMirrorUrl('http://localhost:5174/', 'http://localhost:5174', 'http://127.0.0.1:5173'),
			mapMirrorUrl('http://localhost:3000/a', 'http://localhost:5173', 'http://localhost:5174'),
			mapMirrorUrl('https://example.com/a', 'http://localhost:5173', 'http://localhost:5174'),
			mapMirrorUrl('file:///C:/dev/site/pages/index.html?x#top', 'file:///c:/dev/site', 'file:///C:/Users/me/.jeffcode/mirror/site-1a2b'),
			mapMirrorUrl('file:///C:/Dev/Site/a%20b.html', 'file:///c:/dev/site', 'file:///C:/mirror/site'),
			mapMirrorUrl('file:///home/me/site/index.html', 'file:///home/me/site', 'file:///home/me/.jeffcode/mirror/site'),
			mapMirrorUrl('file:///home/me/site2/index.html', 'file:///home/me/site', 'file:///home/me/.jeffcode/mirror/site'),
			mapMirrorUrl('not a url', 'http://localhost:5173', 'http://localhost:5174'),
		], [
			'http://localhost:5174/a/b?x=1#y',
			'http://127.0.0.1:5173/',
			undefined,
			undefined,
			'file:///C:/Users/me/.jeffcode/mirror/site-1a2b/pages/index.html?x#top',
			'file:///C:/mirror/site/a%20b.html',
			'file:///home/me/.jeffcode/mirror/site/index.html',
			undefined,
			undefined,
		]);
	});

	test('isLocalDevUrl accepts local and private addresses only', () => {
		const urls = [
			'http://localhost:5173/',
			'https://app.localhost:3000',
			'http://127.0.0.1:8000',
			'http://127.4.5.6',
			'http://0.0.0.0:3000',
			'http://[::1]:3000',
			'http://10.0.0.12:8080',
			'http://172.20.1.1',
			'http://192.168.1.20:4200',
			'http://172.32.0.1',
			'https://example.com',
			'file:///C:/site/index.html',
			'about:blank',
		];
		assert.deepStrictEqual(urls.map(isLocalDevUrl), [true, true, true, true, true, true, true, true, true, false, false, false, false]);
	});

	test('quoting and shell invocation', () => {
		assert.deepStrictEqual([
			quoteWindowsArg('C:\\dev\\site'),
			quoteWindowsArg('C:\\Users\\Jean Dupont\\.jeffcode'),
			quoteWindowsArg('C:\\with space\\'),
			quotePosixArg('/home/me/site'),
			quotePosixArg('/home/me/my site'),
			quotePosixArg('it\'s'),
		], [
			'C:\\dev\\site',
			'"C:\\Users\\Jean Dupont\\.jeffcode"',
			'"C:\\with space\\\\"',
			'/home/me/site',
			'\'/home/me/my site\'',
			'\'it\'\\\'\'s\'',
		]);
		assert.deepStrictEqual([
			shellInvocation('windows', 'npm run dev -- --port 5174'),
			shellInvocation('posix', 'npm run dev -- --port 5174'),
		], [
			{ executable: 'cmd.exe', args: '/d /s /c "npm run dev -- --port 5174"' },
			{ executable: '/bin/sh', args: ['-c', 'npm run dev -- --port 5174'] },
		]);
	});

	test('projectNodeVersion and withNodeVersionManager', () => {
		assert.deepStrictEqual([
			projectNodeVersion({ nvmrc: '# comment\n\nv24.16.0\n', engines: '20' }),
			projectNodeVersion({ nodeVersion: 'lts/iron' }),
			projectNodeVersion({ engines: '24.22.3' }),
			projectNodeVersion({ engines: '^22.1' }),
			projectNodeVersion({ engines: '24.x' }),
			projectNodeVersion({ engines: '>=20' }),
			projectNodeVersion({ engines: '20 || 22' }),
			projectNodeVersion({ nvmrc: 'rm -rf /' }),
			projectNodeVersion({}),
		], ['v24.16.0', 'lts/iron', '24', '22', '24', undefined, undefined, undefined, undefined]);
		assert.deepStrictEqual([
			withNodeVersionManager('posix', 'pnpm dev lmp', '24'),
			withNodeVersionManager('posix', 'pnpm dev', undefined),
			withNodeVersionManager('windows', 'pnpm dev', '24'),
		], [
			'if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1; nvm use 24; fi; pnpm dev lmp',
			'if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1; fi; pnpm dev',
			'pnpm dev',
		]);
	});

	test('findPortConflict and replacePortInSource', () => {
		const root = '/Users/me/.jeffcode/mirror/front-abc';
		const output = [
			'node:events:487',
			'Error: listen EADDRINUSE: address already in use :::4111',
			'    at Server.setupListenHandle [as _listen2] (node:net:2008:16)',
			`    at generatePlatformProxyConfig (file://${root}/configs/vite-config/src/plugins/proxy.ts:113:10)`,
			`    at BasicMinimalPluginContext.config (file://${root}/configs/vite-config/src/plugins/proxy.ts:153:36)`,
			`    at runConfigHook (file://${root}/node_modules/.pnpm/vite@8.3.5/node_modules/vite/dist/node/chunks/node.js:38288:42)`,
			`    at ${root}/apps/lmp/server%20dev.mjs:4:1`,
			'  code: \'EADDRINUSE\',',
			'  port: 4111',
		];
		const windowsRoot = 'C:\\Users\\me\\.jeffcode\\mirror\\front-abc';
		assert.deepStrictEqual([
			findPortConflict(output, root),
			findPortConflict(output, `${root}/`),
			findPortConflict(['Error: listen EADDRINUSE: address already in use 127.0.0.1:3000', '    at file:///c:/Users/me/.jeffcode/mirror/front-abc/server.js:3:5'], windowsRoot),
			findPortConflict(['Error: listen EADDRINUSE: address already in use :::4111', '    at Server.listen (node:net:2170:7)'], root),
			findPortConflict([`    at x (${root}/a.ts:1:1)`], root),
		], [
			{ port: 4111, files: ['configs/vite-config/src/plugins/proxy.ts', 'apps/lmp/server dev.mjs'] },
			{ port: 4111, files: ['configs/vite-config/src/plugins/proxy.ts', 'apps/lmp/server dev.mjs'] },
			{ port: 3000, files: ['server.js'] },
			undefined,
			undefined,
		]);
		assert.strictEqual(
			replacePortInSource('const port = 4111; listen(4111); const url = `http://localhost:4111/api`; const other = 14111 + 4111.5;', 4111, 4112),
			'const port = 4112; listen(4112); const url = `http://localhost:4112/api`; const other = 14111 + 4111.5;',
		);
	});

	test('isSafeGitRef', () => {
		assert.deepStrictEqual(
			['main', 'origin/feature/x', 'v1.2.0', 'a1b2c3d', 'HEAD~2', 'main^{commit}', '-x', 'a..b', 'a b', 'a;rm', '$(x)', ''].map(isSafeGitRef),
			[true, true, true, true, true, false, false, false, false, false, false, false],
		);
	});

	test('sanitizeFolderName and extractShellCommand', () => {
		assert.deepStrictEqual(['My Site!', 'café-app', '...', 'a/b\\c', 'x'.repeat(60)].map(sanitizeFolderName), ['My-Site', 'cafe-app', 'site', 'a-b-c', 'x'.repeat(48)]);
		assert.deepStrictEqual([
			extractShellCommand('/d /c npm run dev'),
			extractShellCommand('-Command npm run dev'),
			extractShellCommand(['-l', '-c', 'pnpm dev']),
			extractShellCommand(['-NoProfile']),
			extractShellCommand(undefined),
		], ['npm run dev', 'npm run dev', 'pnpm dev', undefined, undefined]);
	});
});
