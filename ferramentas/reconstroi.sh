#!/usr/bin/env bash
# RECONSTRÓI · levanta um banco descartável, roda o bootstrap e prova que ele bate
#
# POR QUE ESTE ARQUIVO EXISTE
#
# `supabase/bootstrap/schema.sql` só vale alguma coisa se alguém tiver rodado
# ele de verdade, num banco vazio, do começo ao fim. Este script é esse alguém.
# Ele cria um banco novo, aplica a maquete do Supabase, aplica o bootstrap,
# tira o inventário estrutural, compara com a referência versionada e roda as
# suítes de SQL. Se qualquer etapa falhar, ele para com código diferente de 0.
#
# ELE SE RECUSA A RODAR EM PRODUÇÃO
#
# Fecha por padrão, não por exceção: só aceita servidor local por socket, exige
# `--i-know-this-is-disposable` escrito por extenso, e recusa qualquer destino
# em que apareça a referência do projeto em uso. Um script de reconstrução
# apontado para o banco errado não dá erro: ele funciona, e é isso que assusta.
#
# Uso:
#   ferramentas/reconstroi.sh --i-know-this-is-disposable
#   ferramentas/reconstroi.sh --i-know-this-is-disposable --manter
#
# Variáveis: PGBIN, PGSOCK, PGPORT, PGBANCO (todas têm padrão razoável).

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGSOCK="${PGSOCK:-/tmp/pg-limpo/run}"
PGPORT="${PGPORT:-54329}"
PGBANCO="${PGBANCO:-reconstruido}"

# A referência do projeto em uso. Não é segredo -- está no index.html -- e o
# lugar dela aqui é o de uma lista de recusa, não o de uma credencial.
PROJETO_EM_USO="adadphekrhfzezfwjxor"

manter=0
autorizado=0
for arg in "$@"; do
  case "$arg" in
    --i-know-this-is-disposable) autorizado=1 ;;
    --manter) manter=1 ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- as recusas --

if [ "$autorizado" -ne 1 ]; then
  cat >&2 <<'FIM'
Este script APAGA e recria um banco inteiro.

Ele só roda com --i-know-this-is-disposable, escrito por extenso, e só
contra um Postgres local descartável. Se você está pensando em apontá-lo
para o projeto em uso: não. O banco de produção não é laboratório de
reconstrução, e não existe versão deste script que faça isso com cuidado.
FIM
  exit 2
fi

for var in PGSOCK PGPORT PGBANCO PGHOST PGDATABASE PGURI DATABASE_URL; do
  valor="${!var:-}"
  if [ -n "$valor" ] && [[ "$valor" == *"$PROJETO_EM_USO"* ]]; then
    echo "RECUSADO: $var aponta para o projeto em uso ($PROJETO_EM_USO)." >&2
    exit 3
  fi
  if [ -n "$valor" ] && [[ "$valor" == *"supabase.co"* || "$valor" == *"supabase.com"* ]]; then
    echo "RECUSADO: $var aponta para um servidor Supabase. Este script é só para banco descartável." >&2
    exit 3
  fi
done

# Socket de arquivo, não TCP: um caminho de socket não alcança a internet, e é
# a forma mais simples de garantir que o destino é local mesmo.
if [ "${PGSOCK:0:1}" != "/" ]; then
  echo "RECUSADO: PGSOCK precisa ser um caminho de socket local, e veio '$PGSOCK'." >&2
  exit 3
fi

psql() { "$PGBIN/psql" -h "$PGSOCK" -p "$PGPORT" -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

if ! "$PGBIN/pg_isready" -h "$PGSOCK" -p "$PGPORT" >/dev/null 2>&1; then
  echo "Não há Postgres escutando em $PGSOCK:$PGPORT. Suba o banco descartável primeiro." >&2
  exit 4
fi

# Última barreira, e a única que o Postgres responde: um servidor de verdade do
# Supabase tem os papéis de plataforma. O descartável não tem nenhum deles até
# a sala-limpa criar os três que a maquete precisa.
plataforma=$(psql -d postgres -tAc \
  "select count(*) from pg_roles where rolname in ('supabase_admin','supabase_auth_admin','supabase_storage_admin','authenticator')")
if [ "$plataforma" != "0" ]; then
  echo "RECUSADO: este servidor tem papéis de plataforma do Supabase. Não é descartável." >&2
  exit 3
fi

# ----------------------------------------------------------------- a rodada --

echo "== banco descartável: $PGBANCO em $PGSOCK:$PGPORT"
psql -d postgres -c "drop database if exists $PGBANCO" >/dev/null
psql -d postgres -c "create database $PGBANCO" >/dev/null

echo "== maquete do Supabase (papéis, auth, auth.uid)"
psql -d "$PGBANCO" -f "$RAIZ/ferramentas/sala-limpa.sql" >/dev/null

echo "== bootstrap"
psql -d "$PGBANCO" -f "$RAIZ/supabase/bootstrap/schema.sql" 2>&1 | grep -E '^(NOTICE|ERROR)' || true

echo "== inventário estrutural"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
psql -d "$PGBANCO" -tA -f "$RAIZ/ferramentas/inventario.sql" > "$tmp/inventario.txt"
node "$RAIZ/ferramentas/confere-schema.mjs" "$tmp/inventario.txt"

echo "== suítes de SQL"
total=0; falhas=0
for f in "$RAIZ"/supabase/testes/*.sql; do
  saida="$(psql -d "$PGBANCO" -F'|' -A -f "$f" 2>&1)"
  # As suítes não têm um formato só: umas listam caso a caso e terminam num
  # placar `passaram|falharam`, outras só listam. Quando há placar ele vale,
  # porque é a própria suíte contando; quando não há, valem as linhas.
  # O `|| true` não é enfeite: com `set -e` e `pipefail`, um grep que não acha
  # nada derruba o script inteiro numa atribuição -- e não achar o placar é o
  # caso NORMAL na metade das suítes.
  placar=$(printf '%s\n' "$saida" | grep -A1 '^passaram|' | tail -1 || true)
  if [ -n "$placar" ] && [ "$placar" != "$saida" ]; then
    n=$(( $(echo "$placar" | cut -d'|' -f1) + $(echo "$placar" | cut -d'|' -f2) ))
    ruins=$(echo "$placar" | cut -d'|' -f2)
  else
    n=$(printf '%s\n' "$saida" | grep -cE '^[0-9]+\|' || true)
    ruins=$(printf '%s\n' "$saida" | grep -E '^[0-9]+\|' | grep -c 'FALHOU' || true)
  fi
  erro=$(printf '%s\n' "$saida" | grep -cE '^psql:.*ERROR' || true)
  printf '   %-26s casos=%-4s falhas=%s\n' "$(basename "$f")" "$n" "$ruins"
  if [ "$erro" != "0" ]; then
    printf '%s\n' "$saida" | grep -E '^psql:.*ERROR' | head -3
    falhas=$((falhas + erro))
  fi
  total=$((total + n)); falhas=$((falhas + ruins))
done
echo "   ------------------------------------------"
echo "   $total casos, $falhas falhas"

if [ "$manter" -eq 0 ]; then
  psql -d postgres -c "drop database $PGBANCO" >/dev/null
  echo "== banco descartado (use --manter para inspecionar depois)"
fi

[ "$falhas" -eq 0 ] || exit 1
echo "== tudo bateu"
