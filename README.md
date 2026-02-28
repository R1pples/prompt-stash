# PromptStash 📌🧬

> **Self-Evolving AI Prompt Manager for VS Code** — Save, organize, auto-optimize, and reuse your best prompts. Powered by open-source prompt libraries + LLM Judge evaluation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-^1.85.0-blue.svg)](https://code.visualstudio.com/)

---

## 🤔 Problem

When doing **vibe coding** with AI assistants, you constantly craft quality prompts — but they get lost across sessions. There's no easy way to:
- Capture effective prompts as reusable snippets
- Track which prompts work best over time
- Automatically improve prompts using community knowledge
- Version and compare prompt quality systematically

**PromptStash** solves all of these.

---

## ✨ Features

### 🔖 Save & Organize Prompts
- **Save from anywhere**: Select text → right-click → "Save Selection as Prompt"
- **12 built-in categories**: Debugging, Refactoring, Code Review, Architecture, Paper Writing, Rebuttal, etc.
- **Tags + Rating** (★1-5) + **Favorites** for quick access
- **Template variables**: `{{VARIABLE_NAME}}` placeholders auto-prompt for values on insert

### ⚡ Smart Completion
- Type `/ps` in markdown/text files to trigger prompt suggestions
- **IntelliSense** completions: Full library with fuzzy search
- **Ghost text** (inline): Preview prompts as you type
- Works in Copilot Chat, markdown, and plaintext files

### 🧬 Self-Evolution Engine (Auto-Optimize)
- **Open-source prompt crawling**: Automatically fetches quality prompts from:
  - [f/awesome-chatgpt-prompts](https://github.com/f/awesome-chatgpt-prompts) (149k+ ★)
  - [dontriskit/awesome-ai-system-prompts](https://github.com/dontriskit/awesome-ai-system-prompts) (5k+ ★)
- **LLM Judge evaluation**: Each prompt scored on 5 criteria (Clarity, Specificity, Structure, Completeness, Effectiveness) using:
  - [Prometheus-7B-v2.0](https://huggingface.co/prometheus-eval/prometheus-7b-v2.0) or M-Prometheus-3B (local deploy)
  - Heuristic fallback (zero-dependency, no GPU needed)
- **Rule-based optimization**: Auto-adds role definition, output format, constraints, step-by-step structure, edge case handling, examples
- **Version management**: Full prompt history chain with A/B comparison — only keeps improvements as recommended version

### ⏱️ Periodic Scheduler
- Background checks for open-source source freshness (GitHub API)
- Automatic re-crawl + optimization cycles
- Configurable intervals (default: 6h crawl, 12h optimize)
- Rate-limited: only optimizes high-usage prompts (configurable threshold)

### 📊 Usage Tracking
- Tracks usage count per prompt
- Sorts by rating + usage frequency
- Surfaces top-performing prompts

### 📤 Export / Import
- Export entire library as JSON
- Import and merge libraries from teammates
- Share your best prompts

---

## 🚀 Getting Started

### Install from Source
```bash
git clone https://github.com/<you>/prompt-stash.git
cd prompt-stash
npm install
npm run compile
```

### Package as VSIX
```bash
npx @vscode/vsce package
```
Install via: Extensions → ⚙️ → "Install from VSIX..."

### Quick Start

1. **Save a prompt**: Command Palette → `PromptStash: Save Prompt`, or select text → right-click → "Save Selection as Prompt"
2. **Find & insert**: Click 📌 PromptStash in the Activity Bar, or type `/ps` in any markdown file
3. **Auto-optimize**: Prompts with ≥2 uses are automatically evaluated and improved during background cycles

---

## ⚙️ Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `promptStash.storageLocation` | `""` | Custom path for prompt library JSON |
| `promptStash.enableInlineCompletion` | `true` | Enable ghost-text completion |
| `promptStash.triggerPrefix` | `"/ps"` | Prefix to trigger suggestions |
| `promptStash.completionFileTypes` | `["markdown","plaintext"]` | File types with active completion |
| `promptStash.defaultCategory` | `"General"` | Default category for new prompts |
| `promptStash.maxCompletionResults` | `10` | Max suggestions shown |

### LLM Judge Configuration (optional)

If you run a local LLM (Ollama / vLLM), PromptStash can use it for more accurate evaluation:

```jsonc
// settings.json
{
  "promptStash.judgeEndpoint": "http://localhost:11434",
  "promptStash.judgeModel": "prometheus-7b-v2.0",
  "promptStash.judgeApiStyle": "ollama"  // "ollama" | "openai" | "vllm"
}
```

Without a local LLM, the heuristic scorer (10+ signal analysis) runs with zero latency.

---

## 🏗️ Architecture

```
prompt-stash/
├── src/
│   ├── extension.ts        # Entry point & activation
│   ├── models.ts           # Interfaces & constants
│   ├── store.ts            # JSON CRUD storage engine
│   ├── treeView.ts         # Sidebar tree (categories + prompts)
│   ├── commands.ts         # User-facing commands
│   ├── completion.ts       # IntelliSense + inline completion
│   ├── webview.ts          # Rich prompt editor panel
│   ├── crawler.ts          # Open-source prompt crawler (CSV/MD/JSON)
│   ├── versionManager.ts   # Prompt version history & scoring
│   ├── llmJudge.ts         # LLM Judge + heuristic evaluation
│   ├── optimizer.ts        # Self-evolution optimization engine
│   └── scheduler.ts        # Periodic update scheduler
├── tests/
│   ├── test_store.ts       # CP1: 27 tests
│   ├── test_crawler.ts     # CP3: 23 tests
│   ├── test_versionManager.ts  # CP4: 23 tests
│   ├── test_llmJudge.ts    # CP5: 16 tests
│   ├── test_optimizer.ts   # CP6: 33 tests
│   ├── test_scheduler.ts   # CP7: 22 tests
│   ├── test_integration.ts # CP8: 27 tests
│   └── test_grayscale.ts   # CP9: 31 tests
└── package.json
```

**Total: 202 tests across 8 test suites, all passing ✅**

### Data Flow

```
┌───────────────┐     ┌──────────┐     ┌──────────────┐
│ User Prompts  │────→│  Store   │────→│ Completion   │
│ (save/edit)   │     │ (JSON)   │     │ Provider     │
└───────────────┘     └────┬─────┘     └──────────────┘
                           │
                    ┌──────▼──────┐
                    │  Scheduler  │ (periodic)
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐    ┌───────────┐    ┌───────────┐
    │ Crawler  │    │ Optimizer │    │  Version   │
    │ (GitHub) │───→│ (rules +  │───→│  Manager   │
    └──────────┘    │  LLM ref) │    │ (history)  │
                    └─────┬─────┘    └───────────┘
                          │
                    ┌─────▼─────┐
                    │ LLM Judge │
                    │ (score +  │
                    │ compare)  │
                    └───────────┘
```

---

## 🧪 Running Tests

```bash
# All unit tests
npx ts-node --project tsconfig.test.json tests/test_store.ts
npx ts-node --project tsconfig.test.json tests/test_crawler.ts
npx ts-node --project tsconfig.test.json tests/test_versionManager.ts
npx ts-node --project tsconfig.test.json tests/test_llmJudge.ts
npx ts-node --project tsconfig.test.json tests/test_optimizer.ts
npx ts-node --project tsconfig.test.json tests/test_scheduler.ts

# Integration + gray-scale
npx ts-node --project tsconfig.test.json tests/test_integration.ts
npx ts-node --project tsconfig.test.json tests/test_grayscale.ts
```

---

## 💡 Template Variables

Use `{{VARIABLE_NAME}}` placeholders in prompts:

```
You are an expert {{LANGUAGE}} developer.
Refactor the code in {{PROJECT_NAME}} to follow {{PATTERN}} design pattern.
Ensure backward compatibility and add unit tests.
```

On insert, PromptStash prompts for each variable's value.

---

## 🗺️ Roadmap

- [ ] Marketplace publish
- [ ] Prompt sharing via GitHub Gist
- [ ] Team sync via shared storage
- [ ] More prompt sources (Cursor Directory, PromptHero)
- [ ] Fine-tuned 3B judge model
- [ ] Prompt analytics dashboard

---

## Contributing

PRs welcome! Please run all tests before submitting.

## License

MIT
