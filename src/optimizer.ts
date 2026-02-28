/**
 * PromptStash - Self-Evolution Optimizer (CP6)
 * 
 * Takes a user's prompt, finds similar high-quality open-source prompts,
 * uses LLM Judge to evaluate, generates optimized version, and decides
 * whether to keep or replace via A/B comparison.
 * 
 * Flow:
 *   1. User prompt → Search for similar open-source prompts (crawler)
 *   2. Merge best patterns → Generate optimized candidate (via LLM or heuristic rules)
 *   3. LLM Judge scores both original and candidate
 *   4. If candidate wins → Create new version (keep history)
 *   5. If original wins → Keep original, discard candidate
 */

import { CrawledPrompt, crawlAllSources, DEFAULT_SOURCES, PromptSource } from './crawler';
import { LLMJudge, JudgeResult, heuristicScore, JudgeConfig } from './llmJudge';
import { VersionManager, PromptVersion } from './versionManager';

export interface OptimizationResult {
    originalContent: string;
    optimizedContent: string;
    originalScore: number;
    optimizedScore: number;
    improved: boolean;
    feedback: string;
    inspirationSources: string[];
    method: 'llm' | 'heuristic';
}

export interface OptimizerConfig {
    /** Maximum number of reference prompts to use for inspiration */
    maxReferences: number;
    /** Minimum similarity threshold (0-1) for keyword match */
    similarityThreshold: number;
    /** Judge config for LLM-based evaluation */
    judgeConfig?: Partial<JudgeConfig>;
    /** Custom prompt sources beyond defaults */
    additionalSources?: PromptSource[];
}

const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
    maxReferences: 5,
    similarityThreshold: 0.1,
};

// ── Prompt Optimization Rules (Heuristic) ───────────────────

export interface OptimizationRule {
    name: string;
    description: string;
    check: (content: string) => boolean;
    apply: (content: string) => string;
}

export const OPTIMIZATION_RULES: OptimizationRule[] = [
    {
        name: 'add-role-definition',
        description: 'Add a clear role/persona definition',
        check: (c) => !/\b(you are|act as|your role|as a)\b/i.test(c),
        apply: (c) => `You are an expert AI assistant.\n\n${c}`,
    },
    {
        name: 'add-output-format',
        description: 'Specify expected output format',
        check: (c) => !/\b(output|format|return|respond with|response should)\b/i.test(c),
        apply: (c) => `${c}\n\nPlease structure your response clearly with appropriate formatting.`,
    },
    {
        name: 'add-constraints',
        description: 'Add quality constraints',
        check: (c) => !/\b(must|should|ensure|always|never|required|do not)\b/i.test(c),
        apply: (c) => `${c}\n\nEnsure your response is accurate, well-structured, and complete.`,
    },
    {
        name: 'add-step-structure',
        description: 'Add step-by-step instruction when missing',
        check: (c) => !/\b(step|first|second|then|finally|next|1\.|2\.)\b/i.test(c) && c.length > 100,
        apply: (c) => `${c}\n\nPlease approach this step by step.`,
    },
    {
        name: 'add-edge-cases',
        description: 'Remind about edge cases',
        check: (c) => !/\b(edge case|error|exception|handle|corner case|fallback)\b/i.test(c) && c.length > 150,
        apply: (c) => `${c}\n\nConsider edge cases and potential error scenarios in your response.`,
    },
    {
        name: 'add-examples-hint',
        description: 'Encourage examples in response',
        check: (c) => !/\b(example|e\.g\.|for instance|such as|demonstrate)\b/i.test(c) && c.length > 100,
        apply: (c) => `${c}\n\nInclude concrete examples where applicable.`,
    },
    {
        name: 'add-markdown-structure',
        description: 'Add section headers for long prompts',
        check: (c) => c.length > 300 && !/^#+\s/m.test(c) && !/\*\*[^*]+\*\*/m.test(c),
        apply: (c) => {
            // Try to structure the prompt with headers
            const lines = c.split('\n');
            if (lines.length > 5) {
                return `## Task\n${c}`;
            }
            return c;
        },
    },
];

// ── Similar Prompt Finder ────────────────────────────────

export function findSimilarPrompts(
    userPrompt: string,
    openSourcePrompts: CrawledPrompt[],
    maxResults: number = 5,
    threshold: number = 0.1
): CrawledPrompt[] {
    // Simple keyword-based similarity
    const userWords = new Set(
        userPrompt.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 3)
    );

    if (userWords.size === 0) { return []; }

    const scored = openSourcePrompts.map(p => {
        const pWords = new Set(
            `${p.title} ${p.content}`.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3)
        );

        let overlap = 0;
        for (const w of userWords) {
            if (pWords.has(w)) { overlap++; }
        }
        const similarity = overlap / userWords.size;
        return { prompt: p, similarity };
    });

    return scored
        .filter(s => s.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults)
        .map(s => s.prompt);
}

// ── Extract Best Patterns from References ───────────────────

export function extractPatterns(references: CrawledPrompt[]): string[] {
    const patterns: string[] = [];

    for (const ref of references) {
        const c = ref.content;
        // Extract structural patterns
        if (/you are|act as/i.test(c)) { patterns.push('role-definition'); }
        if (/```/.test(c)) { patterns.push('code-blocks'); }
        if (/\b(step|1\.|first)\b/i.test(c)) { patterns.push('step-by-step'); }
        if (/\b(must|should|ensure)\b/i.test(c)) { patterns.push('constraints'); }
        if (/\b(example|e\.g\.|for instance)\b/i.test(c)) { patterns.push('examples'); }
        if (/\b(output|format|respond)\b/i.test(c)) { patterns.push('output-spec'); }
        if (/^##\s/m.test(c)) { patterns.push('sections'); }
    }

    return [...new Set(patterns)];
}

// ── Heuristic Optimization (no LLM needed) ──────────────────

export function optimizeWithRules(content: string, references: CrawledPrompt[]): string {
    let optimized = content;

    // Apply rules that are relevant
    for (const rule of OPTIMIZATION_RULES) {
        if (rule.check(optimized)) {
            optimized = rule.apply(optimized);
        }
    }

    return optimized;
}

// ── Main Optimizer ──────────────────────────────────────

export class PromptOptimizer {
    private judge: LLMJudge;
    private config: OptimizerConfig;
    private cachedOpenSourcePrompts: CrawledPrompt[] = [];
    private lastCrawlTime: number = 0;
    private readonly CRAWL_CACHE_TTL = 3600_000; // 1 hour

    constructor(config: Partial<OptimizerConfig> = {}) {
        this.config = { ...DEFAULT_OPTIMIZER_CONFIG, ...config };
        this.judge = new LLMJudge(config.judgeConfig);
    }

    /** Load/refresh open source prompt cache */
    async loadOpenSourcePrompts(force: boolean = false): Promise<number> {
        const now = Date.now();
        if (!force && this.cachedOpenSourcePrompts.length > 0 && (now - this.lastCrawlTime) < this.CRAWL_CACHE_TTL) {
            return this.cachedOpenSourcePrompts.length;
        }

        const sources = [...DEFAULT_SOURCES, ...(this.config.additionalSources || [])];
        this.cachedOpenSourcePrompts = await crawlAllSources(sources);
        this.lastCrawlTime = now;
        return this.cachedOpenSourcePrompts.length;
    }

    /** Load prompts from a pre-fetched list (for testing / offline) */
    loadPromptsFromCache(prompts: CrawledPrompt[]): void {
        this.cachedOpenSourcePrompts = prompts;
        this.lastCrawlTime = Date.now();
    }

    /** Optimize a single prompt */
    async optimizePrompt(content: string): Promise<OptimizationResult> {
        // 1. Find similar reference prompts
        const references = findSimilarPrompts(
            content,
            this.cachedOpenSourcePrompts,
            this.config.maxReferences,
            this.config.similarityThreshold
        );

        // 2. Generate optimized candidate using rules + reference patterns
        const optimizedContent = optimizeWithRules(content, references);

        // 3. Score both versions
        const originalResult = await this.judge.scorePrompt(content);
        const optimizedResult = await this.judge.scorePrompt(optimizedContent);

        // 4. Compare if scores are close
        let improved = optimizedResult.score > originalResult.score;
        let feedback = `Original: ${originalResult.score}/5, Optimized: ${optimizedResult.score}/5`;

        if (Math.abs(optimizedResult.score - originalResult.score) < 0.5 && optimizedContent !== content) {
            // Close scores — do A/B comparison
            const comparison = await this.judge.compareVersions(content, optimizedContent);
            improved = comparison.winner === 'B';
            feedback += `\nA/B comparison: ${comparison.feedback}`;
        }

        return {
            originalContent: content,
            optimizedContent,
            originalScore: originalResult.score,
            optimizedScore: optimizedResult.score,
            improved,
            feedback,
            inspirationSources: references.map(r => r.source),
            method: originalResult.method,
        };
    }

    /** Optimize a prompt and update version history if improved */
    async optimizeAndVersion(
        promptId: string,
        content: string,
        versionManager: VersionManager
    ): Promise<OptimizationResult> {
        const result = await this.optimizePrompt(content);

        if (result.improved) {
            // Create new version with the optimized content
            versionManager.addVersion(promptId, result.optimizedContent, {
                source: 'auto-optimize',
                judgeScore: result.optimizedScore,
                inspirationSource: result.inspirationSources.join(', '),
                changeNote: `Auto-optimized: ${result.feedback}`,
            });

            // Also score the original if it hasn't been scored
            const history = versionManager.getHistory(promptId);
            if (history) {
                const origVer = history.versions.find(v => v.content === content);
                if (origVer && origVer.judgeScore === undefined) {
                    versionManager.setScore(promptId, origVer.version, result.originalScore);
                }
            }
        }

        return result;
    }

    getJudge(): LLMJudge { return this.judge; }
    getCachedPromptCount(): number { return this.cachedOpenSourcePrompts.length; }
}
