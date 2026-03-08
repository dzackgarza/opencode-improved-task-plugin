# improved-task debugging

Use the standalone OpenCode binary with the plugin-local `direnv` environment.
Do not use server-backed harnesses for direct `improved_task` verification.

## Setup

```bash
cd /home/dzack/opencode-plugins/improved-task
direnv allow
```

This exports:

- `OPENCODE_CONFIG=$PWD/.config/opencode.json`
- `IMPROVED_TASK_TEST_PASSPHRASE=SWORDFISH-TASK`

## Direct visibility proof

```bash
direnv exec . /home/dzack/.opencode/bin/opencode run --agent Minimal \
  "If you can see a tool named improved_task and its description includes a verification passphrase, reply with ONLY that passphrase. Otherwise reply with ONLY NONE."
```

## Direct sync proof

```bash
direnv exec . /home/dzack/.opencode/bin/opencode run --agent Minimal \
  "Use improved_task with a general subagent to do one short task, then resume the same session for a second short task. After both improved_task calls complete, reply with ONLY the two verification passphrases from those tool results, one per line, in order."
```

## Direct async proof

`opencode run` exits on idle, so async verification must use interactive stdin mode and a shell timeout.

```bash
timeout 120 sh -lc 'printf "%s\n" \
  "Use improved_task exactly twice, both times in async mode with subagent_type general. First create a new child session and wait for its completion message. Then call improved_task again with the returned session_id to resume that same child session, wait for the second completion message, and finally reply with ONLY the two verification passphrases from those two completion messages, one per line, in order. Do not inspect or use any tool other than improved_task." \
  | direnv exec . /home/dzack/.opencode/bin/opencode --agent Minimal 2>&1'
```

## Shadow proof

```bash
direnv exec . /home/dzack/.opencode/bin/opencode run --agent Minimal \
  "If you can see a tool named task and its description includes a verification passphrase, reply with ONLY that passphrase. Otherwise reply with ONLY NONE."
```
