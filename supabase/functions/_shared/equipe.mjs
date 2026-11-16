// Regras da gestão da equipe (papéis e contas). Módulo puro: roda igual no Node (testes) e no Deno.
import { PAPEIS } from './papeis.mjs';

const ESCOLHA_PAPEIS = 'Escolha papéis da lista.';

// Confere a lista de papéis enviada: precisa ser uma lista só com papéis do sistema.
// Repetições são tiradas; a lista vazia é permitida (a pessoa fica sem papel).
export function validarPapeis(papeis) {
    if (!Array.isArray(papeis) || !papeis.every(papel => PAPEIS.includes(papel))) {
        return { erro: ESCOLHA_PAPEIS, papeis: [] };
    }
    return { erro: null, papeis: [...new Set(papeis)] };
}

// Impede que a troca de papéis deixe o sistema sem quem o administre.
// superadminsAtuais: ids de quem tem o papel superadmin agora.
export function conferirMudancaDePapeis({ autorId, usuarioId, papeisNovos, superadminsAtuais }) {
    const perdeSuperadmin = superadminsAtuais.includes(usuarioId) && !papeisNovos.includes('superadmin');
    if (!perdeSuperadmin) return null;
    if (autorId === usuarioId) return 'Você não pode tirar o seu próprio papel de superadmin.';
    if (superadminsAtuais.every(id => id === usuarioId)) return 'O sistema precisa de pelo menos um superadmin.';
    return null;
}

export function conferirDesativacao({ autorId, usuarioId }) {
    if (autorId === usuarioId) return 'Você não pode desativar a sua própria conta.';
    return null;
}
