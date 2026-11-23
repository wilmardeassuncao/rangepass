// tests/integracao/vagas-banco.test.mjs
// A RPC vagas_por_hora: pistas e instrutores livres em cada hora. O banco de desenvolvimento pode ter
// outros dados, então os testes conferem só os ids criados aqui.
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import {
    rest, rpc, marcador, CHAVE_ANON,
    criarUsuario, criar, apagarTudoCriado, anotarAgendamento,
    banirUsuario, desbanirUsuario,
} from './apoio.mjs';

after(apagarTudoCriado);

let cliente, instrutorA, instrutorB, pistaA, pistaB, modelo, tipoMunicao;

before(async () => {
    cliente = await criarUsuario({ papeis: ['cliente'] });
    instrutorA = await criarUsuario({ papeis: ['instrutor'] });
    instrutorB = await criarUsuario({ papeis: ['instrutor'] });
    pistaA = await novaPista();
    pistaB = await novaPista();
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
    tipoMunicao = await criar('tipos_municao', { calibre_id: calibre.id, nome: `Munição ${marcador()}` });
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: `REG-${marcador()}`, situacao: 'disponivel' });
});

function novaPista() {
    return criar('pistas', { numero: 100000000 + Math.floor(Math.random() * 1000000000) });
}

// Cada teste usa um dia só dele, longe dos outros testes.
function hora(dia, h) {
    return `2031-${dia}T${String(h).padStart(2, '0')}:00:00-03:00`;
}

function maisHoras(inicio, n) {
    return new Date(new Date(inicio).getTime() + n * 3600000).toISOString();
}

// Chama vagas_por_hora e devolve um mapa { instante em ms: { pistas, instrutores } }.
async function vagas(inicios, ignorar = null) {
    const r = await rpc('vagas_por_hora', { p_inicios: inicios, p_ignorar: ignorar });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.length, inicios.length, JSON.stringify(r.dados));
    return Object.fromEntries(r.dados.map(l => [new Date(l.inicio).getTime(), l]));
}

const em = (mapa, inicio) => mapa[new Date(inicio).getTime()];

test('pista e instrutor criados aparecem livres numa hora sem reservas', async () => {
    const h = hora('03-04', 10);
    const l = em(await vagas([h]), h);
    for (const p of [pistaA.id, pistaB.id]) assert.ok(l.pistas.includes(p), JSON.stringify(l.pistas));
    for (const i of [instrutorA.id, instrutorB.id]) assert.ok(l.instrutores.includes(i), JSON.stringify(l.instrutores));
    // Em ordem crescente.
    assert.deepStrictEqual(l.pistas, [...l.pistas].sort((a, b) => a - b));
    assert.deepStrictEqual(l.instrutores, [...l.instrutores].sort());
});

test('pista interditada na hora não aparece', async () => {
    const h = hora('03-05', 10);
    const h2 = hora('03-05', 11);
    await criar('interdicoes', { pista_id: pistaA.id, periodo: `[${h},${h2})`, motivo: `teste ${marcador()}` });
    const v = await vagas([h, h2]);
    assert.ok(!em(v, h).pistas.includes(pistaA.id), 'interditada não pode aparecer');
    assert.ok(em(v, h).pistas.includes(pistaB.id));
    assert.ok(em(v, h2).pistas.includes(pistaA.id), 'livre na hora seguinte');
});

async function agendarDuasHoras(inicio) {
    const r = await rpc('criar_agendamento', {
        p_responsavel: cliente.id,
        p_pedido: {
            inicio, horas: 2, instrutor_id: instrutorA.id, instrutores_necessarios: 1,
            participantes: [{
                nome_completo: 'Cliente Teste', cpf: cliente.cpf, data_nascimento: '1990-01-01', perfil_id: cliente.id,
                modalidade: 'estande', termo_versao: null, modelo_id: modelo.id,
                tipo_municao_id: tipoMunicao.id, municao_qtd: 50, arma_propria: null,
            }],
        },
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    anotarAgendamento(r.dados);
    const pistas = await rest(`agendamento_pistas?agendamento_id=eq.${r.dados}&select=pista_id`);
    assert.strictEqual(pistas.status, 200, JSON.stringify(pistas.dados));
    return { id: r.dados, pistas: pistas.dados.map(l => l.pista_id) };
}

test('instrutor e pista de um agendamento ficam ocupados só nas horas dele', async () => {
    const h = hora('03-06', 10);
    const { pistas } = await agendarDuasHoras(h);
    assert.ok(pistas.length >= 1);
    const v = await vagas([h, maisHoras(h, 1), maisHoras(h, 2)]);
    for (const k of [0, 1]) {
        const l = em(v, maisHoras(h, k));
        assert.ok(!l.instrutores.includes(instrutorA.id), `instrutor ocupado na hora ${k}`);
        for (const p of pistas) assert.ok(!l.pistas.includes(p), `pista ${p} ocupada na hora ${k}`);
    }
    const livre = em(v, maisHoras(h, 2));
    assert.ok(livre.instrutores.includes(instrutorA.id));
    for (const p of pistas) assert.ok(livre.pistas.includes(p), `pista ${p} livre na hora 2`);
});

test('p_ignorar devolve as reservas do próprio agendamento', async () => {
    const h = hora('03-07', 10);
    const { id, pistas } = await agendarDuasHoras(h);
    const v = em(await vagas([h], id), h);
    assert.ok(v.instrutores.includes(instrutorA.id));
    for (const p of pistas) assert.ok(v.pistas.includes(p), `pista ${p} volta a aparecer`);
    // Sem o p_ignorar continuam ocupados.
    const sem = em(await vagas([h]), h);
    assert.ok(!sem.instrutores.includes(instrutorA.id));
});

test('pista desativada e instrutor bloqueado nunca aparecem', async () => {
    const h = hora('03-08', 10);
    const desativar = await rest(`pistas?id=eq.${pistaB.id}`, { metodo: 'PATCH', corpo: { ativa: false } });
    assert.strictEqual(desativar.status, 200, JSON.stringify(desativar.dados));
    await banirUsuario(instrutorB.id);
    try {
        const l = em(await vagas([h]), h);
        assert.ok(!l.pistas.includes(pistaB.id), 'pista desativada');
        assert.ok(!l.instrutores.includes(instrutorB.id), 'instrutor bloqueado');
        assert.ok(l.pistas.includes(pistaA.id));
        assert.ok(l.instrutores.includes(instrutorA.id));
    } finally {
        await desbanirUsuario(instrutorB.id);
        const v = await rest(`pistas?id=eq.${pistaB.id}`, { metodo: 'PATCH', corpo: { ativa: true } });
        assert.strictEqual(v.status, 200, JSON.stringify(v.dados));
    }
});

test('anon e authenticated não executam', async () => {
    const h = hora('03-09', 10);
    const r = await rpc('vagas_por_hora', { p_inicios: [h], p_ignorar: null }, { chave: CHAVE_ANON });
    assert.ok(r.status === 401 || r.status === 403, `${r.status} ${JSON.stringify(r.dados)}`);
    const u = await criarUsuario({ papeis: ['cliente'] });
    assert.ok(u.token, 'usuário de teste sem token');
    const a = await rpc('vagas_por_hora', { p_inicios: [h], p_ignorar: null }, { chave: CHAVE_ANON, token: u.token });
    assert.ok(a.status === 401 || a.status === 403, `${a.status} ${JSON.stringify(a.dados)}`);
});
