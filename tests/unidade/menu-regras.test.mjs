import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ABAS } from '../../admin-regras.mjs';
import { GRUPOS_EQUIPE, ROTULO_ABA, menuDe, parteDoEndereco, abasNaOrdemDoMenu, saudacao } from '../../menu-regras.mjs';

const PERFIL = { id: 'perfil', texto: 'Meu perfil', href: 'conta.html' };

test('cliente vê Meus agendamentos, Novo agendamento e Meu perfil, sem itens da equipe', () => {
    assert.deepEqual(menuDe(['cliente']), [
        {
            titulo: null,
            itens: [
                { id: 'agendamentos-cliente', texto: 'Meus agendamentos', href: 'index.html' },
                { id: 'novo', texto: 'Novo agendamento', href: 'index.html#novo' },
                PERFIL,
            ],
        },
    ]);
});

test('superadmin vê a própria área e os 4 grupos da equipe', () => {
    const menu = menuDe(['superadmin']);
    assert.deepEqual(menu.map((g) => g.titulo), [null, 'Operação', 'Cadastros', 'Vendas', 'Sistema']);
    assert.deepEqual(menu[1].itens, [
        { id: 'estande-recepcao', texto: 'Recepção', href: 'estande.html#recepcao' },
        { id: 'equipe-agendamentos', texto: 'Agendamentos', href: 'admin.html#agendamentos' },
    ]);
    const item = menu.flatMap((g) => g.itens).find((i) => i.id === 'equipe-precos');
    assert.equal(item.href, 'admin.html#precos');
    assert.equal(item.texto, 'Preços');
});

test('administrativo vê só Operação', () => {
    const menu = menuDe(['administrativo']);
    assert.deepEqual(menu[0], { titulo: null, itens: [PERFIL] });
    assert.equal(menu.length, 2);
    assert.equal(menu[1].titulo, 'Operação');
    assert.deepEqual(menu[1].itens.map((i) => i.id), ['equipe-agendamentos']);
});

test('atendente vê o grupo Operação só com Recepção', () => {
    assert.deepEqual(menuDe(['atendente']), [
        { titulo: null, itens: [PERFIL] },
        { titulo: 'Operação', itens: [{ id: 'estande-recepcao', texto: 'Recepção', href: 'estande.html#recepcao' }] },
    ]);
});

test('atendente que também é administrativo vê Recepção e depois Agendamentos', () => {
    const menu = menuDe(['atendente', 'administrativo']);
    assert.deepEqual(menu[1].itens.map((i) => i.id), ['estande-recepcao', 'equipe-agendamentos']);
});

test('instrutor e almoxarifado sem cliente veem só Meu perfil (as áreas deles entram no plano 8B)', () => {
    for (const papel of ['instrutor', 'almoxarifado']) {
        assert.deepEqual(menuDe([papel]), [{ titulo: null, itens: [PERFIL] }]);
    }
});

test('todo id de aba tem grupo e rótulo', () => {
    for (const { id } of ABAS) {
        assert.equal(GRUPOS_EQUIPE.filter((g) => g.abas.includes(id)).length, 1, id);
        assert.ok(ROTULO_ABA[id], id);
    }
});

test('parteDoEndereco devolve a parte permitida ou a primeira', () => {
    assert.equal(parteDoEndereco('#precos', ['precos', 'catalogo']), 'precos');
    assert.equal(parteDoEndereco('#precos', ['agendamentos']), 'agendamentos');
    assert.equal(parteDoEndereco('', ['catalogo']), 'catalogo');
    assert.equal(parteDoEndereco('#xyz', []), null);
});

test('abasNaOrdemDoMenu: as abas permitidas na ordem do menu (Agendamentos primeiro)', () => {
    assert.deepEqual(abasNaOrdemDoMenu(['superadmin']),
        ['agendamentos', 'catalogo', 'pistas', 'equipe', 'precos', 'promocoes', 'configuracoes']);
    assert.deepEqual(abasNaOrdemDoMenu(['administrativo']), ['agendamentos']);
    assert.deepEqual(abasNaOrdemDoMenu(['cliente']), []);
});

test('sem # o superadmin abre Agendamentos', () => {
    assert.equal(parteDoEndereco('', abasNaOrdemDoMenu(['superadmin'])), 'agendamentos');
});

test('saudacao usa o primeiro nome; sem nome, o e-mail; sem nada, vazio', () => {
    assert.equal(saudacao({ nome_completo: '  Maria  da Silva ' }, 'm@x.com'), 'Olá, Maria');
    assert.equal(saudacao({ nome_completo: '' }, 'm@x.com'), 'Olá, m@x.com');
    assert.equal(saudacao(null, 'm@x.com'), 'Olá, m@x.com');
    assert.equal(saudacao(null, null), '');
});

test('menu-regras fica leve: importa as áreas de estande-areas.mjs, não as regras do estande', () => {
    const fonte = readFileSync(new URL('../../menu-regras.mjs', import.meta.url), 'utf8');
    const importados = [...fonte.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(importados.includes('./estande-areas.mjs'), importados.join(', '));
    assert.ok(!importados.some((i) => /estande-regras|precos|agendamento/.test(i)), importados.join(', '));
});
