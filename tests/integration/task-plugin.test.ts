import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

const OPENCODE = "/home/dzack/.opencode/bin/opencode";
const TOOL_DIR = "/home/dzack/opencode-plugins/improved-task";
const SEED = "SWORDFISH-TASK";
const MAX_BUFFER = 8 * 1024 * 1024;

function pass(tool: string, path: string) {
  return `${SEED}:${tool}:${path}`;
}

function run(prompt: string, timeout = 180_000) {
  spawnSync("direnv", ["allow", TOOL_DIR], { cwd: TOOL_DIR, timeout: 30_000 });
  const result = spawnSync(
    "direnv",
    ["exec", TOOL_DIR, OPENCODE, "run", "--agent", "Minimal", prompt],
    { cwd: process.env.HOME, encoding: "utf8", timeout, maxBuffer: MAX_BUFFER },
  );
  if (result.error) throw result.error;
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function runInteractive(prompt: string, timeout = 180_000) {
  const result = spawnSync(
    "sh",
    [
      "-lc",
      `timeout 120 sh -lc ${JSON.stringify(`printf '%s\n' ${JSON.stringify(prompt)} | direnv exec ${JSON.stringify(TOOL_DIR)} ${JSON.stringify(OPENCODE)} --agent Minimal 2>&1`)}`,
    ],
    {
      cwd: process.env.HOME,
      encoding: "utf8",
      timeout,
      maxBuffer: MAX_BUFFER,
      env: process.env,
    },
  );
  if (result.error) throw result.error;
  return (result.stdout ?? "") + (result.stderr ?? "");
}

describe("improved-task live e2e", () => {
  it("proves improved_task visibility", () => {
    const output = run(
      "If you can see a tool named improved_task and its description includes a verification passphrase, reply with ONLY that passphrase. Otherwise reply with ONLY NONE.",
    );
    expect(output).toContain(pass("improved_task", "visible"));
  }, 200_000);

  it("proves improved_task sync new and resume", () => {
    const output = run(
      "Use improved_task with a general subagent to do one short task, then resume the same session for a second short task. After both improved_task calls complete, reply with ONLY the two verification passphrases from those tool results, one per line, in order.",
    );
    expect(output).toContain(pass("improved_task", "sync:new"));
    expect(output).toContain(pass("improved_task", "sync:resume"));
  }, 220_000);

  it("proves improved_task async new and resume", () => {
    const output = runInteractive(
      "Use improved_task exactly twice, both times in async mode with subagent_type general. First create a new child session and wait for its completion message. Then call improved_task again with the returned session_id to resume that same child session, wait for the second completion message, and finally reply with ONLY the two verification passphrases from those two completion messages, one per line, in order. Do not inspect or use any tool other than improved_task.",
    );
    expect(output).toContain(pass("improved_task", "async:new"));
    expect(output).toContain(pass("improved_task", "async:resume"));
  }, 220_000);

  it("proves task shadow visibility", () => {
    const output = run(
      "If you can see a tool named task and its description includes a verification passphrase, reply with ONLY that passphrase. Otherwise reply with ONLY NONE.",
    );
    expect(output).toContain(pass("task", "visible"));
  }, 200_000);

  it("proves task sync new and resume", () => {
    const output = run(
      "Use task exactly twice, both times with mode=sync and subagent_type general. First create a new child session and complete one short task. Then call task again with the returned session_id to resume that same child session for a second short task. After both task calls complete, reply with ONLY the two verification passphrases from those tool results, one per line, in order. Do not inspect or use any tool other than task.",
    );
    expect(output).toContain(pass("task", "sync:new"));
    expect(output).toContain(pass("task", "sync:resume"));
  }, 220_000);

  it("proves task async new and resume", () => {
    const output = runInteractive(
      "Use task exactly twice, both times with mode=async and subagent_type general. First create a new child session and wait for its completion message. Then call task again with the returned session_id to resume that same child session, wait for the second completion message, and finally reply with ONLY the two verification passphrases from those two completion messages, one per line, in order. Do not inspect or use any tool other than task.",
    );
    expect(output).toContain(pass("task", "async:new"));
    expect(output).toContain(pass("task", "async:resume"));
  }, 220_000);
});
