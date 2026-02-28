/**
 * PromptStash - Data model types
 */

export interface PromptSnippet {
    /** Unique identifier */
    id: string;
    /** Short descriptive title */
    title: string;
    /** The actual prompt content */
    content: string;
    /** Category for organization */
    category: string;
    /** Tags for filtering and search */
    tags: string[];
    /** Quality rating 1-5 */
    rating: number;
    /** How many times this prompt was used/inserted */
    usageCount: number;
    /** When this prompt was created */
    createdAt: string;
    /** When this prompt was last modified */
    updatedAt: string;
    /** When this prompt was last used */
    lastUsedAt?: string;
    /** Optional: what language/framework this prompt targets */
    language?: string;
    /** Optional: short description of when to use this prompt */
    description?: string;
    /** Whether this prompt is marked as favorite */
    isFavorite: boolean;
    /** Optional: variables/placeholders in the prompt like {{PROJECT_NAME}} */
    variables?: string[];
}

export interface PromptLibrary {
    version: string;
    prompts: PromptSnippet[];
    categories: string[];
    lastModified: string;
}

export interface PromptSearchResult {
    prompt: PromptSnippet;
    score: number;
    matchedField?: string;
}

export const DEFAULT_CATEGORIES = [
    'General',
    'Code Generation',
    'Debugging',
    'Refactoring',
    'Testing',
    'Documentation',
    'Code Review',
    'Architecture',
    'Data Analysis',
    'Paper Writing',
    'Rebuttal',
    'DevOps',
    'Custom'
];
