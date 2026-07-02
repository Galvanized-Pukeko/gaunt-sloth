import type { ConfigType, CommandLineConfigOverrides } from '@gaunt-sloth/core/config.js';
import { availableDefaultConfigs, hasAnyConfig } from '@gaunt-sloth/core/config.js';
import { createProjectConfig } from '#src/commands/configSetup.js';
import { runFirstRunDialog } from '#src/commands/firstRunDialog.js';
import { displaySuccess, displayWarning } from '@gaunt-sloth/core/utils/consoleUtils.js';
import { stdin, stdout } from '@gaunt-sloth/core/utils/systemUtils.js';
import { Argument, Command } from 'commander';

/**
 * Adds the init command to the program.
 *
 * With an explicit `[type]` it writes a project config for that provider (the
 * scriptable path) and stops. Without arguments it runs the CFG-2 first-run dialog,
 * which detects usable providers, lets the user pick a provider + model and choose
 * whether to store the config for this project or globally.
 *
 * CFG-19 — no-arg `gth init` no longer dead-ends at the shell after setup: on a
 * successful first-run (a config now exists) AND an interactive TTY, it continues
 * straight into the `code` session in the same process, mirroring what bare-`gth`
 * first-run does via CFG-16. `gth init <provider>` stays stop-only (the scriptable
 * "scaffold config and exit" path), and non-TTY / aborted-dialog runs never start a
 * session (they would block scripts/pipes or have no config to run against).
 *
 * @param program - The commander program
 * @param commandLineConfigOverrides - CLI config overrides, forwarded to the continuing session
 */
export function initCommand(
  program: Command,
  commandLineConfigOverrides: CommandLineConfigOverrides = {}
): void {
  program
    .command('init')
    .description('Initialize Gaunt Sloth in your project. This will write necessary config files.')
    .addArgument(
      new Argument(
        '[type]',
        'Config type (optional, runs the interactive dialog if omitted)'
      ).choices(availableDefaultConfigs)
    )
    .action(async (config?: ConfigType) => {
      if (config) {
        // Naming a provider is the scriptable "scaffold config and exit" path — stop-only.
        await createProjectConfig(config);
        return;
      }

      await runFirstRunDialog();

      // CFG-19 — continue straight into the `code` session on a successful, interactive first-run
      // instead of returning to the shell (the observed dead-end). Only when a config now exists
      // (the user did not abort) AND we are on an interactive TTY — the exact gate CFG-16 uses in
      // startSession, so non-TTY / piped runs never block waiting on stdin.
      if (!(await hasAnyConfig(commandLineConfigOverrides))) {
        // The user aborted the dialog without writing a config; nothing to run.
        displayWarning('Setup was not completed. Re-run gth once a configuration exists.');
        return;
      }
      if (!(stdin.isTTY && stdout.isTTY)) {
        // Non-interactive run: config is written, but auto-launching a session would block a
        // script/pipe. Stop here — the user can re-run `gth` interactively.
        return;
      }

      displaySuccess('Setup complete — starting your session.');
      // Lazily import the session dispatch + code SessionConfig so the `<provider>` stop-only path
      // never loads the session/TUI dependency graph.
      const { dispatchInteractiveSession } = await import('#src/modules/startSession.js');
      const { buildCodeSessionConfig } = await import('#src/commands/codeCommand.js');
      await dispatchInteractiveSession(buildCodeSessionConfig(), commandLineConfigOverrides);
    });
}
