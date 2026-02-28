/**
 * PromptStash - Inline Completion Provider
 * Provides prompt suggestions when typing in markdown/prompt/chat files
 * 
 * Trigger: type the configured prefix (default "/ps") followed by a space or keyword
 */

import * as vscode from 'vscode';
import { PromptStore } from './store';
import { PromptSnippet } from './models';

export class PromptCompletionProvider implements vscode.CompletionItemProvider {
    constructor(private store: PromptStore) {}

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] | undefined {
        const config = vscode.workspace.getConfiguration('promptStash');
        const enabled = config.get<boolean>('enableInlineCompletion', true);
        if (!enabled) { return undefined; }

        const triggerPrefix = config.get<string>('triggerPrefix', '/ps');
        const maxResults = config.get<number>('maxCompletionResults', 10);

        // Get the current line text up to the cursor
        const linePrefix = document.lineAt(position).text.substring(0, position.character);

        // Check if the line contains our trigger prefix
        const triggerIndex = linePrefix.lastIndexOf(triggerPrefix);
        if (triggerIndex === -1) { return undefined; }

        // Extract the search query after the trigger prefix
        const query = linePrefix.substring(triggerIndex + triggerPrefix.length).trim();

        // Get matching prompts
        let prompts: PromptSnippet[];
        if (query.length === 0) {
            // Show top-rated prompts
            prompts = this.store.getTopPrompts(maxResults);
        } else {
            // Search by query
            prompts = this.store.searchPrompts(query).slice(0, maxResults);
        }

        if (prompts.length === 0) { return undefined; }

        // Create IntelliSense completion range that replaces the trigger + query
        const replaceRange = new vscode.Range(
            position.line, triggerIndex,
            position.line, position.character
        );

        return prompts.map((prompt, index) => {
            const item = new vscode.CompletionItem(
                `$(bookmark) ${prompt.title}`,
                vscode.CompletionItemKind.Snippet
            );

            item.detail = `★${'★'.repeat(prompt.rating - 1)} | ${prompt.category} | Used ${prompt.usageCount}x`;
            item.documentation = new vscode.MarkdownString(
                `### ${prompt.title}\n\n` +
                `**Tags:** ${prompt.tags.join(', ') || 'none'}\n\n` +
                `---\n\n\`\`\`\n${prompt.content}\n\`\`\``
            );

            // The text that will be inserted
            item.insertText = prompt.content;
            item.range = replaceRange;
            item.sortText = `${String(index).padStart(3, '0')}`;
            item.filterText = `${triggerPrefix} ${prompt.title} ${prompt.tags.join(' ')} ${prompt.category}`;

            // Track usage after insertion
            item.command = {
                command: 'promptStash._recordUsage',
                title: 'Record Usage',
                arguments: [prompt.id],
            };

            return item;
        });
    }
}

/**
 * Inline Completion Provider for ghost-text style suggestions
 * Shows prompt completions as ghost text when typing the trigger prefix
 */
export class PromptInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    constructor(private store: PromptStore) {}

    provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): vscode.InlineCompletionItem[] | undefined {
        const config = vscode.workspace.getConfiguration('promptStash');
        const enabled = config.get<boolean>('enableInlineCompletion', true);
        if (!enabled) { return undefined; }

        const triggerPrefix = config.get<string>('triggerPrefix', '/ps');

        const linePrefix = document.lineAt(position).text.substring(0, position.character);
        const triggerIndex = linePrefix.lastIndexOf(triggerPrefix);
        if (triggerIndex === -1) { return undefined; }

        const query = linePrefix.substring(triggerIndex + triggerPrefix.length).trim();
        if (query.length < 2) { return undefined; } // Need at least 2 chars for inline

        const prompts = this.store.searchPrompts(query).slice(0, 3);
        if (prompts.length === 0) { return undefined; }

        const replaceRange = new vscode.Range(
            position.line, triggerIndex,
            position.line, position.character
        );

        return prompts.map(prompt => {
            return new vscode.InlineCompletionItem(
                prompt.content,
                replaceRange
            );
        });
    }
}
