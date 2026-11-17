// Edge Function painel-agendamentos: a visão do administrativo (o superadmin também passa).
// GET com filtros: a lista de agendamentos de um período. GET ?id=: o detalhe de um agendamento,
// com os participantes (CPFs) e o histórico; cada detalhe aberto fica registrado em acessos_dados.
// Só administrativo e superadmin chegam aos dados: o papel é conferido antes de qualquer consulta.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, admin } from '../_shared/contexto.js';
import { dataNoFuso } from '../_shared/cadastro.mjs';
import { instanteNoFuso } from '../_shared/agendamento.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const SITUACOES = ['aguardando_pagamento', 'pago', 'check_in', 'concluido', 'cancelado', 'nao_compareceu'];
const LIMITE = 500;
const DIAS_PADRAO = 15;
const DIAS_MAXIMOS = 92;
const NAO_ENCONTRADO = 'Não encontramos este agendamento.';

async function consulta(promessa) {
    const { data, error } = await promessa;
    if (error) throw error;
    return data;
}

function dataReal(data) {
    if (typeof data !== 'string' || !DATA.test(data)) return false;
    const d = new Date(`${data}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === data;
}

function somarDias(data, dias) {
    const d = new Date(`${data}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

function diasEntre(de, ate) {
    return Math.round((new Date(`${ate}T00:00:00Z`) - new Date(`${de}T00:00:00Z`)) / 86400000);
}

async function fusoDoEstande() {
    const linha = await consulta(admin.from('configuracoes').select('valor').eq('chave', 'estande').single());
    return linha.valor.fuso;
}

// Confere os filtros da lista. Sem datas: de hoje até hoje + 15 dias (no fuso do estande); sem
// "ate": "de" + 15 dias. As duas datas contam (inclusivas), no máximo 92 dias ao todo.
function lerFiltros(params, hoje) {
    const campos = {};
    const texto = (nome) => (params.get(nome) ?? '').trim();

    const de = texto('de') || hoje;
    if (!dataReal(de)) campos.de = 'Use uma data válida.';
    const ate = texto('ate') || (campos.de ? '' : somarDias(de, DIAS_PADRAO));
    if (texto('ate') && !dataReal(ate)) campos.ate = 'Use uma data válida.';
    if (!campos.de && !campos.ate) {
        const dias = diasEntre(de, ate);
        if (dias < 0 || dias + 1 > DIAS_MAXIMOS) {
            campos.ate = 'Escolha um período de até 92 dias, com o fim depois do início.';
        }
    }

    const situacao = texto('situacao') || null;
    if (situacao && !SITUACOES.includes(situacao)) campos.situacao = 'Escolha uma situação da lista.';
    const instrutorId = texto('instrutor_id') || null;
    if (instrutorId && !UUID.test(instrutorId)) campos.instrutor_id = 'Escolha um instrutor da lista.';

    return { campos, filtros: { de, ate, situacao, instrutorId, busca: texto('busca') || null } };
}

// Colunas da Linha. As reservas vêm todas (o histórico precisa dos ids); a Linha mostra só as ativas.
const CAMPOS_LINHA = `id, inicio, horas, situacao, forma_pagamento, criado_em, responsavel_id,
    responsavel:perfis!agendamentos_responsavel_id_fkey(nome_completo, cpf, telefone),
    agendamento_instrutores(id, ativo, principal, perfis(nome_completo)),
    agendamento_pistas(id, ativo, pistas(numero)),
    agendamento_unidades(id, ativo, unidades_arma(numero_registro, modelos(marca, nome)))`;

const CAMPOS_PARTICIPANTES = `participantes(id, nome_completo, cpf, data_nascimento, perfil_id, modalidade, termo_versao,
    itens_participante(id, arma_propria, municao_qtd, modelos(marca, nome), tipos_municao(nome)))`;

function nomeDoModelo(modelo) {
    return modelo ? `${modelo.marca} ${modelo.nome}` : null;
}

function montarLinha(linha, emails, participantesQtd) {
    const ativas = (lista) => lista.filter((r) => r.ativo).sort((a, b) => a.id - b.id);
    return {
        id: linha.id,
        inicio: linha.inicio,
        horas: linha.horas,
        situacao: linha.situacao,
        forma_pagamento: linha.forma_pagamento,
        criado_em: linha.criado_em,
        responsavel: {
            nome_completo: linha.responsavel?.nome_completo ?? null,
            cpf: linha.responsavel?.cpf ?? null,
            telefone: linha.responsavel?.telefone ?? null,
            email: emails.get(linha.responsavel_id) ?? null,
        },
        participantes_qtd: participantesQtd,
        instrutores: ativas(linha.agendamento_instrutores)
            .sort((a, b) => b.principal - a.principal)
            .map((r) => r.perfis?.nome_completo ?? null)
            .filter(Boolean),
        pistas: ativas(linha.agendamento_pistas).map((r) => r.pistas?.numero).sort((a, b) => a - b),
        armas: ativas(linha.agendamento_unidades).map((r) => ({
            modelo: nomeDoModelo(r.unidades_arma?.modelos),
            numero_registro: r.unidades_arma?.numero_registro ?? null,
        })),
    };
}

async function emailsDe(ids) {
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return new Map();
    const linhas = await consulta(admin.rpc('emails_dos_usuarios', { p_ids: unicos }));
    return new Map(linhas.map((l) => [l.id, l.email]));
}

async function listar(params) {
    const fuso = await fusoDoEstande();
    const { campos, filtros } = lerFiltros(params, dataNoFuso(new Date(), fuso));
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: 'Revise os campos destacados.', campos });

    const [linhas, instrutores] = await Promise.all([
        consulta(admin.rpc('painel_filtrar', {
            p_inicio: instanteNoFuso(filtros.de, 0, fuso).toISOString(),
            p_fim: instanteNoFuso(somarDias(filtros.ate, 1), 0, fuso).toISOString(),
            p_situacao: filtros.situacao,
            p_instrutor: filtros.instrutorId,
            p_busca: filtros.busca,
        }).select(`${CAMPOS_LINHA}, participantes(count)`).order('inicio').order('id').limit(LIMITE + 1)),
        consulta(admin.rpc('instrutores_ativos')),
    ]);
    const limiteAtingido = linhas.length > LIMITE;
    const mostradas = linhas.slice(0, LIMITE);
    const emails = await emailsDe(mostradas.map((l) => l.responsavel_id));

    const corpo = {
        agendamentos: mostradas.map((l) => montarLinha(l, emails, l.participantes?.[0]?.count ?? 0)),
        instrutores: instrutores.map((i) => ({ id: i.id, nome: i.nome })),
    };
    if (limiteAtingido) corpo.limite_atingido = true;
    return respostaJson(200, corpo);
}

function montarParticipante(p) {
    const item = p.itens_participante[0] ?? {};
    const arma = item.arma_propria;
    return {
        nome_completo: p.nome_completo,
        cpf: p.cpf,
        data_nascimento: p.data_nascimento,
        modalidade: p.modalidade,
        termo_versao: p.termo_versao ?? null,
        modelo: nomeDoModelo(item.modelos),
        tipo_municao: item.tipos_municao?.nome ?? null,
        municao_qtd: item.municao_qtd ?? null,
        arma_propria: arma
            ? {
                modelo: arma.modelo ?? null,
                calibre: arma.calibre ?? null,
                numero_registro: arma.numero_registro ?? null,
                responsavel: arma.responsavel ?? null,
            }
            : null,
    };
}

// Linhas do histórico do agendamento e das reservas, participantes e itens dele, em ordem de data.
async function historicoDe(linha) {
    const participantes = linha.participantes;
    const grupos = [
        ['agendamentos', [linha.id]],
        ['agendamento_instrutores', linha.agendamento_instrutores.map((r) => r.id)],
        ['agendamento_pistas', linha.agendamento_pistas.map((r) => r.id)],
        ['agendamento_unidades', linha.agendamento_unidades.map((r) => r.id)],
        ['participantes', participantes.map((p) => p.id)],
        ['itens_participante', participantes.flatMap((p) => p.itens_participante.map((i) => i.id))],
    ].filter(([, ids]) => ids.length > 0);

    const partes = await Promise.all(grupos.map(([tabela, ids]) => consulta(admin.from('historico_alteracoes')
        .select('id, tabela, acao, antes, depois, feito_por, feito_em')
        .eq('tabela', tabela).in('registro_id', ids.map(String)))));
    const linhas = partes.flat().sort((a, b) => (a.feito_em < b.feito_em ? -1 : a.feito_em > b.feito_em ? 1 : a.id - b.id));

    const autores = [...new Set(linhas.map((h) => h.feito_por).filter(Boolean))];
    const nomes = new Map();
    if (autores.length) {
        const perfis = await consulta(admin.from('perfis').select('id, nome_completo').in('id', autores));
        for (const p of perfis) nomes.set(p.id, p.nome_completo);
    }
    const emails = await emailsDe(autores.filter((id) => !nomes.has(id)));

    return linhas.map((h) => ({
        em: h.feito_em,
        tabela: h.tabela,
        acao: h.acao,
        autor: h.feito_por ? (nomes.get(h.feito_por) ?? emails.get(h.feito_por) ?? null) : null,
        antes: h.antes,
        depois: h.depois,
    }));
}

function ordemDosParticipantes(responsavelId) {
    return (a, b) => ((b.perfil_id === responsavelId) - (a.perfil_id === responsavelId))
        || a.nome_completo.localeCompare(b.nome_completo);
}

async function detalhar(id, contexto) {
    if (!UUID.test(id)) throw new ErroHttp(404, NAO_ENCONTRADO);
    const linha = await consulta(admin.from('agendamentos')
        .select(`${CAMPOS_LINHA}, ${CAMPOS_PARTICIPANTES}`).eq('id', id).maybeSingle());
    if (!linha) throw new ErroHttp(404, NAO_ENCONTRADO);

    const [emails, historico] = await Promise.all([emailsDe([linha.responsavel_id]), historicoDe(linha)]);
    const agendamento = {
        ...montarLinha(linha, emails, linha.participantes.length),
        participantes: [...linha.participantes].sort(ordemDosParticipantes(linha.responsavel_id)).map(montarParticipante),
    };

    // Só um detalhe entregue com sucesso conta como acesso aos dados pessoais.
    await consulta(admin.rpc('registrar_acesso', {
        p_usuario: contexto.usuarioId, p_recurso: 'agendamento', p_registro: linha.id,
    }));
    return respostaJson(200, { agendamento, historico });
}

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    exigirPapel(contexto, 'administrativo');

    const params = new URL(req.url).searchParams;
    const id = params.get('id');
    if (id !== null) return detalhar(id.trim(), contexto);
    return listar(params);
}));
