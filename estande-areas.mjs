// As áreas da página do estande (estande.html) e quem vê cada uma. Arquivo pequeno de propósito: o menu
// (menu-regras.mjs, usado em todas as páginas) importa daqui sem puxar as regras de preço do estande.
import { temAlgumPapel } from './supabase/functions/_shared/papeis.mjs';

// Na ordem do menu (Almoxarifado e Minha pista entram no plano 8B).
export const AREAS_ESTANDE = [{ id: 'recepcao', texto: 'Recepção', papeis: ['atendente'] }];

export function areasVisiveis(papeis) {
    return AREAS_ESTANDE.filter((area) => temAlgumPapel(papeis, area.papeis)).map((area) => area.id);
}
