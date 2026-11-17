// tests/integracao/painel-agendamentos.test.mjs
// A Edge Function painel-agendamentos: a visão do administrativo (lista com filtros e detalhe com histórico).
// O banco de desenvolvimento tem dados de exemplo; os testes não supõem que só existem os criados aqui
// e não mudam nada deles. Tudo o que é criado aqui é apagado no fim, inclusive os acessos registrados.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { dataNoFuso } from '../../supabase/functions/_shared/cadastro.mjs';
import { instanteNoFuso } from '../../supabase/functions/_shared/agendamento.mjs';
import {
    rest, rpc, funcao, marcador, cpfAleatorio,
    criarUsuario, criar, apagarTudoCriado, anotarAgendamento, apagarAcessosDe,
} from './apoio.mjs';

let nomeDoCliente, administrativo, cliente, instrutor, modelo, tipoMunicao, unidade, agendamentoId, data, convidadoCpf;

after(async () => {
    const passos = [];
    if (administrativo) passos.push(() => apagarAcessosDe(administrativo.id));
    if (cliente) passos.push(() => apagarAcessosDe(cliente.id));
    passos.push(apagarTudoCriado);
    const falhas = [];
    for (const passo of passos) {
        try { await passo(); } catch (erro) { falhas.push(erro.message); }
    }
    if (falhas.length) throw new Error(falhas.join('\n'));
});

const ARMA = { modelo: 'Glock G17', calibre: '9mm', numero_registro: `SIG-${marcador()}`, responsavel: 'Convidado Teste' };

function somarDias(dia, n) {
    const d = new Date(`${dia}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

before(async () => {
    administrativo = await criarUsuario({ papeis: ['administrativo'] });
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutor = await criarUsuario({ papeis: ['instrutor'] });
    nomeDoCliente = (await rest(`perfis?id=eq.${cliente.id}&select=nome_completo`)).dados[0].nome_completo;
    await criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    unidade = await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });

    const config = await rest('configuracoes?chave=eq.estande&select=valor');
    const fuso = config.dados[0].valor.fuso;
    data = somarDias(dataNoFuso(new Date(), fuso), 3);
    convidadoCpf = cpfAleatorio();
    const pedido = {
        inicio: instanteNoFuso(data, 10, fuso).toISOString(), horas: 2, instrutor_id: instrutor.id, instrutores_necessarios: 1,
        participantes: [
            {
                nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', perfil_id: cliente.id,
                modalidade: 'estande', termo_versao: null, modelo_id: modelo.id,
                tipo_municao_id: tipoMunicao.id, municao_qtd: 50, arma_propria: null,
            },
            {
                nome_completo: 'Convidado Teste', cpf: convidadoCpf, data_nascimento: '1985-05-05', perfil_id: null,
                modalidade: 'arma_propria', termo_versao: 1, modelo_id: null,
                tipo_municao_id: tipoMunicao.id, municao_qtd: 30, arma_propria: ARMA,
            },
        ],
    };
    const r = await rpc('criar_agendamento', { p_responsavel: cliente.id, p_pedido: pedido });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    agendamentoId = r.dados;
    anotarAgendamento(agendamentoId);
});

function painel(token, consulta = '') {
    return funcao(`painel-agendamentos${consulta ? `?${consulta}` : ''}`, { token });
}

function periodo(extra = '') {
    return `de=${data}&ate=${data}${extra}`;
}

function achar(r) {
    return r.dados.agendamentos.find(a => a.id === agendamentoId);
}

test('sem login dá 401; cliente, instrutor e atendente dão 403', async () => {
    assert.strictEqual((await painel(null)).status, 401);
    const atendente = await criarUsuario({ papeis: ['atendente'] });
    for (const pessoa of [cliente, instrutor, atendente]) {
        const r = await painel(pessoa.token);
        assert.strictEqual(r.status, 403, JSON.stringify(r.dados));
    }
});

test('o administrativo vê o agendamento no período, com os dados da linha', async () => {
    const r = await painel(administrativo.token, periodo());
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(Array.isArray(r.dados.instrutores), JSON.stringify(r.dados));
    const linha = achar(r);
    assert.ok(linha, 'o agendamento deveria aparecer no período');
    assert.strictEqual(linha.horas, 2);
    assert.strictEqual(linha.situacao, 'aguardando_pagamento');
    // A lista não leva CPF nem e-mail do responsável: só nome e telefone (os dados completos ficam no detalhe).
    assert.deepStrictEqual(Object.keys(linha.responsavel).sort(), ['nome_completo', 'telefone']);
    assert.strictEqual(linha.responsavel.nome_completo, nomeDoCliente);
    assert.ok(!JSON.stringify(r.dados).includes(cliente.cpf), 'a lista não deveria conter o CPF do responsável');
    assert.strictEqual(linha.participantes_qtd, 2);
    assert.strictEqual(linha.instrutores.length, 1);
    assert.strictEqual(linha.pistas.length, 1);
    assert.deepStrictEqual(linha.armas, [{ modelo: `${modelo.marca} Modelo Teste`, numero_registro: unidade.numero_registro }]);
});

test('sem datas, o período padrão (hoje + 15 dias) traz o agendamento', async () => {
    const r = await painel(administrativo.token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.ok(achar(r));
});

test('situacao=cancelado não traz; instrutor_id do instrutor dele traz; busca pelo CPF traz', async () => {
    const cancelado = await painel(administrativo.token, periodo('&situacao=cancelado'));
    assert.strictEqual(cancelado.status, 200, JSON.stringify(cancelado.dados));
    assert.ok(!achar(cancelado));

    const doInstrutor = await painel(administrativo.token, periodo(`&instrutor_id=${instrutor.id}`));
    assert.strictEqual(doInstrutor.status, 200, JSON.stringify(doInstrutor.dados));
    assert.ok(achar(doInstrutor));
    assert.ok(doInstrutor.dados.agendamentos.every(a => a.id === agendamentoId), 'só o agendamento do instrutor de teste');

    const busca = await painel(administrativo.token, periodo(`&busca=${cliente.cpf}`));
    assert.strictEqual(busca.status, 200, JSON.stringify(busca.dados));
    assert.ok(achar(busca));
    assert.ok(busca.dados.agendamentos.every(a => a.responsavel.nome_completo === nomeDoCliente));

    const porEmail = await painel(administrativo.token, periodo(`&busca=${encodeURIComponent(cliente.email.toUpperCase())}`));
    assert.strictEqual(porEmail.status, 200, JSON.stringify(porEmail.dados));
    assert.ok(achar(porEmail));
});

async function buscasRegistradas() {
    const r = await rest(`acessos_dados?usuario_id=eq.${administrativo.id}&recurso=eq.painel.busca&select=registro&order=id`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    return r.dados.map(a => a.registro);
}

test('a lista com busca registra o acesso (painel.busca); sem busca, não registra', async () => {
    const antes = await buscasRegistradas();
    const semBusca = await painel(administrativo.token, periodo('&busca=%20%20'));
    assert.strictEqual(semBusca.status, 200, JSON.stringify(semBusca.dados));
    const outra = await painel(administrativo.token, periodo());
    assert.strictEqual(outra.status, 200, JSON.stringify(outra.dados));
    assert.deepStrictEqual(await buscasRegistradas(), antes, 'sem busca não registra acesso');

    const comBusca = await painel(administrativo.token, periodo(`&busca=${cliente.cpf}`));
    assert.strictEqual(comBusca.status, 200, JSON.stringify(comBusca.dados));
    assert.deepStrictEqual(await buscasRegistradas(), [...antes, cliente.cpf], 'uma linha painel.busca com o termo');
});

test('ate antes de de dá 400 com a mensagem', async () => {
    const r = await painel(administrativo.token, `de=${data}&ate=${somarDias(data, -1)}`);
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.deepStrictEqual(r.dados, {
        erro: 'Revise os campos destacados.',
        campos: { ate: 'Escolha um período de até 92 dias, com o fim depois do início.' },
    });
    const invalida = await painel(administrativo.token, 'de=2026-02-30&situacao=xyz&instrutor_id=abc');
    assert.strictEqual(invalida.status, 400, JSON.stringify(invalida.dados));
    assert.strictEqual(invalida.dados.campos.de, 'Use uma data válida.');
    assert.strictEqual(invalida.dados.campos.situacao, 'Escolha uma situação da lista.');
    assert.strictEqual(invalida.dados.campos.instrutor_id, 'Escolha um instrutor da lista.');
});

test('o detalhe traz participantes com CPF, nº de registro e histórico com autor, e registra o acesso', async () => {
    const r = await painel(administrativo.token, `id=${agendamentoId}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const ag = r.dados.agendamento;
    assert.strictEqual(ag.id, agendamentoId);
    assert.strictEqual(ag.participantes.length, 2);
    const convidado = ag.participantes.find(p => p.cpf === convidadoCpf);
    assert.ok(convidado, JSON.stringify(ag.participantes));
    assert.strictEqual(convidado.termo_versao, 1);
    assert.strictEqual(convidado.arma_propria.numero_registro, ARMA.numero_registro);
    assert.ok(ag.participantes.some(p => p.cpf === cliente.cpf));
    assert.strictEqual(ag.armas[0].numero_registro, unidade.numero_registro);

    const historico = r.dados.historico;
    const criacao = historico.find(h => h.tabela === 'agendamentos' && h.acao === 'insercao');
    assert.ok(criacao, JSON.stringify(historico));
    assert.match(criacao.autor, /^Teste /);
    assert.ok(historico.some(h => h.tabela === 'agendamento_unidades'), 'histórico das reservas também');
    for (let i = 1; i < historico.length; i++) assert.ok(historico[i - 1].em <= historico[i].em, 'em ordem de data');

    const acessos = await rest(`acessos_dados?usuario_id=eq.${administrativo.id}&recurso=eq.agendamento&select=registro`);
    assert.strictEqual(acessos.status, 200, JSON.stringify(acessos.dados));
    assert.deepStrictEqual(acessos.dados.map(a => a.registro), [agendamentoId]);
});

test('detalhe de id inválido ou inexistente dá 404 e não registra acesso', async () => {
    for (const id of ['abc', '00000000-0000-0000-0000-000000000000']) {
        const r = await painel(administrativo.token, `id=${id}`);
        assert.strictEqual(r.status, 404, JSON.stringify(r.dados));
        assert.strictEqual(r.dados.erro, 'Não encontramos este agendamento.');
    }
    const acessos = await rest(`acessos_dados?usuario_id=eq.${administrativo.id}&recurso=eq.agendamento&select=registro`);
    assert.ok(acessos.dados.every(a => a.registro === agendamentoId));
});

test('outros métodos dão 405', async () => {
    const r = await funcao('painel-agendamentos', { metodo: 'POST', corpo: {}, token: administrativo.token });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
});
