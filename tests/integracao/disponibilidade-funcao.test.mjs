// tests/integracao/disponibilidade-funcao.test.mjs
// GET agendamentos?ver=disponibilidade: pistas e instrutores livres por hora, para a agenda visual.
// O banco de desenvolvimento pode ter outros dados, então os testes conferem só o que foi criado aqui.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, funcao, marcador, criarUsuario, criar, apagarTudoCriado, anotarAgendamento, diaAbertoDeTeste, definirPrecosDeTeste,
} from './apoio.mjs';
import { validarPedido } from '../../supabase/functions/_shared/agendamento.mjs';
import { calcularPreco } from '../../supabase/functions/_shared/precos.mjs';

let restaurarPrecos = null;
after(async () => {
    const falhas = [];
    for (const passo of [restaurarPrecos, apagarTudoCriado].filter(Boolean)) {
        try { await passo(); } catch (erro) { falhas.push(erro.message); }
    }
    if (falhas.length) throw new Error(falhas.join('\n'));
});

const NAO_ENCONTRADO = { erro: 'Não encontramos este agendamento.' };

let cliente, outroCliente, modelo, tipoMunicao, pista, dia, opcoes;
let proximo = 0;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    outroCliente = await criarUsuario({ papeis: ['cliente'] });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Livre' });
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    pista = await criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
    restaurarPrecos = await definirPrecosDeTeste({
        modelos: [{ id: modelo.id, preco: 3000 }],
        tiposMunicao: [{ id: tipoMunicao.id, preco: 250 }],
    });
    dia = await diaAbertoDeTeste(3, 10);
    // Cada reserva dos testes usa 2 horas do dia (5 reservas = 10 horas).
    assert.ok(dia.horas.length >= 10, `o dia de teste precisa de pelo menos 10 horários: ${JSON.stringify(dia)}`);
    const r = await funcao('agendamentos?ver=opcoes', { token: cliente.token });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    opcoes = r.dados;
});

const ver = (consulta = '', token = cliente.token) => funcao(`agendamentos?ver=disponibilidade${consulta}`, { token });

// Reserva 2 horas, a partir da primeira hora do dia de teste, com um instrutor só deste teste.
async function reservar(token = cliente.token) {
    const instrutor = await criarUsuario({ papeis: ['instrutor'] });
    const h = dia.horas[proximo]; proximo += 2;
    const corpo = {
        data: dia.data, hora: h, horas: 2, instrutor_id: instrutor.id,
        participantes: [{ modalidade: 'estande', modelo_id: modelo.id, tipo_municao_id: tipoMunicao.id, municao_qtd: 50 }],
    };
    const { campos, pedido } = validarPedido(corpo, { agora: new Date(), opcoes });
    assert.deepStrictEqual(Object.keys(campos).filter((c) => c !== 'instrutor_id'), []);
    const preco = calcularPreco(pedido, opcoes.precos, { hoje: opcoes.hoje, fuso: opcoes.estande.fuso });
    const r = await funcao('agendamentos', { metodo: 'POST', token, corpo: { ...corpo, preco_esperado_centavos: preco.total_centavos } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    anotarAgendamento(r.dados.agendamento.id);
    return { instrutor, h, id: r.dados.agendamento.id };
}

test('sem login recebe 401', async () => {
    const r = await funcao('agendamentos?ver=disponibilidade');
    assert.strictEqual(r.status, 401, JSON.stringify(r.dados));
});

test('usuário sem cadastro recebe 404', async () => {
    const u = await criarUsuario({ perfil: false });
    const r = await ver('', u.token);
    assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, { erro: 'Não encontramos o seu cadastro. Procure o atendimento do estande.' });
});

test('traz todos os dias de hoje até a antecedência máxima, e as horas de funcionamento', async () => {
    const r = await ver();
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.hoje, opcoes.hoje);
    assert.strictEqual(Object.keys(r.dados.dias).length, opcoes.agenda.antecedencia_maxima_dias + 1);
    assert.deepStrictEqual(Object.keys(r.dados.dias[dia.data]), dia.horas.map(String));
    assert.strictEqual(r.dados.agendamento, null);
    // Pista e instrutores de teste livres numa hora sem reservas.
    const livre = r.dados.dias[dia.data][dia.horas[dia.horas.length - 1]];
    assert.ok(livre.pistas.includes(pista.id), JSON.stringify(livre));
});

test('instrutor reservado sai das horas da reserva', async () => {
    const { instrutor, h } = await reservar();
    const r = await ver();
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    for (const hora of [h, h + 1]) assert.ok(!r.dados.dias[dia.data][hora].instrutores.includes(instrutor.id), `hora ${hora}`);
});

test('com agendamento=<id> do próprio cliente, as reservas dele voltam a aparecer', async () => {
    const { instrutor, h, id } = await reservar();
    const r = await ver(`&agendamento=${id}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(r.dados.dias[dia.data][h].instrutores.includes(instrutor.id));
    assert.deepStrictEqual(r.dados.agendamento, { instrutor_escolhido_id: instrutor.id, participantes: 1, instrutores: 1 });
});

test('com agendamento=<id>, a resposta traz instrutores igual às reservas de instrutor ativas do agendamento', async () => {
    // Com 1 participante as faixas dariam 1 instrutor: a reserva extra ativa mostra que o número vem das
    // reservas gravadas, e a inativa, que só as ativas contam.
    const { id } = await reservar();
    const extra = await criarUsuario({ papeis: ['instrutor'] });
    await criar('agendamento_instrutores', { agendamento_id: id, instrutor_id: extra.id, principal: false });
    // O gatilho a_copiar_periodo grava a reserva como ativa (o agendamento está ativo); depois ela é desativada.
    const inativo = await criarUsuario({ papeis: ['instrutor'] });
    const desativada = await criar('agendamento_instrutores', { agendamento_id: id, instrutor_id: inativo.id, principal: false });
    const d = await rest(`agendamento_instrutores?id=eq.${desativada.id}`, { metodo: 'PATCH', corpo: { ativo: false } });
    assert.strictEqual(d.status, 200, JSON.stringify(d.dados));
    assert.strictEqual(d.dados[0].ativo, false, JSON.stringify(d.dados));
    const r = await ver(`&agendamento=${id}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.agendamento.instrutores, 2);
});

test('agendamento de outro cliente, cancelado ou id inválido recebe 404', async () => {
    const { id } = await reservar();
    const deOutro = await ver(`&agendamento=${id}`, outroCliente.token);
    assert.strictEqual(deOutro.status, 404, JSON.stringify(deOutro.dados));
    assert.deepStrictEqual(deOutro.dados, NAO_ENCONTRADO);

    const cancelar = await funcao('agendamentos', { metodo: 'PUT', token: cliente.token, corpo: { id, acao: 'cancelar' } });
    assert.strictEqual(cancelar.status, 200, JSON.stringify(cancelar.dados));
    const cancelado = await ver(`&agendamento=${id}`);
    assert.strictEqual(cancelado.status, 404, JSON.stringify(cancelado.dados));
    assert.deepStrictEqual(cancelado.dados, NAO_ENCONTRADO);

    for (const invalido of ['abc', '00000000-0000-0000-0000-000000000000']) {
        const r = await ver(`&agendamento=${invalido}`);
        assert.strictEqual(r.status, 404, `${invalido}: ${JSON.stringify(r.dados)}`);
        assert.deepStrictEqual(r.dados, NAO_ENCONTRADO);
    }
});

test('a resposta não traz número de pista, registro de arma nem CPF', async () => {
    const { id } = await reservar();
    const r = await ver(`&agendamento=${id}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const texto = JSON.stringify(r.dados);
    for (const segredo of [String(pista.numero), 'REG-', 'numero_registro', cliente.cpf].filter(Boolean)) {
        assert.ok(!texto.includes(segredo), segredo);
    }
});
