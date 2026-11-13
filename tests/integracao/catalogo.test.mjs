// tests/integracao/catalogo.test.mjs
import test, { after, before } from 'node:test';
import assert from 'node:assert';
import { rest, CHAVE_ANON, marcador, criar, apagarCriados } from './apoio.mjs';

// Os testes apagam tudo o que criam, inclusive o histórico gerado.
after(apagarCriados);

let modelo;

before(async () => {
    const categoria = await criar('categorias', { nome: `Categoria ${marcador()}` });
    const calibre = await criar('calibres', { nome: `Calibre ${marcador()}` });
    modelo = await criar('modelos', { categoria_id: categoria.id, calibre_id: calibre.id, marca: `Marca ${marcador()}`, nome: 'Modelo Teste' });
});

test('número de registro de unidade é único', async () => {
    const numero = `REG-${marcador()}`;
    await criar('unidades_arma', { modelo_id: modelo.id, numero_registro: numero });
    const r = await rest('unidades_arma', { metodo: 'POST', corpo: { modelo_id: modelo.id, numero_registro: numero } });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
});

test('modelo repetido (mesma marca e nome) é recusado', async () => {
    const r = await rest('modelos', {
        metodo: 'POST',
        corpo: { categoria_id: modelo.categoria_id, calibre_id: modelo.calibre_id, marca: modelo.marca, nome: modelo.nome },
    });
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
});

test('interdição com período vazio é recusada', async () => {
    const pista = await criar('pistas', { numero: 900000 + Math.floor(Math.random() * 99999) });
    const r = await rest('interdicoes', {
        metodo: 'POST',
        corpo: { pista_id: pista.id, periodo: '[2030-07-01 10:00-03,2030-07-01 10:00-03)', motivo: 'teste' },
    });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
});

test('anon não lê unidades_arma', async () => {
    const r = await rest('unidades_arma?select=id', { chave: CHAVE_ANON });
    assert.ok([401, 403].includes(r.status), `status ${r.status}`);
});
