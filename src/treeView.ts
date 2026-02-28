/**
 * PromptStash - Tree View Provider
 * Renders the sidebar prompt library organized by category
 */

import * as vscode from 'vscode';
import { PromptStore } from './store';
import { PromptSnippet } from './models';

export type TreeItemType = CategoryItem | PromptItem;

export class PromptTreeProvider implements vscode.TreeDataProvider<TreeItemType> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeItemType | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private mode: 'category' | 'favorites' = 'category';

    constructor(
        private store: PromptStore,
        mode: 'category' | 'favorites' = 'category'
    ) {
        this.mode = mode;
        store.onDidChange(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItemType): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItemType): TreeItemType[] {
        if (this.mode === 'favorites') {
            return this.getFavoriteChildren(element);
        }
        return this.getCategoryChildren(element);
    }

    // ── Category mode ───────────────────────────────────────

    private getCategoryChildren(element?: TreeItemType): TreeItemType[] {
        if (!element) {
            // Root level: show categories that have prompts
            const categories = this.store.getCategories();
            const items: CategoryItem[] = [];

            for (const cat of categories) {
                const prompts = this.store.getByCategory(cat);
                if (prompts.length > 0) {
                    items.push(new CategoryItem(cat, prompts.length));
                }
            }

            // Sort by prompt count (descending)
            items.sort((a, b) => b.count - a.count);
            return items;
        }

        if (element instanceof CategoryItem) {
            const prompts = this.store.getByCategory(element.category);
            return prompts
                .sort((a, b) => b.rating - a.rating || b.usageCount - a.usageCount)
                .map(p => new PromptItem(p));
        }

        return [];
    }

    // ── Favorites mode ──────────────────────────────────────

    private getFavoriteChildren(element?: TreeItemType): TreeItemType[] {
        if (!element) {
            const favorites = this.store.getFavorites();
            return favorites
                .sort((a, b) => b.rating - a.rating)
                .map(p => new PromptItem(p));
        }
        return [];
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

// ── Tree Item: Category ─────────────────────────────────────

export class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly category: string,
        public readonly count: number
    ) {
        super(category, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${count} prompt${count === 1 ? '' : 's'}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'category';
        this.tooltip = `${category} — ${count} prompt(s)`;
    }
}

// ── Tree Item: Prompt ───────────────────────────────────────

export class PromptItem extends vscode.TreeItem {
    constructor(public readonly prompt: PromptSnippet) {
        super(prompt.title, vscode.TreeItemCollapsibleState.None);

        const stars = '★'.repeat(prompt.rating) + '☆'.repeat(5 - prompt.rating);
        const tags = prompt.tags.length > 0 ? ` [${prompt.tags.join(', ')}]` : '';
        const fav = prompt.isFavorite ? '⭐ ' : '';

        this.description = `${stars} · Used ${prompt.usageCount}x`;
        this.tooltip = new vscode.MarkdownString(
            `### ${fav}${prompt.title}\n\n` +
            `**Rating:** ${stars}\n\n` +
            `**Category:** ${prompt.category}${tags}\n\n` +
            `**Used:** ${prompt.usageCount} times\n\n` +
            `---\n\n` +
            `\`\`\`\n${prompt.content.substring(0, 500)}${prompt.content.length > 500 ? '\n...' : ''}\n\`\`\``
        );
        this.tooltip.isTrusted = true;

        this.iconPath = prompt.isFavorite
            ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
            : new vscode.ThemeIcon('note');

        this.contextValue = 'prompt';

        // Single-click → preview in webview
        this.command = {
            command: 'promptStash.editPrompt',
            title: 'View Prompt',
            arguments: [this],
        };
    }
}
