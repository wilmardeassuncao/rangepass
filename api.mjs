// Conversa com o Supabase, usada por todas as páginas: o cliente (login) e a chamada das Edge Functions.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA);

// Chama uma Edge Function com o login da pessoa (se houver). `consulta` é o texto depois do "?",
// por exemplo 'ver=opcoes'. Devolve o código da resposta e o JSON (ou null, se não vier JSON).
export async function chamarFuncao(nome, { metodo = 'GET', corpo, consulta } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const cabecalhos = { apikey: SUPABASE_CHAVE_PUBLICA };
    if (session) cabecalhos.Authorization = `Bearer ${session.access_token}`;
    if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
    const endereco = `${SUPABASE_URL}/functions/v1/${nome}${consulta ? `?${consulta}` : ''}`;
    const resposta = await fetch(endereco, {
        method: metodo, headers: cabecalhos, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let dados = null;
    try { dados = await resposta.json(); } catch { dados = null; }
    return { status: resposta.status, dados };
}
