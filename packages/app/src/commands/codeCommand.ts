import { Command } from 'commander';
import type { SessionConfig } from '@gaunt-sloth/agent/modules/interactiveSessionModule.js';
import { startSession } from '#src/modules/startSession.js';
import { CommandLineConfigOverrides } from '@gaunt-sloth/core/config.js';
import { readCodePrompt } from '@gaunt-sloth/core/utils/llmUtils.js';

/**
 * Builds the `code`-mode {@link SessionConfig} literal. Exported so other entry points that need
 * to start the SAME code session (CFG-19: `gth init` continuing straight into a session after a
 * successful first-run) share ONE definition rather than duplicating the literal.
 */
export function buildCodeSessionConfig(): SessionConfig {
  return {
    mode: 'code',
    readModePrompt: readCodePrompt,
    description:
      'Interactively write code with sloth (has full file system access within your project)',
    readyMessage: '\nGaunt Sloth is ready to code. Type your prompt.',
    exitMessage: "Type 'exit' or Ctrl+C to exit code session · /help for commands\n",
  };
}

export function codeCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  const sessionConfig: SessionConfig = buildCodeSessionConfig();

  // REL-3: bare `gth` (no subcommand) now defaults to the agentic code session.
  program.action(async () => {
    await startSession(sessionConfig, commandLineConfigOverrides);
  });

  program
    .command('code')
    .description(
      'Interactively write code with sloth (has full file system access within your project)'
    )
    .argument('[message]', 'Initial message to start the code session')
    .action(async (message: string) => {
      await startSession(sessionConfig, commandLineConfigOverrides, message);
    });
}
