// Edge Function agendamentos: opções do formulário, lista dos agendamentos do cliente logado,
// criar, alterar o horário e cancelar. Nunca devolve números de registro, pistas, unidades
// nem CPFs de convidados.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, contaBloqueada, admin } from '../_shared/contexto.js';
import { validarPedido, validarNovoHorario, podeAlterar, erroDeReserva } from '../_shared/agendamento.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACOES = ['alterar_horario', 'cancelar'];
const ATIVAS = ['aguardando_pagamento', 'pago'];

const SEM_CADASTRO = 'Não encontramos o seu cadastro. Procure o atendimento do estande.';
const NAO_ENCONTRADO = 'Não encontramos este agendamento.';

async function consulta(promessa) {
    const { data, error } = await promessa;
    if (error) throw error;
    return data;
}

async function lerCorpo(req) {
    try {
        return await req.json();
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }
}

// Instrutores que podem ser escolhidos: papel instrutor, perfil ativo e login não bloqueado.
async function instrutoresDisponiveis() {
    const papeis = await consulta(admin.from('papeis_usuario').select('usuario_id').eq('papel', 'instrutor'));
    const ids = papeis.map((l) => l.usuario_id);
    if (!ids.length) return [];
    const [perfis, liberados] = await Promise.all([
        consulta(admin.from('perfis').select('id, nome_completo').in('id', ids).eq('ativo', true).order('nome_completo')),
        loginsLiberados(),
    ]);
    return perfis.filter((p) => liberados.has(p.id)).map((p) => ({ id: p.id, nome: p.nome_completo }));
}

// Ids dos logins não bloqueados. Se o Auth falhar, o erro sobe (500) em vez de sumir com instrutores.
async function loginsLiberados() {
    const liberados = new Set();
    const POR_PAGINA = 1000;
    for (let pagina = 1; ; pagina++) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });
        if (error) throw error;
        for (const usuario of data.users) if (!contaBloqueada(usuario)) liberados.add(usuario.id);
        if (data.users.length < POR_PAGINA) return liberados;
    }
}

// Só itens ativos; modelos só com categoria e calibre ativos e ao menos uma arma disponível.
async function catalogo() {
    const [categorias, calibres, modelos, tipos, unidades] = await Promise.all([
        consulta(admin.from('categorias').select('id, nome').eq('ativo', true).order('nome')),
        consulta(admin.from('calibres').select('id, nome').eq('ativo', true).order('nome')),
        consulta(admin.from('modelos').select('id, categoria_id, calibre_id, marca, nome').eq('ativo', true).order('marca').order('nome')),
        consulta(admin.from('tipos_municao').select('id, calibre_id, nome').eq('ativo', true).order('nome')),
        consulta(admin.from('unidades_arma').select('modelo_id').eq('situacao', 'disponivel')),
    ]);
    const categoriasAtivas = new Set(categorias.map((c) => c.id));
    const calibresAtivos = new Set(calibres.map((c) => c.id));
    const comArma = new Set(unidades.map((u) => u.modelo_id));
    return {
        categorias,
        calibres,
        modelos: modelos.filter((m) => categoriasAtivas.has(m.categoria_id) && calibresAtivos.has(m.calibre_id) && comArma.has(m.id)),
        tipos_municao: tipos.filter((t) => calibresAtivos.has(t.calibre_id)),
    };
}

// O mesmo objeto vai para o navegador (GET ?ver=opcoes) e para as validações do servidor.
// A troca de horário não usa a lista de instrutores; com comInstrutores = false ela vem vazia.
async function montarOpcoes(contexto, { comInstrutores = true } = {}) {
    const [linhas, cat, instrutores] = await Promise.all([
        consulta(admin.from('configuracoes').select('chave, valor')
            .in('chave', ['estande', 'agenda', 'funcionamento', 'municao', 'cadastro', 'termo'])),
        catalogo(),
        comInstrutores ? instrutoresDisponiveis() : [],
    ]);
    const c = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
    const { perfil } = contexto;
    return {
        estande: { nome: c.estande.nome, fuso: c.estande.fuso },
        agenda: {
            antecedencia_minima_horas: c.agenda.antecedencia_minima_horas,
            antecedencia_maxima_dias: c.agenda.antecedencia_maxima_dias,
            prazo_alteracao_horas: c.agenda.prazo_alteracao_horas,
            duracao_maxima_individual: c.agenda.duracao_maxima_individual,
            duracao_maxima_grupo: c.agenda.duracao_maxima_grupo,
            grupo_maximo: c.agenda.grupo_maximo,
            faixas_instrutores: c.agenda.faixas_instrutores,
        },
        funcionamento: c.funcionamento,
        municao: { minima_por_participante: c.municao.minima_por_participante },
        idade_minima: c.cadastro.idade_minima,
        termo: { versao: c.termo.versao, texto: c.termo.texto },
        catalogo: cat,
        instrutores,
        responsavel: {
            id: perfil.id, nome_completo: perfil.nome_completo, cpf: perfil.cpf, data_nascimento: perfil.data_nascimento,
        },
    };
}

async function prazoAlteracao() {
    const linha = await consulta(admin.from('configuracoes').select('valor').eq('chave', 'agenda').single());
    return linha.valor.prazo_alteracao_horas;
}

// Único lugar que monta o Item: a lista, o POST e o PUT usam esta função.
const CAMPOS_ITEM = `id, inicio, horas, situacao, forma_pagamento, responsavel_id,
    agendamento_instrutores(id, principal, perfis(nome_completo)),
    participantes(nome_completo, perfil_id, modalidade,
        itens_participante(arma_propria, municao_qtd,
            modelos(marca, nome, calibres(nome)),
            tipos_municao(nome, calibres(nome))))`;

function montarItem(linha, agora, prazo) {
    const instrutores = [...linha.agendamento_instrutores]
        .sort((a, b) => (b.principal - a.principal) || (a.id - b.id))
        .map((r) => r.perfis?.nome_completo ?? null)
        .filter(Boolean);
    const participantes = [...linha.participantes]
        .sort((a, b) => ((b.perfil_id === linha.responsavel_id) - (a.perfil_id === linha.responsavel_id))
            || a.nome_completo.localeCompare(b.nome_completo))
        .map((p) => {
            const item = p.itens_participante[0] ?? {};
            return {
                nome_completo: p.nome_completo,
                modalidade: p.modalidade,
                modelo: item.modelos
                    ? { marca: item.modelos.marca, nome: item.modelos.nome, calibre: item.modelos.calibres?.nome ?? null }
                    : null,
                arma_propria: item.arma_propria
                    ? { modelo: item.arma_propria.modelo, calibre: item.arma_propria.calibre }
                    : null,
                tipo_municao: item.tipos_municao
                    ? { nome: item.tipos_municao.nome, calibre: item.tipos_municao.calibres?.nome ?? null }
                    : null,
                municao_qtd: item.municao_qtd ?? null,
            };
        });
    return {
        id: linha.id,
        inicio: linha.inicio,
        horas: linha.horas,
        situacao: linha.situacao,
        forma_pagamento: linha.forma_pagamento,
        pode_alterar: podeAlterar(linha, agora, prazo),
        prazo_alteracao_horas: prazo,
        instrutores,
        participantes,
    };
}

// Agendamentos do responsável, em ordem de início decrescente; com id, só aquele.
async function carregarItens(responsavelId, id = null) {
    let q = admin.from('agendamentos').select(CAMPOS_ITEM).eq('responsavel_id', responsavelId);
    if (id) q = q.eq('id', id);
    const [linhas, prazo] = await Promise.all([consulta(q.order('inicio', { ascending: false })), prazoAlteracao()]);
    const agora = new Date();
    return linhas.map((l) => montarItem(l, agora, prazo));
}

async function carregarItem(responsavelId, id) {
    const [item] = await carregarItens(responsavelId, id);
    if (!item) throw new Error(`Agendamento ${id} sumiu logo depois de gravado.`);
    return item;
}

// Erro de uma das RPCs: os de reserva viram 409 com mensagem clara; os outros sobem (500).
function erroDaRpc(error) {
    const reserva = erroDeReserva(error.code);
    if (reserva) return respostaJson(reserva.status, reserva.corpo);
    throw error;
}

async function criar(req, contexto) {
    const corpo = await lerCorpo(req);
    const opcoes = await montarOpcoes(contexto);
    const { campos, pedido } = validarPedido(corpo, { agora: new Date(), opcoes });
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: 'Revise os campos destacados.', campos });

    const { data, error } = await admin.rpc('criar_agendamento', { p_responsavel: contexto.usuarioId, p_pedido: pedido });
    if (error) return erroDaRpc(error);
    return respostaJson(201, { agendamento: await carregarItem(contexto.usuarioId, data) });
}

async function alterar(req, contexto) {
    const corpo = await lerCorpo(req);
    const pedido = corpo && typeof corpo === 'object' ? corpo : {};
    if (!ACOES.includes(pedido.acao)) throw new ErroHttp(400, 'Esta ação não existe.');

    // Id inválido, inexistente ou de outro cliente: a mesma resposta, para não revelar nada.
    if (typeof pedido.id !== 'string' || !UUID.test(pedido.id)) throw new ErroHttp(404, NAO_ENCONTRADO);
    const ag = await consulta(admin.from('agendamentos').select('id, inicio, situacao')
        .eq('id', pedido.id).eq('responsavel_id', contexto.usuarioId).maybeSingle());
    if (!ag) throw new ErroHttp(404, NAO_ENCONTRADO);

    if (!ATIVAS.includes(ag.situacao)) {
        throw new ErroHttp(409, 'Este agendamento não pode mais ser alterado pelo app. Fale com o estande.');
    }
    const agora = new Date();
    const prazo = await prazoAlteracao();
    if (!podeAlterar(ag, agora, prazo)) {
        throw new ErroHttp(403, `Faltam menos de ${prazo} horas para o início. Para alterar ou cancelar, fale com o estande.`);
    }

    let resultado;
    if (pedido.acao === 'cancelar') {
        resultado = await admin.rpc('cancelar_agendamento', { p_agendamento: ag.id, p_autor: contexto.usuarioId });
    } else {
        const [opcoes, participantes] = await Promise.all([
            montarOpcoes(contexto, { comInstrutores: false }),
            consulta(admin.from('participantes').select('id').eq('agendamento_id', ag.id)),
        ]);
        const novo = validarNovoHorario(
            { data: pedido.data, hora: pedido.hora, horas: pedido.horas },
            { agora, opcoes, quantidade: participantes.length },
        );
        if (Object.keys(novo.campos).length > 0) {
            return respostaJson(400, { erro: 'Revise os campos destacados.', campos: novo.campos });
        }
        resultado = await admin.rpc('alterar_horario_agendamento', {
            p_agendamento: ag.id, p_inicio: novo.inicio, p_horas: novo.horas, p_autor: contexto.usuarioId,
        });
    }
    if (resultado.error) return erroDaRpc(resultado.error);
    return respostaJson(200, { agendamento: await carregarItem(contexto.usuarioId, ag.id) });
}

async function listar(req, contexto) {
    const ver = new URL(req.url).searchParams.get('ver');
    if (ver === 'opcoes') return respostaJson(200, await montarOpcoes(contexto));
    return respostaJson(200, { agendamentos: await carregarItens(contexto.usuarioId) });
}

Deno.serve(tratar(async (req) => {
    if (!['GET', 'POST', 'PUT'].includes(req.method)) throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    if (!contexto.perfil) throw new ErroHttp(404, SEM_CADASTRO);
    if (req.method === 'GET') return listar(req, contexto);
    if (req.method === 'POST') return criar(req, contexto);
    return alterar(req, contexto);
}));
