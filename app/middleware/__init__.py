"""Cross-cutting middleware utilities for the agent runtime.

Three concerns live here:

- :mod:`app.middleware.rate_limit` -- per-agent, per-user token-bucket
  rate limiter implementing the limits in PRD §5A.8.
- :mod:`app.middleware.budget` -- per-project monthly token budget tracker
  (PRD §5A.7 step 4 / §6.4).
- :mod:`app.middleware.idempotency` -- Stripe-style ``Idempotency-Key``
  deduplication for agent routes (paired with
  :mod:`app.middleware.idempotency_guard`).
"""
