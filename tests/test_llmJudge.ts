/**
 * PromptStash - Unit Tests for LLM Judge (CP5)
 * Tests heuristic scorer + output parsers (LLM calls are mocked/skipped)
 */

import * as assert from 'assert';
import { heuristicScore, parseLLMJudgeOutput, parseLLMCompareOutput, LLMJudge, JudgeResult } from '../src/llmJudge';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e: any) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🧪 PromptStash LLM Judge Unit Tests (CP5)\n' + '='.repeat(50));

// ── Heuristic Scorer ────────────────────────────────────────────────
console.log('\n📊 Heuristic Scorer');
{
    test('short vague prompt scores low', () => {
        const r = heuristicScore('Fix the bug');
        assert.ok(r.score <= 2.5, `Expected <=2.5, got ${r.score}`);
        assert.strictEqual(r.method, 'heuristic');
    });

    test('medium prompt with some structure scores medium', () => {
        const r = heuristicScore(`You are a Python developer. 
Please refactor this code to follow best practices.
1. First, identify code smells
2. Then apply appropriate patterns
Return the refactored code.`);
        assert.ok(r.score >= 2.5 && r.score <= 4.5, `Score ${r.score} not in range`);
    });

    test('excellent structured prompt scores high', () => {
        const r = heuristicScore(`## Role
You are an expert {{LANGUAGE}} developer specializing in backend systems.

## Task
Refactor the following code to follow SOLID principles. You must ensure:
1. Each class has a single responsibility
2. The code should be extensible without modification
3. All dependencies must be injected

## Constraints
- Always handle edge cases and error conditions
- Output format should be working code with comments
- Never remove existing tests

## Example
For instance, if given a monolithic class, you should split it into:
\`\`\`python
class UserService:
    pass
class AuthService:
    pass
\`\`\`

## Expected Output
Return the refactored code as a complete file with all necessary imports.`);
        assert.ok(r.score >= 4.0, `Expected >=4.0, got ${r.score}`);
    });

    test('prompt with code blocks gets bonus', () => {
        const withCode = heuristicScore('Do this:\n```\ncode here\n```\nThat should work.');
        const without = heuristicScore('Do this. That should work and be correct.');
        assert.ok(withCode.score >= without.score);
    });

    test('prompt with variables gets bonus', () => {
        const r = heuristicScore('Refactor {{PROJECT}} code in {{LANGUAGE}} with best practices and ensure quality output format');
        assert.ok(r.feedback.includes('template variables'));
    });

    test('score capped at 5', () => {
        // Extremely long prompt hitting all bonuses
        const monster = `## Role
You are an expert Python developer. Act as a senior architect.

## Task  
You must refactor this code step by step. First analyze, then implement.
Ensure all edge cases and error handling are covered.

## Constraints
- Always follow SOLID principles
- Should use dependency injection
- Never break existing tests
- Required to maintain backward compatibility

## Example
For instance, consider this code:
\`\`\`python
class Service:
    def process(self):
        pass
\`\`\`

## Output
The output format should be:
1. A summary of changes
2. The refactored code
3. Updated tests

Handle all error cases and exceptions properly.
Return the result in the specified format.
${' '.repeat(600)}`;
        const r = heuristicScore(monster);
        assert.ok(r.score <= 5, `Score ${r.score} exceeds 5`);
    });
}

// ── LLM Output Parsers ──────────────────────────────────────────────
console.log('\n🔍 LLM Output Parsers');
{
    test('parseLLMJudgeOutput extracts score and feedback', () => {
        const output = `The prompt is well-structured with clear role definition and step-by-step instructions. 
It provides good context and constraints. However, it could benefit from more specific examples.
[RESULT] 4`;
        const { score, feedback } = parseLLMJudgeOutput(output);
        assert.strictEqual(score, 4);
        assert.ok(feedback.includes('well-structured'));
    });

    test('parseLLMJudgeOutput handles score at boundary', () => {
        const { score } = parseLLMJudgeOutput('Great prompt [RESULT] 5');
        assert.strictEqual(score, 5);
    });

    test('parseLLMJudgeOutput defaults to 3 for missing score', () => {
        const { score } = parseLLMJudgeOutput('Some feedback without a result tag');
        assert.strictEqual(score, 3);
    });

    test('parseLLMJudgeOutput clamps invalid scores', () => {
        const { score: s1 } = parseLLMJudgeOutput('[RESULT] 0');
        assert.strictEqual(s1, 1); // clamped to 1
        const { score: s2 } = parseLLMJudgeOutput('[RESULT] 9');
        assert.strictEqual(s2, 5); // clamped to 5
    });

    test('parseLLMCompareOutput extracts winner', () => {
        const { winner, feedback } = parseLLMCompareOutput('Version B is better because it provides more context. [RESULT] B');
        assert.strictEqual(winner, 'B');
        assert.ok(feedback.includes('better'));
    });

    test('parseLLMCompareOutput handles A winner', () => {
        const { winner } = parseLLMCompareOutput('A is clearly superior. [RESULT] A');
        assert.strictEqual(winner, 'A');
    });

    test('parseLLMCompareOutput defaults to B on parse failure', () => {
        const { winner } = parseLLMCompareOutput('No clear result tag here');
        assert.strictEqual(winner, 'B');
    });
}

// ── LLM Judge (Heuristic fallback mode) ─────────────────────────────
console.log('\n🤖 LLM Judge (Heuristic Mode)');
{
    test('scorePrompt falls back to heuristic when no LLM', async () => {
        const judge = new LLMJudge({ endpoint: 'http://localhost:99999/fake' });
        const result = await judge.scorePrompt('Fix the bug in my code please');
        assert.strictEqual(result.method, 'heuristic');
        assert.ok(result.score >= 1 && result.score <= 5);
    });

    test('compareVersions falls back to heuristic', async () => {
        const judge = new LLMJudge({ endpoint: 'http://localhost:99999/fake' });
        const shortPrompt = 'Fix bug';
        const goodPrompt = `You are a debugging expert. First analyze the error, then provide a step-by-step fix. 
Ensure you handle edge cases. Return the corrected code with comments explaining changes.`;
        const result = await judge.compareVersions(shortPrompt, goodPrompt);
        assert.strictEqual(result.method, 'heuristic');
        assert.strictEqual(result.winner, 'B'); // good prompt should win
    });

    test('compareVersions A wins when A is better', async () => {
        const judge = new LLMJudge({ endpoint: 'http://localhost:99999/fake' });
        const goodPrompt = `You are a senior developer. You must refactor this code step by step.
First identify issues, then apply SOLID principles. Ensure all error cases are handled.
\`\`\`
example code here
\`\`\`
Output format should be complete refactored code.`;
        const badPrompt = 'Refactor code';
        const result = await judge.compareVersions(goodPrompt, badPrompt);
        assert.strictEqual(result.winner, 'A');
    });
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) { console.log('❌ SOME TESTS FAILED'); process.exit(1); }
else { console.log('✅ ALL TESTS PASSED'); }
