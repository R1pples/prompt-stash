/**
 * CP6 – Self-Evolution Optimizer Tests
 */

import {
    findSimilarPrompts,
    extractPatterns,
    optimizeWithRules,
    OPTIMIZATION_RULES,
    PromptOptimizer,
    OptimizationResult,
} from '../src/optimizer';
import { CrawledPrompt } from '../src/crawler';
import { VersionManager } from '../src/versionManager';

// ─── Helpers ────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.error(`  ❌ ${msg}`); }
}

function makeCrawled(title: string, content: string, source: string = 'test'): CrawledPrompt {
    return { title, content, source, sourceId: `test-${title}`, category: 'General', tags: [], fetchedAt: new Date().toISOString() };
}

// ─── Mock prompts ───────────────────────────────────────────────────

const OPEN_SOURCE: CrawledPrompt[] = [
    makeCrawled(
        'Expert Code Reviewer',
        'You are an expert code reviewer. Step 1: Read the code. Step 2: Identify bugs. Step 3: Suggest improvements. Ensure clarity. Example: missing null check.',
        'prompts.chat'
    ),
    makeCrawled(
        'Writing Assistant',
        'Act as a professional writing assistant. You should help users improve their writing style, grammar, and structure. Always provide examples.',
        'prompts.chat'
    ),
    makeCrawled(
        'Data Analyst',
        'You are a data analyst. Parse the dataset step by step. Output the results in markdown tables. Must handle edge cases like null values.',
        'awesome-prompts'
    ),
    makeCrawled(
        'Math Tutor',
        'Act as a math tutor. Explain concepts clearly. Use step-by-step solutions. Include worked examples. Format output as numbered steps.',
        'awesome-prompts'
    ),
    makeCrawled(
        'DevOps Engineer',
        'You are a DevOps engineer. Write Dockerfiles, CI pipelines, and deployment scripts. Ensure security best practices. Handle error scenarios.',
        'awesome-prompts'
    ),
];

// ─── Tests ─────────────────────────────────────────────────────────

console.log('\n═══ CP6: Self-Evolution Optimizer Tests ═══\n');

// 1. findSimilarPrompts tests
console.log('── findSimilarPrompts ──');
{
    const query = 'Help me review my code and find bugs';
    const results = findSimilarPrompts(query, OPEN_SOURCE, 3, 0.1);
    assert(results.length > 0, 'finds at least one similar prompt for "code review" query');
    assert(
        results.some(r => r.title.toLowerCase().includes('code')),
        'top results include code-related prompts'
    );
}
{
    const query = 'short';
    const results = findSimilarPrompts(query, OPEN_SOURCE, 5, 0.1);
    // "short" has 5 chars so passes >3 filter, but unlikely to match
    assert(results.length === 0 || results.length <= 5, 'returns empty or limited for low-match query');
}
{
    const results = findSimilarPrompts('', OPEN_SOURCE, 5, 0.1);
    assert(results.length === 0, 'empty query returns no results');
}
{
    const results = findSimilarPrompts('write code', [], 5, 0.1);
    assert(results.length === 0, 'empty corpus returns no results');
}
{
    const query = 'math tutor explain step solutions';
    const results = findSimilarPrompts(query, OPEN_SOURCE, 2, 0.1);
    assert(results.length <= 2, 'respects maxResults limit');
}
{
    const results = findSimilarPrompts('code review bugs improve', OPEN_SOURCE, 5, 0.99);
    assert(results.length === 0, 'very high threshold returns nothing');
}

// 2. extractPatterns tests
console.log('── extractPatterns ──');
{
    const patterns = extractPatterns(OPEN_SOURCE);
    assert(patterns.includes('role-definition'), 'detects role-definition pattern');
    assert(patterns.includes('step-by-step'), 'detects step-by-step pattern');
    assert(patterns.includes('constraints'), 'detects constraints pattern');
    assert(patterns.includes('examples'), 'detects examples pattern');
}
{
    const patterns = extractPatterns([]);
    assert(patterns.length === 0, 'empty references yield no patterns');
}

// 3. OPTIMIZATION_RULES tests
console.log('── OPTIMIZATION_RULES ──');
{
    const plain = 'Please help me write some Python code';
    const roleRule = OPTIMIZATION_RULES.find(r => r.name === 'add-role-definition')!;
    assert(roleRule.check(plain), 'role rule fires on prompt without role');
    const applied = roleRule.apply(plain);
    assert(applied.includes('You are'), 'role rule adds "You are" prefix');
}
{
    const withRole = 'You are a Python expert. Help me write code.';
    const roleRule = OPTIMIZATION_RULES.find(r => r.name === 'add-role-definition')!;
    assert(!roleRule.check(withRole), 'role rule does NOT fire when role already present');
}
{
    const plain = 'Write a function that sorts an array. Explain it step by step.';
    const outputRule = OPTIMIZATION_RULES.find(r => r.name === 'add-output-format')!;
    assert(outputRule.check(plain), 'output-format rule fires when no format specified');
    const applied = outputRule.apply(plain);
    assert(applied.includes('structure your response'), 'output-format rule adds format hint');
}
{
    const midContent = 'a '.repeat(80);  // 160 chars, needs constraints
    const constraintRule = OPTIMIZATION_RULES.find(r => r.name === 'add-constraints')!;
    const applied = constraintRule.check(midContent) ? constraintRule.apply(midContent) : midContent;
    assert(applied.includes('Ensure') || applied === midContent, 'constraint rule works without error');
}

// 4. optimizeWithRules tests
console.log('── optimizeWithRules ──');
{
    const bare = 'Write me a sorting algorithm';
    const optimized = optimizeWithRules(bare, []);
    assert(optimized.length > bare.length, 'optimization adds content to bare prompt');
    assert(optimized.includes(bare), 'original content is preserved');
}
{
    // A prompt that already has most markers should grow less
    const rich = 'You are an expert. Step 1: do this. Must ensure quality. Example: foo. Output in JSON.';
    const optimized = optimizeWithRules(rich, []);
    const delta = optimized.length - rich.length;
    assert(delta < 200, 'well-crafted prompt gets minimal additions');
}

// 5. PromptOptimizer (heuristic mode — no LLM endpoint)
console.log('── PromptOptimizer (heuristic mode) ──');
{
    const optimizer = new PromptOptimizer();
    optimizer.loadPromptsFromCache(OPEN_SOURCE);
    assert(optimizer.getCachedPromptCount() === 5, 'cache loaded with 5 prompts');
}

// Async tests
async function runAsyncTests() {
    console.log('── PromptOptimizer.optimizePrompt ──');

    const optimizer = new PromptOptimizer();
    optimizer.loadPromptsFromCache(OPEN_SOURCE);

    // A bare prompt should be improvable
    const bare = 'Write a function that parses CSV files';
    const result = await optimizer.optimizePrompt(bare);
    assert(result.originalContent === bare, 'original content preserved');
    assert(result.optimizedContent.length >= bare.length, 'optimized is at least as long');
    assert(typeof result.originalScore === 'number', 'original has a score');
    assert(typeof result.optimizedScore === 'number', 'optimized has a score');
    assert(result.method === 'heuristic', 'heuristic method used when no LLM');
    assert(typeof result.improved === 'boolean', 'improved is boolean');
    assert(typeof result.feedback === 'string' && result.feedback.length > 0, 'feedback is non-empty');

    // An already-good prompt
    const rich = 'You are an expert data engineer. Step 1: Read the CSV. Step 2: Validate each row. Must handle null values. Example: skip rows with missing fields. Output as JSON. Ensure edge cases like empty files are handled.';
    const result2 = await optimizer.optimizePrompt(rich);
    assert(result2.originalScore >= 3.0, 'rich prompt scores at least 3.0');

    // optimizeAndVersion
    console.log('── PromptOptimizer.optimizeAndVersion ──');
    const vm = new VersionManager('/tmp/ps-opt-test-' + Date.now());
    vm.initHistory('p-opt-1', bare);

    const result3 = await optimizer.optimizeAndVersion('p-opt-1', bare, vm);
    const history = vm.getHistory('p-opt-1');
    assert(history !== undefined, 'version history exists');

    if (result3.improved) {
        assert(history!.versions.length >= 2, 'improved prompt has ≥2 versions');
        assert(history!.recommendedVersion >= 1, 'recommended version set');
    } else {
        assert(history!.versions.length === 1, 'non-improved keeps only 1 version');
    }

    // Clean up
    const fs = require('fs');
    const path = `/tmp/ps-opt-test-${Date.now()}`;
    try { fs.rmSync(path, { recursive: true, force: true }); } catch {}
}

runAsyncTests().then(() => {
    console.log(`\n══ CP6 Results: ${pass} passed, ${fail} failed ══\n`);
    process.exit(fail > 0 ? 1 : 0);
}).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
