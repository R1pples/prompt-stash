/**
 * CP7 – Periodic Update Scheduler Tests
 */

import { UpdateScheduler, SchedulerEvent, DEFAULT_SCHEDULER_CONFIG } from '../src/scheduler';
import { PromptOptimizer } from '../src/optimizer';
import { VersionManager } from '../src/versionManager';
import { CrawledPrompt } from '../src/crawler';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.error(`  ❌ ${msg}`); }
}

function mockPrompts(): CrawledPrompt[] {
    return [
        { title: 'Expert Coder', content: 'You are an expert coder. Step 1: Read code. Step 2: Fix bugs. Ensure quality. Example: null check.', source: 'test', sourceId: 't1', category: 'Coding', tags: ['code'], fetchedAt: new Date().toISOString() },
        { title: 'Writer', content: 'Act as a writer. Must produce clear prose. Output in markdown.', source: 'test', sourceId: 't2', category: 'Writing', tags: ['write'], fetchedAt: new Date().toISOString() },
    ];
}

console.log('\n═══ CP7: Periodic Update Scheduler Tests ═══\n');

// 1. Basic creation and config
console.log('── Scheduler Config ──');
{
    const optimizer = new PromptOptimizer();
    const sched = new UpdateScheduler(optimizer);
    assert(!sched.isRunning(), 'not running after creation');
    assert(sched.getCrawlCount() === 0, 'zero crawl count');
    assert(sched.getOptimizeCount() === 0, 'zero optimize count');
}
{
    const optimizer = new PromptOptimizer();
    const sched = new UpdateScheduler(optimizer, { enabled: false });
    sched.start();
    assert(!sched.isRunning(), 'disabled scheduler does not start');
    sched.dispose();
}

// 2. Start / stop lifecycle
console.log('── Lifecycle ──');
{
    const optimizer = new PromptOptimizer();
    const sched = new UpdateScheduler(optimizer, { crawlIntervalMs: 100000, optimizeIntervalMs: 100000 });
    sched.start();
    assert(sched.isRunning(), 'running after start');
    sched.stop();
    assert(!sched.isRunning(), 'not running after stop');
}
{
    const optimizer = new PromptOptimizer();
    const sched = new UpdateScheduler(optimizer, { crawlIntervalMs: 100000, optimizeIntervalMs: 100000 });
    sched.start();
    sched.start(); // double start should be idempotent
    assert(sched.isRunning(), 'still running after double start');
    sched.dispose();
    assert(!sched.isRunning(), 'disposed means stopped');
}

// 3. Event emission — tested in async section below

// Async tests
async function runAsyncTests() {
    console.log('── Crawl Cycle Events ──');
    {
        const optimizer = new PromptOptimizer();
        optimizer.loadPromptsFromCache(mockPrompts());
        const sched = new UpdateScheduler(optimizer);
        const events: SchedulerEvent[] = [];
        sched.onEvent(e => events.push(e));

        await sched.runCrawlCycle();
        assert(events.some(e => e.type === 'crawl-start'), 'emits crawl-start');
        assert(events.some(e => e.type === 'crawl-done'), 'emits crawl-done');
        assert(sched.getCrawlCount() === 1, 'crawl count incremented');
        assert(sched.getLastCrawlTime() > 0, 'lastCrawlTime set');
    }

    console.log('── Manual Optimize Cycle ──');
    {
        const optimizer = new PromptOptimizer();
        optimizer.loadPromptsFromCache(mockPrompts());
        const sched = new UpdateScheduler(optimizer);
        const events: SchedulerEvent[] = [];
        sched.onEvent(e => events.push(e));

        // Without prompt provider
        const r1 = await sched.runOptimizeCycle();
        assert(r1.length === 0, 'no results without prompt provider');
    }
    {
        const optimizer = new PromptOptimizer();
        optimizer.loadPromptsFromCache(mockPrompts());
        const sched = new UpdateScheduler(optimizer, { minUsageForOptimize: 1, maxOptimizePerCycle: 2 });
        const events: SchedulerEvent[] = [];
        sched.onEvent(e => events.push(e));

        sched.setPromptProvider(() => [
            { id: 'user-1', content: 'Write a sorting function', usageCount: 3 },
            { id: 'user-2', content: 'Help me debug this code', usageCount: 5 },
            { id: 'user-3', content: 'Explain recursion', usageCount: 0 },  // below minUsage
        ]);

        const results = await sched.runOptimizeCycle();
        assert(results.length === 2, 'optimized 2 prompts (3rd filtered by usage)');
        assert(events.some(e => e.type === 'optimize-start'), 'emits optimize-start');
        assert(events.some(e => e.type === 'optimize-done'), 'emits optimize-done');
        assert(sched.getOptimizeCount() === 1, 'optimize count incremented');
        assert(sched.getLastOptimizeTime() > 0, 'lastOptimizeTime set');
    }

    // With VersionManager
    console.log('── Optimize with VersionManager ──');
    {
        const optimizer = new PromptOptimizer();
        optimizer.loadPromptsFromCache(mockPrompts());
        const vm = new VersionManager('/tmp/ps-sched-test-' + Date.now());
        const sched = new UpdateScheduler(optimizer, { minUsageForOptimize: 1, maxOptimizePerCycle: 1 });
        sched.setVersionManager(vm);

        // Init version history for the prompt
        vm.initHistory('vp-1', 'Write some code for me');

        sched.setPromptProvider(() => [
            { id: 'vp-1', content: 'Write some code for me', usageCount: 5 },
        ]);

        const results = await sched.runOptimizeCycle();
        assert(results.length === 1, 'one prompt optimized');
        const h = vm.getHistory('vp-1');
        assert(h !== undefined, 'version history exists');
        if (results[0].improved) {
            assert(h!.versions.length >= 2, 'improved prompt has new version');
        } else {
            assert(h!.versions.length === 1, 'not-improved keeps original');
        }
    }

    // maxOptimizePerCycle limit
    console.log('── Rate Limiting ──');
    {
        const optimizer = new PromptOptimizer();
        optimizer.loadPromptsFromCache(mockPrompts());
        const sched = new UpdateScheduler(optimizer, { minUsageForOptimize: 1, maxOptimizePerCycle: 1 });
        sched.setPromptProvider(() => [
            { id: 'a', content: 'Prompt A long enough', usageCount: 10 },
            { id: 'b', content: 'Prompt B long enough', usageCount: 10 },
            { id: 'c', content: 'Prompt C long enough', usageCount: 10 },
        ]);
        const results = await sched.runOptimizeCycle();
        assert(results.length === 1, 'respects maxOptimizePerCycle=1');
    }
}

runAsyncTests().then(() => {
    console.log(`\n══ CP7 Results: ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail > 0 ? 1 : 0);
}).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
