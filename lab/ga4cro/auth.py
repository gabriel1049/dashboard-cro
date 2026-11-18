"""Autenticação na Google Analytics Data API.

Dois modos, escolhidos por GA4_AUTH_MODE no .env:

- service_account: chave JSON de uma conta de serviço. Exige que um Administrador
  da propriedade GA4 adicione o e-mail da conta de serviço como Leitor.
- oauth: login com a sua própria conta Google. Funciona com qualquer acesso de
  leitura que você já tenha na propriedade (Leitor, Analista, Editor), sem precisar
  de Administrador. O token fica salvo em credentials/token.json.

No modo "auto" a conta de serviço é usada se o arquivo existir; senão, OAuth.
"""
from __future__ import annotations

import json
from pathlib import Path

from google.auth.credentials import Credentials
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials as UserCredentials

from .config import SCOPES, Settings, get_settings


class AuthError(RuntimeError):
    """Credenciais ausentes ou inválidas, com instrução do que fazer."""


def resolve_mode(settings: Settings) -> str:
    """Modo efetivo: "auto" vira service_account se a chave JSON existir, senão oauth."""
    if settings.auth_mode != "auto":
        return settings.auth_mode
    if settings.service_account_file and settings.service_account_file.exists():
        return "service_account"
    return "oauth"


def service_account_email(settings: Settings | None = None) -> str | None:
    """E-mail da conta de serviço, que precisa ser adicionado como Leitor no GA4."""
    s = settings or get_settings()
    if not s.service_account_file or not s.service_account_file.exists():
        return None
    data = json.loads(s.service_account_file.read_text(encoding="utf-8"))
    return data.get("client_email")


def load_credentials(settings: Settings | None = None, interactive: bool = False) -> Credentials:
    """Devolve credenciais prontas para os clientes da Data API.

    interactive=True abre o navegador para login OAuth quando não há token válido
    (usado pelo comando `python -m ga4cro login`). O dashboard chama com False e
    mostra a instrução de login em vez de travar esperando o navegador.
    """
    s = settings or get_settings()
    if resolve_mode(s) == "service_account":
        return _service_account_credentials(s)
    return _oauth_credentials(s, interactive)


def _service_account_credentials(s: Settings) -> Credentials:
    if not s.service_account_file or not s.service_account_file.exists():
        raise AuthError(
            f"Arquivo da Service Account não encontrado: {s.service_account_file}. "
            "Baixe a chave JSON no Google Cloud e salve nesse caminho, ou use GA4_AUTH_MODE=oauth."
        )
    return service_account.Credentials.from_service_account_file(str(s.service_account_file), scopes=SCOPES)


def _oauth_credentials(s: Settings, interactive: bool) -> Credentials:
    """Usa o token salvo, renovando se preciso. Sem token válido, abre o login (só com interactive)."""
    creds: UserCredentials | None = None
    if s.oauth_token_file.exists():
        creds = UserCredentials.from_authorized_user_file(str(s.oauth_token_file), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.refresh_token:
        try:
            creds.refresh(Request())
            _save_token(creds, s.oauth_token_file)
            return creds
        except RefreshError:
            # Token revogado ou expirado (no modo "Teste" do Google Cloud o token dura 7 dias).
            creds = None

    if not interactive:
        raise AuthError("Login no Google necessário. Rode no terminal: python -m ga4cro login")

    if not s.oauth_client_file.exists():
        raise AuthError(
            f"Cliente OAuth não encontrado: {s.oauth_client_file}. Crie um ID do cliente OAuth do tipo "
            "'App para computador' no Google Cloud, baixe o JSON e salve nesse caminho (veja o README)."
        )

    client_info = json.loads(s.oauth_client_file.read_text(encoding="utf-8"))
    if "web" in client_info:
        # Cliente "Aplicativo da Web": o Google só aceita a URI de retorno cadastrada no console,
        # então o login usa uma porta fixa. Cliente "App para computador" aceita qualquer porta.
        port = s.oauth_port
        hint = (
            f"Cliente OAuth do tipo Web: a URI http://localhost:{port}/ precisa estar em "
            "'URIs de redirecionamento autorizados' no Google Cloud, senão o Google mostra redirect_uri_mismatch.\n"
        )
    else:
        # Porta 0: o sistema escolhe uma livre.
        port, hint = 0, ""

    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(s.oauth_client_file), SCOPES)
    creds = flow.run_local_server(
        port=port,
        open_browser=True,
        # Sem a tela de consentimento o Google pode não devolver refresh_token num segundo login.
        prompt="consent",
        authorization_prompt_message=hint + "Abrindo o navegador para login no Google. Se não abrir, acesse:\n{url}",
        success_message="Login concluído. Pode fechar esta aba e voltar ao terminal.",
    )
    _save_token(creds, s.oauth_token_file)
    return creds


def _save_token(creds: UserCredentials, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(creds.to_json(), encoding="utf-8")
