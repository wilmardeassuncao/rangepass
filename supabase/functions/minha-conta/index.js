// Edge Function minha-conta: GET devolve os dados de quem está logado; PUT edita o próprio perfil.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, admin } from '../_shared/contexto.js';
import { validarEdicaoPerfil } from '../_shared/cadastro.mjs';

function mostrar(contexto) {
    return respostaJson(200, {
        id: contexto.usuarioId,
        email: contexto.email,
        papeis: contexto.papeis,
        perfil: contexto.perfil,
    });
}

async function editar(req, contexto) {
    let corpo;
    try {
        corpo = await req.json();
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }

    const { campos, alteracoes } = validarEdicaoPerfil(corpo);
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: 'Revise os campos destacados.', campos });
    if (!contexto.perfil) throw new ErroHttp(404, 'Não encontramos o seu cadastro. Procure o atendimento do estande.');

    const { data, error } = await admin.rpc('atualizar_perfil', {
        p_usuario: contexto.usuarioId, p_dados: alteracoes, p_autor: contexto.usuarioId,
    });
    if (error) throw error;
    return respostaJson(200, { perfil: data });
}

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET' && req.method !== 'PUT') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    if (req.method === 'GET') return mostrar(contexto);
    return editar(req, contexto);
}));
