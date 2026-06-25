# @gaunt-sloth/tools

> ⚠️ **Deprecated.** This package is part of the `gaunt-sloth-assistant` 1.x line, which has been
> renamed to [`gaunt-sloth`](https://www.npmjs.com/package/gaunt-sloth). It is not carried forward
> into v2 and will receive no further updates.
> Site & docs: <https://gauntsloth.app> · Source: <https://github.com/pukeko-robotics/gaunt-sloth>

Tools and middleware for Gaunt Sloth.

## Contents

- Built-in tools configuration (`builtInToolsConfig`)
- Filesystem toolkit (`GthFileSystemToolkit`) — provides read/write/glob/grep tools controlled by `.aiignore`
- Custom tools (`GthCustomToolkit`) — executes user-defined shell commands from config
- Dev tools (`GthDevToolkit`) — tools for development and coding sessions
- Status update tool
- Web fetch tool
- Binary content injection middleware
- Middleware registry (`resolveMiddleware`) and types

## Dependencies

- `@gaunt-sloth/core`

## Exports

```js
import { builtInToolsConfig } from '@gaunt-sloth/tools/builtInToolsConfig.js';
import { resolveMiddleware } from '@gaunt-sloth/tools/middleware/registry.js';
```

## Related packages

- [`@gaunt-sloth/core`](../core) — Core utilities, config, and agent infrastructure
- [`@gaunt-sloth/tools`](../tools) — Built-in tools, filesystem toolkit, and middleware registry (this package)
- [`@gaunt-sloth/api`](../api) — API server, AG-UI, MCP, and A2A integration
- [`@gaunt-sloth/review`](../review) — Review and Q&A modules with standalone CLI
- [`gaunt-sloth-assistant`](../assistant) — Main CLI application
