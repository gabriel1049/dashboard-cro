"""Linha de comando do projeto.

    python -m ga4cro info    mostra o modo de autenticação e o e-mail da Service Account
    python -m ga4cro login   login OAuth com a sua conta Google (abre o navegador)
    python -m ga4cro check   consulta de teste + getMetadata + inventário de eventos
"""
from __future__ import annotations

import json
import sys

from google.api_core import exceptions as gexc

from . import auth
from .config import ROOT, get_settings


def _fmt(n: float) -> str:
    """Número arredondado, com ponto de milhar (12.345)."""
    return f"{n:,.0f}".replace(",", ".")


def cmd_info() -> int:
    """Mostra a configuração lida do .env e qual credencial vai ser usada."""
    s = get_settings()
    mode = auth.resolve_mode(s)
    print(f"Propriedade:          {s.property_id}")
    print(f"Modo de autenticação: {mode} (GA4_AUTH_MODE={s.auth_mode})")
    print(f"Cliente OAuth:        {s.oauth_client_file} [{'ok' if s.oauth_client_file.exists() else 'ausente'}]")
    print(f"Token OAuth:          {s.oauth_token_file} [{'ok' if s.oauth_token_file.exists() else 'ausente'}]")
    sa = s.service_account_file
    print(f"Service Account:      {sa} [{'ok' if sa and sa.exists() else 'ausente'}]")
    email = auth.service_account_email(s)
    if email:
        print(f"\nE-mail para adicionar como Leitor no GA4: {email}")
    return 0


def cmd_login() -> int:
    """Login OAuth no navegador; em seguida roda o check para confirmar o acesso à propriedade."""
    s = get_settings()
    if auth.resolve_mode(s) != "oauth":
        print("GA4_AUTH_MODE está usando Service Account; login OAuth não é necessário.")
        return 0
    auth.load_credentials(s, interactive=True)
    print(f"Token salvo em {s.oauth_token_file}")
    return cmd_check()


def cmd_check() -> int:
    """Roda o inventário da propriedade, imprime o resumo e salva o JSON completo em output/."""
    # Import aqui dentro: info e login não precisam carregar a biblioteca da Data API.
    from .client import data_client
    from .discovery import run_discovery

    s = get_settings()
    print(f"Conectando na propriedade {s.property_id} via {auth.resolve_mode(s)}...\n")
    result = run_discovery(data_client(s), s)

    t = result["teste"]
    print("== Consulta de teste (últimos 28 dias) ==")
    print(f"Sessões: {_fmt(t['sessions'])} | Usuários ativos: {_fmt(t['activeUsers'])} | Eventos: {_fmt(t['eventCount'])}")
    q = t["quota"]
    print(f"Cota restante: {_fmt(q['tokens_por_dia_restantes'])} tokens/dia, {_fmt(q['tokens_por_hora_restantes'])} tokens/hora\n")

    r = result["restricoes"]
    print("== Acesso aos dados ==")
    print(f"Moeda: {r['currency_code']} | Fuso: {r['time_zone']} | Thresholding: {'SIM' if r['subject_to_thresholding'] else 'não'}")
    if r["metricas_restritas"]:
        print("ATENÇÃO, métricas restritas para a sua conta:", r["metricas_restritas"])
    else:
        print("Sem restrição de métricas de receita/custo.")
    print()

    md = result["metadata"]
    print(f"== Metadata: {len(md['dimensions'])} dimensões, {len(md['metrics'])} métricas ==")
    print(f"Dimensões personalizadas ({len(md['custom_dimensions'])}):")
    for d in md["custom_dimensions"]:
        print(f"  {d['api_name']}  ({d['ui_name']})")
    print(f"Métricas personalizadas ({len(md['custom_metrics'])}):")
    for m in md["custom_metrics"]:
        print(f"  {m['api_name']}  ({m['ui_name']})")
    missing = [n for n, ok in {**md["expected_dimensions"], **md["expected_metrics"]}.items() if not ok]
    print(f"Nomes esperados ausentes no metadata: {', '.join(missing) or 'nenhum'}\n")

    print("== Funil de e-commerce (contagem de eventos, 90 dias) ==")
    for name, count in result["funil_ecommerce"].items():
        print(f"  {name:<20} {_fmt(count):>12}")
    print("\n== Eventos de lead (90 dias) ==")
    for name, count in result["eventos_lead"].items():
        print(f"  {name:<20} {_fmt(count):>12}")
    print(f"\nEventos-chave com volume: {', '.join(result['eventos_chave']) or 'nenhum'}\n")

    print(f"== Todos os eventos (90 dias): {len(result['eventos_90d'])} ==")
    for e in result["eventos_90d"]:
        key = " *chave*" if e.get("keyEvents", 0) > 0 else ""
        print(f"  {e['eventName']:<40} {_fmt(e.get('eventCount', 0)):>12}  usuários {_fmt(e.get('totalUsers', 0)):>10}{key}")

    out = ROOT / "output" / f"discovery_{s.property_id}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRelatório completo salvo em {out}")
    return 0


def _explain_api_error(err: gexc.GoogleAPICallError) -> str:
    """Mensagem em português, com o que fazer, para os erros mais comuns da Data API."""
    msg = str(err)
    if "SERVICE_DISABLED" in msg or "has not been used in project" in msg:
        return "A Google Analytics Data API não está ativada no projeto do Google Cloud. Ative em APIs e serviços > Biblioteca."
    if isinstance(err, gexc.PermissionDenied):
        return (
            "A conta autenticada não tem acesso a esta propriedade. Confira se o login foi feito com a conta "
            "Google que enxerga a propriedade no GA4 (ou, na Service Account, se o e-mail dela foi adicionado como Leitor)."
        )
    if isinstance(err, gexc.ResourceExhausted):
        return "Cota da API esgotada. Aguarde a próxima hora (ou o dia seguinte) e rode de novo."
    return "Erro da API do Google Analytics."


def main(argv: list[str]) -> int:
    """Executa o subcomando e converte os erros conhecidos em mensagem e código de saída 1."""
    # O console do Windows não usa UTF-8 por padrão e quebraria nos acentos.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    commands = {"info": cmd_info, "login": cmd_login, "check": cmd_check}
    if len(argv) != 1 or argv[0] not in commands:
        # A docstring do módulo serve de ajuda.
        print(__doc__)
        return 2
    try:
        return commands[argv[0]]()
    except auth.AuthError as e:
        print(f"Autenticação: {e}")
        return 1
    except gexc.GoogleAPICallError as e:
        print(f"{_explain_api_error(e)}\n\nDetalhe: {e}")
        return 1
    except RuntimeError as e:
        print(f"Configuração: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
