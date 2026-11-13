// tests/unidade/http.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { tratar, ErroHttp, respostaJson } from '../../supabase/functions/_shared/http.mjs';

const MENSAGEM_INESPERADO = 'Algo deu errado do nosso lado. Tente de novo em instantes.';

test('tratar converte ErroHttp em JSON com a mensagem', async () => {
    const r = await tratar(async () => { throw new ErroHttp(403, 'Você não tem permissão para fazer isso.'); })(new Request('http://x', { method: 'GET' }));
    assert.strictEqual(r.status, 403);
    assert.deepStrictEqual(await r.json(), { erro: 'Você não tem permissão para fazer isso.' });
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
});

test('tratar responde OPTIONS com 204 e CORS', async () => {
    let chamou = false;
    const r = await tratar(async () => { chamou = true; return respostaJson(200, {}); })(new Request('http://x', { method: 'OPTIONS' }));
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
    assert.strictEqual(chamou, false);
});

test('tratar esconde erro inesperado com mensagem amigável', async (t) => {
    t.mock.method(console, 'error', () => {});
    const r = await tratar(async () => { throw new Error('detalhe interno'); })(new Request('http://x', { method: 'GET' }));
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(await r.json(), { erro: MENSAGEM_INESPERADO });
    assert.strictEqual(console.error.mock.callCount(), 1);
});

test('respostaJson usa JSON em UTF-8 e CORS', async () => {
    const r = respostaJson(200, { ok: true });
    assert.strictEqual(r.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.strictEqual(r.headers.get('access-control-allow-methods'), 'GET, POST, PUT, OPTIONS');
    assert.deepStrictEqual(await r.json(), { ok: true });
});
