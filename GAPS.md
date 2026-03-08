# GAPS — improved-task

## Known Gaps

### `computeCompletionConfidenceScore` is still a placeholder

The current implementation always returns `1.0`. It is not evidence-backed and should not
be treated as a meaningful completion metric until a real scoring rule is defined and
verified live.

### Subagent cache TTL behavior is unverified

The `CachedSubagent` cache uses a 60-second TTL. There is no live proof yet that
registration changes during a long-running session are picked up correctly after expiry.
