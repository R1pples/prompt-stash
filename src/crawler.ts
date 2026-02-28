/**
 * PromptStash - Open Source Prompt Crawler
 * Fetches & parses prompts from popular GitHub repositories
 */

import * as https from 'https';
import * as http from 'http';

export interface CrawledPrompt {
    title: string;
    content: string;
    source: string;       // repo URL
    sourceId: string;     // unique id from source
    category: string;
    tags: string[];
    fetchedAt: string;
}

export interface PromptSource {
    name: string;
    owner: string;
    repo: string;
    branch: string;
    /** Path to the raw data file (CSV, JSON, YAML, or README) */
    filePath: string;
    /** Parser type */
    format: 'csv' | 'json' | 'markdown-sections';
    /** URL to check last commit date for freshness */
    lastCheckedAt?: string;
    lastCommitSha?: string;
}

// ── Default sources ─────────────────────────────────────

export const DEFAULT_SOURCES: PromptSource[] = [
    {
        name: 'Awesome ChatGPT Prompts',
        owner: 'f',
        repo: 'prompts.chat',
        branch: 'main',
        filePath: 'prompts.csv',
        format: 'csv',
    },
    {
        name: 'Awesome AI System Prompts',
        owner: 'dontriskit',
        repo: 'awesome-ai-system-prompts',
        branch: 'main',
        filePath: 'README.md',
        format: 'markdown-sections',
    },
];

// ── HTTP fetcher (Node.js native, no extra deps) ─────────────────

export function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'PromptStash/0.1' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                if (res.headers.location) {
                    return fetchUrl(res.headers.location).then(resolve).catch(reject);
                }
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// ── CSV Parser (for f/prompts.chat) ───────────────────────

export function parseCSV(csv: string, source: PromptSource): CrawledPrompt[] {
    const lines = csv.split('\n');
    const results: CrawledPrompt[] = [];

    // First line is header: "act","prompt"
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) { continue; }

        // Parse CSV with quoted fields
        const match = line.match(/^"([^"]*(?:""[^"]*)*)","([^"]*(?:""[^"]*)*)"$/);
        if (match) {
            const title = match[1].replace(/""/g, '"');
            const content = match[2].replace(/""/g, '"');
            if (title && content && content.length > 20) {
                results.push({
                    title,
                    content,
                    source: `https://github.com/${source.owner}/${source.repo}`,
                    sourceId: `${source.owner}/${source.repo}:${i}`,
                    category: categorizePrompt(title, content),
                    tags: extractTags(title, content),
                    fetchedAt: new Date().toISOString(),
                });
            }
        }
    }
    return results;
}

// ── Markdown Section Parser (for README-based repos) ────────────

export function parseMarkdownSections(md: string, source: PromptSource): CrawledPrompt[] {
    const results: CrawledPrompt[] = [];
    // Split by ## headers
    const sections = md.split(/^##\s+/m).filter(Boolean);

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const titleEnd = section.indexOf('\n');
        if (titleEnd === -1) { continue; }

        const title = section.substring(0, titleEnd).trim().replace(/[#*`]/g, '');
        const body = section.substring(titleEnd).trim();

        // Look for code blocks which often contain the actual prompt
        const codeBlockMatch = body.match(/```(?:\w*\n)?([\s\S]*?)```/);
        const content = codeBlockMatch ? codeBlockMatch[1].trim() : '';

        if (title && content && content.length > 30) {
            results.push({
                title: title.substring(0, 100),
                content,
                source: `https://github.com/${source.owner}/${source.repo}`,
                sourceId: `${source.owner}/${source.repo}:section-${i}`,
                category: categorizePrompt(title, content),
                tags: extractTags(title, content),
                fetchedAt: new Date().toISOString(),
            });
        }
    }
    return results;
}

// ── JSON Parser ─────────────────────────────────────────

export function parseJSONPrompts(jsonStr: string, source: PromptSource): CrawledPrompt[] {
    const results: CrawledPrompt[] = [];
    try {
        const data = JSON.parse(jsonStr);
        const items = Array.isArray(data) ? data : (data.prompts || data.items || []);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const title = item.title || item.act || item.name || `Prompt ${i + 1}`;
            const content = item.content || item.prompt || item.text || '';
            if (content.length > 20) {
                results.push({
                    title, content,
                    source: `https://github.com/${source.owner}/${source.repo}`,
                    sourceId: `${source.owner}/${source.repo}:${i}`,
                    category: categorizePrompt(title, content),
                    tags: extractTags(title, content),
                    fetchedAt: new Date().toISOString(),
                });
            }
        }
    } catch { /* invalid JSON, return empty */ }
    return results;
}

// ── Auto-categorize based on keywords ─────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
    'Code Generation': ['code', 'program', 'developer', 'engineer', 'implement', 'build', 'create app'],
    'Debugging': ['debug', 'fix', 'error', 'bug', 'troubleshoot', 'issue'],
    'Refactoring': ['refactor', 'clean', 'improve code', 'optimize', 'SOLID', 'design pattern'],
    'Testing': ['test', 'unit test', 'integration test', 'QA', 'quality'],
    'Documentation': ['document', 'readme', 'comment', 'docstring', 'api doc'],
    'Code Review': ['review', 'pull request', 'code review', 'feedback'],
    'Architecture': ['architect', 'system design', 'microservice', 'database', 'infrastructure'],
    'Data Analysis': ['data', 'analysis', 'pandas', 'SQL', 'visualization', 'statistics'],
    'Paper Writing': ['paper', 'research', 'academic', 'latex', 'rebuttal', 'review response'],
    'DevOps': ['deploy', 'docker', 'CI/CD', 'kubernetes', 'pipeline', 'cloud'],
};

export function categorizePrompt(title: string, content: string): string {
    const text = `${title} ${content}`.toLowerCase();
    let bestCategory = 'General';
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        let score = 0;
        for (const kw of keywords) {
            if (text.includes(kw.toLowerCase())) { score++; }
        }
        if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
        }
    }
    return bestCategory;
}

export function extractTags(title: string, content: string): string[] {
    const tags: Set<string> = new Set();
    const text = `${title} ${content}`.toLowerCase();

    const tagKeywords = [
        'python', 'javascript', 'typescript', 'java', 'rust', 'go', 'c++',
        'react', 'vue', 'angular', 'node', 'django', 'flask',
        'api', 'database', 'sql', 'nosql', 'rest', 'graphql',
        'machine learning', 'deep learning', 'nlp', 'ai',
        'docker', 'kubernetes', 'aws', 'gcp', 'azure',
        'git', 'agile', 'scrum',
    ];

    for (const kw of tagKeywords) {
        if (text.includes(kw)) { tags.add(kw); }
    }
    return Array.from(tags).slice(0, 8);
}

// ── Main Crawler ────────────────────────────────────────

export async function crawlSource(source: PromptSource): Promise<CrawledPrompt[]> {
    const rawUrl = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${source.filePath}`;

    const content = await fetchUrl(rawUrl);

    switch (source.format) {
        case 'csv':
            return parseCSV(content, source);
        case 'json':
            return parseJSONPrompts(content, source);
        case 'markdown-sections':
            return parseMarkdownSections(content, source);
        default:
            return [];
    }
}

export async function crawlAllSources(sources: PromptSource[] = DEFAULT_SOURCES): Promise<CrawledPrompt[]> {
    const allPrompts: CrawledPrompt[] = [];
    for (const source of sources) {
        try {
            const prompts = await crawlSource(source);
            allPrompts.push(...prompts);
            console.log(`✅ Crawled ${prompts.length} prompts from ${source.name}`);
        } catch (err) {
            console.error(`❌ Failed to crawl ${source.name}:`, err);
        }
    }
    return allPrompts;
}

// ── Check if source has been updated (via GitHub API) ───────────

export async function checkSourceFreshness(source: PromptSource): Promise<{ updated: boolean; sha: string }> {
    const apiUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/commits?path=${source.filePath}&per_page=1`;
    try {
        const json = await fetchUrl(apiUrl);
        const commits = JSON.parse(json);
        if (commits.length > 0) {
            const latestSha = commits[0].sha;
            const updated = source.lastCommitSha !== latestSha;
            return { updated, sha: latestSha };
        }
    } catch { /* API rate limit or network error */ }
    return { updated: false, sha: source.lastCommitSha || '' };
}
