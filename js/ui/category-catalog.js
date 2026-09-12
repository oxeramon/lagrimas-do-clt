/* Catálogo padrão de categorias.
 *
 * Genérico e público: é a lista que qualquer app de finanças começaria, não a
 * lista de ninguém. Nada aqui veio de olhar dado de usuário, e nada aqui entra
 * no banco sozinho -- a pessoa clica em "Criar categorias padrão" se quiser.
 *
 * Criar automaticamente seria pior do que parece: quem já tem um jeito próprio
 * de organizar acaba com duas árvores parecidas e nenhuma confiável.
 *
 * Dois níveis, não três. O terceiro existe no banco para quem precisar, e
 * oferecer "Alimentação › Restaurante › Pizza" de saída é sugerir um nível de
 * detalhe que quase ninguém mantém.
 */
export const CATEGORIAS_PADRAO = [
  { nome: "Moradia",     fluxo: "saida", cor: "#1F5E52", filhas: ["Aluguel", "Condomínio", "Luz", "Água", "Internet", "Gás"] },
  { nome: "Alimentação", fluxo: "saida", cor: "#2E7D63", filhas: ["Mercado", "Restaurante", "Delivery"] },
  { nome: "Transporte",  fluxo: "saida", cor: "#2F6F91", filhas: ["Combustível", "Aplicativo", "Transporte público", "Manutenção"] },
  { nome: "Saúde",       fluxo: "saida", cor: "#3C7C8C", filhas: ["Plano", "Consulta", "Farmácia"] },
  { nome: "Educação",    fluxo: "saida", cor: "#47618F", filhas: ["Curso", "Material", "Mensalidade"] },
  { nome: "Lazer",       fluxo: "saida", cor: "#6B5B95", filhas: ["Streaming", "Bar", "Viagem"] },
  { nome: "Assinaturas", fluxo: "saida", cor: "#7A5A86", filhas: [] },
  { nome: "Compras",     fluxo: "saida", cor: "#8A6A57", filhas: ["Roupas", "Casa", "Eletrônicos"] },
  { nome: "Impostos",    fluxo: "saida", cor: "#7A4F4F", filhas: [] },
  { nome: "Dívidas",     fluxo: "saida", cor: "#8C5A4A", filhas: ["Parcelas", "Juros"] },

  { nome: "Salário",     fluxo: "entrada", cor: "#1F5E52", filhas: [] },
  { nome: "Extra",       fluxo: "entrada", cor: "#2E7D63", filhas: ["Freela", "Bônus"] },
  { nome: "Reembolso",   fluxo: "entrada", cor: "#2F6F91", filhas: [] },
  { nome: "Venda",       fluxo: "entrada", cor: "#47618F", filhas: [] },

  /* `ambos` existe para o que não é nem receita nem despesa por natureza:
     ajuste de saldo e taxa aparecem dos dois lados. */
  { nome: "Outros",      fluxo: "ambos", cor: "#6B7A76", filhas: [] },
];

/* Achata o catálogo em linhas prontas para o insert em lote.
 *
 * As filhas precisam do id da mãe, que só existe depois do insert. Então isto
 * devolve DUAS levas: primeiro as raízes, depois -- já com os ids em mãos --
 * as filhas. É a razão de a função receber `idsDasRaizes` em vez de tentar
 * resolver tudo de uma vez. */
export function raizesPadrao(){
  return CATEGORIAS_PADRAO.map((c, i) => ({
    nome: c.nome, fluxo: c.fluxo, cor: c.cor, ativo: true, ordem: (i + 1) * 10,
  }));
}

export function filhasPadrao(raizesSalvas){
  const idPorNome = new Map((raizesSalvas || []).map((r) => [r.nome, r.id]));
  const fora = [];
  for (const c of CATEGORIAS_PADRAO){
    const paiId = idPorNome.get(c.nome);
    if (!paiId) continue;
    c.filhas.forEach((nome, i) => {
      fora.push({ paiId, nome, fluxo: c.fluxo, cor: c.cor, ativo: true, ordem: (i + 1) * 10 });
    });
  }
  return fora;
}

export const quantasCategoriasPadrao = () =>
  CATEGORIAS_PADRAO.length + CATEGORIAS_PADRAO.reduce((s, c) => s + c.filhas.length, 0);
