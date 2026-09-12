/* A conexão e a tradução de erro.
 *
 * O cliente do Supabase NÃO é criado aqui. Ele nasce no `index.html`, junto da
 * URL e da chave publicável, e é entregue a esta camada por `ligaSupabase()`.
 * São duas razões, e as duas importam:
 *
 *   1. a prévia (`testes/preview.mjs`) troca o import do CDN por um dublê, e
 *      ela procura essa linha no `index.html`. Espalhar a criação do cliente
 *      quebraria a prévia;
 *   2. repository que RECEBE o cliente é testável sem navegador e sem rede --
 *      basta entregar um dublê.
 *
 * Ninguém fora de `js/data/` toca em `conexao.sb`.
 */
export const conexao = { sb: null };

export function ligaSupabase(cliente){
  conexao.sb = cliente;
  return cliente;
}

/* Erro do PostgREST vira frase curta.
 *
 * A camada de dados normaliza; a UI decide como mostrar. O texto segue a regra
 * de escrita do projeto: quem lê está apertado de dinheiro e não quer saber o
 * que é uma violação de constraint.
 *
 * O código do Postgres é mais confiável que a mensagem, que muda de versão
 * para versão e vem em inglês. Quando não dá para reconhecer, a frase genérica
 * é melhor do que despejar o texto cru na tela. */
export function erroLegivel(erro, contexto){
  if (!erro) return null;
  const cod = String(erro.code || "");
  const msg = String(erro.message || erro.hint || "");
  const onde = contexto ? contexto + ": " : "";

  if (cod === "23505") return onde + "já existe um registro com esse nome.";
  if (cod === "23503") return onde + "isso aponta para algo que não existe mais. Recarregue a página.";
  if (cod === "23514") return onde + "algum valor não é aceito aqui.";
  if (cod === "23502") return onde + "faltou preencher um campo obrigatório.";
  if (cod === "42501" || /permission denied|row-level security/i.test(msg))
    return onde + "você não tem acesso a esse registro.";
  if (cod === "PGRST301" || /JWT|not authenticated|session|expired/i.test(msg))
    return "Sua sessão expirou. Entre de novo.";
  if (/Failed to fetch|NetworkError|network|timeout/i.test(msg))
    return "Sem conexão com o servidor. Tente de novo em instantes.";

  /* mensagem de `raise exception` nossa (gatilho de transferência) já é escrita
     em português e para gente -- essa vale a pena repassar */
  if (/transferência/i.test(msg)) return msg;

  return onde + "não deu para completar. Tente de novo.";
}

/* Embrulho único para toda chamada: devolve sempre a mesma forma, e nunca
   deixa uma exceção de rede escapar como Promise rejeitada solta. */
export async function executa(promessa, contexto){
  try {
    const r = await promessa;
    if (r && r.error) return { dados: null, erro: erroLegivel(r.error, contexto) };
    return { dados: r ? r.data : null, erro: null };
  } catch (e){
    return { dados: null, erro: erroLegivel(e, contexto) };
  }
}
