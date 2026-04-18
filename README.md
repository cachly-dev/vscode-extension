# Cachly Brain — VS Code Extension

Shows your AI Brain health, lessons, recall stats, and estimated token savings in the VS Code status bar.

## Features

- 🧠 **Status Bar**: Live lesson count + brain status
- 📊 **Health Panel**: `Cmd+Shift+P` → "Cachly: Show Brain Health" — overview with token savings
- 📖 **Lesson Viewer**: `Cmd+Shift+P` → "Cachly: Show Lessons" — detailed list of all learned lessons
- 💰 **Token Savings**: Estimates tokens and cost saved by reusing solutions (~1,200 tokens per recall)
- 🔄 **Auto-refresh**: Configurable interval (default: 5 min)

## How Lessons Work

Lessons are created when an AI assistant (Copilot, Claude, Cursor) calls `learn_from_attempts()` via the [Cachly MCP server](../mcp/). Each `recall_best_solution()` or `session_start()` call reuses a known solution instead of re-researching, saving ~1,200 tokens per recall.

## Setup

1. Download the extension from [cachly.dev/docs/ide-plugins](https://cachly.dev/docs/ide-plugins)
2. In VS Code: `Cmd+Shift+P` → "Extensions: Install from VSIX…" → select the `.vsix`
3. Open Settings → search "Cachly"
4. Set your **API Key** (`cky_live_...`)
5. Set your **Instance ID** (UUID from dashboard)

### 🤖 Copy for your AI

Paste this into Copilot Chat, Claude, or Cursor to auto-configure:

```
Install the Cachly Brain VS Code extension, then configure it:
1. Download and install the VSIX from https://cachly.dev/downloads/cachly-brain-0.3.0.vsix
2. Open VS Code Settings (Cmd+, or Ctrl+,) and search for "Cachly"
3. Set cachly.apiKey to your API key (starts with cky_live_...)
4. Set cachly.instanceId to your Brain instance UUID (from the Cachly dashboard)
5. The status bar should now show "🧠 Brain: N lessons"
6. Use Cmd+Shift+P → "Cachly: Show Brain Health" to see full stats
7. Use Cmd+Shift+P → "Cachly: Show Lessons" to see all learned lessons
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `cachly.apiKey` | — | Your Cachly API key |
| `cachly.instanceId` | — | Brain instance UUID |
| `cachly.apiUrl` | `https://api.cachly.dev` | API base URL |
| `cachly.refreshInterval` | `300` | Refresh interval (seconds) |

## Development

```bash
cd sdk/vscode
npm install
npm run compile
# Press F5 to launch Extension Development Host
```
