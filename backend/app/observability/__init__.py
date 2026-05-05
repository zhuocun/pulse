"""Vendor-neutral observability surface (OpenTelemetry + Prometheus).

Both submodules are opt-in via :class:`Settings` (``OTEL_TRACING`` /
``PROMETHEUS_METRICS``); a slim install that does not pull the
``[observability]`` extra never imports the underlying SDKs.
"""
