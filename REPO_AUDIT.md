# Repo Audit

## Zero-Knowledge Proof Gates

These gates are mandatory for every proof in this repo.

- A test is valid only if a passphrase first becomes available on the exact path being proved.
- A passphrase used to prove execution or resume must never appear in any prompt, system prompt, child-task prompt, or other pre-execution model-visible text.
- Visibility, execution, and resume are different claims and must use different proof surfaces.
- Tool-description passphrases may prove visibility only.
- Tool-output and published-report passphrases may prove execution or resume only when they were unavailable beforehand.

## Forbidden Constructions

- No secrets given to any agent in prompts.
- No public witness tokens inserted into child prompts as part of the proof.
- No tests that depend on child-agent obedience for the proof target.
- No tests that depend on agent honesty without an externally checkable passphrase.
- No meta-tests about where secrets do or do not appear. Audit those constraints during test construction; do not turn them into repo tests.
- No non-proofs labeled as proofs.

## Required Proof Mapping

Every proof must answer all of these questions explicitly before it is accepted:

- What exact behavior is being proved: visibility, sync new, sync resume, async new, or async resume?
- Where does the proof passphrase first appear?
- Could the top-level agent have seen that passphrase before the proved path succeeded?
- What exact output or report must the top-level agent recite?
- What external check makes hallucination or misreporting fail?

If any answer is ambiguous, the construction is invalid.

## Allowed Proof Surfaces

- Visibility proof: tool description only.
- Sync execution proof: sync tool result or published report only.
- Async execution proof: async completion report only.
- Resume proof: resumed result/report plus session continuity only.

The top-level agent's tool path is the subject. Subagent internals are not.

## Review Checklist

Before accepting any new or modified test:

- Confirm no proof-relevant passphrase appears in prompts.
- Confirm the asserted passphrase matches the exact path under test.
- Confirm the proof target is the top-level agent/tool behavior, not child prompt-following.
- Confirm the agent can only succeed by reciting a passphrase obtained from the proved path.
- Confirm failure of the path would necessarily change the recited passphrase or make it unavailable.
