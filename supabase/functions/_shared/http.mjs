// Respostas HTTP das Edge Functions. Módulo puro: roda igual no Node (testes) e no Deno.

export const CABECALHOS_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const MENSAGEM_INESPERADO = 'Algo deu errado do nosso lado. Tente de novo em instantes.';

// Erro com status HTTP e uma mensagem que pode ser mostrada à pessoa.
export class ErroHttp extends Error {
    constructor(status, mensagem) {
        super(mensagem);
        this.name = 'ErroHttp';
        this.status = status;
    }
}

export function respostaJson(status, corpo) {
    return new Response(JSON.stringify(corpo), {
        status,
        headers: { ...CABECALHOS_CORS, 'Content-Type': 'application/json; charset=utf-8' },
    });
}

// Envolve o manipulador da função: responde ao OPTIONS do navegador e transforma erros em JSON.
export function tratar(manipulador) {
    return async (req) => {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CABECALHOS_CORS });
        try {
            return await manipulador(req);
        } catch (erro) {
            if (erro instanceof ErroHttp) return respostaJson(erro.status, { erro: erro.message });
            console.error(erro);
            return respostaJson(500, { erro: MENSAGEM_INESPERADO });
        }
    };
}
