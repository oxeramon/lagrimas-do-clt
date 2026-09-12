/* Escapa dado do usuário antes de ele entrar em innerHTML.
 *
 * Regra do projeto, sem exceção: todo dado vindo do banco passa por aqui antes
 * de virar markup. Mensagem de erro usa textContent e não precisa disto.
 */
export const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
