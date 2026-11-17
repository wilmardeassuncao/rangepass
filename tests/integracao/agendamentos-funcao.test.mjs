// tests/integracao/agendamentos-funcao.test.mjs
// A função agendamentos: opções do formulário, lista, criar, alterar o horário e cancelar.
// O banco de desenvolvimento pode ter outros dados (pistas, instrutores, modelos), então os testes
// não supõem que só existem os recursos criados aqui. Cada teste que agenda usa um instrutor próprio
// e uma hora diferente das dos outros testes.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, funcao, marcador, cpfAleatorio, criarUsuario, criar, apagarTudoCriado, anotarAgendamento, diaAbertoDeTeste,
    definirPrecosDeTeste, gravarPrecosDaConfiguracao,
} from './apoio.mjs';
import { erroDeReserva, instanteNoFuso, validarPedido } from '../../supabase/functions/_shared/agendamento.mjs';
import { dataNoFuso } from '../../supabase/functions/_shared/cadastro.mjs';
import { calcularPreco } from '../../supabase/functions/_shared/precos.mjs';

// Os testes apagam tudo o que criam: agendamentos (com reservas e histórico), catálogo e usuários,
// e devolvem a linha configuracoes.precos exatamente como estava.
let restaurarPrecos = null;
after(async () => {
    const falhas = [];
    for (const passo of [restaurarPrecos, apagarTudoCriado].filter(Boolean)) {
        try { await passo(); } catch (erro) { falhas.push(erro.message); }
    }
    if (falhas.length) throw new Error(falhas.join('\n'));
});

const NAO_ENCONTRADO = { erro: 'Não encontramos este agendamento.' };
const ILEGIVEL = { erro: 'Não foi possível ler os dados enviados. Tente de novo.' };
const PRECO_MUDOU = 'O preço mudou desde que você abriu a revisão. Confira o novo valor e confirme de novo.';
const PRECO_MODELO = 3000;
const PRECO_MUNICAO = 250;

let cliente, outroCliente, modelo, modeloManutencao, modeloSemPreco, tipoMunicao, tipoSemPreco, calibre, dia, dia2, fuso;
let proximaHora = 0;
let proximaHora2 = 0;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    outroCliente = await criarUsuario({ papeis: ['cliente'] });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Livre' });
    modeloManutencao = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Parado' });
    modeloSemPreco = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Sem Preço' });
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });
    await criar('unidades_arma', { modelo_id: modeloManutencao.id, numero_registro: `REG-${marcador()}`, situacao: 'manutencao' });
    await criar('unidades_arma', { modelo_id: modeloSemPreco.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    tipoSemPreco = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição Sem Preço ${marcador()}` });
    for (let i = 0; i < 2; i++) await criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
    restaurarPrecos = await definirPrecosDeTeste({
        modelos: [{ id: modelo.id, preco: PRECO_MODELO }, { id: modeloManutencao.id, preco: PRECO_MODELO }],
        tiposMunicao: [{ id: tipoMunicao.id, preco: PRECO_MUNICAO }],
    });

    dia = await diaAbertoDeTeste(3);
    assert.ok(dia.horas.length >= 9, `o dia de teste precisa de pelo menos 9 horários: ${JSON.stringify(dia)}`);
    // Um segundo dia, para os testes de preço (o modelo de teste tem uma única arma).
    for (let n = 4; !dia2; n++) {
        const d = await diaAbertoDeTeste(n);
        if (d.data !== dia.data && d.horas.length >= 12) dia2 = d;
    }
    const opcoes = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(opcoes.status, 200, JSON.stringify(opcoes.dados));
    fuso = opcoes.dados.estande.fuso;
});

// Uma hora do dia de teste que nenhum outro teste usa.
function horaLivre() {
    return dia.horas[proximaHora++];
}

// O mesmo, no segundo dia.
function horaLivre2() {
    return dia2.horas[proximaHora2++];
}

function participanteEstande(extra = {}) {
    return { modalidade: 'estande', modelo_id: modelo.id, tipo_municao_id: tipoMunicao.id, municao_qtd: 50, ...extra };
}

function pedido(instrutor, hora, extra = {}) {
    return { data: dia.data, hora, horas: 1, instrutor_id: instrutor.id, participantes: [participanteEstande()], ...extra };
}

// O preço que o navegador mostraria agora na revisão: as opções do servidor e o mesmo cálculo.
async function precoAgora(corpo, token = cliente.token) {
    const r = await funcao('agendamentos?ver=opcoes', { token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const opcoes = r.dados;
    const { campos, pedido: normalizado } = validarPedido(corpo, { agora: new Date(), opcoes });
    const semInstrutor = Object.keys(campos).filter((c) => c !== 'instrutor_id');
    if (semInstrutor.length) return null;
    return calcularPreco(normalizado, opcoes.precos, { hoje: opcoes.hoje, fuso: opcoes.estande.fuso });
}

// O corpo com o preco_esperado_centavos que o navegador mandaria (0 quando o pedido nem é válido).
async function comPreco(corpo, token) {
    if (Object.hasOwn(corpo, 'preco_esperado_centavos')) return corpo;
    const preco = await precoAgora(corpo, token);
    return { ...corpo, preco_esperado_centavos: preco ? preco.total_centavos : 0 };
}

// PUT alterar_horario com o preço esperado calculado como o navegador faria (o pedido original com o horário novo).
async function alterarHorario(ag, corpoOriginal, novo, extra = {}) {
    const preco = await precoAgora({ ...corpoOriginal, ...novo });
    return funcao('agendamentos', {
        metodo: 'PUT', token: cliente.token,
        corpo: { id: ag.id, acao: 'alterar_horario', ...novo, preco_esperado_centavos: preco.total_centavos, ...extra },
    });
}

async function precoGravado(id) {
    const r = await rest(`agendamentos?id=eq.${id}&select=preco_total_centavos,preco_detalhe`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados[0];
}

async function mudarPrecoDoModelo(id, preco) {
    const r = await rest(`modelos?id=eq.${id}`, { metodo: 'PATCH', corpo: { preco_hora_centavos: preco } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
}

// POST do corpo como está; se criar, anota o id para apagar no fim.
async function postar(corpo, token = cliente.token) {
    const r = await funcao('agendamentos', { metodo: 'POST', corpo, token });
    if (r.status === 201 && r.dados?.agendamento?.id) anotarAgendamento(r.dados.agendamento.id);
    return r;
}

// POST com o preço esperado (se o corpo não trouxer um).
async function agendar(corpo, token = cliente.token) {
    return postar(await comPreco(corpo, token), token);
}

async function agendarOk(corpo, token) {
    const r = await agendar(corpo, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    return r.dados.agendamento;
}

function novoInstrutor() {
    return criarUsuario({ papeis: ['instrutor'] });
}

async function nomeDe(usuario) {
    const r = await funcao('minha-conta', { token: usuario.token });
    return r.dados.perfil.nome_completo;
}

// extras: outros textos que não podem aparecer (por exemplo, o CPF de um convidado).
function semSegredos(dados, extras = []) {
    const texto = JSON.stringify(dados);
    for (const segredo of ['numero_registro', 'REG-', ...extras]) assert.ok(!texto.includes(segredo), `${segredo}: ${texto}`);
}

const CHAVES_ITEM = ['forma_pagamento', 'horas', 'id', 'inicio', 'instrutores', 'participantes', 'pode_alterar',
    'prazo_alteracao_horas', 'preco', 'situacao'];
const CHAVES_PARTICIPANTE = ['arma_propria', 'modalidade', 'modelo', 'municao_qtd', 'nome_completo', 'tipo_municao'];

// O Item tem exatamente as chaves combinadas, e cada participante também.
function soChavesDoItem(item) {
    assert.deepStrictEqual(Object.keys(item).sort(), CHAVES_ITEM);
    for (const p of item.participantes) assert.deepStrictEqual(Object.keys(p).sort(), CHAVES_PARTICIPANTE);
}

test('opções trazem o termo, os instrutores e só modelos com arma disponível', async () => {
    const instrutor = await novoInstrutor();
    const r = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.termo.versao, 1);
    assert.ok(r.dados.termo.texto, JSON.stringify(r.dados.termo));
    const ids = r.dados.catalogo.modelos.map(m => m.id);
    assert.ok(ids.includes(modelo.id), JSON.stringify(ids));
    assert.ok(!ids.includes(modeloManutencao.id), JSON.stringify(ids));
    assert.ok(r.dados.catalogo.tipos_municao.some(t => t.id === tipoMunicao.id));
    assert.ok(r.dados.instrutores.some(i => i.id === instrutor.id), JSON.stringify(r.dados.instrutores));
    for (const i of r.dados.instrutores) assert.deepStrictEqual(Object.keys(i).sort(), ['id', 'nome']);
    assert.deepStrictEqual(Object.keys(r.dados.responsavel).sort(), ['cpf', 'data_nascimento', 'id', 'nome_completo']);
    assert.strictEqual(r.dados.responsavel.id, cliente.id);
    semSegredos(r.dados);
});

test('opções trazem a tabela de preços: só itens com preço, campanhas e pacotes vigentes hoje', async () => {
    const hoje = dataNoFuso(new Date(), fuso);
    const somar = (n) => {
        const d = new Date(`${hoje}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    };
    const regra = await criar('regras_preco', { nome: `Regra ${marcador()}`, dias: [1, 2], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20, prioridade: 1 });
    const regraInativa = await criar('regras_preco', { nome: `Regra ${marcador()}`, dias: [1], hora_inicio: '08:00', hora_fim: '09:00', percentual: 10, ativo: false });
    const vigente = await criar('campanhas', { nome: `Campanha ${marcador()}`, percentual: 1, inicio: hoje, fim: hoje });
    const vencida = await criar('campanhas', { nome: `Campanha ${marcador()}`, percentual: 1, inicio: somar(-5), fim: somar(-1) });
    const futura = await criar('campanhas', { nome: `Campanha ${marcador()}`, percentual: 1, inicio: somar(1), fim: somar(5) });
    const inativa = await criar('campanhas', { nome: `Campanha ${marcador()}`, percentual: 1, inicio: hoje, fim: hoje, ativo: false });
    const pacote = await criar('pacotes', { nome: `Pacote ${marcador()}`, inicio: somar(-1), fim: hoje, preco_centavos: 999999, horas: 1, modelo_id: modelo.id });
    const pacoteVencido = await criar('pacotes', { nome: `Pacote ${marcador()}`, inicio: somar(-3), fim: somar(-1), preco_centavos: 999999, horas: 1 });

    const r = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const { precos } = r.dados;
    assert.strictEqual(r.dados.hoje, hoje);
    assert.deepStrictEqual(Object.keys(precos).sort(), ['campanhas', 'hora_pista_centavos', 'modelos', 'pacotes', 'regras', 'tipos_municao']);
    assert.ok(Number.isInteger(precos.hora_pista_centavos), JSON.stringify(precos));
    assert.strictEqual(precos.modelos[modelo.id], PRECO_MODELO);
    assert.strictEqual(precos.tipos_municao[tipoMunicao.id], PRECO_MUNICAO);
    assert.ok(!Object.hasOwn(precos.modelos, modeloSemPreco.id), JSON.stringify(precos.modelos));
    assert.ok(!Object.hasOwn(precos.tipos_municao, tipoSemPreco.id), JSON.stringify(precos.tipos_municao));

    const daRegra = precos.regras.find(x => x.hora_inicio === '18:00' && x.percentual === 20 && x.prioridade === 1 && x.dias.join() === '1,2');
    assert.deepStrictEqual(daRegra, { dias: [1, 2], hora_inicio: '18:00', hora_fim: '23:00', percentual: 20, prioridade: 1 });
    for (const x of precos.regras) assert.match(`${x.hora_inicio} ${x.hora_fim}`, /^\d\d:\d\d \d\d:\d\d$/);
    assert.ok(regra.id && regraInativa.id);
    assert.strictEqual(precos.regras.filter(x => x.hora_inicio === '08:00' && x.hora_fim === '09:00' && x.percentual === 10 && x.dias.join() === '1').length,
        0, 'regra inativa não entra');

    const campanhas = precos.campanhas.map(c => c.id);
    assert.ok(campanhas.includes(vigente.id), JSON.stringify(precos.campanhas));
    for (const c of [vencida, futura, inativa]) assert.ok(!campanhas.includes(c.id), JSON.stringify(precos.campanhas));
    assert.deepStrictEqual(precos.campanhas.find(c => c.id === vigente.id),
        { id: vigente.id, nome: vigente.nome, percentual: 1, inicio: hoje, fim: hoje });
    const pacotes = precos.pacotes.map(p => p.id);
    assert.ok(pacotes.includes(pacote.id), JSON.stringify(precos.pacotes));
    assert.ok(!pacotes.includes(pacoteVencido.id), JSON.stringify(precos.pacotes));
    assert.deepStrictEqual(precos.pacotes.find(p => p.id === pacote.id), {
        id: pacote.id, nome: pacote.nome, inicio: somar(-1), fim: hoje, preco_centavos: 999999, horas: 1,
        modelo_id: modelo.id, tipo_municao_id: null, municao_qtd: null,
    });

    // As promoções criadas aqui saem já, para não mexer no preço dos outros testes.
    for (const [tabela, linha] of [['regras_preco', regra], ['regras_preco', regraInativa], ['campanhas', vigente], ['campanhas', vencida],
        ['campanhas', futura], ['campanhas', inativa], ['pacotes', pacote], ['pacotes', pacoteVencido]]) {
        const d = await rest(`${tabela}?id=eq.${linha.id}`, { metodo: 'DELETE' });
        assert.ok(d.status < 300, JSON.stringify(d.dados));
    }
});

test('modelo e munição sem preço ficam fora das opções; pedido com o modelo sem preço recebe 400', async () => {
    const r = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(!r.dados.catalogo.modelos.some(m => m.id === modeloSemPreco.id), JSON.stringify(r.dados.catalogo.modelos));
    assert.ok(!r.dados.catalogo.tipos_municao.some(t => t.id === tipoSemPreco.id), JSON.stringify(r.dados.catalogo.tipos_municao));
    assert.ok(r.dados.catalogo.modelos.some(m => m.id === modelo.id));

    const p = await agendar(pedido({ id: null }, dia.horas[0], {
        participantes: [participanteEstande({ modelo_id: modeloSemPreco.id })], preco_esperado_centavos: 0,
    }));
    assert.strictEqual(p.status, 400, JSON.stringify(p.dados));
    assert.strictEqual(p.dados.campos['participantes.0.modelo_id'], 'Escolha uma arma da lista.');

    const m = await agendar(pedido({ id: null }, dia.horas[0], {
        participantes: [participanteEstande({ tipo_municao_id: tipoSemPreco.id })], preco_esperado_centavos: 0,
    }));
    assert.strictEqual(m.status, 400, JSON.stringify(m.dados));
    assert.strictEqual(m.dados.campos['participantes.0.tipo_municao_id'], 'Escolha a munição da lista.');
});

test('preco_esperado_centavos ausente ou inválido recebe 400', async () => {
    for (const preco of [undefined, null, -1, 1.5, '38500', {}]) {
        const corpo = { ...pedido({ id: null }, dia.horas[0]), preco_esperado_centavos: preco };
        if (preco === undefined) delete corpo.preco_esperado_centavos;
        const r = await postar(corpo);
        assert.strictEqual(r.status, 400, `${JSON.stringify(preco)}: ${JSON.stringify(r.dados)}`);
        assert.deepStrictEqual(r.dados, ILEGIVEL);
    }
});

test('POST com o preço certo grava o total e o detalhe; o Item traz o preço', async () => {
    const corpo = pedido(await novoInstrutor(), horaLivre2(), { data: dia2.data, horas: 2 });
    const preco = await precoAgora(corpo);
    assert.ok(preco.total_centavos > 0, JSON.stringify(preco));
    const ag = await agendarOk({ ...corpo, preco_esperado_centavos: preco.total_centavos });
    proximaHora2++; // a sessão tem 2 horas
    assert.deepStrictEqual(ag.preco, { total_centavos: preco.total_centavos, desconto: preco.desconto });
    assert.deepStrictEqual(await precoGravado(ag.id), { preco_total_centavos: preco.total_centavos, preco_detalhe: preco });
    // Aluguel e munição do modelo de teste: 2 horas × 3.000 e 50 × 250.
    assert.deepStrictEqual(preco.itens.slice(1), [
        { descricao: 'Aluguel de armas', total_centavos: 2 * PRECO_MODELO },
        { descricao: 'Munição', total_centavos: 50 * PRECO_MUNICAO },
    ]);
    soChavesDoItem(ag);
});

test('preço mudado entre a revisão e o POST recebe 409 com o preço novo, e nada é gravado', async () => {
    const hora = horaLivre2();
    const corpo = pedido(await novoInstrutor(), hora, { data: dia2.data });
    const visto = await precoAgora(corpo);
    await mudarPrecoDoModelo(modelo.id, PRECO_MODELO + 1000);
    try {
        const novo = await precoAgora(corpo);
        assert.strictEqual(novo.total_centavos, visto.total_centavos + 1000);
        const r = await agendar({ ...corpo, preco_esperado_centavos: visto.total_centavos });
        assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
        assert.deepStrictEqual(r.dados, { erro: PRECO_MUDOU, preco: novo });

        const gravados = await rest(`agendamentos?responsavel_id=eq.${cliente.id}&select=id,inicio`);
        const inicio = instanteNoFuso(dia2.data, hora, fuso).getTime();
        assert.deepStrictEqual(gravados.dados.filter(a => Date.parse(a.inicio) === inicio), []);
    } finally {
        await mudarPrecoDoModelo(modelo.id, PRECO_MODELO);
    }
});

test('o agendamento mantém o preço depois que o preço do modelo muda; alterar o horário recalcula', async () => {
    const corpo = pedido(await novoInstrutor(), horaLivre2(), { data: dia2.data });
    const ag = await agendarOk(corpo);
    const original = await precoGravado(ag.id);
    assert.ok(original.preco_total_centavos > 0, JSON.stringify(original));

    await mudarPrecoDoModelo(modelo.id, PRECO_MODELO + 2000);
    try {
        const lista = await funcao('agendamentos', { token: cliente.token });
        assert.strictEqual(lista.dados.agendamentos.find(a => a.id === ag.id).preco.total_centavos, original.preco_total_centavos);
        assert.deepStrictEqual(await precoGravado(ag.id), original);

        // Com o preço antigo: 409 com o novo, e nada muda.
        const nova = horaLivre2();
        const novoHorario = { data: dia2.data, hora: nova, horas: 1 };
        const esperado = await precoAgora({ ...corpo, ...novoHorario });
        assert.strictEqual(esperado.total_centavos, original.preco_total_centavos + 2000);
        const velho = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token,
            corpo: { id: ag.id, acao: 'alterar_horario', ...novoHorario, preco_esperado_centavos: original.preco_total_centavos },
        });
        assert.strictEqual(velho.status, 409, JSON.stringify(velho.dados));
        assert.deepStrictEqual(velho.dados, { erro: PRECO_MUDOU, preco: esperado });
        const semMudar = await rest(`agendamentos?id=eq.${ag.id}&select=inicio`);
        assert.strictEqual(Date.parse(semMudar.dados[0].inicio), Date.parse(ag.inicio));

        // Preço esperado inválido: 400.
        const invalido = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token, corpo: { id: ag.id, acao: 'alterar_horario', ...novoHorario, preco_esperado_centavos: '1' },
        });
        assert.strictEqual(invalido.status, 400, JSON.stringify(invalido.dados));
        assert.deepStrictEqual(invalido.dados, ILEGIVEL);

        // Com o preço novo: grava o horário e o preço recalculado.
        const r = await alterarHorario(ag, corpo, novoHorario);
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
        assert.strictEqual(Date.parse(r.dados.agendamento.inicio), instanteNoFuso(dia2.data, nova, fuso).getTime());
        assert.deepStrictEqual(r.dados.agendamento.preco, { total_centavos: esperado.total_centavos, desconto: esperado.desconto });
        assert.deepStrictEqual(await precoGravado(ag.id), { preco_total_centavos: esperado.total_centavos, preco_detalhe: esperado });

        // O modelo do agendamento ficou sem preço: não dá para recalcular, então 409.
        await mudarPrecoDoModelo(modelo.id, null);
        const semPreco = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token,
            corpo: { id: ag.id, acao: 'alterar_horario', data: dia2.data, hora: horaLivre2(), horas: 1, preco_esperado_centavos: 0 },
        });
        assert.strictEqual(semPreco.status, 409, JSON.stringify(semPreco.dados));
        assert.deepStrictEqual(semPreco.dados, { erro: 'Os preços deste agendamento mudaram. Fale com o estande para alterar o horário.' });
    } finally {
        await mudarPrecoDoModelo(modelo.id, PRECO_MODELO);
    }
});

test('sem o preço da hora de pista, alterar o horário recebe 409 e nada muda', async () => {
    const corpo = pedido(await novoInstrutor(), horaLivre2(), { data: dia2.data });
    const ag = await agendarOk(corpo);
    const novoHorario = { data: dia2.data, hora: horaLivre2(), horas: 1 };
    const esperado = await precoAgora({ ...corpo, ...novoHorario });
    const atual = (await rest('configuracoes?chave=eq.precos&select=valor')).dados[0].valor;
    await gravarPrecosDaConfiguracao({ ...atual, hora_pista_centavos: null });
    try {
        const r = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token,
            corpo: { id: ag.id, acao: 'alterar_horario', ...novoHorario, preco_esperado_centavos: esperado.total_centavos },
        });
        assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
        assert.deepStrictEqual(r.dados, { erro: 'O estande ainda não definiu os preços. Tente de novo mais tarde.' });
        const semMudar = await rest(`agendamentos?id=eq.${ag.id}&select=inicio`);
        assert.strictEqual(Date.parse(semMudar.dados[0].inicio), Date.parse(ag.inicio));
    } finally {
        await gravarPrecosDaConfiguracao(atual);
    }
});

test('modelo do agendamento desativado, com a arma disponível: alterar o horário dá certo com o preço recalculado', async () => {
    const corpo = pedido(await novoInstrutor(), horaLivre2(), { data: dia2.data });
    const ag = await agendarOk(corpo);
    const nova = horaLivre2();
    const novoHorario = { data: dia2.data, hora: nova, horas: 1 };
    // O preço que o cliente viu (o modelo some das opções quando é desativado; o preço dele não muda).
    const esperado = await precoAgora({ ...corpo, ...novoHorario });
    const d = await rest(`modelos?id=eq.${modelo.id}`, { metodo: 'PATCH', corpo: { ativo: false } });
    assert.strictEqual(d.status, 200, JSON.stringify(d.dados));
    try {
        const r = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token,
            corpo: { id: ag.id, acao: 'alterar_horario', ...novoHorario, preco_esperado_centavos: esperado.total_centavos },
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
        assert.strictEqual(Date.parse(r.dados.agendamento.inicio), instanteNoFuso(dia2.data, nova, fuso).getTime());
        assert.deepStrictEqual(await precoGravado(ag.id), { preco_total_centavos: esperado.total_centavos, preco_detalhe: esperado });
    } finally {
        const v = await rest(`modelos?id=eq.${modelo.id}`, { metodo: 'PATCH', corpo: { ativo: true } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
});

test('todas as armas do modelo em manutenção: alterar o horário dá o erro de arma livre, não o de preço', async () => {
    const corpo = pedido(await novoInstrutor(), horaLivre2(), { data: dia2.data });
    const ag = await agendarOk(corpo);
    const novoHorario = { data: dia2.data, hora: horaLivre2(), horas: 1 };
    const esperado = await precoAgora({ ...corpo, ...novoHorario });
    const unidades = (await rest(`unidades_arma?modelo_id=eq.${modelo.id}&select=id,situacao`)).dados;
    assert.ok(unidades.length > 0 && unidades.every(u => u.situacao === 'disponivel'), JSON.stringify(unidades));
    const m = await rest(`unidades_arma?modelo_id=eq.${modelo.id}`, { metodo: 'PATCH', corpo: { situacao: 'manutencao' } });
    assert.strictEqual(m.status, 200, JSON.stringify(m.dados));
    try {
        const r = await funcao('agendamentos', {
            metodo: 'PUT', token: cliente.token,
            corpo: { id: ag.id, acao: 'alterar_horario', ...novoHorario, preco_esperado_centavos: esperado.total_centavos },
        });
        assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
        assert.deepStrictEqual(r.dados, erroDeReserva('RP004').corpo);
    } finally {
        for (const u of unidades) {
            const v = await rest(`unidades_arma?id=eq.${u.id}`, { metodo: 'PATCH', corpo: { situacao: u.situacao } });
            assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
        }
    }
});

test('sem o preço da hora de pista, o POST recebe 409', async () => {
    const atual = (await rest('configuracoes?chave=eq.precos&select=valor')).dados[0].valor;
    await gravarPrecosDaConfiguracao({ ...atual, hora_pista_centavos: null });
    try {
        const r = await agendar(pedido(await novoInstrutor(), dia2.horas[0], { data: dia2.data, preco_esperado_centavos: 0 }));
        assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
        assert.deepStrictEqual(r.dados, { erro: 'O estande ainda não definiu os preços. Tente de novo mais tarde.' });
    } finally {
        await gravarPrecosDaConfiguracao(atual);
    }
});

test('sem login recebe 401', async () => {
    const r = await funcao('agendamentos');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('usuário sem cadastro recebe 404', async () => {
    const u = await criarUsuario({ perfil: false });
    const r = await funcao('agendamentos?ver=opcoes', { token: u.token });
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Não encontramos o seu cadastro. Procure o atendimento do estande.' });
});

test('pedido inválido recebe 400', async () => {
    const r = await agendar({ data: dia.data, hora: dia.horas[0], horas: 1, participantes: [] });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, 'Revise os campos destacados.');
    assert.ok(r.dados.campos.participantes, JSON.stringify(r.dados));
});

test('cria e aparece na lista', async () => {
    const instrutor = await novoInstrutor();
    const cpfConvidado = cpfAleatorio();
    const proprio = {
        modalidade: 'arma_propria', nome_completo: 'Convidado Teste da Silva', cpf: cpfConvidado, data_nascimento: '1990-01-01',
        tipo_municao_id: tipoMunicao.id, municao_qtd: 50, aceite_termo_versao: 1,
        arma_propria: { modelo: 'Glock G17', calibre: '9mm', numero_registro: `REG-${marcador()}`, responsavel: 'Convidado Teste' },
    };
    const r = await agendar(pedido(instrutor, horaLivre(), { forma_pagamento: 'app', participantes: [participanteEstande(), proprio] }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    const ag = r.dados.agendamento;
    assert.strictEqual(ag.situacao, 'aguardando_pagamento');
    assert.strictEqual(ag.forma_pagamento, 'balcao');
    assert.strictEqual(ag.participantes.length, 2);
    assert.deepStrictEqual(ag.participantes.find(p => p.modalidade === 'arma_propria').arma_propria, { modelo: 'Glock G17', calibre: '9mm' });
    soChavesDoItem(ag);
    semSegredos(r.dados, [cpfConvidado]);

    const lista = await funcao('agendamentos', { token: cliente.token });
    assert.strictEqual(lista.status, 200, JSON.stringify(lista.dados));
    const item = lista.dados.agendamentos.find(a => a.id === ag.id);
    assert.ok(item, JSON.stringify(lista.dados));
    assert.strictEqual(item.pode_alterar, true);
    assert.deepStrictEqual(item.instrutores, [await nomeDe(instrutor)]);
    assert.deepStrictEqual(item, ag);
    soChavesDoItem(item);
    semSegredos(lista.dados, [cpfConvidado]);
});

test('instrutor ocupado recebe 409', async () => {
    const instrutor = await novoInstrutor();
    const corpo = pedido(instrutor, horaLivre());
    await agendarOk(corpo);
    // Outro cliente: o mesmo cliente no mesmo horário daria RP006 (a mesma pessoa em dois agendamentos).
    const r = await agendar(corpo, outroCliente.token);
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, erroDeReserva('RP001').corpo);
});

test('outro cliente não vê nem mexe', async () => {
    const instrutor = await novoInstrutor();
    const ag = await agendarOk(pedido(instrutor, horaLivre()));

    const lista = await funcao('agendamentos', { token: outroCliente.token });
    assert.strictEqual(lista.status, 200, JSON.stringify(lista.dados));
    assert.ok(!lista.dados.agendamentos.some(a => a.id === ag.id));

    for (const id of [ag.id, crypto.randomUUID(), 'abc']) {
        const r = await funcao('agendamentos', { metodo: 'PUT', token: outroCliente.token, corpo: { id, acao: 'cancelar' } });
        assert.strictEqual(r.status, 404, `${id}: ${JSON.stringify(r.dados)}`);
        assert.deepStrictEqual(r.dados, NAO_ENCONTRADO);
    }
    const depois = await funcao('agendamentos', { token: cliente.token });
    assert.strictEqual(depois.dados.agendamentos.find(a => a.id === ag.id).situacao, 'aguardando_pagamento');
});

test('altera o horário', async () => {
    const instrutor = await novoInstrutor();
    const corpo = pedido(instrutor, horaLivre());
    const ag = await agendarOk(corpo);
    const nova = horaLivre();
    const r = await alterarHorario(ag, corpo, { data: dia.data, hora: nova, horas: 1 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.agendamento.id, ag.id);
    assert.strictEqual(Date.parse(r.dados.agendamento.inicio), instanteNoFuso(dia.data, nova, fuso).getTime());
    semSegredos(r.dados);
});

test('cancela, e cancelar de novo recebe 409', async () => {
    const instrutor = await novoInstrutor();
    const ag = await agendarOk(pedido(instrutor, horaLivre()));
    const cancelar = () => funcao('agendamentos', { metodo: 'PUT', token: cliente.token, corpo: { id: ag.id, acao: 'cancelar' } });

    const r = await cancelar();
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.agendamento.situacao, 'cancelado');
    assert.strictEqual(r.dados.agendamento.pode_alterar, false);

    const de_novo = await cancelar();
    assert.strictEqual(de_novo.status, 409, JSON.stringify(de_novo.dados));
    assert.deepStrictEqual(de_novo.dados, { erro: 'Este agendamento não pode mais ser alterado pelo app. Fale com o estande.' });
});

test('dentro do prazo recebe 403', async () => {
    const inicio = new Date(Date.now() + 2 * 3600000).toISOString();
    const ag = await criar('agendamentos', { responsavel_id: cliente.id, inicio, horas: 1, forma_pagamento: 'balcao' });
    const opcoes = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    const prazo = opcoes.dados.agenda.prazo_alteracao_horas;

    const r = await funcao('agendamentos', { metodo: 'PUT', token: cliente.token, corpo: { id: ag.id, acao: 'cancelar' } });
    assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: `Faltam menos de ${prazo} horas para o início. Para alterar ou cancelar, fale com o estande.` });
});

test('ação desconhecida recebe 400', async () => {
    const r = await funcao('agendamentos', { metodo: 'PUT', token: cliente.token, corpo: { id: crypto.randomUUID(), acao: 'apagar' } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Esta ação não existe.' });
});

test('mesma chave_envio devolve o mesmo agendamento', async () => {
    const instrutor = await novoInstrutor();
    const hora = horaLivre();
    const corpo = { ...pedido(instrutor, hora), chave_envio: crypto.randomUUID() };

    const primeiro = await agendar(corpo);
    assert.strictEqual(primeiro.status, 201, JSON.stringify(primeiro.dados));
    const segundo = await agendar(corpo);
    assert.strictEqual(segundo.status, 200, JSON.stringify(segundo.dados));
    assert.strictEqual(segundo.dados.agendamento.id, primeiro.dados.agendamento.id);
    soChavesDoItem(segundo.dados.agendamento);

    const r = await rest(`agendamentos?responsavel_id=eq.${cliente.id}&select=id,inicio`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const inicio = instanteNoFuso(dia.data, hora, fuso).getTime();
    const naqueleHorario = r.dados.filter(a => Date.parse(a.inicio) === inicio);
    assert.strictEqual(naqueleHorario.length, 1, JSON.stringify(naqueleHorario));
});

test('chave_envio inválida recebe 400', async () => {
    for (const chave_envio of ['abc', 123, {}]) {
        const r = await agendar({ ...pedido({ id: null }, dia.horas[0]), chave_envio });
        assert.strictEqual(r.status, 400, `${JSON.stringify(chave_envio)}: ${JSON.stringify(r.dados)}`);
        assert.deepStrictEqual(r.dados, { erro: 'Não foi possível ler os dados enviados. Tente de novo.' });
    }
});

test('chave_envio de outro cliente não devolve o agendamento dele', async () => {
    const chave_envio = crypto.randomUUID();
    const deA = await agendarOk({ ...pedido(await novoInstrutor(), horaLivre()), chave_envio });
    const listaAntes = await funcao('agendamentos', { token: cliente.token });
    assert.strictEqual(listaAntes.status, 200, JSON.stringify(listaAntes.dados));

    // Cada hora é usada uma vez só: o modelo de teste tem uma única arma.
    const r = await agendar({ ...pedido(await novoInstrutor(), horaLivre()), chave_envio }, outroCliente.token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    assert.notStrictEqual(r.dados.agendamento.id, deA.id);
    assert.ok(!JSON.stringify(r.dados).includes(deA.id), JSON.stringify(r.dados));

    const listaDepois = await funcao('agendamentos', { token: cliente.token });
    assert.strictEqual(listaDepois.status, 200, JSON.stringify(listaDepois.dados));
    assert.deepStrictEqual(listaDepois.dados, listaAntes.dados);
});
