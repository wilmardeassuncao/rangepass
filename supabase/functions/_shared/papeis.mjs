// Papéis do sistema. Módulo puro: roda igual no Node (testes) e no Deno (Edge Functions).

export const PAPEIS = ['cliente', 'atendente', 'almoxarifado', 'instrutor', 'administrativo', 'superadmin'];

// Verdadeiro se a pessoa tem pelo menos um dos papéis exigidos. O superadmin passa em qualquer exigência.
export function temAlgumPapel(papeis, exigidos) {
    if (papeis.includes('superadmin')) return true;
    return exigidos.some(papel => papeis.includes(papel));
}
