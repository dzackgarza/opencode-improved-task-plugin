import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function requireEnv(name: string, message: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(message);
  return value;
}

const BASE_URL = requireEnv(
  'OPENCODE_BASE_URL',
  'OPENCODE_BASE_URL must be set (run against a repo-local or CI OpenCode server)',
);
const PASSPHRASE = requireEnv(
  'IMPROVED_TASK_TEST_PASSPHRASE',
  'IMPROVED_TASK_TEST_PASSPHRASE must be set (sourced from plugin .envrc)',
);
const PROJECT_DIR = process.cwd();

const MANAGER_PACKAGE = 'git+https://github.com/dzackgarza/opencode-manager.git';
const MAX_BUFFER = 8 * 1024 * 1024;
const SESSION_TIMEOUT_MS = 240_000;
const ASYNC_CALLBACK_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

const IMPROVED_TASK_PROOF_AGENT = 'improved-task-proof';
const TASK_PROOF_AGENT = 'task-proof';

type TranscriptStep = {
  type: string;
  tool?: string;
  status?: string;
  outputText?: string;
  contentText?: string;
};

type TranscriptAssistantMessage = {
  steps: Array<TranscriptStep | null>;
};

type TranscriptTurn = {
  userPrompt: string;
  assistantMessages: TranscriptAssistantMessage[];
};

type TranscriptData = {
  turns: TranscriptTurn[];
};

type ToolStep = TranscriptStep & {
  type: 'tool';
  tool: string;
};

function runOcm(args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(
    'uvx',
    ['--from', MANAGER_PACKAGE, 'ocm', ...args],
    {
      env: { ...process.env, OPENCODE_BASE_URL: BASE_URL },
      cwd: PROJECT_DIR,
      encoding: 'utf8',
      timeout: SESSION_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    },
  );
  if (result.error) throw result.error;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (result.status !== 0) {
    throw new Error(`ocm ${args.join(' ')} failed\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  return { stdout, stderr };
}

function beginSession(prompt: string, agent?: string): string {
  const args = agent
    ? ['begin-session', prompt, '--agent', agent, '--json']
    : ['begin-session', prompt, '--json'];
  const { stdout } = runOcm(args);
  const data = JSON.parse(stdout) as { sessionID: string };
  if (!data.sessionID) throw new Error(`begin-session returned no sessionID: ${stdout}`);
  return data.sessionID;
}

function waitIdle(sessionID: string): void {
  runOcm(['wait', sessionID, '--timeout-sec=180']);
}

function readTranscriptData(sessionID: string): TranscriptData {
  const { stdout } = runOcm(['transcript', sessionID, '--json']);
  return JSON.parse(stdout) as TranscriptData;
}

function readTranscriptTurns(sessionID: string): TranscriptTurn[] {
  return readTranscriptData(sessionID).turns;
}

function readTranscriptSteps(sessionID: string): TranscriptStep[] {
  return readTranscriptTurns(sessionID).flatMap((turn) =>
    turn.assistantMessages.flatMap((msg) =>
      (msg.steps ?? []).filter((step): step is TranscriptStep => step !== null),
    ),
  );
}

function readFinalAssistantText(sessionID: string): string {
  const parts = readTranscriptTurns(sessionID).flatMap((turn) =>
    turn.assistantMessages.flatMap((msg) =>
      (msg.steps ?? [])
        .filter((step): step is { type: string; contentText: string } =>
          step !== null && step.type === 'text' && typeof step.contentText === 'string',
        )
        .map((step) => step.contentText),
    ),
  );
  return parts.join('\n');
}

function findCompletedToolStep(sessionID: string, toolName: string): ToolStep {
  const steps = readTranscriptSteps(sessionID);
  const step = steps.find(
    (candidate): candidate is ToolStep =>
      candidate.type === 'tool' &&
      candidate.tool === toolName &&
      candidate.status === 'completed',
  );
  expect(step, `Missing completed ${toolName} step.\n${JSON.stringify(steps, null, 2)}`).toBeDefined();
  return step as ToolStep;
}

function findUserPrompt(
  turns: TranscriptTurn[],
  predicate: (prompt: string) => boolean,
): string | undefined {
  return turns
    .map((turn) => turn.userPrompt)
    .find((prompt) => typeof prompt === 'string' && prompt.length > 0 && predicate(prompt));
}

function extractFrontMatterValue(text: string, key: string): string | undefined {
  const quoted = text.match(new RegExp(`^${key}:\\s*\"([^\"]+)\"$`, 'm'));
  if (quoted) return quoted[1];
  const bare = text.match(new RegExp(`^${key}:\\s*([^\\n]+)$`, 'm'));
  return bare?.[1]?.trim();
}

function expectReminderPrompt(prompt: string): void {
  expect(prompt).toContain('<system-reminder>');
  expect(prompt).toContain('The subagent results report has already been displayed in chat.');
  expect(prompt).toContain('Refer to that displayed report instead of reconstructing it');
  expect(prompt).toContain('</system-reminder>');
}

function expectSummaryReportPrompt(input: {
  report: string;
  childSessionID: string;
  verificationPassphrase: string;
}): void {
  const { report, childSessionID, verificationPassphrase } = input;
  expect(report).not.toContain('[task_failed]');
  expect(report).toContain(`session_id: "${childSessionID}"`);
  expect(report).toContain('tokens_used:');
  expect(report).toContain('num_tool_calls:');
  expect(report).toContain('transcript_path:');
  expect(report).toContain('## Agent\'s Last Message');
  expect(report).toContain('## Turn-by-Turn Summary');
  expect(report).toContain('### Observed Counts');
  expect(report).toContain('## Completion Review');
  expect(report).toContain(`Verification passphrase: ${verificationPassphrase}`);

  const transcriptPath = extractFrontMatterValue(report, 'transcript_path');
  expect(transcriptPath).toBeDefined();
  expect(existsSync(transcriptPath as string)).toBe(true);

  const transcriptArtifact = readFileSync(transcriptPath as string, 'utf8');
  expect(transcriptArtifact).toContain(`"sessionID": "${childSessionID}"`);
}

async function waitForUserPrompt(
  sessionID: string,
  predicate: (prompt: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = findUserPrompt(readTranscriptTurns(sessionID), predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for matching user prompt in session ${sessionID}.`);
}

describe('improved-task plugin integration', () => {
  describe('tool visibility', () => {
    it('proves improved_task tool description embeds the verification passphrase', () => {
      const prompt =
        'Reply with EXACTLY the verification passphrase from the improved_task tool description. Do not call improved_task. Reply with ONLY the passphrase, nothing else.';

      const sessionID = beginSession(prompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);
        const text = readFinalAssistantText(sessionID);
        expect(text).toContain(PASSPHRASE);
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);

    it('proves config-defined subagents appear in the improved_task tool description', () => {
      const prompt =
        'Reply with EXACTLY the bullet line from the improved_task tool description that starts with "- general:". Do not call improved_task. If no such line exists, reply with ONLY MISSING.';

      const sessionID = beginSession(prompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);
        const text = readFinalAssistantText(sessionID).trim();
        expect(text).not.toBe('MISSING');
        expect(text).toContain('- general:');
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);
  });

  describe('sync lifecycle', () => {
    it('proves improved_task sync delegation publishes a success report and reminder', () => {
      const prompt =
        'Use improved_task once with mode=sync and subagent_type general. In the child session, reply with ONLY the word DONE. After the tool finishes, reply with ONLY OK.';

      const sessionID = beginSession(prompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);

        const toolStep = findCompletedToolStep(sessionID, 'improved_task');
        expect(toolStep.outputText).toContain('report_published: true');

        const childSessionID = extractFrontMatterValue(toolStep.outputText ?? '', 'session_id');
        expect(childSessionID).toBeDefined();

        const turns = readTranscriptTurns(sessionID);
        const report = findUserPrompt(
          turns,
          (candidate) => candidate.includes(`${PASSPHRASE}:improved_task:sync:new`),
        );
        expect(report).toBeDefined();
        expectSummaryReportPrompt({
          report: report as string,
          childSessionID: childSessionID as string,
          verificationPassphrase: `${PASSPHRASE}:improved_task:sync:new`,
        });

        const reminder = findUserPrompt(turns, (candidate) => candidate.includes('<system-reminder>'));
        expect(reminder).toBeDefined();
        expectReminderPrompt(reminder as string);

        const text = readFinalAssistantText(sessionID);
        expect(text).toContain('OK');
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);

    it('proves the shadow task tool publishes the same report contract', () => {
      const prompt =
        'Use task once with mode=sync and subagent_type general. In the child session, reply with ONLY the word DONE. After the tool finishes, reply with ONLY OK.';

      const sessionID = beginSession(prompt, TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);

        const toolStep = findCompletedToolStep(sessionID, 'task');
        expect(toolStep.outputText).toContain('report_published: true');

        const childSessionID = extractFrontMatterValue(toolStep.outputText ?? '', 'session_id');
        expect(childSessionID).toBeDefined();

        const turns = readTranscriptTurns(sessionID);
        const report = findUserPrompt(
          turns,
          (candidate) => candidate.includes(`${PASSPHRASE}:task:sync:new`),
        );
        expect(report).toBeDefined();
        expectSummaryReportPrompt({
          report: report as string,
          childSessionID: childSessionID as string,
          verificationPassphrase: `${PASSPHRASE}:task:sync:new`,
        });

        const text = readFinalAssistantText(sessionID);
        expect(text).toContain('OK');
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);

    it('falls back to a new child session when session_id does not exist', () => {
      const bogusSessionID = 'ses_does_not_exist_for_improved_task_proof';
      const prompt =
        `Use improved_task once with mode=sync, session_id=${bogusSessionID}, and subagent_type general. ` +
        'In the child session, reply with ONLY the word DONE. After the tool finishes, reply with ONLY OK.';

      const sessionID = beginSession(prompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);

        const toolStep = findCompletedToolStep(sessionID, 'improved_task');
        const childSessionID = extractFrontMatterValue(toolStep.outputText ?? '', 'session_id');
        expect(childSessionID).toBeDefined();
        expect(childSessionID).not.toBe(bogusSessionID);

        const turns = readTranscriptTurns(sessionID);
        const report = findUserPrompt(
          turns,
          (candidate) => candidate.includes(`${PASSPHRASE}:improved_task:sync:new`),
        );
        expect(report).toBeDefined();
        expect(report).not.toContain(bogusSessionID);

        const text = readFinalAssistantText(sessionID);
        expect(text).toContain('OK');
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);
  });

  describe('async lifecycle', () => {
    it('proves async dispatch returns a running notice and later publishes the callback report', async () => {
      const prompt =
        'Use improved_task once with mode=async and subagent_type general. In the child session, reply with ONLY the word DONE. After improved_task returns, reply with ONLY ACK.';

      const sessionID = beginSession(prompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);

        const toolStep = findCompletedToolStep(sessionID, 'improved_task');
        expect(toolStep.outputText).toContain('status: running');
        expect(toolStep.outputText).toContain('Task is running in the background.');

        const childSessionID = extractFrontMatterValue(toolStep.outputText ?? '', 'session_id');
        expect(childSessionID).toBeDefined();

        const initialText = readFinalAssistantText(sessionID);
        expect(initialText).toContain('ACK');

        const report = await waitForUserPrompt(
          sessionID,
          (candidate) => candidate.includes(`${PASSPHRASE}:improved_task:async:new`),
          ASYNC_CALLBACK_TIMEOUT_MS,
        );
        expectSummaryReportPrompt({
          report,
          childSessionID: childSessionID as string,
          verificationPassphrase: `${PASSPHRASE}:improved_task:async:new`,
        });

        const reminder = await waitForUserPrompt(
          sessionID,
          (candidate) => candidate.includes('<system-reminder>'),
          ASYNC_CALLBACK_TIMEOUT_MS,
        );
        expectReminderPrompt(reminder);
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);
  });

  describe('resume', () => {
    it('proves the parent session can continue after sync delegation publishes its report', () => {
      const firstPrompt =
        'Use improved_task once with mode=sync and subagent_type general. In the child session, reply with ONLY DONE. Reply with ONLY OK when the tool finishes.';

      const sessionID = beginSession(firstPrompt, IMPROVED_TASK_PROOF_AGENT);
      try {
        waitIdle(sessionID);
        const firstText = readFinalAssistantText(sessionID);
        expect(firstText).toContain('OK');

        runOcm(['chat', sessionID, 'Reply with EXACTLY RESUMED.']);
        waitIdle(sessionID);

        const resumeText = readFinalAssistantText(sessionID);
        expect(resumeText).toContain('RESUMED');
      } finally {
        try { runOcm(['delete', sessionID]); } catch { /* best-effort */ }
      }
    }, SESSION_TIMEOUT_MS);
  });
});
