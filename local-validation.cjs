// Explicit local-only test/build entry point. Never loads .env or provider secrets.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const fixtures = require('./local-fixtures.cjs');
// Identity/browser tests share only synthetic preview records, but concurrent
// fixture resets can invalidate another test's session or side-effect counts.
if (['unit', 'browser'].includes(process.argv[2])) {
 const lock = path.join(__dirname, '.local-validation.lock');
 if (fs.existsSync(lock)) {
  const prior = JSON.parse(fs.readFileSync(lock, 'utf8'));
  let alive = true; try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) throw Error('Outro teste usa as mesmas fixtures locais. Aguarde terminar antes de iniciar este.');
  fs.unlinkSync(lock);
 }
 fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, mode: process.argv[2] }), { flag: 'wx' });
 process.on('exit', () => { if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock); });
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE)$/i.test(key)));
Object.assign(env, { NODE_ENV: 'test', NEXT_TELEMETRY_DISABLED: '1', CENTRAL_IDENTITY_LOCAL_PREVIEW: 'true', CENTRAL_IDENTITY_ENABLED: 'true', CENTRAL_IDENTITY_SECRET: 'isolated-local-validation-secret-not-for-production-20261021', SESSION_SECRET: 'isolated-local-validation-session-not-for-production-20261021', AUTH_SECRET: 'isolated-local-validation-auth-not-for-production-20261021', ATTENDANCE_PUBLIC_URL: 'http://127.0.0.1:4037', CRM_PUBLIC_URL: 'http://127.0.0.1:4038', AUTH_URL: 'http://127.0.0.1:4038', AUTH_TRUST_HOST: 'true', NODE_OPTIONS: '--require ' + JSON.stringify(path.join(__dirname, 'local-network-guard.cjs')) });
const browserDependencies = [path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'), path.resolve(__dirname, '../backups/performance-csv/node_modules')].find(folder => fs.existsSync(path.join(folder, 'playwright/package.json')));
if (browserDependencies) env.NODE_PATH = browserDependencies;
const run = (args, app, extra = {}) => {
 const cwd = app ? path.join(__dirname, app) : __dirname;
 const result = spawnSync(process.execPath, args, { cwd, env: { ...env, DATABASE_URL: fixtures.database(app === 'crm' ? 'crm' : 'attendance'), ...extra }, stdio: 'inherit', windowsHide: true });
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status || 1);
};
(async () => {
 switch (process.argv[2]) {
  case 'check-db': for (const app of ['attendance', 'crm']) { const p = fixtures.client(app); try { console.log(app + ' synthetic database available; users=' + await p.user.count()); } finally { await p.$disconnect(); } } break;
  case 'unit': run(['--test', '--test-concurrency=1', ...fs.readdirSync(__dirname).filter(file => file.endsWith('.test.cjs'))]); break;
  case 'crm': run(['node_modules/vitest/vitest.mjs', 'run'], 'crm'); break;
  case 'types': run(['node_modules/typescript/bin/tsc', '--noEmit'], 'crm'); break;
  case 'lint': run(['node_modules/eslint/bin/eslint.js', 'src/components/activity-center.tsx', 'src/lib/activity-center.ts', 'src/lib/activity-center-actions.ts', 'src/lib/activity-center-actions.test.ts', 'src/lib/activity-center-rules.ts', 'src/app/api/activity-center/route.ts'], 'crm'); break;
  case 'assets': run(['scripts/build-static-assets.js'], 'attendance'); break;
  case 'browser': {
   const scripts = process.argv.slice(3);
   if (!scripts.length || scripts.some(file => file !== 'test-browser.cjs' && !/^test-[A-Za-z0-9-]+-browser\.cjs$/.test(file))) throw Error('Explicit local browser test filenames required');
   for (const file of scripts) run([file]);
   break;
  }
  case 'attendance':
  case 'attendance-baseline': {
   // Several legacy tests intentionally clear tables. Never point them at
   // the preview schema: use a separate, explicitly named disposable schema.
   const url = new URL(fixtures.database('attendance'));
   if (url.hostname !== '127.0.0.1' || url.port !== '5559' || url.pathname !== '/central_ux_test') throw Error('Non-local test database');
   const baseline = process.argv[2] === 'attendance-baseline';
   url.searchParams.set('schema', baseline ? 'merge_attendance_baseline_20261021' : 'merge_attendance_regression_20261021');
   const isolated = { DATABASE_URL: url.href, CHECKPOINT_DISABLE: '1' };
   const cwd = baseline ? path.resolve(__dirname, '../local-validation-baseline-20261021/attendance') : path.join(__dirname, 'attendance');
   for (const args of [['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], ['prisma/seed.js']]) {
    const result = spawnSync(process.execPath, args, { cwd, env: { ...env, ...isolated }, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
   }
   const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/**/*.test.js'], { cwd, env: { ...env, ...isolated }, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, windowsHide: true });
   const output = (result.stdout || '') + (result.stderr || '');
   fs.writeFileSync(path.join(__dirname, baseline ? 'attendance-baseline.log' : 'attendance-regression.log'), output);
   console.log(output.split(/\r?\n/).filter(line => /^[ℹ✖]|^not ok|^# (tests|pass|fail)/.test(line)).join('\n'));
   if (result.error) throw result.error;
   if (result.status !== 0) process.exit(result.status || 1);
   break;
  }
  case 'build': run(['node_modules/next/dist/bin/next', 'build'], 'crm', { NODE_ENV: 'production', CENTRAL_IDENTITY_VALIDATION_BUILD: 'true' }); break;
  default: throw Error('Choose check-db, unit, crm, types, lint, assets, attendance or build');
 }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
