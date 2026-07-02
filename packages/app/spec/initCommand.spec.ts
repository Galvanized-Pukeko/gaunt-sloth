import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Define mocks at top level
const createProjectConfig = vi.fn();
const runFirstRunDialog = vi.fn();
const hasAnyConfig = vi.fn();
const dispatchInteractiveSession = vi.fn();
const buildCodeSessionConfig = vi.fn();
const displaySuccess = vi.fn();
const displayWarning = vi.fn();

// Mock the configSetup module (createProjectConfig lives here)
vi.mock('#src/commands/configSetup.js', () => ({
  createProjectConfig,
}));

// Mock the first-run dialog (CFG-2) — initCommand only routes to it
vi.mock('#src/commands/firstRunDialog.js', () => ({
  runFirstRunDialog,
}));

// Mock the core config module — availableDefaultConfigs feeds the arg choices; hasAnyConfig is
// the CFG-19 success gate.
vi.mock('@gaunt-sloth/core/config.js', () => ({
  availableDefaultConfigs: [
    'vertexai',
    'anthropic',
    'groq',
    'deepseek',
    'openai',
    'google-genai',
    'xai',
    'openrouter',
    'ollama',
  ],
  hasAnyConfig,
}));

vi.mock('@gaunt-sloth/core/utils/consoleUtils.js', () => ({
  displaySuccess,
  displayWarning,
}));

// Stable object so the named bindings initCommand imported keep pointing at it; tests mutate
// properties rather than reassigning.
const systemUtilsMock = {
  stdin: { isTTY: true } as { isTTY?: boolean },
  stdout: { isTTY: true } as { isTTY?: boolean },
};
vi.mock('@gaunt-sloth/core/utils/systemUtils.js', () => systemUtilsMock);

// CFG-19 — the session dispatch tail + shared code SessionConfig, lazily imported by initCommand
// on the continue path.
vi.mock('#src/modules/startSession.js', () => ({ dispatchInteractiveSession }));
vi.mock('#src/commands/codeCommand.js', () => ({ buildCodeSessionConfig }));

const CODE_SESSION_CONFIG = { mode: 'code' } as const;

describe('initCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.stdin.isTTY = true;
    systemUtilsMock.stdout.isTTY = true;
    // Default: after the dialog a config exists (setup succeeded).
    hasAnyConfig.mockResolvedValue(true);
    buildCodeSessionConfig.mockReturnValue(CODE_SESSION_CONFIG);
  });

  it('Should call createProjectConfig with the provided config type', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program);
    await program.parseAsync(['na', 'na', 'init', 'vertexai']);
    expect(createProjectConfig).toHaveBeenCalledWith('vertexai');
    expect(runFirstRunDialog).not.toHaveBeenCalled();
  });

  it('CFG-19: `gth init <provider>` does NOT start a session (scriptable, stop-only)', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program, {});
    await program.parseAsync(['na', 'na', 'init', 'vertexai']);
    expect(createProjectConfig).toHaveBeenCalledWith('vertexai');
    expect(dispatchInteractiveSession).not.toHaveBeenCalled();
    expect(runFirstRunDialog).not.toHaveBeenCalled();
  });

  it('Should run the first-run dialog when called without a type', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program);
    await program.parseAsync(['na', 'na', 'init']);
    expect(runFirstRunDialog).toHaveBeenCalledTimes(1);
    expect(createProjectConfig).not.toHaveBeenCalled();
  });

  it('CFG-19: no-arg init on an interactive TTY with a written config continues into the code session', async () => {
    const overrides = { verbose: true };
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program, overrides);
    await program.parseAsync(['na', 'na', 'init']);

    expect(runFirstRunDialog).toHaveBeenCalledTimes(1);
    // Continues into the SAME code session via the shared config + shared dispatch tail.
    expect(buildCodeSessionConfig).toHaveBeenCalledTimes(1);
    expect(dispatchInteractiveSession).toHaveBeenCalledWith(CODE_SESSION_CONFIG, overrides);
    expect(displaySuccess).toHaveBeenCalledWith('Setup complete — starting your session.');
  });

  it('CFG-19: no-arg init that is aborted (no config written) does NOT start a session', async () => {
    hasAnyConfig.mockResolvedValue(false); // user backed out; nothing written
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program, {});
    await program.parseAsync(['na', 'na', 'init']);

    expect(runFirstRunDialog).toHaveBeenCalledTimes(1);
    expect(dispatchInteractiveSession).not.toHaveBeenCalled();
    expect(displayWarning).toHaveBeenCalledWith(
      'Setup was not completed. Re-run gth once a configuration exists.'
    );
  });

  it('CFG-19: no-arg init on a non-TTY does NOT start a session (would block scripts/pipes)', async () => {
    systemUtilsMock.stdin.isTTY = false;
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    initCommand(program, {});
    await program.parseAsync(['na', 'na', 'init']);

    expect(runFirstRunDialog).toHaveBeenCalledTimes(1);
    expect(dispatchInteractiveSession).not.toHaveBeenCalled();
  });

  it('Should display available config types in help', async () => {
    const { initCommand } = await import('#src/commands/initCommand.js');
    const program = new Command();
    const testOutput = { text: '' };

    program.configureOutput({
      writeOut: (str: string) => (testOutput.text += str),
      writeErr: (str: string) => (testOutput.text += str),
    });

    initCommand(program);

    const commandUnderTest = program.commands.find((c) => c.name() === 'init');
    expect(commandUnderTest).toBeDefined();
    commandUnderTest?.outputHelp();

    // Verify available config types are displayed (argument is now optional [type])
    expect(testOutput.text).toContain('[type]');
    expect(testOutput.text).toContain('vertexai');
    expect(testOutput.text).toContain('anthropic');
    expect(testOutput.text).toContain('groq');
    expect(testOutput.text).toContain('openrouter');
  });
});
