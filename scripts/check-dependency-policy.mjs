// This check reads metadata only; it does not install or execute dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [manifest, lock, review, workflow, nodeVersion, assets] = await Promise.all([
  json('package.json'), json('package-lock.json'), json('scripts/dependency-review.json'),
  readFile('.github/workflows/pages.yml', 'utf8'), readFile('.nvmrc', 'utf8'),
  readFile('scripts/runtime-assets.json'),
]);
const checkAge = (id, published) => {
  assert.ok(Number.isFinite(Date.parse(published)), `Missing release date: ${id}`);
  assert.ok(Date.parse(published) <= Date.parse(review.releaseCutoff) || review.securityExceptions[id],
    `${id} is newer than the reviewed cutoff and has no approved security exception`);
};
assert.equal(lock.lockfileVersion, 3);
for (const section of ['dependencies', 'devDependencies']) {
  assert.deepEqual(manifest[section], lock.packages[''][section], `${section} and lockfile differ`);
  for (const [name, version] of Object.entries(manifest[section])) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must use an exact version`);
  }
}
const installed = Object.entries(lock.packages).filter(([path]) => path);
assert.equal(installed.length, review.npm.length, 'Dependency inventory changed; review it before deploying');
for (const [path, pkg] of installed) {
  const name = path.split('node_modules/').at(-1);
  const approved = review.npm.find(item => item.name === name && item.version === pkg.version);
  assert.ok(approved, `Unreviewed package: ${name}@${pkg.version}`);
  assert.equal(pkg.integrity, approved.integrity, `Integrity changed for ${name}`);
  assert.equal(pkg.resolved, approved.resolved, `Download URL changed for ${name}`);
  checkAge(`${name}@${pkg.version}`, approved.published);
}
assert.equal(nodeVersion.trim(), review.node.version);
assert.equal(manifest.packageManager, `npm@${review.node.npm}`);
checkAge(`node@${review.node.version}`, review.node.published);
checkAge(`npm@${review.node.npm}`, review.node.npmPublished);
if (process.env.GITHUB_ACTIONS === 'true') {
  assert.equal(process.versions.node, review.node.version, 'Unexpected CI Node.js version');
  assert.equal(execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), review.node.npm,
    'Unexpected CI npm version');
}
for (const [, name, sha] of workflow.matchAll(/uses:\s*([^\s@]+)@([^\s]+)/g)) {
  assert.match(sha, /^[a-f0-9]{40}$/, `${name} must be pinned to a full commit SHA`);
  assert.equal(sha, review.actions[name]?.sha, `Unreviewed action: ${name}`);
}
for (const [name, pin] of Object.entries(review.actions)) checkAge(`${name}@${pin.version}`, pin.published);
for (const [name, pin] of Object.entries(review.runtimeSources)) checkAge(name, pin.published);
assert.equal(createHash('sha256').update(assets).digest('hex'), review.runtimeManifestSha256,
  'Runtime asset pins changed; review their sources and checksums');
assert.ok(workflow.includes(`ref: ${review.publishing.commit}`), 'Publishing source pin changed');
console.log(`PASS: ${installed.length} locked npm packages, Node/npm, Actions, and runtime pins match the review`);
