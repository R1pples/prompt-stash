/**
 * PromptStash - Version Manager
 * Maintains history chain for each prompt. Every optimization creates a new version.
 * Users always see the best (latest recommended) version, but can browse history.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface PromptVersion {
    /** Version number (1, 2, 3, ...) */
    version: number;
    /** The prompt content at this version */
    content: string;
    /** LLM Judge score (1-5 scale) for this version, undefined if not yet scored */
    judgeScore?: number;
    /** What triggered this version: 'manual' | 'auto-optimize' | 'import' */
    source: 'manual' | 'auto-optimize' | 'import';
    /** Optional: which source inspired this version */
    inspirationSource?: string;
    /** Timestamp */
    createdAt: string;
    /** Optional: diff description of changes */
    changeNote?: string;
}

export interface PromptHistory {
    /** The prompt ID this history belongs to */
    promptId: string;
    /** All versions, sorted ascending by version number */
    versions: PromptVersion[];
    /** The version number currently recommended (best score) */
    recommendedVersion: number;
}

export interface VersionStore {
    histories: Record<string, PromptHistory>;
    lastModified: string;
}

export class VersionManager {
    private store: VersionStore;
    private storagePath: string;

    constructor(storagePath: string) {
        this.storagePath = storagePath;
        this.store = this.load();
    }

    private load(): VersionStore {
        try {
            if (fs.existsSync(this.storagePath)) {
                return JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
            }
        } catch { /* ignore */ }
        return { histories: {}, lastModified: new Date().toISOString() };
    }

    private save(): void {
        this.store.lastModified = new Date().toISOString();
        const dir = path.dirname(this.storagePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(this.storagePath, JSON.stringify(this.store, null, 2), 'utf-8');
    }

    // ── Initialize history for a prompt ───────────────────────

    initHistory(promptId: string, content: string, source: 'manual' | 'import' = 'manual'): PromptHistory {
        if (this.store.histories[promptId]) {
            return this.store.histories[promptId];
        }
        const history: PromptHistory = {
            promptId,
            versions: [{
                version: 1,
                content,
                source,
                createdAt: new Date().toISOString(),
            }],
            recommendedVersion: 1,
        };
        this.store.histories[promptId] = history;
        this.save();
        return history;
    }

    // ── Add a new version ───────────────────────────────────

    addVersion(promptId: string, content: string, opts: {
        source: 'manual' | 'auto-optimize' | 'import';
        judgeScore?: number;
        inspirationSource?: string;
        changeNote?: string;
    }): PromptVersion | undefined {
        const history = this.store.histories[promptId];
        if (!history) { return undefined; }

        const nextVersion = history.versions.length > 0
            ? history.versions[history.versions.length - 1].version + 1
            : 1;

        const ver: PromptVersion = {
            version: nextVersion,
            content,
            source: opts.source,
            judgeScore: opts.judgeScore,
            inspirationSource: opts.inspirationSource,
            changeNote: opts.changeNote,
            createdAt: new Date().toISOString(),
        };

        history.versions.push(ver);

        // Update recommended version if this one scores higher
        this.recalcRecommended(promptId);
        this.save();
        return ver;
    }

    // ── Set judge score for a version ─────────────────────────

    setScore(promptId: string, version: number, score: number): boolean {
        const history = this.store.histories[promptId];
        if (!history) { return false; }
        const ver = history.versions.find(v => v.version === version);
        if (!ver) { return false; }
        ver.judgeScore = score;
        this.recalcRecommended(promptId);
        this.save();
        return true;
    }

    // ── Recalculate which version is recommended ────────────────

    private recalcRecommended(promptId: string): void {
        const history = this.store.histories[promptId];
        if (!history || history.versions.length === 0) { return; }

        let best = history.versions[0];
        for (const ver of history.versions) {
            if (ver.judgeScore !== undefined) {
                if (best.judgeScore === undefined || ver.judgeScore > best.judgeScore) {
                    best = ver;
                } else if (ver.judgeScore === best.judgeScore && ver.version > best.version) {
                    best = ver; // Same score, prefer newer
                }
            }
        }
        // If no version has a score, recommend the latest
        if (best.judgeScore === undefined) {
            best = history.versions[history.versions.length - 1];
        }
        history.recommendedVersion = best.version;
    }

    // ── Getters ─────────────────────────────────────────────

    getHistory(promptId: string): PromptHistory | undefined {
        return this.store.histories[promptId];
    }

    getVersion(promptId: string, version: number): PromptVersion | undefined {
        const h = this.store.histories[promptId];
        if (!h) { return undefined; }
        return h.versions.find(v => v.version === version);
    }

    getRecommendedVersion(promptId: string): PromptVersion | undefined {
        const h = this.store.histories[promptId];
        if (!h) { return undefined; }
        return h.versions.find(v => v.version === h.recommendedVersion);
    }

    getLatestVersion(promptId: string): PromptVersion | undefined {
        const h = this.store.histories[promptId];
        if (!h || h.versions.length === 0) { return undefined; }
        return h.versions[h.versions.length - 1];
    }

    getAllVersions(promptId: string): PromptVersion[] {
        return this.store.histories[promptId]?.versions || [];
    }

    getVersionCount(promptId: string): number {
        return this.store.histories[promptId]?.versions.length || 0;
    }

    // ── Delete history ──────────────────────────────────────

    deleteHistory(promptId: string): boolean {
        if (!this.store.histories[promptId]) { return false; }
        delete this.store.histories[promptId];
        this.save();
        return true;
    }

    // ── Check if optimization improved the prompt ───────────────

    didImprove(promptId: string): boolean {
        const h = this.store.histories[promptId];
        if (!h || h.versions.length < 2) { return false; }
        const latest = h.versions[h.versions.length - 1];
        const prev = h.versions[h.versions.length - 2];
        if (latest.judgeScore !== undefined && prev.judgeScore !== undefined) {
            return latest.judgeScore > prev.judgeScore;
        }
        return false;
    }

    // ── Export for serialization ─────────────────────────────

    exportAll(): string {
        return JSON.stringify(this.store, null, 2);
    }
}
