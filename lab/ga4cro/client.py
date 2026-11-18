"""Fábrica dos clientes da Google Analytics Data API."""
from __future__ import annotations

from google.analytics.data_v1alpha import AlphaAnalyticsDataClient
from google.analytics.data_v1beta import BetaAnalyticsDataClient

from .auth import load_credentials
from .config import Settings


def data_client(settings: Settings | None = None) -> BetaAnalyticsDataClient:
    """Cliente v1beta: runReport, batchRunReports, getMetadata, checkCompatibility."""
    return BetaAnalyticsDataClient(credentials=load_credentials(settings))


def alpha_client(settings: Settings | None = None) -> AlphaAnalyticsDataClient:
    """Cliente v1alpha: runFunnelReport."""
    return AlphaAnalyticsDataClient(credentials=load_credentials(settings))
