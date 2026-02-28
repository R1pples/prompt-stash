/**
 * PromptStash - Extension Entry Point
 * 
 * Save, organize, and reuse your best AI coding prompts.
 * Smart completion for vibe coding workflows.
 */

import * as vscode from 'vscode';
import { PromptStore } from './store';
import { PromptTreeProvider } from './treeView';
import { PromptCompletionProvider, PromptInlineCompletionProvider } from './completion';
import {
    savePromptCommand,
    saveSelectionCommand,
    editPromptCommand,
    deletePromptCommand,
    ratePromptCommand,
    searchAndInsertCommand,
    insertPromptCommand,
    copyPromptCommand,
    duplicatePromptCommand,
    exportLibraryCommand,
    importLibraryCommand,
} from './commands';

export function activate(context: vscode.ExtensionContext) {
    console.log('PromptStash is now active!');

    // ── Initialize Store ────────────────────────────────────
    const store = new PromptStore(context);

    // ── Tree View Providers ─────────────────────────────────
    const libraryTreeProvider = new PromptTreeProvider(store, 'category');
    const favoritesTreeProvider = new PromptTreeProvider(store, 'favorites');

    vscode.window.registerTreeDataProvider('promptStash.library', libraryTreeProvider);
    vscode.window.registerTreeDataProvider('promptStash.favorites', favoritesTreeProvider);

    // ── Completion Providers ────────────────────────────────
    const config = vscode.workspace.getConfiguration('promptStash');
    const completionFileTypes = config.get<string[]>('completionFileTypes', [
        'markdown', 'plaintext', 'github-copilot-chat',
    ]);

    const selectors: vscode.DocumentSelector = completionFileTypes.map(lang => ({
        language: lang,
    }));

    // Standard IntelliSense completion
    const completionProvider = new PromptCompletionProvider(store);
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(selectors, completionProvider, '/')
    );

    // Inline (ghost text) completion
    const inlineProvider = new PromptInlineCompletionProvider(store);
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(selectors, inlineProvider)
    );

    // ── Register Commands ───────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('promptStash.savePrompt', () =>
            savePromptCommand(store)
        ),
        vscode.commands.registerCommand('promptStash.saveSelection', () =>
            saveSelectionCommand(store)
        ),
        vscode.commands.registerCommand('promptStash.editPrompt', (item) =>
            editPromptCommand(store, context, item)
        ),
        vscode.commands.registerCommand('promptStash.deletePrompt', (item) =>
            deletePromptCommand(store, item)
        ),
        vscode.commands.registerCommand('promptStash.ratePrompt', (item) =>
            ratePromptCommand(store, item)
        ),
        vscode.commands.registerCommand('promptStash.searchAndInsert', () =>
            searchAndInsertCommand(store)
        ),
        vscode.commands.registerCommand('promptStash.insertPrompt', (item) =>
            insertPromptCommand(store, item)
        ),
        vscode.commands.registerCommand('promptStash.copyPrompt', (item) =>
            copyPromptCommand(store, item)
        ),
        vscode.commands.registerCommand('promptStash.duplicatePrompt', (item) =>
            duplicatePromptCommand(store, item)
        ),
        vscode.commands.registerCommand('promptStash.refreshLibrary', () => {
            libraryTreeProvider.refresh();
            favoritesTreeProvider.refresh();
        }),
        vscode.commands.registerCommand('promptStash.exportLibrary', () =>
            exportLibraryCommand(store)
        ),
        vscode.commands.registerCommand('promptStash.importLibrary', () =>
            importLibraryCommand(store)
        ),
        // Internal command to track usage from completion items
        vscode.commands.registerCommand('promptStash._recordUsage', (promptId: string) => {
            store.recordUsage(promptId);
        }),
    );

    // ── Status Bar ──────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(bookmark) PromptStash';
    statusBar.tooltip = 'Search & insert a saved prompt';
    statusBar.command = 'promptStash.searchAndInsert';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── Cleanup ─────────────────────────────────────────────
    context.subscriptions.push({
        dispose: () => {
            store.dispose();
            libraryTreeProvider.dispose();
            favoritesTreeProvider.dispose();
        }
    });
}

export function deactivate() {
    console.log('PromptStash deactivated.');
}
