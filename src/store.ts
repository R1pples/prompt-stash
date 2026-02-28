/**
 * PromptStash - Prompt Storage Engine
 * Handles CRUD operations with JSON file-based persistence
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PromptSnippet, PromptLibrary, DEFAULT_CATEGORIES } from './models';

export class PromptStore {
    private library: PromptLibrary;
    private storagePath: string;
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private context: vscode.ExtensionContext) {
        this.storagePath = this.resolveStoragePath();
        this.library = this.load();
    }

    // ── Resolve where to store the library ──────────────────────────────

    private resolveStoragePath(): string {
        const config = vscode.workspace.getConfiguration('promptStash');
        const customPath = config.get<string>('storageLocation');

        if (customPath && customPath.trim()) {
            const dir = path.dirname(customPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            return customPath;
        }

        // Default: use VS Code global storage
        const globalDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(globalDir)) {
            fs.mkdirSync(globalDir, { recursive: true });
        }
        return path.join(globalDir, 'prompt-library.json');
    }

    // ── Load / Save ─────────────────────────────────────────────

    private load(): PromptLibrary {
        try {
            if (fs.existsSync(this.storagePath)) {
                const raw = fs.readFileSync(this.storagePath, 'utf-8');
                const data = JSON.parse(raw) as PromptLibrary;
                // Ensure categories include defaults
                const allCats = new Set([...DEFAULT_CATEGORIES, ...data.categories]);
                data.categories = Array.from(allCats);
                return data;
            }
        } catch (err) {
            console.error('PromptStash: Failed to load library', err);
        }

        return {
            version: '1.0.0',
            prompts: [],
            categories: [...DEFAULT_CATEGORIES],
            lastModified: new Date().toISOString(),
        };
    }

    private save(): void {
        try {
            this.library.lastModified = new Date().toISOString();
            const json = JSON.stringify(this.library, null, 2);
            fs.writeFileSync(this.storagePath, json, 'utf-8');
            this._onDidChange.fire();
        } catch (err) {
            console.error('PromptStash: Failed to save library', err);
            vscode.window.showErrorMessage(`PromptStash: Failed to save — ${err}`);
        }
    }

    // ── Generate unique ID ────────────────────────────────────

    private generateId(): string {
        return `ps_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    // ── Extract {{variables}} from content ──────────────────────

    private extractVariables(content: string): string[] {
        const matches = content.match(/\{\{(\w+)\}\}/g);
        if (!matches) { return []; }
        return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
    }

    // ── CRUD Operations ─────────────────────────────────────

    addPrompt(data: {
        title: string;
        content: string;
        category?: string;
        tags?: string[];
        rating?: number;
        language?: string;
        description?: string;
    }): PromptSnippet {
        const now = new Date().toISOString();
        const prompt: PromptSnippet = {
            id: this.generateId(),
            title: data.title,
            content: data.content,
            category: data.category || 'General',
            tags: data.tags || [],
            rating: data.rating || 3,
            usageCount: 0,
            createdAt: now,
            updatedAt: now,
            isFavorite: false,
            language: data.language,
            description: data.description,
            variables: this.extractVariables(data.content),
        };

        // Ensure the category exists
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
        const updated = {
            ...existing,
            ...updates,
            id: existing.id, // Prevent ID override
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        };

        if (updates.content) {
            updated.variables = this.extractVariables(updates.content);
        }

        if (updates.category && !this.library.categories.includes(updates.category)) {
            this.library.categories.push(updates.category);
        }

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

    getPrompt(id: string): PromptSnippet | undefined {
        return this.library.prompts.find(p => p.id === id);
    }

    getAllPrompts(): PromptSnippet[] {
        return [...this.library.prompts];
    }

    getFavorites(): PromptSnippet[] {
        return this.library.prompts.filter(p => p.isFavorite);
    }

    getByCategory(category: string): PromptSnippet[] {
        return this.library.prompts.filter(p => p.category === category);
    }

    getByTag(tag: string): PromptSnippet[] {
        return this.library.prompts.filter(p => p.tags.includes(tag));
    }

    getCategories(): string[] {
        return [...this.library.categories];
    }

    getAllTags(): string[] {
        const tags = new Set<string>();
        for (const p of this.library.prompts) {
            for (const t of p.tags) { tags.add(t); }
        }
        return Array.from(tags).sort();
    }

    // ── Usage tracking ──────────────────────────────────────

    recordUsage(id: string): void {
        const prompt = this.library.prompts.find(p => p.id === id);
        if (prompt) {
            prompt.usageCount++;
            prompt.lastUsedAt = new Date().toISOString();
            this.save();
        }
    }

    // ── Toggle favorite ─────────────────────────────────────

    toggleFavorite(id: string): boolean | undefined {
        const prompt = this.library.prompts.find(p => p.id === id);
        if (!prompt) { return undefined; }
        prompt.isFavorite = !prompt.isFavorite;
        this.save();
        return prompt.isFavorite;
    }

    // ── Simple text search (fuzzy search done at higher level) ──────

    searchPrompts(query: string): PromptSnippet[] {
        const q = query.toLowerCase();
        return this.library.prompts.filter(p =>
            p.title.toLowerCase().includes(q) ||
            p.content.toLowerCase().includes(q) ||
            p.tags.some(t => t.toLowerCase().includes(q)) ||
            (p.description && p.description.toLowerCase().includes(q))
        );
    }

    // ── Get top prompts by rating and usage ─────────────────────

    getTopPrompts(limit: number = 10): PromptSnippet[] {
        return [...this.library.prompts]
            .sort((a, b) => {
                // Sort by rating first, then by usage count
                const ratingDiff = b.rating - a.rating;
                if (ratingDiff !== 0) { return ratingDiff; }
                return b.usageCount - a.usageCount;
            })
            .slice(0, limit);
    }

    // ── Export / Import ─────────────────────────────────────

    exportLibrary(): string {
        return JSON.stringify(this.library, null, 2);
    }

    importLibrary(json: string, merge: boolean = true): number {
        const imported = JSON.parse(json) as PromptLibrary;
        let count = 0;

        if (merge) {
            const existingIds = new Set(this.library.prompts.map(p => p.id));
            for (const p of imported.prompts) {
                if (!existingIds.has(p.id)) {
                    this.library.prompts.push(p);
                    count++;
                }
            }
            const allCats = new Set([...this.library.categories, ...imported.categories]);
            this.library.categories = Array.from(allCats);
        } else {
            count = imported.prompts.length;
            this.library = imported;
        }

        this.save();
        return count;
    }

    // ── Duplicate a prompt ────────────────────────────────────

    duplicatePrompt(id: string): PromptSnippet | undefined {
        const original = this.getPrompt(id);
        if (!original) { return undefined; }

        return this.addPrompt({
            title: `${original.title} (copy)`,
            content: original.content,
            category: original.category,
            tags: [...original.tags],
            rating: original.rating,
            language: original.language,
            description: original.description,
        });
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
