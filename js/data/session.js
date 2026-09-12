/* Sessão: entrar, sair, e saber quem está logado.
 *
 * Fica em `js/data/` pelo mesmo motivo das tabelas: a UI não deve conhecer a
 * forma do objeto do Supabase. Ela pergunta "quem é?" e recebe um id, ou
 * `null`. Se um dia a autenticação mudar, muda aqui.
 */
import { conexao, erroLegivel } from "./client.js";

/* nome privado e distinto por arquivo: a prévia achata todos os módulos
   num escopo só, e dois `const sb` colidiriam. */
const bancoAuth = () => conexao.sb;

export async function entra(email, senha){
  const { error } = await bancoAuth().auth.signInWithPassword({ email, password: senha });
  if (!error) return { erro: null };
  /* credencial errada é o caso comum e merece frase própria: "não deu para
     completar" aqui só faria a pessoa tentar de novo igual. */
  if (/invalid login|credentials/i.test(String(error.message || "")))
    return { erro: "E-mail ou senha não conferem." };
  return { erro: erroLegivel(error) };
}

export const sai = () => bancoAuth().auth.signOut();

/* O callback recebe o id do usuário, ou `null` quando não há sessão. */
export function observaSessao(aoMudar){
  bancoAuth().auth.onAuthStateChange((_evt, sessao) => aoMudar(sessao ? sessao.user.id : null));
}

export async function sessaoAtual(){
  const { data } = await bancoAuth().auth.getSession();
  return data && data.session ? data.session.user.id : null;
}
