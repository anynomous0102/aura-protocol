from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator, Mapping, MutableMapping

try:
    from opentelemetry import context, propagate, trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    from opentelemetry.trace import SpanKind
except Exception:  # pragma: no cover - allows local minimal installs to keep running.
    context = None
    propagate = None
    trace = None
    Resource = None
    TracerProvider = None
    BatchSpanProcessor = None
    ConsoleSpanExporter = None
    SpanKind = None


_CONFIGURED = False


def configure_tracing(service_name: str) -> None:
    global _CONFIGURED
    if _CONFIGURED or trace is None or TracerProvider is None:
        return
    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service_name,
                "service.namespace": "aura-protocol",
                "deployment.environment": os.getenv("AURA_ENVIRONMENT", "development"),
                "cloud.region": os.getenv("AURA_REGION", "global"),
            }
        )
    )
    exporter = _build_exporter()
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _CONFIGURED = True


def _build_exporter() -> Any:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

            return OTLPSpanExporter(endpoint=endpoint, insecure=os.getenv("OTEL_EXPORTER_OTLP_INSECURE", "true").lower() in {"1", "true", "yes"})
        except Exception:
            pass
    return ConsoleSpanExporter()


def get_tracer(name: str):
    if trace is None:
        return _NoopTracer()
    return trace.get_tracer(name)


def inject_trace_metadata(metadata: MutableMapping[str, Any] | None = None) -> dict[str, Any]:
    carrier: dict[str, str] = {}
    if propagate is not None:
        propagate.inject(carrier)
    merged = dict(metadata or {})
    merged["trace_context"] = carrier
    span = trace.get_current_span() if trace is not None else None
    span_context = span.get_span_context() if span is not None else None
    if span_context is not None and span_context.is_valid:
        merged["trace_id"] = f"{span_context.trace_id:032x}"
        merged["span_id"] = f"{span_context.span_id:016x}"
    return merged


@contextmanager
def start_worker_span(name: str, metadata: Mapping[str, Any] | None = None) -> Iterator[Any]:
    if trace is None or propagate is None or context is None:
        yield None
        return
    carrier = dict((metadata or {}).get("trace_context") or {})
    parent = propagate.extract(carrier)
    token = context.attach(parent)
    try:
        span_kwargs = {"kind": SpanKind.CONSUMER} if SpanKind is not None else {}
        with trace.get_tracer("aura.worker").start_as_current_span(name, **span_kwargs) as span:
            if span is not None:
                span.set_attribute("messaging.system", "redis")
                span.set_attribute("aura.trace.parent_span_id", str((metadata or {}).get("span_id", "")))
            yield span
    finally:
        context.detach(token)


class _NoopTracer:
    @contextmanager
    def start_as_current_span(self, _: str) -> Iterator[None]:
        yield None
