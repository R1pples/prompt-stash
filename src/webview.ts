/**
 * PromptStash - Webview Editor
 * Rich panel for viewing/editing prompt details
 */

import * as vscode from 'vscode';
import { PromptStore } from './store';
import { PromptSnippet, DEFAULT_CATEGORIES } from './models';

let currentPanel: vscode.WebviewPanel | undefined;

export function showPromptEditor(
    store: PromptStore,
    context: vscode.ExtensionContext,
    promptId: string
): void {
    const prompt = store.getPrompt(promptId);
    if (!prompt) {
        vscode.window.showErrorMessage('Prompt not found.');
        return;
    }

    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        currentPanel = vscode.window.createWebviewPanel(
            'promptStash.editor',
            `Prompt: ${prompt.title}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        currentPanel.onDidDispose(() => {
            currentPanel = undefined;
        });
    }

    currentPanel.title = `Prompt: ${prompt.title}`;
    currentPanel.webview.html = getWebviewContent(prompt, store.getCategories(), store.getAllTags());

    // Handle messages from webview
    currentPanel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'save': {
                    store.updatePrompt(promptId, {
                        title: message.data.title,
                        content: message.data.content,
                        category: message.data.category,
                        tags: message.data.tags,
                        rating: message.data.rating,
                        description: message.data.description,
                    });
                    vscode.window.showInformationMessage(`✅ Updated: "${message.data.title}"`);
                    // Refresh webview with updated data
                    const updated = store.getPrompt(promptId);
                    if (updated && currentPanel) {
                        currentPanel.webview.html = getWebviewContent(updated, store.getCategories(), store.getAllTags());
                    }
                    break;
                }
                case 'toggleFavorite': {
                    store.toggleFavorite(promptId);
                    const updated = store.getPrompt(promptId);
                    if (updated && currentPanel) {
                        currentPanel.webview.html = getWebviewContent(updated, store.getCategories(), store.getAllTags());
                    }
                    break;
                }
                case 'copy': {
                    await vscode.env.clipboard.writeText(message.data);
                    store.recordUsage(promptId);
                    vscode.window.showInformationMessage('Copied to clipboard!');
                    break;
                }
                case 'insert': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        await editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, message.data);
                        });
                        store.recordUsage(promptId);
                    }
                    break;
                }
            }
        },
        undefined,
        context.subscriptions
    );
}

function getWebviewContent(
    prompt: PromptSnippet,
    categories: string[],
    allTags: string[]
): string {
    const escapedContent = escapeHtml(prompt.content);
    const categoriesOptions = categories
        .map(c => `<option value="${escapeHtml(c)}" ${c === prompt.category ? 'selected' : ''}>${escapeHtml(c)}</option>`)
        .join('\n');

    return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    :root {
        --spacing-xs: 4px;
        --spacing-sm: 8px;
        --spacing-md: 16px;
        --spacing-lg: 24px;
    }
    body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        padding: var(--spacing-lg);
        line-height: 1.6;
    }
    h1 {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: 1.4em;
        margin-bottom: var(--spacing-md);
    }
    .fav-btn {
        background: none;
        border: none;
        font-size: 1.3em;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
    }
    .fav-btn:hover {
        background: var(--vscode-toolbar-hoverBackground);
    }
    .meta {
        display: flex;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
        font-size: 0.85em;
        color: var(--vscode-descriptionForeground);
        flex-wrap: wrap;
    }
    .meta span {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .form-group {
        margin-bottom: var(--spacing-md);
    }
    label {
        display: block;
        font-weight: 600;
        margin-bottom: var(--spacing-xs);
        font-size: 0.9em;
        color: var(--vscode-foreground);
    }
    input, select, textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 10px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 4px;
        font-family: inherit;
        font-size: 0.95em;
    }
    input:focus, select:focus, textarea:focus {
        outline: none;
        border-color: var(--vscode-focusBorder);
    }
    textarea {
        min-height: 200px;
        resize: vertical;
        font-family: var(--vscode-editor-font-family), monospace;
        font-size: var(--vscode-editor-font-size, 13px);
        line-height: 1.5;
    }
    .rating {
        display: flex;
        gap: 2px;
        font-size: 1.4em;
    }
    .rating .star {
        cursor: pointer;
        color: var(--vscode-descriptionForeground);
        transition: color 0.1s;
    }
    .rating .star.active {
        color: #f5a623;
    }
    .rating .star:hover {
        color: #f5a623;
    }
    .tag-container {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        margin-bottom: var(--spacing-sm);
    }
    .tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.8em;
    }
    .tag .remove {
        cursor: pointer;
        font-weight: bold;
        opacity: 0.7;
    }
    .tag .remove:hover {
        opacity: 1;
    }
    .actions {
        display: flex;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-lg);
    }
    button {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9em;
        font-weight: 500;
    }
    .btn-primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .btn-primary:hover {
        background: var(--vscode-button-hoverBackground);
    }
    .btn-secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    .variables-info {
        background: var(--vscode-textBlockQuote-background);
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        padding: var(--spacing-sm) var(--spacing-md);
        margin-top: var(--spacing-sm);
        font-size: 0.85em;
        border-radius: 0 4px 4px 0;
    }
    .char-count {
        text-align: right;
        font-size: 0.8em;
        color: var(--vscode-descriptionForeground);
        margin-top: 2px;
    }
</style>
</head>
<body>
    <h1>
        <button class="fav-btn" onclick="toggleFav()" title="Toggle favorite">
            ${prompt.isFavorite ? '⭐' : '☆'}
        </button>
        <input id="title" type="text" value="${escapeHtml(prompt.title)}" 
               style="border: none; background: transparent; font-size: inherit; font-weight: bold; flex: 1; padding: 0;" />
    </h1>

    <div class="meta">
        <span>📅 Created: ${new Date(prompt.createdAt).toLocaleDateString()}</span>
        <span>✏️ Modified: ${new Date(prompt.updatedAt).toLocaleDateString()}</span>
        <span>🔄 Used: ${prompt.usageCount} times</span>
        ${prompt.lastUsedAt ? `<span>🕐 Last used: ${new Date(prompt.lastUsedAt).toLocaleDateString()}</span>` : ''}
    </div>

    <div class="form-group">
        <label>Category</label>
        <select id="category">
            ${categoriesOptions}
        </select>
    </div>

    <div class="form-group">
        <label>Rating</label>
        <div class="rating" id="rating">
            ${[1, 2, 3, 4, 5].map(i =>
                `<span class="star ${i <= prompt.rating ? 'active' : ''}" data-value="${i}" onclick="setRating(${i})">★</span>`
            ).join('')}
        </div>
    </div>

    <div class="form-group">
        <label>Tags</label>
        <div class="tag-container" id="tags">
            ${prompt.tags.map(t => `<span class="tag">${escapeHtml(t)} <span class="remove" onclick="removeTag('${escapeHtml(t)}')">×</span></span>`).join('')}
        </div>
        <input id="tagInput" type="text" placeholder="Type a tag and press Enter" 
               onkeydown="if(event.key==='Enter'){addTag();event.preventDefault();}" />
    </div>

    <div class="form-group">
        <label>Description (optional)</label>
        <input id="description" type="text" value="${escapeHtml(prompt.description || '')}" 
               placeholder="When to use this prompt..." />
    </div>

    <div class="form-group">
        <label>Prompt Content</label>
        <textarea id="content" spellcheck="false">${escapedContent}</textarea>
        <div class="char-count"><span id="charCount">${prompt.content.length}</span> characters</div>
        ${prompt.variables && prompt.variables.length > 0
            ? `<div class="variables-info">
                 💡 <strong>Variables detected:</strong> ${prompt.variables.map(v => `<code>{{${v}}}</code>`).join(', ')}
                 <br><small>These will be prompted for replacement when inserting.</small>
               </div>`
            : ''}
    </div>

    <div class="actions">
        <button class="btn-primary" onclick="save()">💾 Save Changes</button>
        <button class="btn-secondary" onclick="copyPrompt()">📋 Copy to Clipboard</button>
        <button class="btn-secondary" onclick="insertPrompt()">📝 Insert at Cursor</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentRating = ${prompt.rating};
        let currentTags = ${JSON.stringify(prompt.tags)};

        function setRating(val) {
            currentRating = val;
            document.querySelectorAll('.star').forEach((el, i) => {
                el.classList.toggle('active', i < val);
            });
        }

        function addTag() {
            const input = document.getElementById('tagInput');
            const tag = input.value.trim();
            if (tag && !currentTags.includes(tag)) {
                currentTags.push(tag);
                renderTags();
            }
            input.value = '';
        }

        function removeTag(tag) {
            currentTags = currentTags.filter(t => t !== tag);
            renderTags();
        }

        function renderTags() {
            const container = document.getElementById('tags');
            container.innerHTML = currentTags.map(t => 
                '<span class="tag">' + t + ' <span class="remove" onclick="removeTag(\\'' + t + '\\')">×</span></span>'
            ).join('');
        }

        function save() {
            vscode.postMessage({
                command: 'save',
                data: {
                    title: document.getElementById('title').value,
                    content: document.getElementById('content').value,
                    category: document.getElementById('category').value,
                    rating: currentRating,
                    tags: currentTags,
                    description: document.getElementById('description').value,
                }
            });
        }

        function toggleFav() {
            vscode.postMessage({ command: 'toggleFavorite' });
        }

        function copyPrompt() {
            vscode.postMessage({ command: 'copy', data: document.getElementById('content').value });
        }

        function insertPrompt() {
            vscode.postMessage({ command: 'insert', data: document.getElementById('content').value });
        }

        // Character count
        document.getElementById('content').addEventListener('input', function() {
            document.getElementById('charCount').textContent = this.value.length;
        });
    </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
