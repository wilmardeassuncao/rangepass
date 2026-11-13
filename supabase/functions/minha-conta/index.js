// Edge Function minha-conta: devolve os dados de quem está logado.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto } from '../_shared/contexto.js';

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    return respostaJson(200, {
        id: contexto.usuarioId,
        email: contexto.email,
        papeis: contexto.papeis,
        perfil: contexto.perfil,
    });
}));
