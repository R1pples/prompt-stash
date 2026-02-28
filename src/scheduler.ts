/**
 * PromptStash - Periodic Update Scheduler (CP7)
 *
 * Schedules periodic tasks:
 *   1. Check open-source prompt sources for freshness
 *   2. Re-crawl stale sources
 *   3. Trigger auto-optimization on user's prompts
 *
 * Uses simple setInterval + configurable intervals.
 * Designed to run within VS Code extension host.
 */

import { checkSourceFreshness, crawlAllSources, DEFAULT_SOURCES, PromptSource, CrawledPrompt } from './crawler';
import { PromptOptimizer, OptimizationResult } from './optimizer';
import { VersionManager } from './versionManager';

// ── Types ───────────────────────────────────────────────

export interface SchedulerConfig {
    /** How often to check sources for new prompts (ms). Default 6h. */
    crawlIntervalMs: number;
    /** How often to run auto-optimization on user prompts (ms). Default 12h. */
    optimizeIntervalMs: number;
    /** Maximum prompts to auto-optimize per cycle. */
    maxOptimizePerCycle: number;
    /** Minimum prompt usage count to be eligible for auto-optimize. */
    minUsageForOptimize: number;
    /** Whether scheduler is enabled at all. */
    enabled: boolean;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    crawlIntervalMs: 6 * 3600_000,        // 6 hours
    optimizeIntervalMs: 12 * 3600_000,     // 12 hours
    maxOptimizePerCycle: 10,
    minUsageForOptimize: 2,
    enabled: true,
};

export interface SchedulerEvent {
    type: 'crawl-start' | 'crawl-done' | 'optimize-start' | 'optimize-done' | 'error';
    timestamp: number;
    detail?: string;
}

export type SchedulerEventListener = (event: SchedulerEvent) => void;

// ── Scheduler ───────────────────────────────────────────

export class UpdateScheduler {
    private config: SchedulerConfig;
    private crawlTimer: any = null;
    private optimizeTimer: any = null;
    private listeners: SchedulerEventListener[] = [];
    private _running = false;
    private _crawlCount = 0;
    private _optimizeCount = 0;
    private _lastCrawl: number = 0;
    private _lastOptimize: number = 0;

    // Dependencies injected for testability
    private optimizer: PromptOptimizer;
    private versionManager: VersionManager | null = null;
    private sources: PromptSource[];
    private getPromptsFn: (() => Array<{ id: string; content: string; usageCount: number }>) | null = null;

    constructor(
        optimizer: PromptOptimizer,
        config: Partial<SchedulerConfig> = {},
        sources: PromptSource[] = DEFAULT_SOURCES
    ) {
        this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
        this.optimizer = optimizer;
        this.sources = sources;
    }

    /** Set the version manager for auto-optimize versioning */
    setVersionManager(vm: VersionManager): void {
        this.versionManager = vm;
    }

    /** Set a function that returns current user prompts eligible for optimization */
    setPromptProvider(fn: () => Array<{ id: string; content: string; usageCount: number }>): void {
        this.getPromptsFn = fn;
    }

    /** Subscribe to scheduler events */
    onEvent(listener: SchedulerEventListener): void {
        this.listeners.push(listener);
    }

    private emit(event: SchedulerEvent): void {
        for (const l of this.listeners) {
            try { l(event); } catch {}
        }
    }

    // ── Core tasks ────────────────────────────────────────

    async runCrawlCycle(): Promise<CrawledPrompt[]> {
        this.emit({ type: 'crawl-start', timestamp: Date.now() });
        try {
            const count = await this.optimizer.loadOpenSourcePrompts(true);
            this._crawlCount++;
            this._lastCrawl = Date.now();
            this.emit({ type: 'crawl-done', timestamp: Date.now(), detail: `Fetched ${count} prompts` });
            // Return cached prompts (we can't access them directly, but caller knows count)
            return [];
        } catch (err: any) {
            this.emit({ type: 'error', timestamp: Date.now(), detail: `Crawl error: ${err.message}` });
            return [];
        }
    }

    async runOptimizeCycle(): Promise<OptimizationResult[]> {
        if (!this.getPromptsFn) { return []; }

        this.emit({ type: 'optimize-start', timestamp: Date.now() });
        const results: OptimizationResult[] = [];

        try {
            const prompts = this.getPromptsFn()
                .filter(p => p.usageCount >= this.config.minUsageForOptimize)
                .slice(0, this.config.maxOptimizePerCycle);

            for (const p of prompts) {
                try {
                    let result: OptimizationResult;
                    if (this.versionManager) {
                        result = await this.optimizer.optimizeAndVersion(p.id, p.content, this.versionManager);
                    } else {
                        result = await this.optimizer.optimizePrompt(p.content);
                    }
                    results.push(result);
                } catch {}
            }

            this._optimizeCount++;
            this._lastOptimize = Date.now();
            const improved = results.filter(r => r.improved).length;
            this.emit({
                type: 'optimize-done',
                timestamp: Date.now(),
                detail: `Optimized ${results.length} prompts, ${improved} improved`,
            });
        } catch (err: any) {
            this.emit({ type: 'error', timestamp: Date.now(), detail: `Optimize error: ${err.message}` });
        }

        return results;
    }

    // ── Lifecycle ─────────────────────────────────────────

    start(): void {
        if (this._running || !this.config.enabled) return;
        this._running = true;

        this.crawlTimer = setInterval(() => {
            this.runCrawlCycle().catch(() => {});
        }, this.config.crawlIntervalMs);

        this.optimizeTimer = setInterval(() => {
            this.runOptimizeCycle().catch(() => {});
        }, this.config.optimizeIntervalMs);
    }

    stop(): void {
        if (this.crawlTimer) { clearInterval(this.crawlTimer); this.crawlTimer = null; }
        if (this.optimizeTimer) { clearInterval(this.optimizeTimer); this.optimizeTimer = null; }
        this._running = false;
    }

    isRunning(): boolean { return this._running; }
    getCrawlCount(): number { return this._crawlCount; }
    getOptimizeCount(): number { return this._optimizeCount; }
    getLastCrawlTime(): number { return this._lastCrawl; }
    getLastOptimizeTime(): number { return this._lastOptimize; }

    /** Dispose — for VS Code extension deactivate */
    dispose(): void {
        this.stop();
        this.listeners = [];
    }
}
