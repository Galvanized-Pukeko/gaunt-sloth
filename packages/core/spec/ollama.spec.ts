import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the config object ChatOpenAI is constructed with so we can assert on the built model.
const chatOpenAIConstructorMock = vi.fn();
vi.mock('@langchain/openai', () => {
  class ChatOpenAI {
    constructor(config: unknown) {
      chatOpenAIConstructorMock(config);
    }
  }
  return { ChatOpenAI };
});

const consoleUtilsMock = {
  display: vi.fn(),
  displayError: vi.fn(),
  displayInfo: vi.fn(),
  displayWarning: vi.fn(),
  displaySuccess: vi.fn(),
  displayDebug: vi.fn(),
};
vi.mock('#src/utils/consoleUtils.js', () => consoleUtilsMock);

const systemUtilsMock = {
  env: {} as Record<string, string | undefined>,
};
vi.mock('#src/utils/systemUtils.js', () => systemUtilsMock);

const fileUtilsMock = {
  writeConfigFileWithMessages: vi.fn(),
};
vi.mock('#src/utils/fileUtils.js', () => fileUtilsMock);

function buildConfig(overrides: Record<string, unknown> = {}) {
  return { type: 'ollama', ...overrides };
}

describe('ollama provider processJsonConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.env = {};
  });

  it('builds a ChatOpenAI pointed at the default local daemon /v1 base URL', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig({ model: 'gemma4:31b' }));

    expect(chatOpenAIConstructorMock).toHaveBeenCalledTimes(1);
    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.configuration.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(builtConfig.model).toBe('gemma4:31b');
  });

  it('falls back to the default model when none is configured', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig());

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.model).toBe('qwen3-coder');
  });

  it('is keyless: injects a placeholder apiKey when none is provided', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig());

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    // ChatOpenAI requires a non-empty apiKey; a placeholder must be present.
    expect(typeof builtConfig.apiKey).toBe('string');
    expect(builtConfig.apiKey.length).toBeGreaterThan(0);
  });

  it('honors an explicitly configured apiKey over the placeholder', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig({ apiKey: 'custom-key' }));

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.apiKey).toBe('custom-key');
  });

  it('derives the /v1 base URL from a full-URL OLLAMA_HOST override', async () => {
    systemUtilsMock.env = { OLLAMA_HOST: 'http://192.168.1.50:11434' };
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig());

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.configuration.baseURL).toBe('http://192.168.1.50:11434/v1');
  });

  it('derives the /v1 base URL from a bare host:port OLLAMA_HOST override', async () => {
    systemUtilsMock.env = { OLLAMA_HOST: '127.0.0.1:1234' };
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig());

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.configuration.baseURL).toBe('http://127.0.0.1:1234/v1');
  });

  it('strips a trailing slash from OLLAMA_HOST before appending /v1', async () => {
    systemUtilsMock.env = { OLLAMA_HOST: 'http://127.0.0.1:11434/' };
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig());

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.configuration.baseURL).toBe('http://127.0.0.1:11434/v1');
  });

  it('strips internal config keys (type, apiKeyEnvironmentVariable) from the built model', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig({ apiKeyEnvironmentVariable: 'OLLAMA_HOST' }));

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect('type' in builtConfig).toBe(false);
    expect('apiKeyEnvironmentVariable' in builtConfig).toBe(false);
  });

  it('preserves a user-supplied configuration alongside the default baseURL', async () => {
    const { processJsonConfig } = await import('#src/providers/ollama.js');

    await processJsonConfig(buildConfig({ configuration: { timeout: 5000 } }));

    const builtConfig = chatOpenAIConstructorMock.mock.calls[0][0];
    expect(builtConfig.configuration.baseURL).toBe('http://127.0.0.1:11434/v1');
    expect(builtConfig.configuration.timeout).toBe(5000);
  });
});

describe('ollama provider init', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    systemUtilsMock.env = {};
  });

  it('writes the default JSON config and warns the user', async () => {
    const { init } = await import('#src/providers/ollama.js');

    init('.gsloth.config.json');

    expect(fileUtilsMock.writeConfigFileWithMessages).toHaveBeenCalledTimes(1);
    const [fileName, content, force] = fileUtilsMock.writeConfigFileWithMessages.mock.calls[0];
    expect(fileName).toBe('.gsloth.config.json');
    expect(content).toContain('"type": "ollama"');
    expect(force).toBe(false);
    expect(consoleUtilsMock.displayWarning).toHaveBeenCalledTimes(1);
  });

  it('overwrites the config when called with force', async () => {
    const { init } = await import('#src/providers/ollama.js');

    init('.gsloth.config.json', true);

    expect(fileUtilsMock.writeConfigFileWithMessages).toHaveBeenCalledTimes(1);
    const [, , force] = fileUtilsMock.writeConfigFileWithMessages.mock.calls[0];
    expect(force).toBe(true);
  });

  it('rejects non-JSON config file names', async () => {
    const { init } = await import('#src/providers/ollama.js');

    expect(() => init('.gsloth.config.js')).toThrow('Only JSON config is supported.');
  });
});
