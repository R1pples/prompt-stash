/**
 * PromptStash - Unit Tests for Store (CP1)
 * Run with: npx ts-node --project tsconfig.test.json tests/test_store.ts
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PromptSnippet, PromptLibrary, DEFAULT_CATEGORIES } from '../src/models';

// ── Standalone Store for testing (no vscode dependency) ─────────────

class TestPromptStore {
    private library: PromptLibrary;
    private storagePath: string;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.library = this.load();
    }

    private load(): PromptLibrary {
        try {
            if (fs.existsSync(this.storagePath)) {
                const raw = fs.readFileSync(this.storagePath, 'utf-8');
                const data = JSON.parse(raw) as PromptLibrary;
                const allCats = new Set([...DEFAULT_CATEGORIES, ...data.categories]);
                data.categories = Array.from(allCats);
                return data;
            }
        } catch (err) {
            console.error('Failed to load', err);
        }
        return { version: '1.0.0', prompts: [], categories: [...DEFAULT_CATEGORIES], lastModified: new Date().toISOString() };
    }

    private save(): void {
        this.library.lastModified = new Date().toISOString();
        fs.writeFileSync(this.storagePath, JSON.stringify(this.library, null, 2), 'utf-8');
    }

    private generateId(): string {
        return `ps_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    private extractVariables(content: string): string[] {
        const matches = content.match(/\{\{(\w+)\}\}/g);
        if (!matches) { return []; }
        return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
    }

    addPrompt(data: { title: string; content: string; category?: string; tags?: string[]; rating?: number; language?: string; description?: string; }): PromptSnippet {
        const now = new Date().toISOString();
        const prompt: PromptSnippet = {
            id: this.generateId(), title: data.title, content: data.content,
            category: data.category || 'General', tags: data.tags || [], rating: data.rating || 3,
            usageCount: 0, createdAt: now, updatedAt: now, isFavorite: false,
            language: data.language, description: data.description,
            variables: this.extractVariables(data.content),
        };
        if (!this.library.categories.includes(prompt.category)) {
            this.library.categories.push(prompt.category);
        }
        this.library.prompts.push(prompt);
        this.save();
        return prompt;
    }

    updatePrompt(id: string, updates: Partial<PromptSnippet>): PromptSnippet | undefined {
        const idx = this.library.prompts.findIndex(p => p.id === id);
        if (idx === -1) { return undefined; }
        const existing = this.library.prompts[idx];
        const updated = { ...existing, ...updates, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
        if (updates.content) { updated.variables = this.extractVariables(updates.content); }
        this.library.prompts[idx] = updated;
        this.save();
        return updated;
    }

    deletePrompt(id: string): boolean {
        const idx = this.library.prompts.findIndex(p => p.id === id);
        if (idx === -1) { return false; }
        this.library.prompts.splice(idx, 1);
        this.save();
        return true;
    }

    getPrompt(id: string): PromptSnippet | undefined { return this.library.prompts.find(p => p.id === id); }
    getAllPrompts(): PromptSnippet[] { return [...this.library.prompts]; }
    getFavorites(): PromptSnippet[] { return this.library.prompts.filter(p => p.isFavorite); }
    getByCategory(cat: string): PromptSnippet[] { return this.library.prompts.filter(p => p.category === cat); }
    getCategories(): string[] { return [...this.library.categories]; }
    getAllTags(): string[] { const s = new Set<string>(); this.library.prompts.forEach(p => p.tags.forEach(t => s.add(t))); return Array.from(s).sort(); }
    toggleFavorite(id: string): boolean | undefined { const p = this.library.prompts.find(p => p.id === id); if (!p) return undefined; p.isFavorite = !p.isFavorite; this.save(); return p.isFavorite; }
    recordUsage(id: string): void { const p = this.library.prompts.find(p => p.id === id); if (p) { p.usageCount++; p.lastUsedAt = new Date().toISOString(); this.save(); } }
    searchPrompts(query: string): PromptSnippet[] { const q = query.toLowerCase(); return this.library.prompts.filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q))); }
    getTopPrompts(limit: number = 10): PromptSnippet[] { return [...this.library.prompts].sort((a, b) => (b.rating - a.rating) || (b.usageCount - a.usageCount)).slice(0, limit); }
    exportLibrary(): string { return JSON.stringify(this.library, null, 2); }
    importLibrary(json: string, merge: boolean = true): number {
        const imported = JSON.parse(json) as PromptLibrary;
        let count = 0;
        if (merge) {
            const ids = new Set(this.library.prompts.map(p => p.id));
            for (const p of imported.prompts) { if (!ids.has(p.id)) { this.library.prompts.push(p); count++; } }
            this.library.categories = Array.from(new Set([...this.library.categories, ...imported.categories]));
        } else { count = imported.prompts.length; this.library = imported; }
        this.save(); return count;
    }
    duplicatePrompt(id: string): PromptSnippet | undefined {
        const orig = this.getPrompt(id);
        if (!orig) return undefined;
        return this.addPrompt({ title: `${orig.title} (copy)`, content: orig.content, category: orig.category, tags: [...orig.tags], rating: orig.rating });
    }
}

// ═══════════════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════════════

const TEST_DIR = path.join(__dirname, '.test_data');
const TEST_FILE = path.join(TEST_DIR, 'test_library.json');

function setup(): TestPromptStore {
    if (fs.existsSync(TEST_DIR)) { fs.rmSync(TEST_DIR, { recursive: true }); }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    return new TestPromptStore(TEST_FILE);
}

function teardown(): void {
    if (fs.existsSync(TEST_DIR)) { fs.rmSync(TEST_DIR, { recursive: true }); }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e: any) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🧪 PromptStash Store Unit Tests (CP1)\n' + '='.repeat(50));

// ── Test Group: CRUD ────────────────────────────────────────────────
console.log('\n📦 CRUD Operations');
{
    const store = setup();

    test('addPrompt creates a prompt with correct fields', () => {
        const p = store.addPrompt({ title: 'Test Prompt', content: 'Hello {{NAME}}', category: 'Debugging', tags: ['test', 'hello'], rating: 4 });
        assert.ok(p.id.startsWith('ps_'));
        assert.strictEqual(p.title, 'Test Prompt');
        assert.strictEqual(p.content, 'Hello {{NAME}}');
        assert.strictEqual(p.category, 'Debugging');
        assert.deepStrictEqual(p.tags, ['test', 'hello']);
        assert.strictEqual(p.rating, 4);
        assert.strictEqual(p.usageCount, 0);
        assert.strictEqual(p.isFavorite, false);
        assert.deepStrictEqual(p.variables, ['NAME']);
    });

    test('getPrompt retrieves by ID', () => {
        const all = store.getAllPrompts();
        const found = store.getPrompt(all[0].id);
        assert.ok(found);
        assert.strictEqual(found!.title, 'Test Prompt');
    });

    test('updatePrompt modifies fields', () => {
        const all = store.getAllPrompts();
        const updated = store.updatePrompt(all[0].id, { title: 'Updated Title', rating: 5 });
        assert.ok(updated);
        assert.strictEqual(updated!.title, 'Updated Title');
        assert.strictEqual(updated!.rating, 5);
        assert.strictEqual(updated!.content, 'Hello {{NAME}}'); // unchanged
    });

    test('updatePrompt returns undefined for bad ID', () => {
        const result = store.updatePrompt('nonexistent_id', { title: 'X' });
        assert.strictEqual(result, undefined);
    });

    test('deletePrompt removes the prompt', () => {
        const p = store.addPrompt({ title: 'ToDelete', content: 'bye' });
        assert.strictEqual(store.getAllPrompts().length, 2);
        const ok = store.deletePrompt(p.id);
        assert.ok(ok);
        assert.strictEqual(store.getAllPrompts().length, 1);
    });

    test('deletePrompt returns false for bad ID', () => {
        assert.strictEqual(store.deletePrompt('bad_id'), false);
    });

    teardown();
}

// ── Test Group: Categories & Tags ───────────────────────────────────
console.log('\n🏷️ Categories & Tags');
{
    const store = setup();

    test('getCategories returns defaults', () => {
        const cats = store.getCategories();
        assert.ok(cats.includes('General'));
        assert.ok(cats.includes('Debugging'));
        assert.ok(cats.includes('Refactoring'));
    });

    test('new category auto-added', () => {
        store.addPrompt({ title: 'P1', content: 'x', category: 'MyCustomCat' });
        assert.ok(store.getCategories().includes('MyCustomCat'));
    });

    test('getByCategory filters correctly', () => {
        store.addPrompt({ title: 'P2', content: 'y', category: 'Debugging' });
        store.addPrompt({ title: 'P3', content: 'z', category: 'Debugging' });
        assert.strictEqual(store.getByCategory('Debugging').length, 2);
        assert.strictEqual(store.getByCategory('MyCustomCat').length, 1);
    });

    test('getAllTags returns unique sorted tags', () => {
        store.addPrompt({ title: 'P4', content: 'a', tags: ['beta', 'alpha'] });
        store.addPrompt({ title: 'P5', content: 'b', tags: ['alpha', 'gamma'] });
        const tags = store.getAllTags();
        assert.deepStrictEqual(tags, ['alpha', 'beta', 'gamma']);
    });

    teardown();
}

// ── Test Group: Favorites & Usage ───────────────────────────────────
console.log('\n⭐ Favorites & Usage');
{
    const store = setup();

    test('toggleFavorite flips isFavorite', () => {
        const p = store.addPrompt({ title: 'Fav', content: 'test' });
        assert.strictEqual(store.toggleFavorite(p.id), true);
        assert.strictEqual(store.getPrompt(p.id)!.isFavorite, true);
        assert.strictEqual(store.toggleFavorite(p.id), false);
    });

    test('getFavorites returns only favorites', () => {
        const p2 = store.addPrompt({ title: 'NotFav', content: 'test2' });
        const all = store.getAllPrompts();
        store.toggleFavorite(all[0].id); // make first one favorite again
        assert.strictEqual(store.getFavorites().length, 1);
    });

    test('recordUsage increments count and sets lastUsedAt', () => {
        const all = store.getAllPrompts();
        store.recordUsage(all[0].id);
        store.recordUsage(all[0].id);
        const p = store.getPrompt(all[0].id)!;
        assert.strictEqual(p.usageCount, 2);
        assert.ok(p.lastUsedAt);
    });

    teardown();
}

// ── Test Group: Search ──────────────────────────────────────────────
console.log('\n🔍 Search');
{
    const store = setup();
    store.addPrompt({ title: 'Debug Python', content: 'Fix the async bug', tags: ['python', 'debug'] });
    store.addPrompt({ title: 'Refactor Java', content: 'Apply SOLID', tags: ['java', 'refactor'] });
    store.addPrompt({ title: 'Write Tests', content: 'Create unit tests for Python', tags: ['python', 'testing'] });

    test('search by title', () => {
        assert.strictEqual(store.searchPrompts('debug').length, 1);
    });

    test('search by content', () => {
        assert.strictEqual(store.searchPrompts('SOLID').length, 1);
    });

    test('search by tag', () => {
        assert.strictEqual(store.searchPrompts('python').length, 2);
    });

    test('search case-insensitive', () => {
        assert.strictEqual(store.searchPrompts('PYTHON').length, 2);
    });

    test('getTopPrompts returns sorted by rating', () => {
        const all = store.getAllPrompts();
        store.updatePrompt(all[0].id, { rating: 5 });
        store.updatePrompt(all[1].id, { rating: 2 });
        store.updatePrompt(all[2].id, { rating: 4 });
        const top = store.getTopPrompts(2);
        assert.strictEqual(top.length, 2);
        assert.strictEqual(top[0].rating, 5);
        assert.strictEqual(top[1].rating, 4);
    });

    teardown();
}

// ── Test Group: Variables ───────────────────────────────────────────
console.log('\n📝 Template Variables');
{
    const store = setup();

    test('extracts {{variables}} from content', () => {
        const p = store.addPrompt({ title: 'V', content: 'Refactor {{PROJECT}} in {{LANGUAGE}} using {{PATTERN}}' });
        assert.deepStrictEqual(p.variables!.sort(), ['LANGUAGE', 'PATTERN', 'PROJECT']);
    });

    test('deduplicates variables', () => {
        const p = store.addPrompt({ title: 'V2', content: '{{X}} and {{X}} and {{Y}}' });
        assert.deepStrictEqual(p.variables!.sort(), ['X', 'Y']);
    });

    test('no variables when none present', () => {
        const p = store.addPrompt({ title: 'V3', content: 'Plain text prompt' });
        assert.deepStrictEqual(p.variables, []);
    });

    teardown();
}

// ── Test Group: Export / Import ─────────────────────────────────────
console.log('\n📤 Export / Import');
{
    const store = setup();
    store.addPrompt({ title: 'E1', content: 'export1' });
    store.addPrompt({ title: 'E2', content: 'export2' });

    test('export produces valid JSON', () => {
        const json = store.exportLibrary();
        const parsed = JSON.parse(json);
        assert.strictEqual(parsed.prompts.length, 2);
    });

    test('import merge adds new prompts', () => {
        const exported = store.exportLibrary();
        const store2 = new TestPromptStore(path.join(TEST_DIR, 'import_test.json'));
        store2.addPrompt({ title: 'Local', content: 'local' });
        const count = store2.importLibrary(exported, true);
        assert.strictEqual(count, 2);
        assert.strictEqual(store2.getAllPrompts().length, 3);
    });

    test('import replace overwrites', () => {
        const exported = store.exportLibrary();
        const store3 = new TestPromptStore(path.join(TEST_DIR, 'replace_test.json'));
        store3.addPrompt({ title: 'WillBeGone', content: 'gone' });
        const count = store3.importLibrary(exported, false);
        assert.strictEqual(count, 2);
        assert.strictEqual(store3.getAllPrompts().length, 2);
    });

    teardown();
}

// ── Test Group: Duplicate ───────────────────────────────────────────
console.log('\n📋 Duplicate');
{
    const store = setup();

    test('duplicatePrompt creates a copy', () => {
        const p = store.addPrompt({ title: 'Original', content: 'abc', tags: ['t1'], rating: 5 });
        const dup = store.duplicatePrompt(p.id);
        assert.ok(dup);
        assert.strictEqual(dup!.title, 'Original (copy)');
        assert.strictEqual(dup!.content, 'abc');
        assert.deepStrictEqual(dup!.tags, ['t1']);
        assert.notStrictEqual(dup!.id, p.id);
        assert.strictEqual(store.getAllPrompts().length, 2);
    });

    test('duplicatePrompt returns undefined for bad ID', () => {
        assert.strictEqual(store.duplicatePrompt('bad'), undefined);
    });

    teardown();
}

// ── Test Group: Persistence ─────────────────────────────────────────
console.log('\n💾 Persistence');
{
    const persistFile = path.join(TEST_DIR, 'persist.json');
    if (!fs.existsSync(TEST_DIR)) { fs.mkdirSync(TEST_DIR, { recursive: true }); }

    test('data persists across store instances', () => {
        const s1 = new TestPromptStore(persistFile);
        s1.addPrompt({ title: 'Persistent', content: 'stay' });
        // Create new instance reading same file
        const s2 = new TestPromptStore(persistFile);
        assert.strictEqual(s2.getAllPrompts().length, 1);
        assert.strictEqual(s2.getAllPrompts()[0].title, 'Persistent');
    });

    teardown();
}

// ── Summary ─────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) { console.log('❌ SOME TESTS FAILED'); process.exit(1); }
else { console.log('✅ ALL TESTS PASSED'); }
