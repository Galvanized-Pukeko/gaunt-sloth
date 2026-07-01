/**
 * EXT-22 (S1) ordering regression test — the load-bearing proof that gsloth's path-namespace
 * correction lands AFTER deepagents' hardcoded "All file paths must start with a /." line, so it
 * has the authoritative last word on path semantics.
 *
 * Unlike GthDeepAgent.spec.ts (which mocks `deepagents`), this drives the REAL deepagents middleware
 * stack via `createDeepAgent` + a real {@link FilesystemBackend}, exactly as the Task-1 spike did
 * (see handoff/spike-systemmessage-ordering.md). A recording `wrapModelCall` middleware captures the
 * final `request.systemMessage` at the model boundary, then short-circuits to a stub `AIMessage`, so
 * NO model / API key is needed. A fake model (never invoked) avoids pulling a provider package.
 *
 * Division of labour: this proves the MECHANISM (a custom wrapModelCall that concats a block lands
 * after deepagents' fs prompt, through deepagents' real middleware nesting). GthDeepAgent.spec.ts
 * proves init() actually installs the S1 middleware as the FINAL array entry with the right gate.
 */
import { describe, expect, it } from 'vitest';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { createMiddleware } from 'langchain';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPathNamespaceCorrectionMiddleware } from '#src/core/GthDeepAgent.js';

// deepagents' hardcoded line (fs.ts FILESYSTEM_SYSTEM_PROMPT) and a marker unique to the S1 guidance.
const FS_LINE = 'All file paths must start with a /.';
const GUIDANCE_MARKER = 'is NOT a valid shell path';

/** Flatten a SystemMessage's content (string or text-block array) to one searchable string. */
function assembledText(sm: unknown): string {
  const content = (sm as { content?: unknown } | undefined)?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? '')))
      .join('\n');
  }
  return '';
}

/**
 * A minimal fake model. It is NEVER invoked (the recording middleware short-circuits before the
 * model boundary), so it needs no provider package / API key; it only has to survive
 * `createDeepAgent` construction. Not an Anthropic model, so deepagents installs no cache
 * middleware — the assembled message is exactly what the runtime middleware stack produced.
 */
function fakeModel(): any {
  return {
    getName: () => 'FakeModel',
    bindTools() {
      return this;
    },
    async invoke() {
      return new AIMessage('never called');
    },
  };
}

/**
 * Build a real deep agent with [S1, recording] as custom middleware, invoke it once, and return the
 * assembled system-message text the model boundary would have received. `s1Active` toggles the S1
 * gate (true = code+virtualMode; false = POSIX real-path pass-through).
 */
async function captureAssembledSystemMessage(s1Active: boolean): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), 'ext22-order-'));
  try {
    let captured: unknown;
    const recording = createMiddleware({
      name: 'Recording',
      wrapModelCall: async (request: any) => {
        captured = request.systemMessage;
        return new AIMessage('stub'); // short-circuit: never calls handler → no model / API key
      },
    });
    const s1 = createPathNamespaceCorrectionMiddleware(s1Active);

    const agent = createDeepAgent({
      model: fakeModel(),
      tools: [],
      systemPrompt: '<<<GSLOTH_COMPOSED_SYSTEM_PROMPT_MARKER>>>',
      // S1 first, recording last: recording (innermost of the two) captures S1's appended block.
      middleware: [s1, recording] as any,
      backend: new FilesystemBackend({ rootDir: root, virtualMode: true }),
    });

    await agent.invoke({ messages: [new HumanMessage('hi')] });
    return assembledText(captured);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('EXT-22 S1 last-word ordering (real deepagents middleware stack)', () => {
  it("appends the path-namespace correction AFTER deepagents' /-rooted line (last word)", async () => {
    const text = await captureAssembledSystemMessage(true);
    const fsIdx = text.indexOf(FS_LINE);
    const guidanceIdx = text.indexOf(GUIDANCE_MARKER);

    // deepagents' hardcoded line is genuinely present (this is the real fs prompt, not a copy)...
    expect(fsIdx).toBeGreaterThanOrEqual(0);
    // ...and gsloth's correction lands strictly LATER — the model reads it last.
    expect(guidanceIdx).toBeGreaterThan(fsIdx);
  });

  it('is a transparent pass-through when inactive (POSIX real-path mode): no correction block', async () => {
    const text = await captureAssembledSystemMessage(false);
    // deepagents' fs prompt is still there; gsloth appends nothing when the gate is off.
    expect(text).toContain(FS_LINE);
    expect(text).not.toContain(GUIDANCE_MARKER);
  });
});
