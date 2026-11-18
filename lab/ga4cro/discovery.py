"""Inventário da propriedade: teste de conexão, metadata e eventos existentes.

Roda antes de construir o dashboard, para que as seções usem somente
dimensões, métricas e eventos que realmente existem na conta.
"""
from __future__ import annotations

from datetime import datetime

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import (
    DateRange,
    Dimension,
    Metric,
    OrderBy,
    RunReportRequest,
)

from .config import Settings

# Eventos recomendados do GA4 para e-commerce, na ordem do funil.
ECOMMERCE_FUNNEL = [
    "view_item_list",
    "view_item",
    "add_to_cart",
    "begin_checkout",
    "add_shipping_info",
    "add_payment_info",
    "purchase",
]
# Eventos que costumam marcar lead: recomendados do GA4, os de formulário da medição otimizada e contact.
LEAD_EVENTS = ["generate_lead", "form_submit", "form_start", "sign_up", "contact"]

# Nomes que o dashboard pretende usar. Nada é assumido: cada um é conferido no getMetadata.
EXPECTED_DIMENSIONS = [
    "date",
    "eventName",
    "deviceCategory",
    "browser",
    "operatingSystem",
    "screenResolution",
    "country",
    "sessionDefaultChannelGroup",
    "sessionSourceMedium",
    "landingPagePlusQueryString",
    "newVsReturning",
    "itemName",
    "transactionId",
]
EXPECTED_METRICS = [
    "sessions",
    "totalUsers",
    "activeUsers",
    "eventCount",
    "engagementRate",
    "bounceRate",
    "keyEvents",
    "sessionKeyEventRate",
    "conversions",  # nome antigo, esperado como ausente
    "transactions",
    "ecommercePurchases",
    "purchaseRevenue",
    "totalRevenue",
    "averagePurchaseRevenue",
    "averageRevenuePerUser",
    "itemsViewed",
    "itemsAddedToCart",
    "itemsPurchased",
    "itemRevenue",
    "cartToViewRate",
    "purchaseToViewRate",
]
# Usadas para testar se a conta autenticada tem restrição de dados de receita.
REVENUE_METRICS = ["purchaseRevenue", "totalRevenue", "transactions"]


def _num(value: str) -> float:
    """Valor da API (sempre string) como float; vazio ou inválido vira 0."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def test_report(client: BetaAnalyticsDataClient, s: Settings) -> dict:
    """Consulta simples dos últimos 28 dias, só para provar que a conexão funciona."""
    resp = client.run_report(
        RunReportRequest(
            property=s.property_name,
            date_ranges=[DateRange(start_date="28daysAgo", end_date="yesterday")],
            metrics=[Metric(name="sessions"), Metric(name="activeUsers"), Metric(name="eventCount")],
            return_property_quota=True,
        )
    )
    # Sem dados no período o GA4 não devolve linha nenhuma, nem com zeros.
    values = [_num(v.value) for v in resp.rows[0].metric_values] if resp.rows else [0, 0, 0]
    q = resp.property_quota
    return {
        "periodo": "últimos 28 dias",
        "sessions": values[0],
        "activeUsers": values[1],
        "eventCount": values[2],
        "quota": {
            "tokens_por_dia_restantes": q.tokens_per_day.remaining,
            "tokens_por_hora_restantes": q.tokens_per_hour.remaining,
            "consumidos_nesta_consulta": q.tokens_per_hour.consumed,
        },
    }


def get_metadata(client: BetaAnalyticsDataClient, s: Settings) -> dict:
    """Dimensões e métricas da propriedade, com as personalizadas à parte e a conferência dos nomes esperados."""
    md = client.get_metadata(name=f"{s.property_name}/metadata")
    dims = [
        {
            "api_name": d.api_name,
            "ui_name": d.ui_name,
            "category": d.category,
            "custom": d.custom_definition,
        }
        for d in md.dimensions
    ]
    mets = [
        {
            "api_name": m.api_name,
            "ui_name": m.ui_name,
            "category": m.category,
            "custom": m.custom_definition,
            "type": m.type_.name,
        }
        for m in md.metrics
    ]
    dim_names = {d["api_name"] for d in dims}
    met_names = {m["api_name"] for m in mets}
    return {
        "dimensions": dims,
        "metrics": mets,
        "custom_dimensions": [d for d in dims if d["custom"]],
        "custom_metrics": [m for m in mets if m["custom"]],
        "expected_dimensions": {n: n in dim_names for n in EXPECTED_DIMENSIONS},
        "expected_metrics": {n: n in met_names for n in EXPECTED_METRICS},
    }


def list_events(client: BetaAnalyticsDataClient, s: Settings, metric_names: set[str], days: int = 90) -> list[dict]:
    """Todos os eventos do período com contagem, usuários e eventos-chave, do mais ao menos frequente."""
    # Só pede as métricas que o metadata confirmou, para a consulta não falhar por nome inexistente.
    metrics = [m for m in ("eventCount", "totalUsers", "keyEvents") if m in metric_names]
    resp = client.run_report(
        RunReportRequest(
            property=s.property_name,
            date_ranges=[DateRange(start_date=f"{days}daysAgo", end_date="yesterday")],
            dimensions=[Dimension(name="eventName")],
            metrics=[Metric(name=m) for m in metrics],
            order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name="eventCount"), desc=True)],
            limit=1000,
        )
    )
    rows = []
    for r in resp.rows:
        row = {"eventName": r.dimension_values[0].value}
        for name, mv in zip(metrics, r.metric_values):
            row[name] = _num(mv.value)
        rows.append(row)
    return rows


def data_restrictions(client: BetaAnalyticsDataClient, s: Settings, metric_names: set[str]) -> dict:
    """Verifica se a conta autenticada tem restrição de receita/custo e se há thresholding."""
    # Sem métrica de receita na propriedade, consulta sessions só para ler o metadata da resposta.
    metrics = [m for m in REVENUE_METRICS if m in metric_names] or ["sessions"]
    resp = client.run_report(
        RunReportRequest(
            property=s.property_name,
            date_ranges=[DateRange(start_date="28daysAgo", end_date="yesterday")],
            dimensions=[Dimension(name="deviceCategory")],
            metrics=[Metric(name=m) for m in metrics],
        )
    )
    md = resp.metadata
    restricted = [
        {"metric": r.metric_name, "restriction": [t.name for t in r.restricted_metric_types]}
        for r in md.schema_restriction_response.active_metric_restrictions
    ]
    return {
        "metricas_testadas": metrics,
        "metricas_restritas": restricted,
        "subject_to_thresholding": md.subject_to_thresholding,
        "currency_code": md.currency_code,
        "time_zone": md.time_zone,
    }


def run_discovery(client: BetaAnalyticsDataClient, s: Settings) -> dict:
    """Roda todas as consultas do inventário e junta o resultado num dicionário (o check salva como JSON)."""
    test = test_report(client, s)
    md = get_metadata(client, s)
    metric_names = {m["api_name"] for m in md["metrics"]}
    events = list_events(client, s, metric_names)
    by_name = {e["eventName"]: e for e in events}
    restrictions = data_restrictions(client, s, metric_names)
    return {
        "gerado_em": datetime.now().isoformat(timespec="seconds"),
        "property_id": s.property_id,
        "teste": test,
        "restricoes": restrictions,
        "metadata": md,
        "eventos_90d": events,
        "funil_ecommerce": {e: by_name.get(e, {}).get("eventCount", 0) for e in ECOMMERCE_FUNNEL},
        "eventos_lead": {e: by_name.get(e, {}).get("eventCount", 0) for e in LEAD_EVENTS},
        "eventos_chave": [e["eventName"] for e in events if e.get("keyEvents", 0) > 0],
    }
