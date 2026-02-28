/**
 * PromptStash - LLM Judge Engine (CP5)
 * 
 * Evaluates prompt quality using local or API-based LLMs.
 * Default: Prometheus-7B-v2.0 (via Ollama/vLLM endpoint) or OpenAI-compatible API.
 * Fallback: Rule-based heuristic scorer when no LLM is available.
 * 
 * Recommended models (small, local-deployable):
 *   1. prometheus-eval/prometheus-7b-v2.0 (7B, best open-source judge)
 *   2. Unbabel/M-Prometheus-3B (3B, lightweight)
 *   3. Qwen/Qwen2.5-3B-Instruct (general-purpose 3B fallback)
 */

import * as http from 'http';
import * as https from 'https';

export interface JudgeConfig {
    /** LLM API endpoint, e.g. http://localhost:11434/api/generate (Ollama) */
    endpoint: string;
    /** Model name for the API */
    modelName: string;
    /** API style: 'ollama' | 'openai' | 'vllm' */
    apiStyle: 'ollama' | 'openai' | 'vllm';
    /** Optional API key for OpenAI-compatible endpoints */
    apiKey?: string;
    /** Timeout in ms */
    timeout: number;
}

export interface JudgeResult {
    score: number;          // 1-5 scale
    feedback: string;       // Detailed evaluation
    method: 'llm' | 'heuristic';  // Which method was used
    modelUsed?: string;
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
    endpoint: 'http://localhost:11434/api/generate',
    modelName: 'prometheus-7b-v2',
    apiStyle: 'ollama',
    timeout: 60000,
};

// ── Prompt Quality Rubric ───────────────────────────────

const JUDGE_SYSTEM_PROMPT = `You are a fair judge assistant specialized in evaluating AI coding prompts. 
Evaluate the quality of the given prompt based on the following criteria:

1. **Clarity** (Is the task clearly defined?)
2. **Specificity** (Does it provide enough context and constraints?)
3. **Structure** (Is it well-organized with clear sections?)
4. **Completeness** (Does it cover edge cases and expected output format?)
5. **Effectiveness** (Would this prompt likely produce high-quality LLM output?)

Score from 1-5:
- 1: Vague, unclear, would produce poor results
- 2: Somewhat clear but missing key details
- 3: Decent prompt with room for improvement
- 4: Well-crafted, specific, and structured
- 5: Excellent, comprehensive, production-ready prompt

Output format:
Feedback: (detailed evaluation)
[RESULT] (integer 1-5)`;

function buildJudgePrompt(promptContent: string): string {
    return `${JUDGE_SYSTEM_PROMPT}

###Prompt to evaluate:
${promptContent}

###Feedback: `;
}

// ── Compare two versions ────────────────────────────────

const COMPARE_SYSTEM_PROMPT = `You are a fair judge comparing two versions of an AI coding prompt.
Determine which version is better based on clarity, specificity, structure, completeness, and effectiveness.

Output format:
Feedback: (explain which is better and why)
[RESULT] A or B`;

function buildComparePrompt(promptA: string, promptB: string): string {
    return `${COMPARE_SYSTEM_PROMPT}

###Version A:
${promptA}

###Version B:
${promptB}

###Feedback: `;
}

// ── HTTP Request Helper ─────────────────────────────────

function httpRequest(url: string, opts: {
    method: string;
    headers: Record<string, string>;
    body: string;
    timeout: number;
}): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const req = client.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: opts.method,
            headers: opts.headers,
            timeout: opts.timeout,
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        req.write(opts.body);
        req.end();
    });
}

// ── LLM Call Adapters ───────────────────────────────────

async function callOllama(config: JudgeConfig, prompt: string): Promise<string> {
    const body = JSON.stringify({
        model: config.modelName,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 512 },
    });
    const resp = await httpRequest(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        timeout: config.timeout,
    });
    const json = JSON.parse(resp);
    return json.response || '';
}

async function callOpenAI(config: JudgeConfig, prompt: string): Promise<string> {
    const body = JSON.stringify({
        model: config.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 512,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) { headers['Authorization'] = `Bearer ${config.apiKey}`; }

    const resp = await httpRequest(config.endpoint, {
        method: 'POST',
        headers,
        body,
        timeout: config.timeout,
    });
    const json = JSON.parse(resp);
    return json.choices?.[0]?.message?.content || '';
}

async function callVLLM(config: JudgeConfig, prompt: string): Promise<string> {
    // vLLM uses OpenAI-compatible API
    return callOpenAI(config, prompt);
}

async function callLLM(config: JudgeConfig, prompt: string): Promise<string> {
    switch (config.apiStyle) {
        case 'ollama': return callOllama(config, prompt);
        case 'openai': return callOpenAI(config, prompt);
        case 'vllm': return callVLLM(config, prompt);
        default: throw new Error(`Unknown API style: ${config.apiStyle}`);
    }
}

// ── Parse LLM Output ────────────────────────────────────

export function parseLLMJudgeOutput(output: string): { score: number; feedback: string } {
    // Extract [RESULT] score
    const resultMatch = output.match(/\[RESULT\]\s*(\d)/);
    const score = resultMatch ? parseInt(resultMatch[1]) : 0;

    // Extract feedback (everything before [RESULT])
    const feedbackMatch = output.split('[RESULT]')[0].trim();
    const feedback = feedbackMatch || output.trim();

    // If regex matched a score (even 0), clamp it; if no match at all, default to 3
    const finalScore = resultMatch ? Math.min(5, Math.max(1, score)) : 3;
    return { score: finalScore, feedback };
}

export function parseLLMCompareOutput(output: string): { winner: 'A' | 'B'; feedback: string } {
    const resultMatch = output.match(/\[RESULT\]\s*(A|B)/i);
    const winner = resultMatch ? (resultMatch[1].toUpperCase() as 'A' | 'B') : 'B';
    const feedback = output.split('[RESULT]')[0].trim();
    return { winner, feedback };
}

// ── Heuristic Scorer (Fallback when no LLM available) ───────────

export function heuristicScore(content: string): JudgeResult {
    let score = 1.5;
    const feedback: string[] = [];

    // Length check
    const len = content.length;
    if (len > 200) { score += 0.3; feedback.push('Reasonable length (+0.3)'); }
    if (len > 500) { score += 0.3; feedback.push('Good length (+0.3)'); }
    if (len > 1000) { score += 0.3; feedback.push('Detailed prompt (+0.3)'); }
    if (len < 50) { score -= 0.3; feedback.push('Very short, may lack detail (-0.3)'); }

    // Structure checks
    if (/^#+\s|^##\s|\*\*[^*]+\*\*|^\d+\./m.test(content)) {
        score += 0.5; feedback.push('Has formatting/structure (+0.5)');
    }
    if (/```/.test(content)) {
        score += 0.3; feedback.push('Contains code blocks (+0.3)');
    }
    if (/\b(step|first|second|then|finally|next)\b/i.test(content)) {
        score += 0.3; feedback.push('Has sequential instructions (+0.3)');
    }

    // Specificity checks
    if (/\b(must|should|ensure|always|never|required)\b/i.test(content)) {
        score += 0.4; feedback.push('Has constraints/requirements (+0.4)');
    }
    if (/\b(example|e\.g\.|for instance|such as)\b/i.test(content)) {
        score += 0.3; feedback.push('Provides examples (+0.3)');
    }
    if (/\b(output|format|return|result)\b/i.test(content)) {
        score += 0.3; feedback.push('Specifies output format (+0.3)');
    }

    // Role/context
    if (/\b(you are|act as|your role|as a)\b/i.test(content)) {
        score += 0.3; feedback.push('Defines role/persona (+0.3)');
    }

    // Variables
    if (/\{\{[^}]+\}\}/.test(content)) {
        score += 0.2; feedback.push('Uses template variables (+0.2)');
    }

    // Edge cases
    if (/\b(edge case|error|exception|handle|fallback)\b/i.test(content)) {
        score += 0.2; feedback.push('Considers edge cases (+0.2)');
    }

    // Cap at 5
    score = Math.min(5, Math.round(score * 10) / 10);

    return {
        score,
        feedback: `Heuristic evaluation:\n${feedback.join('\n')}`,
        method: 'heuristic',
    };
}

// ── Main Judge Class ────────────────────────────────────

export class LLMJudge {
    private config: JudgeConfig;
    private llmAvailable: boolean | null = null;

    constructor(config: Partial<JudgeConfig> = {}) {
        this.config = { ...DEFAULT_JUDGE_CONFIG, ...config };
    }

    /** Check if LLM endpoint is reachable */
    async checkAvailability(): Promise<boolean> {
        try {
            const url = new URL(this.config.endpoint);
            const testUrl = `${url.protocol}//${url.host}/`;
            await httpRequest(testUrl, {
                method: 'GET', headers: {}, body: '', timeout: 5000,
            });
            this.llmAvailable = true;
            return true;
        } catch {
            this.llmAvailable = false;
            return false;
        }
    }

    /** Score a single prompt */
    async scorePrompt(content: string): Promise<JudgeResult> {
        // Try LLM first
        if (this.llmAvailable === null) {
            await this.checkAvailability();
        }

        if (this.llmAvailable) {
            try {
                const prompt = buildJudgePrompt(content);
                const output = await callLLM(this.config, prompt);
                const { score, feedback } = parseLLMJudgeOutput(output);
                return { score, feedback, method: 'llm', modelUsed: this.config.modelName };
            } catch (err) {
                console.warn('LLM judge failed, falling back to heuristic:', err);
            }
        }

        // Fallback to heuristic
        return heuristicScore(content);
    }

    /** Compare two versions, return which is better */
    async compareVersions(contentA: string, contentB: string): Promise<{
        winner: 'A' | 'B';
        feedback: string;
        method: 'llm' | 'heuristic';
    }> {
        if (this.llmAvailable === null) {
            await this.checkAvailability();
        }

        if (this.llmAvailable) {
            try {
                const prompt = buildComparePrompt(contentA, contentB);
                const output = await callLLM(this.config, prompt);
                const { winner, feedback } = parseLLMCompareOutput(output);
                return { winner, feedback, method: 'llm' };
            } catch {
                // fallback
            }
        }

        // Heuristic comparison
        const scoreA = heuristicScore(contentA);
        const scoreB = heuristicScore(contentB);
        return {
            winner: scoreB.score >= scoreA.score ? 'B' : 'A',
            feedback: `Heuristic: A=${scoreA.score}, B=${scoreB.score}`,
            method: 'heuristic',
        };
    }

    getConfig(): JudgeConfig { return { ...this.config }; }
    setConfig(config: Partial<JudgeConfig>) { this.config = { ...this.config, ...config }; }
}
