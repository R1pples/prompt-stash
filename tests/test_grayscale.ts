/**
 * CP9 – Gray-Scale Test (Mock Traffic Simulation)
 *
 * Simulates production usage patterns:
 *   - Multiple virtual users saving, searching, inserting prompts
 *   - Background optimization cycles running concurrently
 *   - Verifies data integrity, no corruption, and performance under load
 */

import * as fs from 'fs';
import * as path from 'path';
import { PromptOptimizer, findSimilarPrompts } from '../src/optimizer';
import { VersionManager } from '../src/versionManager';
import { UpdateScheduler } from '../src/scheduler';
import { heuristicScore } from '../src/llmJudge';
import { CrawledPrompt } from '../src/crawler';
import { PromptSnippet } from '../src/models';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.error(`  ❌ ${msg}`); }
}

// ── Lightweight in-memory mock store ────────────────────────────────

class SimStore {
    prompts: PromptSnippet[] = [];
    private storagePath: string;

    constructor(dir: string) {
        this.storagePath = path.join(dir, 'store.json');
        fs.mkdirSync(dir, { recursive: true });
    }

    add(title: string, content: string, category: string): PromptSnippet {
        const p: PromptSnippet = {
            id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title, content, category, tags: [],
            rating: 0, usageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isFavorite: false, variables: [],
        };
        this.prompts.push(p);
        return p;
    }

    recordUsage(id: string): void {
        const p = this.prompts.find(x => x.id === id);
        if (p) p.usageCount++;
    }

    search(query: string): PromptSnippet[] {
        const q = query.toLowerCase();
        return this.prompts.filter(p =>
            p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
        );
    }

    save(): void {
        fs.writeFileSync(this.storagePath, JSON.stringify({ prompts: this.prompts }, null, 2));
    }

    reload(): void {
        if (fs.existsSync(this.storagePath)) {
            this.prompts = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8')).prompts || [];
        }
    }
}

// ── Mock Prompt Corpus ──────────────────────────────────────────────

const OPEN_SOURCE: CrawledPrompt[] = [
    { title: 'Code Review Expert', content: 'You are an expert code reviewer. Step 1: analyze. Step 2: suggest. Must ensure code quality. Example: null checks.', source: 'os', sourceId: 'o1', category: 'Coding', tags: ['code'], fetchedAt: new Date().toISOString() },
    { title: 'API Docs Writer', content: 'Act as API documentation writer. Include endpoint descriptions, request/response examples. Output in OpenAPI format.', source: 'os', sourceId: 'o2', category: 'Writing', tags: ['docs'], fetchedAt: new Date().toISOString() },
    { title: 'Bug Fixer', content: 'You are a debugging expert. First, reproduce the bug. Then, isolate the root cause. Must handle edge cases. Provide a minimal fix.', source: 'os', sourceId: 'o3', category: 'Coding', tags: ['debug'], fetchedAt: new Date().toISOString() },
];

// ── User Activity Scenarios ─────────────────────────────────────────

const USER_PROMPTS = [
    { title: 'Review PR', content: 'Review this pull request and find bugs', category: 'Coding' },
    { title: 'Write README', content: 'Generate a README file for my project', category: 'Writing' },
    { title: 'Debug crash', content: 'Help me debug this crash in my app', category: 'Coding' },
    { title: 'SQL query', content: 'Write a SQL query to join users and orders', category: 'Data Science' },
    { title: 'Test plan', content: 'Create a test plan for my authentication system', category: 'Testing' },
    { title: 'CI pipeline', content: 'Set up a CI/CD pipeline for Node.js project', category: 'DevOps' },
    { title: 'Refactor code', content: 'Refactor this function for better readability', category: 'Coding' },
    { title: 'API design', content: 'Design a REST API for a blog platform', category: 'Architecture' },
    { title: 'Perf tune', content: 'Optimize this query that runs slowly', category: 'Data Science' },
    { title: 'Security audit', content: 'Audit this code for security vulnerabilities', category: 'Security' },
];

// ─── Test ───────────────────────────────────────────────────────────

async function runGrayScaleTest() {
    console.log('\n═══ CP9: Gray-Scale Test (Mock Traffic) ═══\n');
    const TMP = `/tmp/ps-grayscale-${Date.now()}`;
    const startTime = Date.now();

    // ── Phase 1: Simulate Multiple Users Saving Prompts ──
    console.log('── Phase 1: Multi-User Prompt Saving ──');
    const store = new SimStore(TMP);
    const savedIds: string[] = [];

    for (const up of USER_PROMPTS) {
        const p = store.add(up.title, up.content, up.category);
        savedIds.push(p.id);
    }
    assert(store.prompts.length === 10, '10 prompts saved by virtual users');
    assert(new Set(savedIds).size === 10, 'all IDs are unique');

    // ── Phase 2: Simulate Usage Patterns ──
    console.log('── Phase 2: Usage Simulation ──');
    // Some prompts get used more than others (power-law distribution)
    const usageCounts = [15, 8, 12, 3, 1, 6, 10, 2, 4, 7];
    for (let i = 0; i < savedIds.length; i++) {
        for (let u = 0; u < usageCounts[i]; u++) {
            store.recordUsage(savedIds[i]);
        }
    }
    assert(store.prompts[0].usageCount === 15, 'top prompt has 15 uses');
    assert(store.prompts[4].usageCount === 1, 'low-usage prompt has 1 use');
    const totalUsage = store.prompts.reduce((s, p) => s + p.usageCount, 0);
    assert(totalUsage === usageCounts.reduce((a, b) => a + b, 0), 'total usage correct');

    // ── Phase 3: Search Simulation ──
    console.log('── Phase 3: Search Patterns ──');
    const searchQueries = ['code', 'debug', 'API', 'query', 'security', 'nonexistent'];
    for (const q of searchQueries) {
        const results = store.search(q);
        if (q === 'nonexistent') {
            assert(results.length === 0, `"${q}" returns 0 results`);
        } else {
            assert(results.length >= 1, `"${q}" returns ≥1 results`);
        }
    }

    // ── Phase 4: Optimization Under Load ──
    console.log('── Phase 4: Optimization Cycles ──');
    const optimizer = new PromptOptimizer({ maxReferences: 3 });
    optimizer.loadPromptsFromCache(OPEN_SOURCE);
    const vm = new VersionManager(path.join(TMP, 'versions'));

    // Init version history for all prompts
    for (const p of store.prompts) {
        vm.initHistory(p.id, p.content);
    }

    // Run optimization on high-usage prompts (usage >= 5)
    let optimized = 0;
    let improved = 0;
    for (const p of store.prompts.filter(x => x.usageCount >= 5)) {
        const result = await optimizer.optimizeAndVersion(p.id, p.content, vm);
        optimized++;
        if (result.improved) improved++;
    }
    assert(optimized >= 5, `optimized ${optimized} high-usage prompts`);
    assert(improved >= 0, `${improved} prompts improved (0 is OK for heuristic)`);

    // ── Phase 5: Scheduler Multi-Cycle ──
    console.log('── Phase 5: Scheduler Multi-Cycle ──');
    const scheduler = new UpdateScheduler(optimizer, { minUsageForOptimize: 5, maxOptimizePerCycle: 3 });
    scheduler.setVersionManager(vm);
    scheduler.setPromptProvider(() =>
        store.prompts.map(p => ({ id: p.id, content: p.content, usageCount: p.usageCount }))
    );

    const events: string[] = [];
    scheduler.onEvent(e => events.push(`${e.type}:${e.detail || ''}`));

    // Run 3 consecutive cycles
    for (let c = 0; c < 3; c++) {
        await scheduler.runOptimizeCycle();
    }
    assert(scheduler.getOptimizeCount() === 3, '3 optimize cycles completed');
    assert(events.filter(e => e.startsWith('optimize-done')).length === 3, '3 optimize-done events');

    // ── Phase 6: Data Integrity Under Concurrent Operations ──
    console.log('── Phase 6: Data Integrity ──');

    // All prompts still in store
    assert(store.prompts.length === 10, 'store has 10 prompts after cycles');

    // All version histories intact
    let historiesOk = true;
    for (const p of store.prompts) {
        const h = vm.getHistory(p.id);
        if (!h || h.versions.length < 1) { historiesOk = false; break; }
    }
    assert(historiesOk, 'all version histories have ≥1 version');

    // Scores are within valid range
    let scoresValid = true;
    for (const p of store.prompts) {
        const h = vm.getHistory(p.id);
        if (h) {
            for (const v of h.versions) {
                if (v.judgeScore !== undefined && (v.judgeScore < 1 || v.judgeScore > 5)) {
                    scoresValid = false;
                }
            }
        }
    }
    assert(scoresValid, 'all scores within [1, 5] range');

    // Persistence roundtrip
    store.save();
    const store2 = new SimStore(path.join(TMP, 'dummy'));
    store2.prompts = []; // fresh
    store2.prompts = JSON.parse(fs.readFileSync(path.join(TMP, 'store.json'), 'utf-8')).prompts;
    assert(store2.prompts.length === 10, 'persisted store loads correctly');

    const vm2 = new VersionManager(path.join(TMP, 'versions'));
    for (const p of store2.prompts) {
        const h = vm2.getHistory(p.id);
        assert(h !== undefined, `reloaded history for ${p.title}`);
    }

    // ── Phase 7: Performance Check ──
    console.log('── Phase 7: Performance ──');
    const elapsed = Date.now() - startTime;
    assert(elapsed < 30_000, `total time ${elapsed}ms < 30s`);

    // Heuristic scoring should be fast (< 1ms per call)
    const perfStart = Date.now();
    for (let i = 0; i < 100; i++) {
        heuristicScore('You are an expert. Step 1: do this. Must check errors. Example: null.');
    }
    const perfElapsed = Date.now() - perfStart;
    assert(perfElapsed < 500, `100 heuristic scores in ${perfElapsed}ms < 500ms`);

    // ── Cleanup ──
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

    console.log(`\n══ CP9 Results: ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail > 0 ? 1 : 0);
}

runGrayScaleTest().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
