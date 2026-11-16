"""Honor disabled Chroma telemetry without calling an incompatible PostHog API."""

from chromadb.telemetry.product import ProductTelemetryClient, ProductTelemetryEvent
from overrides import override


class NoOpTelemetry(ProductTelemetryClient):
    @override
    def capture(self, event: ProductTelemetryEvent) -> None:
        pass
