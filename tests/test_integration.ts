/**
 * CP8 – System Integration Test
 *
 * End-to-end flow:
 *   1. Create a PromptStore and save user prompts
 *   2. Crawler fetches open-source references (mock/real)
 *   3. Optimizer generates improved versions
 *   4. VersionManager stores history with judge scores
 *   5. Scheduler runs one cycle tying it all together
 *   6. Verify data integrity across all layers
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

// ── Minimal in-memory PromptStore mock (avoids vscode dependency) ──

class MockPromptStore {
    private prompts: PromptSnippet[] = [];
    private storagePath: string;

    constructor(dir: string) {
        this.storagePath = path.join(dir, 'prompt-library.json');
        fs.mkdirSync(dir, { recursive: true });
        this.load();
    }

    private load(): void {
        if (fs.existsSync(this.storagePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
                this.prompts = data.prompts || [];
            } catch {}
        }
    }

    private save(): void {
        fs.writeFileSync(this.storagePath, JSON.stringify({ prompts: this.prompts }, null, 2));
    }

    addPrompt(opts: { title: string; content: string; category: string; tags: string[] }): PromptSnippet {
        const p: PromptSnippet = {
            id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: opts.title,
            content: opts.content,
            category: opts.category,
            tags: opts.tags,
            rating: 0,
            usageCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isFavorite: false,
            variables: [],
        };
        this.prompts.push(p);
        this.save();
        return p;
    }

    getAllPrompts(): PromptSnippet[] { return this.prompts; }

    getPrompt(id: string): PromptSnippet | undefined { return this.prompts.find(p => p.id === id); }

    recordUsage(id: string): void {
        const p = this.prompts.find(x => x.id === id);
        if (p) { p.usageCount++; this.save(); }
    }
}

// ── Setup ───────────────────────────────────────────────────────────

const TMP = `/tmp/ps-integration-test-${Date.now()}`;
fs.mkdirSync(TMP, { recursive: true });

const STORE_PATH = path.join(TMP, 'store');
const VERSION_PATH = path.join(TMP, 'versions');

const MOCK_OPEN_SOURCE: CrawledPrompt[] = [
    {
        title: 'Expert Code Reviewer',
        content: 'You are an expert code reviewer. Step 1: Read the code thoroughly. Step 2: Identify potential bugs and code smells. Step 3: Suggest concrete improvements. Ensure you cover edge cases. Example: check for null pointer dereference.',
        source: 'prompts.chat',
        sourceId: 'os-1',
        category: 'Coding',
        tags: ['code', 'review'],
        fetchedAt: new Date().toISOString(),
    },
    {
        title: 'Technical Writer',
        content: 'Act as a technical writer. You must produce clear, concise documentation. Output in markdown format. Include code examples where relevant. Always structure with headings.',
        source: 'awesome-prompts',
        sourceId: 'os-2',
        category: 'Writing',
        tags: ['writing', 'docs'],
        fetchedAt: new Date().toISOString(),
    },
    {
        title: 'Data Scientist',
        content: 'You are a data scientist. First, explore the dataset. Then, select appropriate models. Must validate with cross-validation. Output results in tables. Handle missing data gracefully.',
        source: 'awesome-prompts',
        sourceId: 'os-3',
        category: 'Data Science',
        tags: ['data', 'ml'],
        fetchedAt: new Date().toISOString(),
    },
];

// ─── Integration Test ───────────────────────────────────────────────

async function runIntegrationTest() {
    console.log('\n═══ CP8: System Integration Tests ═══\n');

    // ── Phase 1: PromptStore – Save User Prompts ──
    console.log('── Phase 1: PromptStore CRUD ──');
    const store = new MockPromptStore(STORE_PATH);

    const p1 = store.addPrompt({
        title: 'My Code Reviewer',
        content: 'Review my code and suggest fixes',
        category: 'Coding',
        tags: ['code'],
    });
    assert(p1.id.length > 0, 'prompt 1 created with id');

    const p2 = store.addPrompt({
        title: 'My Doc Generator',
        content: 'Generate documentation for this function',
        category: 'Writing',
        tags: ['docs'],
    });
    assert(store.getAllPrompts().length === 2, 'store has 2 prompts');

    // Record usage 
    store.recordUsage(p1.id);
    store.recordUsage(p1.id);
    store.recordUsage(p1.id);
    store.recordUsage(p2.id);
    const updated1 = store.getPrompt(p1.id);
    assert(updated1!.usageCount === 3, 'usage count tracked (p1=3)');

    // ── Phase 2: Optimizer + Open Source ──
    console.log('── Phase 2: Optimizer Finds References ──');
    const optimizer = new PromptOptimizer({ maxReferences: 3, similarityThreshold: 0.1 });
    optimizer.loadPromptsFromCache(MOCK_OPEN_SOURCE);
    assert(optimizer.getCachedPromptCount() === 3, 'optimizer loaded 3 open source prompts');

    const refs = findSimilarPrompts(p1.content, MOCK_OPEN_SOURCE, 3, 0.1);
    assert(refs.length > 0, 'found similar open-source prompts for "code review"');

    // ── Phase 3: Optimize and Score ──
    console.log('── Phase 3: Optimize & Score ──');
    const vm = new VersionManager(VERSION_PATH);
    vm.initHistory(p1.id, p1.content);
    vm.initHistory(p2.id, p2.content);

    const result1 = await optimizer.optimizeAndVersion(p1.id, p1.content, vm);
    assert(typeof result1.originalScore === 'number', 'p1 original scored');
    assert(typeof result1.optimizedScore === 'number', 'p1 optimized scored');
    assert(result1.method === 'heuristic', 'uses heuristic scoring (no LLM)');

    const result2 = await optimizer.optimizeAndVersion(p2.id, p2.content, vm);
    assert(typeof result2.originalScore === 'number', 'p2 scored');

    // ── Phase 4: Version History Integrity ──
    console.log('── Phase 4: Version History ──');
    const h1 = vm.getHistory(p1.id);
    assert(h1 !== undefined, 'p1 has version history');
    assert(h1!.versions.length >= 1, 'p1 has at least 1 version');

    if (result1.improved) {
        assert(h1!.versions.length >= 2, 'p1 improved → has 2+ versions');
        const recommended = vm.getRecommendedVersion(p1.id);
        assert(recommended !== undefined, 'recommended version exists');
        assert(recommended!.judgeScore !== undefined, 'recommended version has score');
    }

    const h2 = vm.getHistory(p2.id);
    assert(h2 !== undefined, 'p2 has version history');

    // ── Phase 5: Scheduler Integration ──
    console.log('── Phase 5: Scheduler Cycle ──');
    const scheduler = new UpdateScheduler(optimizer, {
        minUsageForOptimize: 2,
        maxOptimizePerCycle: 5,
    });
    scheduler.setVersionManager(vm);
    scheduler.setPromptProvider(() => {
        return store.getAllPrompts().map(p => ({
            id: p.id,
            content: p.content,
            usageCount: p.usageCount,
        }));
    });

    const events: string[] = [];
    scheduler.onEvent(e => events.push(e.type));

    const cycleResults = await scheduler.runOptimizeCycle();
    assert(events.includes('optimize-start'), 'scheduler emitted optimize-start');
    assert(events.includes('optimize-done'), 'scheduler emitted optimize-done');
    // Only p1 has usageCount >= 2
    assert(cycleResults.length >= 1, 'scheduler optimized at least 1 prompt');
    assert(scheduler.getOptimizeCount() === 1, 'optimize count = 1');

    // ── Phase 6: Cross-Module Consistency ──
    console.log('── Phase 6: Cross-Module Consistency ──');

    // Verify store data still intact
    assert(store.getAllPrompts().length === 2, 'store still has 2 prompts');
    assert(store.getPrompt(p1.id)!.title === 'My Code Reviewer', 'p1 title intact');

    // Verify version manager has entries for optimize targets
    const allHistoryIds = [p1.id, p2.id];
    for (const id of allHistoryIds) {
        const h = vm.getHistory(id);
        assert(h !== undefined, `history for ${id.slice(0,8)} exists`);
    }

    // Heuristic score consistency: same content → same score
    const content = 'You are an expert. Step 1: do. Must check errors.';
    try {
        const sc1 = heuristicScore(content);
        const sc2 = heuristicScore(content);
        console.log(`    DEBUG: sc1=${JSON.stringify(sc1.score)}, sc2=${JSON.stringify(sc2.score)}`);
        assert(sc1.score === sc2.score, 'heuristic score is deterministic');
    } catch (e: any) {
        console.log(`    DEBUG ERROR: ${e.message}`);
        assert(false, 'heuristic score is deterministic');
    }

    // ── Phase 7: Persistence Check ──
    console.log('── Phase 7: Persistence ──');

    // VersionManager persists to disk
    const vm2 = new VersionManager(VERSION_PATH);
    const h1Reloaded = vm2.getHistory(p1.id);
    assert(h1Reloaded !== undefined, 'version history persists after reload');
    assert(h1Reloaded!.versions.length === h1!.versions.length, 'version count matches after reload');

    // Store persists to disk
    const store2 = new MockPromptStore(STORE_PATH);
    assert(store2.getAllPrompts().length === 2, 'store persists after reload');

    // ── Cleanup ──
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

    console.log(`\n══ CP8 Results: ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail > 0 ? 1 : 0);
}

runIntegrationTest().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
