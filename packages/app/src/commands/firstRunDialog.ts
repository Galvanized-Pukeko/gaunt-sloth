import { USER_PROJECT_CONFIG_JSON } from '@gaunt-sloth/core/constants.js';
import {
  detectProviders,
  listModels,
  type DetectedProvider,
  type ModelInfo,
  type ProviderId,
} from '@gaunt-sloth/core/providers/modelDiscovery.js';
import { getGlobalGslothConfigWritePath } from '@gaunt-sloth/core/utils/globalConfigUtils.js';
import {
  displayInfo,
  displaySuccess,
  displayWarning,
} from '@gaunt-sloth/core/utils/consoleUtils.js';
import { createInterface, stdin, stdout } from '@gaunt-sloth/core/utils/systemUtils.js';
import {
  getGslothConfigWritePath,
  writeFileIfNotExistsWithMessages,
} from '@gaunt-sloth/review/utils/fileUtils.js';
import { ensureGslothDir, writeProjectReviewPreamble } from '#src/commands/configSetup.js';

/**
 * Where the first-run dialog (CFG-2) persists the chosen provider/model config.
 * `project` writes into the project's `.gsloth/.gsloth-settings/` (CFG-3 loads it
 * as the highest-precedence layer); `global` writes into `~/.gsloth/`, the base
 * layer shared by every project.
 */
export type ConfigScope = 'project' | 'global';

type AskFn = (question: string) => Promise<string>;

/**
 * Injectable side effects, so the dialog can be unit-tested without touching the
 * filesystem, the network (Ollama probe) or stdin. Defaults wire the real
 * CFG-1 detection + CFG-3 write paths.
 */
export interface FirstRunDialogDeps {
  detectProviders: typeof detectProviders;
  listModels: typeof listModels;
  ensureGslothDir: typeof ensureGslothDir;
  writeProjectReviewPreamble: typeof writeProjectReviewPreamble;
  /** Writes the config content to the scope's path and returns that path. */
  writeConfig: (scope: ConfigScope, content: string) => string;
  /** Prompts the user and resolves with their (untrimmed) answer. */
  ask: AskFn;
}

/**
 * Orders providers so usable ones (API key present / Ollama running) come first,
 * preserving the registry order within each group (Array.prototype.sort is stable).
 */
export function orderProviders(providers: DetectedProvider[]): DetectedProvider[] {
  return [...providers].sort((a, b) => Number(b.available) - Number(a.available));
}

/**
 * Parses a 1-based menu answer into a 0-based index, or null when it is not a
 * whole number within `1..count`.
 */
export function parseMenuSelection(answer: string, count: number): number | null {
  const n = Number.parseInt(answer.trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > count) return null;
  return n - 1;
}

/** The index of the first ⭐ preferred model, or 0 when none are flagged. */
export function defaultModelIndex(models: ModelInfo[]): number {
  const preferred = models.findIndex((m) => m.preferred);
  return preferred >= 0 ? preferred : 0;
}

/** Builds the `.gsloth.config.json` body for a chosen provider + model. */
export function buildConfigContent(providerId: ProviderId, model: string): string {
  return `${JSON.stringify({ llm: { type: providerId, model } }, null, 2)}\n`;
}

/** Resolves the config write path for the chosen scope (CFG-3 layering). */
export function resolveConfigWritePath(scope: ConfigScope): string {
  return scope === 'global'
    ? getGlobalGslothConfigWritePath(USER_PROJECT_CONFIG_JSON)
    : getGslothConfigWritePath(USER_PROJECT_CONFIG_JSON);
}

/**
 * Short, human description of a provider's readiness for the menu line.
 */
function providerStatus(provider: DetectedProvider): string {
  if (provider.available) {
    return provider.apiKeyEnvironmentVariable
      ? `key: ${provider.apiKeyEnvironmentVariable}`
      : 'ready';
  }
  return provider.requiresExternalAuth ? 'needs external auth' : 'no API key set';
}

/**
 * Prompts until the answer is a valid 1-based selection. When `defaultIdx` is
 * provided, an empty answer resolves to it (so the menu can show a default).
 */
async function promptMenu(
  ask: AskFn,
  question: string,
  count: number,
  defaultIdx?: number
): Promise<number> {
  for (;;) {
    const answer = (await ask(question)).trim();
    if (answer === '' && defaultIdx !== undefined) return defaultIdx;
    const idx = parseMenuSelection(answer, count);
    if (idx !== null) return idx;
    displayWarning(`Please enter a number between 1 and ${count}.`);
  }
}

function defaultWriteConfig(scope: ConfigScope, content: string): string {
  const path = resolveConfigWritePath(scope);
  writeFileIfNotExistsWithMessages(path, content);
  return path;
}

/**
 * CFG-2 — the first-run configuration dialog.
 *
 * Walks the user through: (1) picking a provider (usable ones first, detected via
 * CFG-1), (2) picking a model (⭐ preferred ones flagged, first preferred is the
 * default), and (3) choosing whether to store the config for this project or
 * globally (CFG-3). Writes a minimal `{ llm: { type, model } }` config and, for
 * the project scope, scaffolds the review/guidelines preamble.
 */
export async function runFirstRunDialog(
  overrides: Partial<FirstRunDialogDeps> = {}
): Promise<void> {
  const rl = overrides.ask ? null : createInterface({ input: stdin, output: stdout });
  const deps: FirstRunDialogDeps = {
    detectProviders,
    listModels,
    ensureGslothDir,
    writeProjectReviewPreamble,
    writeConfig: defaultWriteConfig,
    ask: overrides.ask ?? ((q) => rl!.question(q)),
    ...overrides,
  };

  try {
    // 1. Provider.
    const providers = orderProviders(await deps.detectProviders());
    if (providers.length === 0) {
      displayWarning('No providers are known to Gaunt Sloth. Cannot configure.');
      return;
    }
    displayInfo('Select a provider:');
    providers.forEach((provider, index) => {
      const mark = provider.available ? '✓' : ' ';
      displayInfo(`  ${index + 1}. [${mark}] ${provider.label} (${providerStatus(provider)})`);
    });
    const provider = providers[await promptMenu(deps.ask, '\nProvider number: ', providers.length)];

    if (!provider.available) {
      displayWarning(
        `${provider.label} is not ready yet — you will need to ${
          provider.requiresExternalAuth
            ? 'complete its external authentication'
            : 'set its API key environment variable'
        } before running gsloth. Writing the config so you can fill in the rest.`
      );
    }

    // 2. Model.
    const models = await deps.listModels(provider.id);
    let model: string;
    if (models.length === 0) {
      displayWarning(`No models discovered for ${provider.label}.`);
      model = (await deps.ask('Enter a model id to use: ')).trim();
      if (!model) {
        displayWarning('No model entered; aborting setup.');
        return;
      }
    } else {
      const fallback = defaultModelIndex(models);
      displayInfo(`\nSelect a model for ${provider.label}:`);
      models.forEach((m, index) => {
        const star = m.preferred ? '⭐ ' : '   ';
        const isDefault = index === fallback ? ' (default)' : '';
        displayInfo(`  ${index + 1}. ${star}${m.id}${isDefault}`);
      });
      model =
        models[
          await promptMenu(deps.ask, `\nModel number [${fallback + 1}]: `, models.length, fallback)
        ].id;
    }

    // 3. Scope.
    displayInfo('\nWhere should this configuration be stored?');
    displayInfo('  1. This project only (.gsloth/.gsloth-settings/)');
    displayInfo('  2. Globally for all projects (~/.gsloth/)');
    const scope: ConfigScope =
      (await promptMenu(deps.ask, '\nStorage choice [1]: ', 2, 0)) === 1 ? 'global' : 'project';

    // 4. Scaffold (project only) + write.
    if (scope === 'project') {
      deps.ensureGslothDir();
      deps.writeProjectReviewPreamble();
    }
    const writtenPath = deps.writeConfig(scope, buildConfigContent(provider.id, model));

    displaySuccess(`Configured ${provider.label} / ${model} (${scope}).`);
    displayInfo(`Config written to ${writtenPath}`);
    if (provider.apiKeyEnvironmentVariable) {
      displayInfo(`Using API key from ${provider.apiKeyEnvironmentVariable}.`);
    } else if (!provider.available && !provider.requiresExternalAuth) {
      displayInfo('Remember to set your API key environment variable before running gsloth.');
    }
  } finally {
    rl?.close();
  }
}
