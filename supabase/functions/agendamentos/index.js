// Edge Function agendamentos: opções do formulário, lista dos agendamentos do cliente logado,
// criar, alterar o horário e cancelar. Nunca devolve números de registro, pistas, unidades
// nem CPFs de convidados. O preço é calculado aqui (o valor oficial), conferido com o que o
// cliente viu na revisão (preco_esperado_centavos) e congelado no agendamento.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, admin } from '../_shared/contexto.js';
import { validarPedido, validarNovoHorario, podeAlterar, erroDeReserva } from '../_shared/agendamento.mjs';
import { dataNoFuso } from '../_shared/cadastro.mjs';
import { calcularPreco } from '../_shared/precos.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACOES = ['alterar_horario', 'cancelar'];
const ATIVAS = ['aguardando_pagamento', 'pago'];

const SEM_CADASTRO = 'Não encontramos o seu cadastro. Procure o atendimento do estande.';
const NAO_ENCONTRADO = 'Não encontramos este agendamento.';
const ILEGIVEL = 'Não foi possível ler os dados enviados. Tente de novo.';
const SEM_PRECOS = 'O estande ainda não definiu os preços. Tente de novo mais tarde.';
const PRECO_MUDOU = 'O preço mudou desde que você abriu a revisão. Confira o novo valor e confirme de novo.';
const PRECOS_DO_AGENDAMENTO_MUDARAM = 'Os preços deste agendamento mudaram. Fale com o estande para alterar o horário.';

async function consulta(promessa) {
    const { data, error } = await promessa;
    if (error) throw error;
    return data;
}

async function lerCorpo(req) {
    try {
        return await req.json();
    } catch {
        throw new ErroHttp(400, ILEGIVEL);
    }
}

// Instrutores que podem ser escolhidos: papel instrutor, perfil ativo e login não bloqueado (o banco confere).
async function instrutoresDisponiveis() {
    return consulta(admin.rpc('instrutores_ativos'));
}

// Só itens ativos e com preço; modelos só com categoria e calibre ativos e ao menos uma arma disponível.
// Os preços saem do catálogo (vão para a tabela de preços): o catálogo fica como era.
async function catalogo() {
    const [categorias, calibres, modelos, tipos, unidades] = await Promise.all([
        consulta(admin.from('categorias').select('id, nome').eq('ativo', true).order('nome')),
        consulta(admin.from('calibres').select('id, nome').eq('ativo', true).order('nome')),
        consulta(admin.from('modelos').select('id, categoria_id, calibre_id, marca, nome, preco_hora_centavos')
            .eq('ativo', true).not('preco_hora_centavos', 'is', null).order('marca').order('nome')),
        consulta(admin.from('tipos_municao').select('id, calibre_id, nome, preco_unidade_centavos')
            .eq('ativo', true).not('preco_unidade_centavos', 'is', null).order('nome')),
        consulta(admin.from('unidades_arma').select('modelo_id').eq('situacao', 'disponivel')),
    ]);
    const categoriasAtivas = new Set(categorias.map((c) => c.id));
    const calibresAtivos = new Set(calibres.map((c) => c.id));
    const comArma = new Set(unidades.map((u) => u.modelo_id));
    const modelosVisiveis = modelos.filter((m) => categoriasAtivas.has(m.categoria_id) && calibresAtivos.has(m.calibre_id) && comArma.has(m.id));
    const tiposVisiveis = tipos.filter((t) => calibresAtivos.has(t.calibre_id));
    return {
        catalogo: {
            categorias,
            calibres,
            modelos: modelosVisiveis.map(({ preco_hora_centavos: _, ...m }) => m),
            tipos_municao: tiposVisiveis.map(({ preco_unidade_centavos: _, ...t }) => t),
        },
        precoModelos: Object.fromEntries(modelosVisiveis.map((m) => [m.id, m.preco_hora_centavos])),
        precoMunicoes: Object.fromEntries(tiposVisiveis.map((t) => [t.id, t.preco_unidade_centavos])),
    };
}

const vigenteEm = (hoje) => (item) => item.inicio <= hoje && hoje <= item.fim;

// TabelaPrecos (_shared/precos.mjs): só itens ativos; campanhas e pacotes vigentes hoje (no fuso do
// estande). Um pacote que cita um modelo ou munição fora da tabela (sem preço, inativo) fica de fora.
async function tabelaDePrecos(configPrecos, cat, hoje) {
    const [regras, campanhas, pacotes] = await Promise.all([
        consulta(admin.from('regras_preco').select('dias, hora_inicio, hora_fim, percentual, prioridade').eq('ativo', true).order('id')),
        consulta(admin.from('campanhas').select('id, nome, percentual, inicio, fim').eq('ativo', true).order('id')),
        consulta(admin.from('pacotes')
            .select('id, nome, inicio, fim, preco_centavos, horas, modelo_id, tipo_municao_id, municao_qtd').eq('ativo', true).order('id')),
    ]);
    const vigente = vigenteEm(hoje);
    return {
        hora_pista_centavos: configPrecos?.hora_pista_centavos ?? null,
        // O banco devolve 'HH:MM:SS'; o cálculo compara 'HH:MM'.
        regras: regras.map((r) => ({ ...r, hora_inicio: r.hora_inicio.slice(0, 5), hora_fim: r.hora_fim.slice(0, 5) })),
        modelos: cat.precoModelos,
        tipos_municao: cat.precoMunicoes,
        campanhas: campanhas.filter(vigente),
        pacotes: pacotes.filter(vigente).filter((p) => (p.modelo_id == null || Object.hasOwn(cat.precoModelos, p.modelo_id))
            && (p.tipo_municao_id == null || Object.hasOwn(cat.precoMunicoes, p.tipo_municao_id))),
    };
}

// O mesmo objeto vai para o navegador (GET ?ver=opcoes) e para as validações do servidor.
// A troca de horário não usa a lista de instrutores; com comInstrutores = false ela vem vazia.
async function montarOpcoes(contexto, { comInstrutores = true } = {}) {
    const [linhas, cat, instrutores] = await Promise.all([
        consulta(admin.from('configuracoes').select('chave, valor')
            .in('chave', ['estande', 'agenda', 'funcionamento', 'municao', 'cadastro', 'termo', 'precos'])),
        catalogo(),
        comInstrutores ? instrutoresDisponiveis() : [],
    ]);
    const c = Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
    const hoje = dataNoFuso(new Date(), c.estande.fuso);
    const precos = await tabelaDePrecos(c.precos, cat, hoje);
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
        catalogo: cat.catalogo,
        precos,
        hoje,
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
const CAMPOS_ITEM = `id, inicio, horas, situacao, forma_pagamento, responsavel_id, preco_total_centavos, preco_detalhe,
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
        // Vazio nos agendamentos feitos antes dos preços.
        preco: linha.preco_total_centavos == null
            ? null
            : { total_centavos: linha.preco_total_centavos, desconto: linha.preco_detalhe?.desconto ?? null },
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

// O preço que o cliente viu na revisão: inteiro, 0 ou mais. Qualquer outra coisa é um corpo ilegível.
function precoEsperado(corpo) {
    const valor = corpo && typeof corpo === 'object' ? corpo.preco_esperado_centavos : undefined;
    if (!Number.isInteger(valor) || valor < 0) throw new ErroHttp(400, ILEGIVEL);
    return valor;
}

function exigirHoraDePista(opcoes) {
    if (!Number.isInteger(opcoes.precos.hora_pista_centavos)) throw new ErroHttp(409, SEM_PRECOS);
}

// Calcula o preço oficial; se não for o que o cliente viu, 409 com o preço novo (nada é gravado).
function conferirPreco(pedido, opcoes, esperado) {
    const preco = calcularPreco(pedido, opcoes.precos, { hoje: opcoes.hoje, fuso: opcoes.estande.fuso });
    if (preco.total_centavos !== esperado) return { resposta: respostaJson(409, { erro: PRECO_MUDOU, preco }) };
    return { preco };
}

// A tabela de preços do recálculo de um agendamento gravado: a tabela do cliente mais o preço atual
// dos modelos e munições do próprio agendamento (os pacotes continuam seguindo o catálogo do cliente).
async function precosDoAgendamento(participantes, precos) {
    const idsModelos = [...new Set(participantes.map((p) => p.modelo_id).filter((id) => id != null))];
    const idsMunicoes = [...new Set(participantes.map((p) => p.tipo_municao_id).filter((id) => id != null))];
    const [modelos, municoes] = await Promise.all([
        idsModelos.length ? consulta(admin.from('modelos').select('id, preco_hora_centavos').in('id', idsModelos)) : [],
        idsMunicoes.length ? consulta(admin.from('tipos_municao').select('id, preco_unidade_centavos').in('id', idsMunicoes)) : [],
    ]);
    return {
        ...precos,
        modelos: { ...precos.modelos, ...Object.fromEntries(modelos.map((m) => [m.id, m.preco_hora_centavos])) },
        tipos_municao: { ...precos.tipos_municao, ...Object.fromEntries(municoes.map((t) => [t.id, t.preco_unidade_centavos])) },
    };
}

// O agendamento que este responsável já gravou com esta chave de envio, ou null.
async function agendamentoDaChave(responsavelId, chave) {
    const linha = await consulta(admin.from('agendamentos').select('id')
        .eq('responsavel_id', responsavelId).eq('chave_envio', chave).maybeSingle());
    return linha ? carregarItem(responsavelId, linha.id) : null;
}

// chave_envio (opcional): o mesmo pedido enviado de novo (clique duplo, rede que caiu) devolve 200
// com o agendamento já gravado, em vez de criar outro.
async function criar(req, contexto) {
    const corpo = await lerCorpo(req);
    const chave = corpo && typeof corpo === 'object' ? (corpo.chave_envio ?? null) : null;
    if (chave !== null && (typeof chave !== 'string' || !UUID.test(chave))) throw new ErroHttp(400, ILEGIVEL);
    if (chave) {
        const existente = await agendamentoDaChave(contexto.usuarioId, chave);
        if (existente) return respostaJson(200, { agendamento: existente });
    }

    const esperado = precoEsperado(corpo);

    const opcoes = await montarOpcoes(contexto);
    exigirHoraDePista(opcoes);
    const { campos, pedido } = validarPedido(corpo, { agora: new Date(), opcoes });
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: 'Revise os campos destacados.', campos });
    const { resposta, preco } = conferirPreco(pedido, opcoes, esperado);
    if (resposta) return resposta;

    const { data, error } = await admin.rpc('criar_agendamento', {
        p_responsavel: contexto.usuarioId, p_pedido: { ...pedido, chave_envio: chave, preco },
    });
    if (error) {
        // Dois envios da mesma chave ao mesmo tempo: o outro gravou primeiro.
        if (error.code === '23505' && chave) {
            const existente = await agendamentoDaChave(contexto.usuarioId, chave);
            if (existente) return respostaJson(200, { agendamento: existente });
        }
        return erroDaRpc(error);
    }
    return respostaJson(201, { agendamento: await carregarItem(contexto.usuarioId, data) });
}

async function alterar(req, contexto) {
    const corpo = await lerCorpo(req);
    const pedido = corpo && typeof corpo === 'object' ? corpo : {};
    if (!ACOES.includes(pedido.acao)) throw new ErroHttp(400, 'Esta ação não existe.');
    const esperado = pedido.acao === 'alterar_horario' ? precoEsperado(pedido) : null;

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
        const [opcoes, participantes, pistas] = await Promise.all([
            montarOpcoes(contexto, { comInstrutores: false }),
            consulta(admin.from('participantes')
                .select('id, modalidade, itens_participante(modelo_id, tipo_municao_id, municao_qtd)').eq('agendamento_id', ag.id)),
            consulta(admin.from('agendamento_pistas').select('id').eq('agendamento_id', ag.id).eq('ativo', true)),
        ]);
        const novo = validarNovoHorario(
            { data: pedido.data, hora: pedido.hora, horas: pedido.horas },
            { agora, opcoes, quantidade: participantes.length },
        );
        if (Object.keys(novo.campos).length > 0) {
            return respostaJson(400, { erro: 'Revise os campos destacados.', campos: novo.campos });
        }
        exigirHoraDePista(opcoes);

        // O pedido gravado com o horário novo, no formato do PedidoNormalizado. criar_agendamento reserva
        // uma pista por instrutor necessário, e a pista é o que se cobra: conta as pistas ativas (no mínimo 1).
        const recalculo = {
            inicio: novo.inicio,
            horas: novo.horas,
            instrutores_necessarios: Math.max(1, pistas.length),
            participantes: participantes.map((p) => {
                const item = p.itens_participante[0] ?? {};
                return { modalidade: p.modalidade, modelo_id: item.modelo_id ?? null,
                    tipo_municao_id: item.tipo_municao_id ?? null, municao_qtd: item.municao_qtd ?? null };
            }),
        };
        // O preço atual de cada modelo e munição gravados no agendamento, lido direto (mesmo que hoje
        // estejam fora do catálogo do cliente): a disponibilidade fica com a RPC (RP004). Sem preço, 409.
        const tabela = await precosDoAgendamento(recalculo.participantes, opcoes.precos);
        const semPreco = recalculo.participantes.some((p) => (p.modalidade === 'estande' && !Number.isInteger(tabela.modelos[p.modelo_id]))
            || ((p.modalidade === 'estande' || p.modalidade === 'arma_propria') && !Number.isInteger(tabela.tipos_municao[p.tipo_municao_id])));
        if (semPreco) throw new ErroHttp(409, PRECOS_DO_AGENDAMENTO_MUDARAM);
        const { resposta, preco } = conferirPreco(recalculo, { ...opcoes, precos: tabela }, esperado);
        if (resposta) return resposta;

        resultado = await admin.rpc('alterar_horario_agendamento', {
            p_agendamento: ag.id, p_inicio: novo.inicio, p_horas: novo.horas, p_autor: contexto.usuarioId, p_preco: preco,
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
