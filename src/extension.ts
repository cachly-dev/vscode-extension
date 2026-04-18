import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

interface TopLesson {
  topic: string;
  outcome: string;
  recall_count: number;
  severity?: string;
  what_worked: string;
  ts: string;
}

interface MemoryData {
  lesson_count: number;
  context_count: number;
  topics: string[];
  top_lessons: TopLesson[];
  last_session?: { summary?: string; focus?: string };
  memory_used_bytes: number;
  memory_limit_bytes: number;
  memory_used_pct: number;
}

interface BrainHealth {
  lessons: number;
  contexts: number;
  lastSession: string | null;
  status: 'healthy' | 'degraded' | 'unreachable';
  tier: string;
  totalRecalls: number;
  estimatedTokensSaved: number;
  topLessons: TopLesson[];
  topics: string[];
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  memoryUsedPct: number;
}

// Average tokens saved per recall — avoids full re-research of context
const TOKENS_PER_RECALL = 1200;

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let recallTimer: NodeJS.Timeout | undefined;
let lastHealth: BrainHealth | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Create status bar item (right side, priority 100)
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cachly.showBrainHealth';
  statusBarItem.tooltip = 'Cachly Brain Health — click for details';
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cachly.showBrainHealth', showBrainHealthPanel),
    vscode.commands.registerCommand('cachly.showLessons', showLessonsPanel),
    vscode.commands.registerCommand('cachly.refreshBrain', () => updateStatusBar()),
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cachly')) {
        startRefreshLoop();
      }
    }),
  );

  // Initial update + start loop
  startRefreshLoop();

  // Trigger a recall on activation — increments recall_count on lessons
  // so recall tracking works even without a full MCP client.
  // Also re-triggers every hour for long-running IDE sessions.
  triggerSessionRecall();
  const ONE_HOUR = 60 * 60 * 1000;
  recallTimer = setInterval(() => triggerSessionRecall(), ONE_HOUR);
}

function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);

  const config = vscode.workspace.getConfiguration('cachly');
  const apiKey = config.get<string>('apiKey', '');
  const instanceId = config.get<string>('instanceId', '');

  if (!apiKey || !instanceId) {
    statusBarItem.text = '$(brain) Cachly: not configured';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
    return;
  }

  updateStatusBar();
  const interval = config.get<number>('refreshInterval', 300) * 1000;
  refreshTimer = setInterval(() => updateStatusBar(), interval);
}

async function updateStatusBar() {
  try {
    const health = await fetchBrainHealth();
    if (health.status === 'unreachable') {
      statusBarItem.text = '$(brain) Brain: offline';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      const icon = health.status === 'healthy' ? '$(brain)' : '$(warning)';
      statusBarItem.text = `${icon} Brain: ${health.lessons} lessons`;
      statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
  } catch {
    statusBarItem.text = '$(brain) Brain: error';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    statusBarItem.show();
  }
}

async function fetchBrainHealth(): Promise<BrainHealth> {
  const config = vscode.workspace.getConfiguration('cachly');
  const apiKey = config.get<string>('apiKey', '');
  const instanceId = config.get<string>('instanceId', '');
  const baseUrl = config.get<string>('apiUrl', 'https://api.cachly.dev');

  const result: BrainHealth = {
    lessons: 0,
    contexts: 0,
    lastSession: null,
    status: 'unreachable',
    tier: 'unknown',
    totalRecalls: 0,
    estimatedTokensSaved: 0,
    topLessons: [],
    topics: [],
    memoryUsedBytes: 0,
    memoryLimitBytes: 0,
    memoryUsedPct: 0,
  };

  // Fetch instance info
  try {
    const instData = await apiGet(`${baseUrl}/api/v1/instances/${instanceId}`, apiKey);
    if (instData?.tier) {
      result.tier = instData.tier;
      result.status = 'healthy';
    }
  } catch {
    return result; // unreachable
  }

  // Fetch memory/brain stats from the real memory endpoint
  try {
    const memData = await apiGet(`${baseUrl}/api/v1/instances/${instanceId}/memory`, apiKey) as MemoryData | null;
    if (memData) {
      result.lessons = memData.lesson_count ?? 0;
      result.contexts = memData.context_count ?? 0;
      result.topics = memData.topics ?? [];
      result.topLessons = memData.top_lessons ?? [];

      // Storage usage
      result.memoryUsedBytes = memData.memory_used_bytes ?? 0;
      result.memoryLimitBytes = memData.memory_limit_bytes ?? 0;
      result.memoryUsedPct = memData.memory_used_pct ?? 0;

      // Sum recall counts across all lessons
      result.totalRecalls = result.topLessons.reduce((sum, l) => sum + (l.recall_count ?? 0), 0);
      result.estimatedTokensSaved = result.totalRecalls * TOKENS_PER_RECALL;

      if (memData.last_session) {
        result.lastSession = memData.last_session.summary ?? memData.last_session.focus ?? JSON.stringify(memData.last_session);
      }
    }
  } catch {
    // memory endpoint might fail — degrade gracefully
    result.status = 'degraded';
  }

  return result;
}

async function triggerSessionRecall() {
  const config = vscode.workspace.getConfiguration('cachly');
  const apiKey = config.get<string>('apiKey', '');
  const instanceId = config.get<string>('instanceId', '');
  const baseUrl = config.get<string>('apiUrl', 'https://api.cachly.dev');

  if (!apiKey || !instanceId) return;

  try {
    await apiPost(`${baseUrl}/api/v1/instances/${instanceId}/recall`, apiKey, {
      source: 'vscode',
    });
  } catch {
    // Non-critical — don't bother the user if recall tracking fails
  }
}

function apiGet(url: string, apiKey: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    const req = mod.get(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function apiPost(url: string, apiKey: string, body: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);

    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function showBrainHealthPanel() {
  const health = await fetchBrainHealth();
  lastHealth = health;

  const statusIcon = health.status === 'healthy' ? '✅ Healthy' : health.status === 'degraded' ? '⚠️ Degraded' : '❌ Unreachable';
  const tokensSaved = health.estimatedTokensSaved > 1000
    ? `~${(health.estimatedTokensSaved / 1000).toFixed(1)}k`
    : `~${health.estimatedTokensSaved}`;
  const costSaved = `~$${(health.estimatedTokensSaved * 0.000003).toFixed(4)}`;  // ~$3/1M tokens

  // Storage usage
  const usedMB = (health.memoryUsedBytes / (1024 * 1024)).toFixed(2);
  const limitMB = (health.memoryLimitBytes / (1024 * 1024)).toFixed(0);
  const pct = health.memoryUsedPct.toFixed(1);
  const barLen = 20;
  const filled = Math.round(health.memoryUsedPct / 100 * barLen);
  const storageBar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const lines = [
    `# 🧠 Cachly Brain Health\n`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Status | ${statusIcon} |`,
    `| Tier | ${health.tier} |`,
    `| Lessons Learned | **${health.lessons}** |`,
    `| Context Entries | ${health.contexts} |`,
    `| Total Recalls | **${health.totalRecalls}** |`,
    `| Est. Tokens Saved | ${tokensSaved} |`,
    `| Est. Cost Saved | ${costSaved} |`,
    `| Last Session | ${health.lastSession ?? 'n/a'} |`,
    `| **Storage** | ${storageBar} **${usedMB} MB** / ${limitMB} MB (${pct}%) |`,
    ``,
    `## 📚 Topics (${health.topics.length})`,
    ``,
    ...health.topics.map(t => `- \`${t}\``),
    ``,
    `## 🏆 Top Lessons`,
    ``,
    `| Topic | Outcome | Recalls | Severity | What Worked |`,
    `|-------|---------|---------|----------|-------------|`,
    ...health.topLessons.map(l => {
      const outcomeIcon = l.outcome === 'success' ? '✅' : l.outcome === 'failure' ? '❌' : '⚠️';
      const sevIcon = l.severity === 'critical' ? '🔴' : l.severity === 'major' ? '🟠' : '🟡';
      const date = l.ts ? new Date(l.ts).toLocaleDateString() : '';
      return `| \`${l.topic}\` | ${outcomeIcon} | ${l.recall_count} | ${sevIcon} ${l.severity ?? '-'} | ${l.what_worked.slice(0, 60)}${l.what_worked.length > 60 ? '…' : ''} |`;
    }),
    ``,
    `---`,
    `> 💡 **How lessons work:** AI assistants call \`learn_from_attempts\` after fixing bugs or completing tasks.`,
    `> Each \`recall_best_solution\` call reuses a lesson instead of re-researching — saving ~1,200 tokens per recall.`,
    `> Run *"Cachly: Show Lessons"* for detailed lesson content.`,
  ];

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function showLessonsPanel() {
  const health = lastHealth ?? await fetchBrainHealth();
  lastHealth = health;

  if (health.topLessons.length === 0) {
    vscode.window.showInformationMessage(
      'No lessons yet. AI assistants store lessons via `learn_from_attempts` after fixing bugs or completing tasks.',
    );
    return;
  }

  const lines = [
    `# 📖 Cachly Brain — All Lessons\n`,
    `> ${health.lessons} lessons learned · ${health.totalRecalls} total recalls · ~${health.estimatedTokensSaved} tokens saved\n`,
  ];

  for (const l of health.topLessons) {
    const outcomeIcon = l.outcome === 'success' ? '✅' : l.outcome === 'failure' ? '❌' : '⚠️';
    const date = l.ts ? new Date(l.ts).toLocaleDateString() : 'unknown';
    lines.push(
      `## ${outcomeIcon} \`${l.topic}\``,
      ``,
      `- **Severity:** ${l.severity ?? 'minor'}`,
      `- **Recalled:** ${l.recall_count} time${l.recall_count !== 1 ? 's' : ''}`,
      `- **Learned:** ${date}`,
      `- **What worked:** ${l.what_worked}`,
      ``,
    );
  }

  lines.push(
    `---`,
    `> 💡 Lessons are created when an AI assistant (Copilot, Claude, Cursor) calls \`learn_from_attempts()\` via the Cachly MCP server.`,
    `> Recalls happen when the assistant calls \`recall_best_solution()\` or \`session_start()\` before starting a task.`,
    `> Each recall saves ~1,200 tokens by reusing known solutions instead of re-researching.`,
  );

  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (recallTimer) clearInterval(recallTimer);
}
