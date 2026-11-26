// Edge Function operacao: a operação do estande no dia (por enquanto, a área Recepção).
// GET ?area=recepcao: a lista das sessões de hoje (no fuso do estande, que vai junto), sem as canceladas.
// GET ?id=: a ficha de check-in, com os participantes (CPFs), as classes de desconto ativas e o custo
// da munição e o fuso do estande; cada ficha aberta fica registrada em acessos_dados.
// POST { acao: 'check_in', ... }: o check-in com o pagamento do balcão. O servidor refaz a conta do
// desconto de classe e grava o pagamento e a situação numa transação só (RPC fazer_check_in).
// Só atendente e superadmin chegam aos dados: o papel é conferido antes de qualquer consulta.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, admin } from '../_shared/contexto.js';
import { dataNoFuso } from '../_shared/cadastro.mjs';
import { instanteNoFuso, somarDias } from '../_shared/agendamento.mjs';
import { descontoDeClasse } from '../_shared/precos.mjs';
import { motivoSemCheckIn, validarCheckIn } from '../_shared/operacao.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAO_ENCONTRADO = 'Não encontramos este agendamento.';
const REVISE = 'Revise os campos destacados.';
const CLASSE_INDISPONIVEL = 'Esta classe de desconto não está mais disponível. Escolha outra.';
const VALOR_MUDOU = 'O valor mudou. Confira a ficha de novo.';

async function consulta(promessa) {
    const { data, error } = await promessa;
    if (error) throw error;
    return data;
}

async function fusoDoEstande() {
    const linha = await consulta(admin.from('configuracoes').select('valor').eq('chave', 'estande').single());
    return linha.valor.fuso;
}

async function lerCorpo(req) {
    try {
        return (await req.json()) ?? {};
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }
}

// O pagamento vem embutido como objeto (um por agendamento) ou, em alguns casos, como lista.
function umOuNulo(valor) {
    return (Array.isArray(valor) ? valor[0] : valor) ?? null;
}

const ativas = (lista) => lista.filter((r) => r.ativo).sort((a, b) => a.id - b.id);

function nomeDoModelo(modelo) {
    return modelo ? `${modelo.marca} ${modelo.nome}` : null;
}

// --- Lista do dia (Recepção) ---

async function listarRecepcao() {
    const fuso = await fusoDoEstande();
    const hoje = dataNoFuso(new Date(), fuso);
    const linhas = await consulta(admin.from('agendamentos')
        .select(`id, inicio, horas, situacao, preco_total_centavos,
            responsavel:perfis!agendamentos_responsavel_id_fkey(nome_completo, telefone),
            participantes(count),
            agendamento_instrutores(id, ativo, principal, perfis(nome_completo)),
            agendamento_pistas(id, ativo, pistas(numero)),
            pagamentos(valor_centavos)`)
        .gte('inicio', instanteNoFuso(hoje, 0, fuso).toISOString())
        .lt('inicio', instanteNoFuso(somarDias(hoje, 1), 0, fuso).toISOString())
        .neq('situacao', 'cancelado')
        .order('inicio').order('id'));

    const agendamentos = linhas.map((l) => ({
        id: l.id,
        inicio: l.inicio,
        horas: l.horas,
        situacao: l.situacao,
        responsavel: { nome: l.responsavel?.nome_completo ?? null, telefone: l.responsavel?.telefone ?? null },
        pessoas: l.participantes?.[0]?.count ?? 0,
        pistas: ativas(l.agendamento_pistas).map((r) => r.pistas?.numero).sort((a, b) => a - b),
        instrutores: ativas(l.agendamento_instrutores)
            .sort((a, b) => b.principal - a.principal)
            .map((r) => r.perfis?.nome_completo ?? null)
            .filter(Boolean),
        valor_centavos: l.preco_total_centavos ?? null,
        pago_no_balcao_centavos: umOuNulo(l.pagamentos)?.valor_centavos ?? null,
    }));
    return respostaJson(200, { hoje, fuso, agendamentos });
}

// --- Ficha de check-in ---

const CAMPOS_FICHA = `id, inicio, horas, situacao, forma_pagamento, responsavel_id, preco_detalhe, preco_total_centavos,
    participantes(id, nome_completo, cpf, data_nascimento, perfil_id, modalidade,
        itens_participante(id, municao_qtd, modelos(marca, nome), tipos_municao(nome, custo_compra_centavos))),
    pagamentos(valor_centavos, forma, classe_id, documento, conta, desconto_centavos, registrado_em)`;

async function lerAgendamento(id) {
    if (!UUID.test(id)) throw new ErroHttp(404, NAO_ENCONTRADO);
    const linha = await consulta(admin.from('agendamentos').select(CAMPOS_FICHA).eq('id', id).maybeSingle());
    if (!linha) throw new ErroHttp(404, NAO_ENCONTRADO);
    return linha;
}

// Σ (quantidade × custo de compra) da munição dos tipos que têm custo; null se nenhum tipo usado tem
// custo (sem limite para o desconto da munição). O custo é o atual, não o do dia do agendamento.
function custoDaMunicao(linha) {
    let total = null;
    for (const p of linha.participantes) {
        for (const item of p.itens_participante) {
            const custo = item.tipos_municao?.custo_compra_centavos;
            if (custo == null || !item.municao_qtd) continue;
            total = (total ?? 0) + item.municao_qtd * custo;
        }
    }
    return total;
}

function ordemDosParticipantes(responsavelId) {
    return (a, b) => ((b.perfil_id === responsavelId) - (a.perfil_id === responsavelId))
        || a.nome_completo.localeCompare(b.nome_completo);
}

function montarParticipante(p) {
    const item = p.itens_participante[0] ?? {};
    return {
        nome_completo: p.nome_completo,
        cpf: p.cpf,
        data_nascimento: p.data_nascimento,
        modalidade: p.modalidade,
        modelo: nomeDoModelo(item.modelos),
        tipo_municao: item.tipos_municao?.nome ?? null,
        municao_qtd: item.municao_qtd ?? null,
    };
}

async function detalhar(id, contexto) {
    const linha = await lerAgendamento(id);
    const [fuso, classes] = await Promise.all([
        fusoDoEstande(),
        consulta(admin.from('classes_desconto')
            .select('id, nome, percentual_pista, percentual_aluguel, percentual_municao')
            .eq('ativo', true).order('nome')),
    ]);
    const motivo = motivoSemCheckIn(linha, { hoje: dataNoFuso(new Date(), fuso), fuso });
    const pagamento = umOuNulo(linha.pagamentos);

    const agendamento = {
        id: linha.id,
        inicio: linha.inicio,
        horas: linha.horas,
        situacao: linha.situacao,
        forma_pagamento: linha.forma_pagamento,
        // Vazios nos agendamentos feitos antes dos preços.
        preco_detalhe: linha.preco_detalhe ?? null,
        preco_total_centavos: linha.preco_total_centavos ?? null,
        participantes: [...linha.participantes].sort(ordemDosParticipantes(linha.responsavel_id)).map(montarParticipante),
        pagamento,
    };

    // Só uma ficha entregue com sucesso conta como acesso aos dados pessoais.
    await consulta(admin.rpc('registrar_acesso', {
        p_usuario: contexto.usuarioId, p_recurso: 'operacao.ficha', p_registro: linha.id,
    }));
    return respostaJson(200, {
        agendamento,
        classes,
        custo_municao_centavos: custoDaMunicao(linha),
        pode_fazer_check_in: motivo === null,
        motivo,
        fuso,
    });
}

// --- Check-in ---

// Monta o pagamento para fazer_check_in, refazendo a conta da classe com o custo atual da munição.
async function montarPagamento(linha, pedido) {
    const temPreco = linha.preco_detalhe != null;
    if (!temPreco) {
        return { valor_centavos: pedido.valor_centavos, forma: pedido.forma_pagamento, desconto_centavos: 0 };
    }

    let valor = linha.preco_total_centavos;
    let conta = null;
    if (pedido.classe_id !== null) {
        const classe = await consulta(admin.from('classes_desconto')
            .select('id, percentual_pista, percentual_aluguel, percentual_municao')
            .eq('id', pedido.classe_id).eq('ativo', true).maybeSingle());
        if (!classe) throw new ErroHttp(409, CLASSE_INDISPONIVEL);
        conta = descontoDeClasse(linha.preco_detalhe, classe, custoDaMunicao(linha));
        valor = conta.valor_cobrado_centavos;
    }
    if (pedido.valor_esperado_centavos !== valor) throw new ErroHttp(409, VALOR_MUDOU);

    return {
        valor_centavos: valor,
        forma: pedido.forma_pagamento,
        classe_id: pedido.classe_id,
        documento: pedido.documento,
        conta,
        desconto_centavos: conta?.desconto_centavos ?? 0,
    };
}

// Traduz os erros de fazer_check_in: a situação mudou (P0001, com a mensagem do banco), o agendamento
// não existe mais (P0002) ou um valor ficou fora das regras do banco (23514; a validação acima já pega
// esses casos, isto é só uma rede de segurança). Uma pista interditada depois do agendamento ainda não
// barra o check-in (o gatilho só confere a pista quando o horário ou a pista mudam); fica para a fase
// de interdição.
function erroDoCheckIn(error) {
    if (error.code === 'P0001') throw new ErroHttp(409, error.message);
    if (error.code === 'P0002') throw new ErroHttp(404, NAO_ENCONTRADO);
    if (error.code === '23514') throw new ErroHttp(400, REVISE);
    throw error;
}

async function fazerCheckIn(corpo, contexto) {
    const { acao: _acao, id, ...dados } = corpo;
    const linha = await lerAgendamento(typeof id === 'string' ? id.trim() : '');

    const fuso = await fusoDoEstande();
    const motivo = motivoSemCheckIn(linha, { hoje: dataNoFuso(new Date(), fuso), fuso });
    if (motivo) throw new ErroHttp(409, motivo);

    const { campos, valores } = validarCheckIn(dados, {
        situacao: linha.situacao, temPreco: linha.preco_detalhe != null,
    });
    if (Object.keys(campos).length > 0) return respostaJson(400, { erro: REVISE, campos });

    const pagamento = valores.pagamento === null ? null : await montarPagamento(linha, valores.pagamento);
    const { data, error } = await admin.rpc('fazer_check_in', {
        p_agendamento: linha.id, p_pagamento: pagamento, p_autor: contexto.usuarioId,
    });
    if (error) erroDoCheckIn(error);
    return respostaJson(200, { agendamento: { id: data.id, situacao: data.situacao } });
}

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET' && req.method !== 'POST') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    exigirPapel(contexto, 'atendente');

    if (req.method === 'POST') {
        const corpo = await lerCorpo(req);
        if (typeof corpo !== 'object' || Array.isArray(corpo) || corpo.acao !== 'check_in') {
            throw new ErroHttp(400, 'Esta ação não existe.');
        }
        return fazerCheckIn(corpo, contexto);
    }

    const params = new URL(req.url).searchParams;
    // Um id vazio conta como ausente (?id=&area=recepcao devolve a lista).
    const id = (params.get('id') ?? '').trim();
    if (id) return detalhar(id, contexto);
    if (params.get('area') === 'recepcao') return listarRecepcao();
    throw new ErroHttp(400, 'Escolha uma área da operação.');
}));
