/* O único atalho de DOM que o projeto usa.
 *
 * Fica separado para que um módulo de domínio que importe `escape.js` não
 * arraste junto uma dependência de `document`.
 */
export const $ = id => document.getElementById(id);
