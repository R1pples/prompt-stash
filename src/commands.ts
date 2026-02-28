/**
 * PromptStash - Commands
 * All user-facing commands for saving, editing, deleting, searching prompts
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { PromptStore } from './store';
import { PromptItem } from './treeView';
import { DEFAULT_CATEGORIES } from './models';
import { showPromptEditor } from './webview';

// ── Save New Prompt (from scratch) ────────────────────────

export async function savePromptCommand(store: PromptStore): Promise<void> {
    // Step 1: Get title
    const title = await vscode.window.showInputBox({
        prompt: 'Give this prompt a short title',
        placeHolder: 'e.g. "Refactor with SOLID principles"',
        validateInput: (v) => v.trim() ? null : 'Title cannot be empty',
    });
    if (!title) { return; }

    // Step 2: Get content via a temporary document
    const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: `<!-- Write or paste your prompt below. Save & close when done. -->\n\n`,
    });
    const editor = await vscode.window.showTextDocument(doc);

    // Wait for user to indicate they're done
    const action = await vscode.window.showInformationMessage(
        'Paste/write your prompt in the editor, then click "Save Prompt" when done.',
        'Save Prompt',
        'Cancel'
    );

    if (action !== 'Save Prompt') { return; }

    let content = doc.getText().replace(/^<!-- .* -->\n*/m, '').trim();
    if (!content) {
        vscode.window.showWarningMessage('Prompt content is empty. Aborted.');
        return;
    }

    // Step 3: Pick category
    const categories = store.getCategories();
    const catPick = await vscode.window.showQuickPick(
        [...categories, '$(add) New Category...'],
        { placeHolder: 'Select a category' }
    );
    let category = catPick;
    if (catPick === '$(add) New Category...') {
        category = await vscode.window.showInputBox({
            prompt: 'Enter new category name',
        });
    }
    if (!category) { category = 'General'; }

    // Step 4: Tags
    const tagInput = await vscode.window.showInputBox({
        prompt: 'Tags (comma-separated, optional)',
        placeHolder: 'e.g. python, refactor, async',
    });
    const tags = tagInput
        ? tagInput.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    // Step 5: Rating
    const ratingPick = await vscode.window.showQuickPick(
        ['★★★★★ (5)', '★★★★☆ (4)', '★★★☆☆ (3)', '★★☆☆☆ (2)', '★☆☆☆☆ (1)'],
        { placeHolder: 'Rate this prompt' }
    );
    const rating = ratingPick ? parseInt(ratingPick.match(/\((\d)\)/)?.[1] || '3') : 3;

    // Save
    const prompt = store.addPrompt({ title, content, category, tags, rating });
    vscode.window.showInformationMessage(`✅ Saved prompt: "${prompt.title}"`);
}

// ── Save Selection as Prompt ──────────────────────────────

export async function saveSelectionCommand(store: PromptStore): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor with selection.');
        return;
    }

    const selection = editor.document.getText(editor.selection);
    if (!selection.trim()) {
        vscode.window.showWarningMessage('Please select some text first.');
        return;
    }

    const title = await vscode.window.showInputBox({
        prompt: 'Title for this prompt snippet',
        placeHolder: 'e.g. "Debug async race condition"',
        validateInput: (v) => v.trim() ? null : 'Title cannot be empty',
    });
    if (!title) { return; }

    const categories = store.getCategories();
    const catPick = await vscode.window.showQuickPick(
        [...categories, '$(add) New Category...'],
        { placeHolder: 'Select a category' }
    );
    let category = catPick;
    if (catPick === '$(add) New Category...') {
        category = await vscode.window.showInputBox({ prompt: 'New category name' });
    }
    if (!category) { category = 'General'; }

    const tagInput = await vscode.window.showInputBox({
        prompt: 'Tags (comma-separated, optional)',
        placeHolder: 'e.g. python, debugging',
    });
    const tags = tagInput
        ? tagInput.split(',').map(t => t.trim()).filter(Boolean)
        : [];

    const prompt = store.addPrompt({
        title,
        content: selection.trim(),
        category,
        tags,
        rating: 3,
    });
    vscode.window.showInformationMessage(`✅ Saved selection as prompt: "${prompt.title}"`);
}

// ── Edit Prompt (opens Webview) ───────────────────────────

export async function editPromptCommand(
    store: PromptStore,
    context: vscode.ExtensionContext,
    item?: PromptItem
): Promise<void> {
    let promptId: string | undefined;

    if (item instanceof PromptItem) {
        promptId = item.prompt.id;
    } else {
        // Let user pick from all prompts
        const allPrompts = store.getAllPrompts();
        const pick = await vscode.window.showQuickPick(
            allPrompts.map(p => ({
                label: p.title,
                description: `${p.category} · ${'★'.repeat(p.rating)}`,
                detail: p.content.substring(0, 100),
                id: p.id,
            })),
            { placeHolder: 'Select a prompt to edit' }
        );
        if (pick) { promptId = (pick as any).id; }
    }

    if (!promptId) { return; }
    showPromptEditor(store, context, promptId);
}

// ── Delete Prompt ───────────────────────────────────────

export async function deletePromptCommand(store: PromptStore, item?: PromptItem): Promise<void> {
    let promptId: string | undefined;
    let promptTitle: string | undefined;

    if (item instanceof PromptItem) {
        promptId = item.prompt.id;
        promptTitle = item.prompt.title;
    } else {
        const allPrompts = store.getAllPrompts();
        const pick = await vscode.window.showQuickPick(
            allPrompts.map(p => ({ label: p.title, id: p.id })),
            { placeHolder: 'Select a prompt to delete' }
        );
        if (pick) {
            promptId = (pick as any).id;
            promptTitle = pick.label;
        }
    }

    if (!promptId) { return; }

    const confirm = await vscode.window.showWarningMessage(
        `Delete prompt "${promptTitle}"?`,
        { modal: true },
        'Delete'
    );

    if (confirm === 'Delete') {
        store.deletePrompt(promptId);
        vscode.window.showInformationMessage(`Deleted prompt: "${promptTitle}"`);
    }
}

// ── Rate Prompt ─────────────────────────────────────────

export async function ratePromptCommand(store: PromptStore, item?: PromptItem): Promise<void> {
    let promptId: string | undefined;

    if (item instanceof PromptItem) {
        promptId = item.prompt.id;
    }

    if (!promptId) { return; }

    const ratingPick = await vscode.window.showQuickPick(
        ['★★★★★ (5)', '★★★★☆ (4)', '★★★☆☆ (3)', '★★☆☆☆ (2)', '★☆☆☆☆ (1)'],
        { placeHolder: 'Rate this prompt' }
    );

    if (ratingPick) {
        const rating = parseInt(ratingPick.match(/\((\d)\)/)?.[1] || '3');
        store.updatePrompt(promptId, { rating });
    }
}

// ── Search & Insert ─────────────────────────────────────

export async function searchAndInsertCommand(store: PromptStore): Promise<void> {
    const allPrompts = store.getAllPrompts();
    if (allPrompts.length === 0) {
        vscode.window.showInformationMessage('No prompts saved yet. Save your first prompt!');
        return;
    }

    const items = allPrompts
        .sort((a, b) => b.rating - a.rating || b.usageCount - a.usageCount)
        .map(p => ({
            label: `${p.isFavorite ? '⭐ ' : ''}${p.title}`,
            description: `${p.category} · ${'★'.repeat(p.rating)} · Used ${p.usageCount}x`,
            detail: p.content.substring(0, 150).replace(/\n/g, ' '),
            prompt: p,
        }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search prompts... (type to filter)',
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!picked) { return; }

    let content = picked.prompt.content;

    // Resolve variables if any
    if (picked.prompt.variables && picked.prompt.variables.length > 0) {
        for (const varName of picked.prompt.variables) {
            const value = await vscode.window.showInputBox({
                prompt: `Enter value for {{${varName}}}`,
                placeHolder: varName,
            });
            if (value !== undefined) {
                content = content.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), value);
            }
        }
    }

    // Insert into active editor or clipboard
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, content);
        });
        store.recordUsage(picked.prompt.id);
        vscode.window.showInformationMessage(`Inserted: "${picked.prompt.title}"`);
    } else {
        await vscode.env.clipboard.writeText(content);
        store.recordUsage(picked.prompt.id);
        vscode.window.showInformationMessage(`Copied to clipboard: "${picked.prompt.title}"`);
    }
}

// ── Insert Prompt (from tree item) ────────────────────────

export async function insertPromptCommand(store: PromptStore, item?: PromptItem): Promise<void> {
    if (!(item instanceof PromptItem)) { return; }

    const editor = vscode.window.activeTextEditor;
    const content = item.prompt.content;

    if (editor) {
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, content);
        });
    } else {
        await vscode.env.clipboard.writeText(content);
        vscode.window.showInformationMessage('Copied to clipboard!');
    }

    store.recordUsage(item.prompt.id);
}

// ── Copy Prompt to Clipboard ──────────────────────────────

export async function copyPromptCommand(store: PromptStore, item?: PromptItem): Promise<void> {
    if (!(item instanceof PromptItem)) { return; }
    await vscode.env.clipboard.writeText(item.prompt.content);
    store.recordUsage(item.prompt.id);
    vscode.window.showInformationMessage(`Copied "${item.prompt.title}" to clipboard`);
}

// ── Duplicate Prompt ──────────────────────────────────────

export async function duplicatePromptCommand(store: PromptStore, item?: PromptItem): Promise<void> {
    if (!(item instanceof PromptItem)) { return; }
    const dup = store.duplicatePrompt(item.prompt.id);
    if (dup) {
        vscode.window.showInformationMessage(`Duplicated as "${dup.title}"`);
    }
}

// ── Export Library ──────────────────────────────────────

export async function exportLibraryCommand(store: PromptStore): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('prompt-library.json'),
        filters: { 'JSON': ['json'] },
    });
    if (!uri) { return; }

    const json = store.exportLibrary();
    fs.writeFileSync(uri.fsPath, json, 'utf-8');
    vscode.window.showInformationMessage(`Library exported to ${uri.fsPath}`);
}

// ── Import Library ──────────────────────────────────────

export async function importLibraryCommand(store: PromptStore): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { 'JSON': ['json'] },
    });
    if (!uris || uris.length === 0) { return; }

    const json = fs.readFileSync(uris[0].fsPath, 'utf-8');

    const mergeChoice = await vscode.window.showQuickPick(
        ['Merge (keep existing + add new)', 'Replace (overwrite everything)'],
        { placeHolder: 'How to import?' }
    );
    if (!mergeChoice) { return; }

    const merge = mergeChoice.startsWith('Merge');
    const count = store.importLibrary(json, merge);
    vscode.window.showInformationMessage(`Imported ${count} prompt(s).`);
}
