/**
 * Integration test: Japanese text rendered with matplotlib in the AgentCore
 * CodeInterpreter sandbox must NOT be garbled (tofu / □).
 *
 * Root cause this guards against: the sandbox's default matplotlib font is
 * DejaVu Sans, which has no CJK glyphs, so every Japanese character renders as a
 * missing-glyph box. A Japanese-capable font (Droid Sans Fallback) ships in the
 * image but is not used unless the font family is configured. The client is
 * expected to bootstrap that configuration automatically per session, so naive
 * user code (no explicit fontproperties) renders Japanese correctly.
 *
 * The test deliberately runs NAIVE matplotlib code with no font setup — the same
 * thing an LLM emits by default — so it fails (RED) until the client applies the
 * fix, and passes (GREEN) once it does.
 *
 * How to run:
 * npm run test:integration -- matplotlib-japanese-font.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { AgentCoreCodeInterpreterClient } from '../client.js';
import type { ExecuteCodeAction } from '../types.js';

let client: AgentCoreCodeInterpreterClient;
let sessionName: string;

beforeAll(async () => {
  sessionName = `jp-font-test-${Date.now()}`;
  client = new AgentCoreCodeInterpreterClient({
    region: process.env.AWS_REGION || 'us-east-1',
    sessionName,
    autoCreate: true,
    persistSessions: false,
  });
}, 60000);

afterAll(async () => {
  try {
    await client.cleanup();
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}, 60000);

/**
 * Renders a representative mixed Japanese + ASCII string (taken from the kind of
 * dashboard that exhibited the bug) and reports, from inside the sandbox, how
 * many characters cannot be drawn by the resolved font family. A correct
 * environment reports TOFU_COUNT: 0 and emits no "missing from font" warning.
 */
const NAIVE_RENDER_CODE = `
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ft2font import FT2Font

# Mixed Japanese + ASCII + digits, like the reported dashboard titles/labels.
text = "令和6年度 事業別執行率 補助金交付事業 ABC 123 (%)"

fig, ax = plt.subplots()
ax.set_title(text, fontsize=18)
ax.set_xlabel("実行率 (%)")
ax.plot([1, 2, 3], [4, 5, 6], label="広報・情報発信事業")
ax.legend()
fig.canvas.draw()  # forces glyph lookup; warns on missing glyphs

# Resolve the active font family chain and check coverage per character.
# Wrap each name in FontProperties(family=...) so generic aliases like
# "sans-serif" resolve to a concrete font file instead of being parsed as a
# fontconfig pattern.
family = matplotlib.rcParams["font.family"]
fonts = [
    FT2Font(font_manager.findfont(font_manager.FontProperties(family=[name])))
    for name in family
]

def covered(ch):
    return any(f.get_char_index(ord(ch)) != 0 for f in fonts)

missing = sorted({ch for ch in text if not ch.isspace() and not covered(ch)})
print("RESULT_JSON " + json.dumps({
    "family": list(family),
    "tofuCount": len(missing),
    "missing": missing,
}))
`;

interface RenderResult {
  family: string[];
  tofuCount: number;
  missing: string[];
}

function parseResult(output: string): RenderResult {
  const line = output.split('\n').find((l) => l.startsWith('RESULT_JSON '));
  if (!line) {
    throw new Error(`No RESULT_JSON marker in sandbox output:\n${output}`);
  }
  return JSON.parse(line.slice('RESULT_JSON '.length)) as RenderResult;
}

describe('CodeInterpreter matplotlib Japanese font rendering', () => {
  it('renders Japanese text with no missing glyphs (no tofu)', async () => {
    const action: ExecuteCodeAction = {
      action: 'executeCode',
      sessionName,
      language: 'python',
      code: NAIVE_RENDER_CODE,
    };

    const result = await client.executeCode(action);
    expect(result.status).toBe('success');

    const output = result.content[0].text ?? JSON.stringify(result.content[0]);
    const parsed = parseResult(output);

    console.log('Resolved font family:', parsed.family);
    if (parsed.tofuCount > 0) {
      console.log('Missing glyphs:', parsed.missing);
    }

    // The active font family must include a CJK-capable fallback...
    expect(parsed.tofuCount).toBe(0);
    // ...and matplotlib must not have logged any missing-glyph warning.
    expect(output).not.toMatch(/missing from font/i);
  }, 120000);

  it('renders Japanese correctly in a fresh kernel (clearContext)', async () => {
    // A reset kernel must still pick up the font configuration (e.g. via an
    // on-disk matplotlibrc), not only an in-memory rcParams mutation.
    const action: ExecuteCodeAction = {
      action: 'executeCode',
      sessionName,
      language: 'python',
      code: NAIVE_RENDER_CODE,
      clearContext: true,
    };

    const result = await client.executeCode(action);
    expect(result.status).toBe('success');

    const output = result.content[0].text ?? JSON.stringify(result.content[0]);
    const parsed = parseResult(output);

    expect(parsed.tofuCount).toBe(0);
    expect(output).not.toMatch(/missing from font/i);
  }, 120000);
});
