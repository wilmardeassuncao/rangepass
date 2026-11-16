// tests/integracao/agendamentos-funcao.test.mjs
// A função agendamentos: opções do formulário, lista, criar, alterar o horário e cancelar.
// O banco de desenvolvimento pode ter outros dados (pistas, instrutores, modelos), então os testes
// não supõem que só existem os recursos criados aqui. Cada teste que agenda usa um instrutor próprio
// e uma hora diferente das dos outros testes.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, funcao, marcador, cpfAleatorio, criarUsuario, criar, apagarTudoCriado, anotarAgendamento, diaAbertoDeTeste,
} from './apoio.mjs';
import { erroDeReserva, instanteNoFuso } from '../../supabase/functions/_shared/agendamento.mjs';

// Os testes apagam tudo o que criam: agendamentos (com reservas e histórico), catálogo e usuários.
after(apagarTudoCriado);

const NAO_ENCONTRADO = { erro: 'Não encontramos este agendamento.' };

let cliente, outroCliente, modelo, modeloManutencao, tipoMunicao, dia, fuso;
let proximaHora = 0;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    outroCliente = await criarUsuario({ papeis: ['cliente'] });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Livre' });
    modeloManutencao = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Parado' });
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });
    await criar('unidades_arma', { modelo_id: modeloManutencao.id, numero_registro: `REG-${marcador()}`, situacao: 'manutencao' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    for (let i = 0; i < 2; i++) await criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });

    dia = await diaAbertoDeTeste(3);
    assert.ok(dia.horas.length >= 9, `o dia de teste precisa de pelo menos 9 horários: ${JSON.stringify(dia)}`);
    const opcoes = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(opcoes.status, 200, JSON.stringify(opcoes.dados));
    fuso = opcoes.dados.estande.fuso;
});

// Uma hora do dia de teste que nenhum outro teste usa.
function horaLivre() {
    return dia.horas[proximaHora++];
}

function participanteEstande(extra = {}) {
    return { modalidade: 'estande', modelo_id: modelo.id, tipo_municao_id: tipoMunicao.id, municao_qtd: 50, ...extra };
}

function pedido(instrutor, hora, extra = {}) {
    return { data: dia.data, hora, horas: 1, instrutor_id: instrutor.id, participantes: [participanteEstande()], ...extra };
}

// POST; se criar, anota o id para apagar no fim.
async function agendar(corpo, token = cliente.token) {
    const r = await funcao('agendamentos', { metodo: 'POST', corpo, token });
    if (r.status === 201 && r.dados?.agendamento?.id) anotarAgendamento(r.dados.agendamento.id);
    return r;
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
    'prazo_alteracao_horas', 'situacao'];
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
    const ag = await agendarOk(pedido(instrutor, horaLivre()));
    const nova = horaLivre();
    const r = await funcao('agendamentos', {
        metodo: 'PUT', token: cliente.token, corpo: { id: ag.id, acao: 'alterar_horario', data: dia.data, hora: nova, horas: 1 },
    });
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
