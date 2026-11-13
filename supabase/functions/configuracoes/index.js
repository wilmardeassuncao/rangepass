// Edge Function configuracoes: qualquer pessoa logada lê; só o superadmin altera.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, admin } from '../_shared/contexto.js';
import { validarConfiguracao } from '../_shared/configuracoes.mjs';

async function ler() {
    const { data, error } = await admin.from('configuracoes').select('chave, valor');
    if (error) throw error;
    return respostaJson(200, { configuracoes: Object.fromEntries(data.map(linha => [linha.chave, linha.valor])) });
}

async function alterar(req, contexto) {
    exigirPapel(contexto, 'superadmin');

    let corpo;
    try {
        corpo = await req.json();
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }
    const { chave, valor } = corpo ?? {};

    const campos = validarConfiguracao(chave, valor);
    if (Object.keys(campos).length > 0) {
        return respostaJson(400, { erro: 'Revise os campos destacados.', campos });
    }

    const { data, error } = await admin.rpc('salvar_configuracao', { p_chave: chave, p_valor: valor, p_usuario: contexto.usuarioId });
    if (error) throw error;
    return respostaJson(200, { chave: data.chave, valor: data.valor });
}

Deno.serve(tratar(async (req) => {
    const contexto = await obterContexto(req);
    if (req.method === 'GET') return ler();
    if (req.method === 'PUT') return alterar(req, contexto);
    throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
}));
