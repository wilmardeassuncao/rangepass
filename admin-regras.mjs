// Regras da página da equipe (admin.html) que não mexem na tela: dá para testar no Node.
import { temAlgumPapel } from './supabase/functions/_shared/papeis.mjs';

export const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// As abas da página, na ordem em que aparecem, e quem pode ver cada uma.
// O superadmin passa em qualquer exigência (temAlgumPapel).
export const ABAS = [
    { id: 'configuracoes', papeis: ['superadmin'] },
    { id: 'catalogo', papeis: ['superadmin'] },
    { id: 'pistas', papeis: ['superadmin'] },
    { id: 'equipe', papeis: ['superadmin'] },
    { id: 'agendamentos', papeis: ['administrativo'] },
];

export function abasVisiveis(papeis) {
    return ABAS.filter((aba) => temAlgumPapel(papeis, aba.papeis)).map((aba) => aba.id);
}

// Formulário → valor de "funcionamento". Dia fechado vira null; as datas ficam em ordem, sem repetição
// e sem as linhas deixadas em branco.
export function funcionamentoDoFormulario(linhas, datas) {
    const dias = {};
    linhas.forEach((linha, dia) => {
        dias[dia] = linha.fechado ? null : { abre: linha.abre, fecha: linha.fecha };
    });
    const datas_fechadas = [...new Set(datas.filter((data) => data !== ''))].sort();
    return { dias, datas_fechadas };
}

// O inverso: valor salvo → linhas do formulário (uma por dia, de domingo a sábado) e lista de datas.
// Dia que não está no valor aparece como fechado.
export function formularioDoFuncionamento(funcionamento) {
    const dias = funcionamento?.dias ?? {};
    const linhas = NOMES_DIAS.map((_nome, dia) => {
        const horario = dias[dia];
        return horario ? { fechado: false, abre: horario.abre, fecha: horario.fecha } : { fechado: true, abre: '', fecha: '' };
    });
    return { linhas, datas: [...(funcionamento?.datas_fechadas ?? [])] };
}

// Versão a mandar ao salvar a política ou o termo: a mesma se o texto não mudou; senão, a seguinte.
export function proximaVersao(atual, textoNovo) {
    return textoNovo === atual.texto ? atual.versao : atual.versao + 1;
}

// Texto de um campo numérico → número. Vazio ou que não é número vira null (o servidor recusa com a
// mensagem certa).
export function numeroDoCampo(texto) {
    const limpo = String(texto ?? '').trim();
    if (limpo === '') return null;
    const numero = Number(limpo);
    return Number.isFinite(numero) ? numero : null;
}

// ---------- Catálogo e pistas ----------

// Número da próxima pista: o seguinte ao maior que já existe (inclusive as inativas); 1 se não houver nenhuma.
export function proximoNumeroDePista(pistas) {
    return (pistas ?? []).reduce((maior, pista) => Math.max(maior, pista.numero), 0) + 1;
}

const ROTULOS_SITUACAO = { disponivel: 'Disponível', manutencao: 'Em manutenção', desativada: 'Desativada' };

export function rotuloSituacaoArma(situacao) {
    return ROTULOS_SITUACAO[situacao] ?? situacao;
}

const NOME_DO_RECURSO = { unidade: 'Esta arma', pista: 'Esta pista' };

// Mensagem depois de salvar um cadastro. Se a arma ou a pista saiu de uso e ainda tem agendamentos
// futuros, avisa que eles continuam marcados.
export function mensagemCadastroSalvo(tipo, reservasFuturas) {
    if (!(reservasFuturas > 0) || !NOME_DO_RECURSO[tipo]) return 'Salvo.';
    return `Salvo. ${NOME_DO_RECURSO[tipo]} tem ${reservasFuturas} agendamento(s) futuro(s); eles continuam marcados e o atendimento precisa resolver.`;
}

export function nomeDoModelo(modelo) {
    return `${modelo.marca} ${modelo.nome}`;
}
