"""Leitura das configurações do .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Raiz do repositório (lab/ga4cro/config.py -> ../../). O .env e credentials/ são compartilhados com o Next.js.
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

# Somente leitura: o dashboard nunca altera nada na propriedade.
SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

AUTH_MODES = ("auto", "oauth", "service_account")


def _path(value: str | None) -> Path | None:
    """Caminho vindo do .env; relativo é resolvido a partir da raiz do repositório."""
    if not value or not value.strip():
        return None
    p = Path(value.strip())
    return p if p.is_absolute() else ROOT / p


@dataclass(frozen=True)
class Settings:
    """Configuração já validada, com os caminhos resolvidos."""
    property_id: str
    auth_mode: str
    service_account_file: Path | None
    oauth_client_file: Path
    oauth_token_file: Path
    oauth_port: int

    @property
    def property_name(self) -> str:
        """Nome do recurso no formato da API (properties/<id>)."""
        return f"properties/{self.property_id}"


def get_settings() -> Settings:
    """Lê e valida o .env. Valor ausente ou inválido vira RuntimeError com o que corrigir."""
    pid = os.getenv("GA4_PROPERTY_ID", "").strip()
    if not pid:
        # Mesmo critério do painel: sem GA4_PROPERTY_ID, vale a primeira de GA4_PROPERTIES (id=nome|fuso;...).
        first = os.getenv("GA4_PROPERTIES", "").split(";")[0]
        pid = first.split("=")[0].strip()
    # Só zeros é o valor de exemplo do .env.example.
    if not pid.isdigit() or set(pid) == {"0"}:
        raise RuntimeError(
            "Propriedade ausente ou inválida no .env. Preencha GA4_PROPERTIES ou GA4_PROPERTY_ID "
            "com o ID numérico da propriedade (Administrador > Detalhes da propriedade)."
        )
    mode = os.getenv("GA4_AUTH_MODE", "auto").strip().lower()
    if mode not in AUTH_MODES:
        raise RuntimeError(f"GA4_AUTH_MODE deve ser um de {AUTH_MODES}, recebido: {mode!r}")
    port = os.getenv("GA4_OAUTH_PORT", "8080").strip()
    if not port.isdigit():
        raise RuntimeError(f"GA4_OAUTH_PORT deve ser um número de porta, recebido: {port!r}")
    return Settings(
        property_id=pid,
        auth_mode=mode,
        service_account_file=_path(os.getenv("GA4_SERVICE_ACCOUNT_FILE")),
        oauth_client_file=_path(os.getenv("GA4_OAUTH_CLIENT_FILE")) or ROOT / "credentials/client_secret.json",
        oauth_token_file=_path(os.getenv("GA4_OAUTH_TOKEN_FILE")) or ROOT / "credentials/token.json",
        oauth_port=int(port),
    )
