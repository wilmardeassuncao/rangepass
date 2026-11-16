// Edge Function catalogo: só o superadmin vê e mantém o catálogo (categorias, calibres, modelos,
// munições), as armas do estande e as pistas. Nada é apagado: os cadastros são criados, editados
// ou desativados, sempre pela RPC salvar_cadastro, que grava o autor no histórico.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, admin } from '../_shared/contexto.js';
import { validarCadastroCatalogo, MENSAGENS_DUPLICADO, desativa } from '../_shared/catalogo.mjs';

const NAO_ENCONTRADO = 'Não encontramos este cadastro.';

// Cada lista com as colunas e a ordem que a tela usa. Inclui os inativos.
const LISTAS = [
    ['categorias', 'categorias', 'id, nome, ativo', ['nome']],
    ['calibres', 'calibres', 'id, nome, ativo', ['nome']],
    ['modelos', 'modelos', 'id, categoria_id, calibre_id, marca, nome, ativo', ['marca', 'nome']],
    ['tipos_municao', 'tipos_municao', 'id, calibre_id, nome, ativo', ['nome']],
    ['unidades', 'unidades_arma', 'id, modelo_id, numero_registro, situacao', ['numero_registro']],
    ['pistas', 'pistas', 'id, numero, ativa', ['numero']],
];

async function ler() {
    const respostas = await Promise.all(LISTAS.map(([, tabela, colunas, ordem]) => {
        let consulta = admin.from(tabela).select(colunas);
        for (const coluna of ordem) consulta = consulta.order(coluna);
        return consulta.order('id');
    }));
    const corpo = {};
    respostas.forEach(({ data, error }, i) => {
        if (error) throw error;
        corpo[LISTAS[i][0]] = data;
    });
    return respostaJson(200, corpo);
}

async function lerCorpo(req) {
    try {
        return (await req.json()) ?? {};
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }
}

// Traduz os erros do banco que a pessoa consegue resolver; o resto vira 500 em tratar().
function erroDoBanco(tipo, error) {
    if (error.code === 'P0002') throw new ErroHttp(404, NAO_ENCONTRADO);
    if (error.code === '23503') throw new ErroHttp(400, 'Um dos itens escolhidos não existe mais. Recarregue a página.');
    if (error.code === '23505') {
        return respostaJson(409, { erro: 'Revise os campos destacados.', campos: { ...MENSAGENS_DUPLICADO[tipo] } });
    }
    throw error;
}

async function salvar(req, contexto, criando) {
    const { tipo, id, dados } = await lerCorpo(req);

    const { campos, valores } = validarCadastroCatalogo(tipo, dados, { criando });
    if (Object.keys(campos).length > 0) {
        return respostaJson(400, { erro: 'Revise os campos destacados.', campos });
    }
    if (!criando && (!Number.isInteger(id) || id < 1)) throw new ErroHttp(404, NAO_ENCONTRADO);

    const { data: item, error } = await admin.rpc('salvar_cadastro', {
        p_tipo: tipo, p_id: criando ? null : id, p_dados: valores, p_autor: contexto.usuarioId,
    });
    if (error) return erroDoBanco(tipo, error);

    if (criando) return respostaJson(201, { item });

    let reservas = 0;
    if (desativa(tipo, valores)) {
        const contagem = await admin.rpc('reservas_futuras', { p_tipo: tipo, p_id: id });
        if (contagem.error) throw contagem.error;
        reservas = contagem.data;
    }
    return respostaJson(200, { item, reservas_futuras: reservas });
}

Deno.serve(tratar(async (req) => {
    const contexto = await obterContexto(req);
    exigirPapel(contexto, 'superadmin');
    if (req.method === 'GET') return ler();
    if (req.method === 'POST') return salvar(req, contexto, true);
    if (req.method === 'PUT') return salvar(req, contexto, false);
    throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
}));
