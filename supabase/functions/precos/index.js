// Edge Function precos: só o superadmin vê e mantém as promoções (regras por dia e horário,
// campanhas, classes de desconto e pacotes). Nada é apagado: cada item é criado, editado ou
// desativado, sempre pela RPC salvar_promocao, que grava o autor no histórico.
// A hora de pista não muda aqui: ela fica nas Configurações (PUT configuracoes, chave precos).
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, admin } from '../_shared/contexto.js';
import { validarRegra, validarCampanha, validarClasse, validarPacote, conferirItensDoPacote } from '../_shared/precos.mjs';

const NAO_ENCONTRADO = 'Não encontramos este cadastro.';
const REVISE = 'Revise os campos destacados.';

// Cada tipo: tabela, colunas devolvidas, ordem da lista e a conferência de _shared/precos.mjs.
const TIPOS = {
    regra: {
        lista: 'regras', tabela: 'regras_preco', ordem: ['nome'], validar: validarRegra,
        colunas: 'id, nome, dias, hora_inicio, hora_fim, percentual, prioridade, ativo',
    },
    campanha: {
        lista: 'campanhas', tabela: 'campanhas', ordem: ['inicio', 'nome'], validar: validarCampanha,
        colunas: 'id, nome, percentual, inicio, fim, ativo',
    },
    classe: {
        lista: 'classes', tabela: 'classes_desconto', ordem: ['nome'], validar: validarClasse,
        colunas: 'id, nome, percentual_pista, percentual_aluguel, percentual_municao, ativo',
    },
    pacote: {
        lista: 'pacotes', tabela: 'pacotes', ordem: ['inicio', 'nome'], validar: validarPacote,
        colunas: 'id, nome, inicio, fim, preco_centavos, horas, modelo_id, tipo_municao_id, municao_qtd, ativo',
    },
};

// O banco devolve os horários como 'HH:MM:SS'; a tela e a conferência usam 'HH:MM'.
function normalizar(tipo, linha) {
    if (tipo !== 'regra' || !linha) return linha;
    return { ...linha, hora_inicio: linha.hora_inicio?.slice(0, 5), hora_fim: linha.hora_fim?.slice(0, 5) };
}

async function ler() {
    const consultas = Object.values(TIPOS).map(({ tabela, colunas, ordem }) => {
        let consulta = admin.from(tabela).select(colunas);
        for (const coluna of ordem) consulta = consulta.order(coluna);
        return consulta.order('id');
    });
    const [config, ...respostas] = await Promise.all([
        admin.from('configuracoes').select('valor').eq('chave', 'precos').maybeSingle(),
        ...consultas,
    ]);
    if (config.error) throw config.error;
    const corpo = { hora_pista_centavos: config.data?.valor?.hora_pista_centavos ?? null };
    Object.entries(TIPOS).forEach(([tipo, { lista }], i) => {
        const { data, error } = respostas[i];
        if (error) throw error;
        corpo[lista] = data.map(linha => normalizar(tipo, linha));
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
async function erroDoBanco(tipo, error, valores, criando) {
    if (error.code === 'P0002') throw new ErroHttp(404, NAO_ENCONTRADO);
    if (error.code === '23503') throw new ErroHttp(400, 'Um dos itens escolhidos não existe mais. Recarregue a página.');
    if (error.code === '23505' && tipo === 'classe') {
        // O índice único é sobre o nome: se a classe de mesmo nome está desativada, sugere reativá-la
        // (e, ao renomear, também escolher outro nome).
        const { data } = await admin.from('classes_desconto').select('ativo').eq('nome', valores.nome).maybeSingle();
        const sugestao = criando ? 'Reative-a na lista em vez de criar outra.' : 'Reative-a na lista ou escolha outro nome.';
        const nome = data && !data.ativo
            ? `Já existe uma classe desativada com este nome. ${sugestao}`
            : 'Já existe uma classe com este nome.';
        return respostaJson(409, { erro: REVISE, campos: { nome } });
    }
    // A conferência abaixo já pega estes casos; isto é só uma rede de segurança.
    if (error.code === '23502' || error.code === '23514') {
        throw new ErroHttp(400, 'Algum valor está faltando ou fora das regras. Revise os campos e tente de novo.');
    }
    throw error;
}

// Numa edição, confere a linha como ficará (a guardada + o que veio), para pegar, por exemplo,
// um fim antes do início guardado ou munição sem quantidade. Devolve os erros, ou null.
async function conferirLinhaFinal(tipo, id, valores) {
    const { tabela, colunas, validar } = TIPOS[tipo];
    const { data, error } = await admin.from(tabela).select(colunas).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw new ErroHttp(404, NAO_ENCONTRADO);
    const { id: _id, ...guardada } = normalizar(tipo, data);
    const { campos } = validar({ ...guardada, ...valores }, { criando: true });
    return { erros: Object.keys(campos).length ? campos : null, final: { ...guardada, ...valores } };
}

// Confere se o modelo e a munição do pacote têm preço e se são do mesmo calibre.
async function conferirItens(final) {
    const ler = async (tabela, colunas, itemId) => {
        if (itemId == null) return null;
        const { data, error } = await admin.from(tabela).select(colunas).eq('id', itemId).maybeSingle();
        if (error) throw error;
        return data; // null se não existe: o banco recusa depois (23503) com a mensagem própria
    };
    const [modelo, tipoMunicao] = await Promise.all([
        ler('modelos', 'preco_hora_centavos, calibre_id', final.modelo_id),
        ler('tipos_municao', 'preco_unidade_centavos, calibre_id', final.tipo_municao_id),
    ]);
    return conferirItensDoPacote(final, { modelo, tipoMunicao });
}

async function salvar(req, contexto, criando) {
    const { tipo, id, dados } = await lerCorpo(req);
    if (!Object.hasOwn(TIPOS, tipo)) {
        return respostaJson(400, { erro: REVISE, campos: { tipo: 'Este tipo de promoção não existe.' } });
    }

    const { campos, valores } = TIPOS[tipo].validar(dados, { criando });
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: REVISE, campos });

    let linhaFinal = valores;
    if (!criando) {
        if (!Number.isInteger(id) || id < 1) throw new ErroHttp(404, NAO_ENCONTRADO);
        const { erros, final } = await conferirLinhaFinal(tipo, id, valores);
        if (erros) return respostaJson(400, { erro: REVISE, campos: erros });
        linhaFinal = final;
    }

    // Ao editar, só confere os itens se vieram itens: desativar ou renomear não pode travar por um
    // preço que sumiu depois.
    const mexeuNosItens = criando || 'modelo_id' in valores || 'tipo_municao_id' in valores;
    if (tipo === 'pacote' && mexeuNosItens) {
        const itens = await conferirItens(linhaFinal);
        if (Object.keys(itens).length > 0) return respostaJson(400, { erro: REVISE, campos: itens });
    }

    const { data, error } = await admin.rpc('salvar_promocao', {
        p_tipo: tipo, p_id: criando ? null : id, p_dados: valores, p_autor: contexto.usuarioId,
    });
    if (error) return erroDoBanco(tipo, error, valores, criando);

    return respostaJson(criando ? 201 : 200, { item: normalizar(tipo, data) });
}

Deno.serve(tratar(async (req) => {
    const contexto = await obterContexto(req);
    exigirPapel(contexto, 'superadmin');
    if (req.method === 'GET') return ler();
    if (req.method === 'POST') return salvar(req, contexto, true);
    if (req.method === 'PUT') return salvar(req, contexto, false);
    throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
}));
