import { Command } from 'commander';
import {
  createInteractiveSession,
  SessionConfig,
} from '@gaunt-sloth/agent/modules/interactiveSessionModule.js';
import { CommandLineConfigOverrides } from '@gaunt-sloth/core/config.js';
import { readCodePrompt } from '@gaunt-sloth/core/utils/llmUtils.js';

export function codeCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides
): void {
  program
    .command('code')
    .description(
      'Interactively write code with sloth (has full file system access within your project)'
    )
    .argument('[message]', 'Initial message to start the code session')
    .action(async (message: string) => {
      const sessionConfig: SessionConfig = {
        mode: 'code',
        readModePrompt: readCodePrompt,
        description:
          'Interactively write code with sloth (has full file system access within your project)',
        readyMessage: '\nGaunt Sloth is ready to code. Type your prompt.',
        exitMessage: "Type 'exit' or hit Ctrl+C to exit code session\n",
      };

      await createInteractiveSession(sessionConfig, commandLineConfigOverrides, message);
    });
}
