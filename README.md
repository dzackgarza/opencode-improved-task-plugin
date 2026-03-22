[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I2I57UKJ8)

# improved-task

This OpenCode plugin adds the `improved_task` tool and shadows the built-in `task` tool with a plugin-backed implementation.

## Features

- Shadows the built-in `task` tool with persistent SQLite-backed task storage
- Exposes `improved_task` for structured task creation, update, and deletion with zero-knowledge UUID proof
- XDG-compliant state storage under `XDG_STATE_HOME`
- Async task dispatch via `client.session.promptAsync`

## Install

Install the plugin from its directory:

```bash
cd improved-task
direnv allow .
just install
```

Repo-root [`opencode.json`](./opencode.json) is the canonical proof config for this repo. CI starts `opencode serve` from the repo root and relies on standard global-plus-project config precedence; there is no separate `.config/opencode.json` proof path.

**Note:** This package depends on the OpenCode child-session lifecycle and does not function as a standalone MCP server.

## Tool Names

### `improved_task`

This tool delegates work to a subagent using native task lifecycle semantics. Use it to handle scoped work through a specialized subagent.

At runtime, the plugin appends the available subagent list to the tool description.
In test mode, the description carries a visibility passphrase and execution-result
paths carry distinct result passphrases.

#### Input

| Field           | Type                | Required | Description                                                     |
| --------------- | ------------------- | -------- | --------------------------------------------------------------- |
| `description`   | `string`            | Yes      | 3–5 word label for this task                                    |
| `prompt`        | `string`            | Yes      | Full prompt for the subagent                                    |
| `subagent_type` | `string`            | Yes      | Name of configured subagent                                     |
| `mode`          | `"sync" \| "async"` | No       | `sync` (default) blocks until done; `async` returns immediately |
| `timeout_ms`    | `number`            | No       | Hard timeout in ms (default 1 800 000 = 30 min)                 |
| `session_id`    | `string`            | No       | Resume an existing session instead of creating one              |

#### Example Input

```json
{
  "description": "Audit auth module",
  "prompt": "Review src/auth/ for security issues and summarize findings.",
  "subagent_type": "general-purpose"
}
```

### `task`

The `task` tool shares the same schema and runtime behavior as `improved_task`. This plugin intentionally shadows the built-in `task` name.

## Output Contract

Successful sync completion returns a markdown report with YAML front matter:

- `session_id`
- `tokens_used`
- `num_tool_calls`
- `transcript_path`
- `time_elapsed`

The report body is organized into these sections:

- `## Agent's Last Message`
- `## Turn-by-Turn Summary`
- `## Completion Review`

The turn summary is built from the `opencode-manager` transcript renderer plus the
structured transcript JSON surface (`opx transcript --json`) plus the
centralized prompt slug `micro-agents/transcript-summary` resolved through
`ai-prompts`. It includes transcript-derived narrative bullets first, then a
deterministic `### Observed Counts` block. `transcript_path` points to that
structured JSON artifact.

The report is also published into the parent session chat so both the user and later
agent turns can refer to the displayed result directly. A synthetic reminder is added
after the report to discourage redundant restatement.

Async calls return an initial running notice immediately and publish the same success
report into the parent session chat when the child session completes.

Actual TUI rendering remains a manual acceptance boundary. The plugin owns the
shadowing and session/report contract; OpenCode owns how that contract is rendered
in the interface.

Tool-description inspection proves visibility only. Execution and resume proofs in this
repo rely on raw tool outputs, published reports, manager-rendered transcripts, and
result-path verification passphrases that are unavailable before execution.

## Environment Variables

| Name                            | Required | Default                      | Controls                                       |
| ------------------------------- | -------- | ---------------------------- | ---------------------------------------------- |
| `OPENCODE_BASE_URL`             | Yes      | —                            | URL of the running OpenCode server             |
| `IMPROVED_TASK_TEST_PASSPHRASE` | No       | —                            | Passphrase for integration test liveness proof |

## Side Effects

- Writes a Markdown transcript file to the session state directory on each completed task call.
- `transcript_path` in the tool output points to the written file.
- No network calls beyond the configured OpenCode server.

## Dependencies

- Runtime: Bun, OpenCode, `@opencode-ai/plugin`
- Optional local tooling: `direnv`
- External runtime CLIs: `opx transcript`, `ai-prompts get`, `llm-run`
- External contract: configured OpenCode subagents

## Checks

```bash
direnv allow .
just check
```

CI is the canonical proof environment. For local debugging, start a repo-local OpenCode server from this checkout, set `OPENCODE_BASE_URL`, and then run the same `just` entrypoints.

For targeted runs, keep using the canonical `justfile` entrypoints instead of direct
`bun test` / `bunx tsc` commands:

```bash
just typecheck
just test
just test-file tests/integration/task-plugin.test.ts 'config-defined subagents appear'
```
