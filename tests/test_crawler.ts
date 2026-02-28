/**
 * PromptStash - Unit Tests for Crawler (CP3)
 */

import * as assert from 'assert';
import { parseCSV, parseMarkdownSections, parseJSONPrompts, categorizePrompt, extractTags, CrawledPrompt, PromptSource } from '../src/crawler';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e: any) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🧪 PromptStash Crawler Unit Tests (CP3)\n' + '='.repeat(50));

const mockSource: PromptSource = {
    name: 'Test', owner: 'test', repo: 'test-repo', branch: 'main',
    filePath: 'test.csv', format: 'csv'
};

// ── CSV Parser ──────────────────────────────────────────────────────
console.log('\n📄 CSV Parser');
{
    const csv = `"act","prompt"
"Linux Terminal","I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show."
"English Translator","I want you to act as an English translator, spelling corrector and improver."
"Empty","x"
`;

    test('parses valid CSV rows', () => {
        const results = parseCSV(csv, mockSource);
        assert.strictEqual(results.length, 2); // 3rd row content too short (<20)
    });

    test('extracts title and content correctly', () => {
        const results = parseCSV(csv, mockSource);
        assert.strictEqual(results[0].title, 'Linux Terminal');
        assert.ok(results[0].content.includes('linux terminal'));
    });

    test('sets source metadata', () => {
        const results = parseCSV(csv, mockSource);
        assert.ok(results[0].source.includes('test/test-repo'));
        assert.ok(results[0].sourceId.includes('test/test-repo'));
        assert.ok(results[0].fetchedAt);
    });

    test('handles escaped quotes in CSV', () => {
        const csv2 = `"act","prompt"
"Quote ""Test""","This prompt has ""quoted"" text inside it for testing purposes."
`;
        const results = parseCSV(csv2, mockSource);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Quote "Test"');
        assert.ok(results[0].content.includes('"quoted"'));
    });

    test('handles empty CSV', () => {
        const results = parseCSV('"act","prompt"\n', mockSource);
        assert.strictEqual(results.length, 0);
    });
}

// ── Markdown Parser ─────────────────────────────────────────────────
console.log('\n📝 Markdown Section Parser');
{
    const md = `# Main Title

Some intro text.

## ChatGPT System Prompt

Here is the system prompt:

\`\`\`
You are ChatGPT, a large language model trained by OpenAI.
Knowledge cutoff: 2024-01
Current date: 2026-02-28
\`\`\`

## Claude System Prompt

The Claude prompt:

\`\`\`
You are Claude, made by Anthropic. You are helpful, harmless, and honest.
Always provide accurate information to the best of your ability.
\`\`\`

## No Code Block Section

This section has no code block, just text.

## Short Code

\`\`\`
Hi
\`\`\`
`;

    const mdSource: PromptSource = { ...mockSource, format: 'markdown-sections' };

    test('extracts sections with code blocks', () => {
        const results = parseMarkdownSections(md, mdSource);
        assert.ok(results.length >= 2, `Expected >=2, got ${results.length}`);
    });

    test('parses title from section header', () => {
        const results = parseMarkdownSections(md, mdSource);
        const titles = results.map(r => r.title);
        assert.ok(titles.some(t => t.includes('ChatGPT')));
        assert.ok(titles.some(t => t.includes('Claude')));
    });

    test('extracts code block content', () => {
        const results = parseMarkdownSections(md, mdSource);
        const chatgpt = results.find(r => r.title.includes('ChatGPT'));
        assert.ok(chatgpt);
        assert.ok(chatgpt!.content.includes('large language model'));
    });

    test('skips sections without code blocks or short content', () => {
        const results = parseMarkdownSections(md, mdSource);
        assert.ok(!results.some(r => r.title.includes('No Code Block')));
        assert.ok(!results.some(r => r.title.includes('Short Code')));
    });
}

// ── JSON Parser ─────────────────────────────────────────────────────
console.log('\n📦 JSON Parser');
{
    const jsonSource: PromptSource = { ...mockSource, format: 'json' };

    test('parses array of prompts', () => {
        const json = JSON.stringify([
            { title: 'Prompt 1', content: 'This is a long enough prompt content for testing purposes.' },
            { title: 'Prompt 2', content: 'Another sufficiently long prompt content for the parser.' },
        ]);
        const results = parseJSONPrompts(json, jsonSource);
        assert.strictEqual(results.length, 2);
    });

    test('handles object with prompts key', () => {
        const json = JSON.stringify({
            prompts: [{ title: 'Nested', content: 'This is a nested prompt inside an object structure.' }]
        });
        const results = parseJSONPrompts(json, jsonSource);
        assert.strictEqual(results.length, 1);
    });

    test('handles alternative field names', () => {
        const json = JSON.stringify([
            { act: 'Bot', prompt: 'Act as a helpful bot assistant for coding tasks.' }
        ]);
        const results = parseJSONPrompts(json, jsonSource);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Bot');
    });

    test('handles invalid JSON gracefully', () => {
        const results = parseJSONPrompts('not json {{{', jsonSource);
        assert.strictEqual(results.length, 0);
    });

    test('filters out short content', () => {
        const json = JSON.stringify([{ title: 'Short', content: 'Too short' }]);
        const results = parseJSONPrompts(json, jsonSource);
        assert.strictEqual(results.length, 0);
    });
}

// ── Categorize ──────────────────────────────────────────────────────
console.log('\n🏷️  Auto-categorization');
{
    test('categorizes code-related prompt', () => {
        const cat = categorizePrompt('Python Developer', 'Write code to implement a REST API');
        assert.strictEqual(cat, 'Code Generation');
    });

    test('categorizes debugging prompt', () => {
        const cat = categorizePrompt('Bug Fixer', 'Debug this error and fix the issue');
        assert.strictEqual(cat, 'Debugging');
    });

    test('categorizes testing prompt', () => {
        const cat = categorizePrompt('QA Engineer', 'Write unit test for this function');
        assert.strictEqual(cat, 'Testing');
    });

    test('returns General for unmatched', () => {
        const cat = categorizePrompt('Random', 'This is just something random without any keywords');
        assert.strictEqual(cat, 'General');
    });

    test('categorizes paper writing', () => {
        const cat = categorizePrompt('Academic Writer', 'Write a research paper about neural networks in latex');
        assert.strictEqual(cat, 'Paper Writing');
    });
}

// ── Tag Extraction ──────────────────────────────────────────────────
console.log('\n🔖 Tag Extraction');
{
    test('extracts language tags', () => {
        const tags = extractTags('Python Dev', 'Write python code with django framework');
        assert.ok(tags.includes('python'));
        assert.ok(tags.includes('django'));
    });

    test('extracts tech tags', () => {
        const tags = extractTags('DevOps', 'Deploy to kubernetes with docker on aws');
        assert.ok(tags.includes('kubernetes'));
        assert.ok(tags.includes('docker'));
        assert.ok(tags.includes('aws'));
    });

    test('limits to 8 tags max', () => {
        const tags = extractTags('Full Stack', 'python javascript typescript java react vue angular node django flask api database sql rest graphql machine learning docker');
        assert.ok(tags.length <= 8);
    });

    test('returns empty for no matches', () => {
        const tags = extractTags('Hello', 'Just a simple greeting text');
        assert.strictEqual(tags.length, 0);
    });
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) { console.log('❌ SOME TESTS FAILED'); process.exit(1); }
else { console.log('✅ ALL TESTS PASSED'); }
