/* Backup integral do usuário. A ordem também é a ordem de restauração: pais
 * antes de filhos. O arquivo nunca é enviado a outro serviço além do Supabase. */
import { conexao } from "./client.js";

export const TABELAS_BACKUP = Object.freeze([
  "config", "instituicoes", "contas", "categorias", "credores", "fixas",
  "fixas_mes", "dividas", "receitas", "pagamentos", "cartoes", "faturas",
  "compras_de_cartao", "assinaturas", "transacoes", "liquidacoes",
  "grupos", "membros", "despesas_do_grupo", "rateios", "acertos",
  "metas", "alocacoes_de_meta", "competencias_de_regra",
]);
const ORDEM_COMPOSTA = {
  config: ["user_id"],
  fixas_mes: ["fixa_id", "mes"],
  pagamentos: ["mes", "item_id"],
};

export async function criaBackup(sb = conexao.sb){
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) throw new Error("Entre na sua conta para gerar o backup.");
  const tabelas = {};
  for (const tabela of TABELAS_BACKUP){
    const linhas = [];
    for (let inicio = 0;; inicio += 500){
      let consulta = sb.from(tabela).select("*").eq("user_id", user.id);
      for (const coluna of ORDEM_COMPOSTA[tabela] || ["id"])
        consulta = consulta.order(coluna);
      const r = await consulta.range(inicio, inicio + 499);
      if (r.error) throw new Error(`Falha ao ler ${tabela}: ${r.error.message}`);
      if (!Array.isArray(r.data)) throw new Error(`Resposta inválida em ${tabela}.`);
      linhas.push(...r.data);
      if (r.data.length < 500) break;
    }
    tabelas[tabela] = linhas;
  }
  return {
    formato: "lagrimas-do-clt/backup-integral",
    versao: 1,
    exportado_em: new Date().toISOString(),
    origem_user_id: user.id,
    tabelas,
  };
}

export function validaBackup(arquivo){
  if (!arquivo || arquivo.formato !== "lagrimas-do-clt/backup-integral" || arquivo.versao !== 1)
    throw new Error("Formato ou versão de backup não reconhecida.");
  const nomes = Object.keys(arquivo.tabelas || {}).sort();
  if (JSON.stringify(nomes) !== JSON.stringify([...TABELAS_BACKUP].sort()))
    throw new Error("O backup não contém exatamente as tabelas esperadas.");
  for (const nome of TABELAS_BACKUP){
    if (!Array.isArray(arquivo.tabelas[nome]) ||
        arquivo.tabelas[nome].some(linha => !linha || linha.user_id !== arquivo.origem_user_id))
      throw new Error(`Dados inválidos em ${nome}.`);
  }
  return TABELAS_BACKUP.reduce((s, nome) => s + arquivo.tabelas[nome].length, 0);
}

/* A restauração é uma única transação no banco. A função SQL recusa uma conta
 * com dados, refaz user_id e preserva os IDs e vínculos originais. */
export async function restauraBackup(arquivo, sb = conexao.sb){
  const total = validaBackup(arquivo);
  const { data: { user }, error: authError } = await sb.auth.getUser();
  if (authError || !user) throw new Error("Entre na conta de destino antes de restaurar.");
  const { data, error } = await sb.rpc("restaura_backup_integral", { p_backup: arquivo });
  if (error) throw new Error(`Restauração cancelada: ${error.message}`);
  if (data !== total) throw new Error("A contagem restaurada difere do arquivo; confira o destino.");
  return total;
}
