/**
 * PromptStash - Unit Tests for Version Manager (CP4)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { VersionManager } from '../src/versionManager';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e: any) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

const TEST_DIR = path.join(__dirname, '.test_versions');
const TEST_FILE = path.join(TEST_DIR, 'versions.json');

function setup(): VersionManager {
    if (fs.existsSync(TEST_DIR)) { fs.rmSync(TEST_DIR, { recursive: true }); }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    return new VersionManager(TEST_FILE);
}
function teardown() { if (fs.existsSync(TEST_DIR)) { fs.rmSync(TEST_DIR, { recursive: true }); } }

console.log('\n🧪 PromptStash Version Manager Unit Tests (CP4)\n' + '='.repeat(50));

// ── Init & Basic Versioning ─────────────────────────────────────────
console.log('\n📋 Init & Basic Versioning');
{
    const vm = setup();

    test('initHistory creates v1', () => {
        const h = vm.initHistory('p1', 'Original prompt content');
        assert.strictEqual(h.versions.length, 1);
        assert.strictEqual(h.versions[0].version, 1);
        assert.strictEqual(h.versions[0].content, 'Original prompt content');
        assert.strictEqual(h.recommendedVersion, 1);
    });

    test('initHistory is idempotent', () => {
        const h = vm.initHistory('p1', 'Different content');
        assert.strictEqual(h.versions.length, 1); // not duplicated
        assert.strictEqual(h.versions[0].content, 'Original prompt content'); // original kept
    });

    test('addVersion creates v2', () => {
        const v = vm.addVersion('p1', 'Improved prompt', { source: 'auto-optimize', changeNote: 'Better structure' });
        assert.ok(v);
        assert.strictEqual(v!.version, 2);
        assert.strictEqual(v!.source, 'auto-optimize');
    });

    test('addVersion creates v3', () => {
        const v = vm.addVersion('p1', 'Even better prompt', { source: 'manual' });
        assert.strictEqual(v!.version, 3);
    });

    test('getVersionCount returns correct count', () => {
        assert.strictEqual(vm.getVersionCount('p1'), 3);
    });

    test('addVersion returns undefined for unknown prompt', () => {
        assert.strictEqual(vm.addVersion('nonexistent', 'x', { source: 'manual' }), undefined);
    });

    teardown();
}

// ── Scoring & Recommendations ───────────────────────────────────────
console.log('\n⭐ Scoring & Recommendations');
{
    const vm = setup();
    vm.initHistory('p1', 'Version 1 content');
    vm.addVersion('p1', 'Version 2 content', { source: 'auto-optimize' });
    vm.addVersion('p1', 'Version 3 content', { source: 'auto-optimize' });

    test('without scores, recommends latest', () => {
        const rec = vm.getRecommendedVersion('p1');
        assert.strictEqual(rec!.version, 3);
    });

    test('setScore updates version score', () => {
        assert.ok(vm.setScore('p1', 1, 3.0));
        assert.ok(vm.setScore('p1', 2, 4.5));
        assert.ok(vm.setScore('p1', 3, 3.8));
    });

    test('recommends highest-scored version', () => {
        const rec = vm.getRecommendedVersion('p1');
        assert.strictEqual(rec!.version, 2); // 4.5 is highest
        assert.strictEqual(rec!.judgeScore, 4.5);
    });

    test('tie-breaking: same score prefers newer version', () => {
        vm.setScore('p1', 3, 4.5); // same as v2
        const rec = vm.getRecommendedVersion('p1');
        assert.strictEqual(rec!.version, 3); // newer
    });

    test('setScore returns false for invalid prompt/version', () => {
        assert.strictEqual(vm.setScore('bad', 1, 5), false);
        assert.strictEqual(vm.setScore('p1', 99, 5), false);
    });

    teardown();
}

// ── Improvement Detection ───────────────────────────────────────────
console.log('\n📈 Improvement Detection');
{
    const vm = setup();
    vm.initHistory('p1', 'V1');

    test('no improvement with single version', () => {
        assert.strictEqual(vm.didImprove('p1'), false);
    });

    test('detects improvement', () => {
        vm.addVersion('p1', 'V2', { source: 'auto-optimize', judgeScore: 4.0 });
        vm.setScore('p1', 1, 3.0);
        assert.strictEqual(vm.didImprove('p1'), true);
    });

    test('detects no improvement (regression)', () => {
        vm.addVersion('p1', 'V3', { source: 'auto-optimize', judgeScore: 2.0 });
        assert.strictEqual(vm.didImprove('p1'), false);
    });

    teardown();
}

// ── Getters ─────────────────────────────────────────────────────────
console.log('\n🔍 Getters');
{
    const vm = setup();
    vm.initHistory('p1', 'V1');
    vm.addVersion('p1', 'V2', { source: 'auto-optimize', inspirationSource: 'github.com/foo' });

    test('getVersion returns correct version', () => {
        const v = vm.getVersion('p1', 2);
        assert.strictEqual(v!.content, 'V2');
        assert.strictEqual(v!.inspirationSource, 'github.com/foo');
    });

    test('getVersion returns undefined for bad version', () => {
        assert.strictEqual(vm.getVersion('p1', 99), undefined);
    });

    test('getLatestVersion returns last', () => {
        const v = vm.getLatestVersion('p1');
        assert.strictEqual(v!.version, 2);
    });

    test('getAllVersions returns array', () => {
        const all = vm.getAllVersions('p1');
        assert.strictEqual(all.length, 2);
    });

    test('getHistory returns full history object', () => {
        const h = vm.getHistory('p1');
        assert.ok(h);
        assert.strictEqual(h!.promptId, 'p1');
    });

    test('getters return undefined/empty for unknown prompt', () => {
        assert.strictEqual(vm.getHistory('bad'), undefined);
        assert.strictEqual(vm.getVersion('bad', 1), undefined);
        assert.strictEqual(vm.getLatestVersion('bad'), undefined);
        assert.deepStrictEqual(vm.getAllVersions('bad'), []);
        assert.strictEqual(vm.getVersionCount('bad'), 0);
    });

    teardown();
}

// ── Delete & Persistence ────────────────────────────────────────────
console.log('\n💾 Delete & Persistence');
{
    if (!fs.existsSync(TEST_DIR)) { fs.mkdirSync(TEST_DIR, { recursive: true }); }

    test('deleteHistory removes entry', () => {
        const vm = setup();
        vm.initHistory('p1', 'V1');
        assert.ok(vm.deleteHistory('p1'));
        assert.strictEqual(vm.getHistory('p1'), undefined);
    });

    test('deleteHistory returns false for unknown', () => {
        const vm = setup();
        assert.strictEqual(vm.deleteHistory('bad'), false);
    });

    test('data persists across instances', () => {
        const f = path.join(TEST_DIR, 'persist_v.json');
        const vm1 = new VersionManager(f);
        vm1.initHistory('p1', 'Persist test');
        vm1.addVersion('p1', 'V2', { source: 'manual' });

        const vm2 = new VersionManager(f);
        assert.strictEqual(vm2.getVersionCount('p1'), 2);
        assert.strictEqual(vm2.getVersion('p1', 2)!.content, 'V2');
    });

    teardown();
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) { console.log('❌ SOME TESTS FAILED'); process.exit(1); }
else { console.log('✅ ALL TESTS PASSED'); }
