// Regras da página da equipe (admin.html) que não mexem na tela: dá para testar no Node.
import { temAlgumPapel } from './supabase/functions/_shared/papeis.mjs';
import { partesNoFuso } from './supabase/functions/_shared/agendamento.mjs';
import { TEXTO_SITUACAO, doisDigitos } from './agendar-regras.mjs';
import { CAMPOS_CADASTRO } from './supabase/functions/_shared/catalogo.mjs';

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

// ---------- Equipe ----------

// Nome de cada papel na tela.
export const ROTULO_PAPEL = {
    cliente: 'Cliente',
    atendente: 'Atendente',
    almoxarifado: 'Almoxarifado',
    instrutor: 'Instrutor',
    administrativo: 'Administrativo',
    superadmin: 'Superadmin',
};

// ---------- Agendamentos ----------

const NOMES_FILTROS = ['de', 'ate', 'situacao', 'instrutor_id', 'busca'];

// Filtros da lista → consulta do GET painel-agendamentos (sem o "?"). Só vão os preenchidos.
export function consultaDosFiltros(filtros) {
    return NOMES_FILTROS
        .map((nome) => [nome, String(filtros?.[nome] ?? '').trim()])
        .filter(([, valor]) => valor !== '')
        .map(([nome, valor]) => `${nome}=${encodeURIComponent(valor)}`)
        .join('&');
}

const RESERVAS = {
    agendamento_pistas: 'Pista reservada',
    agendamento_instrutores: 'Instrutor reservado',
    agendamento_unidades: 'Arma reservada',
};
const INCLUIDOS = { participantes: 'Participante incluído', itens_participante: 'Item incluído' };

const textoDaSituacao = (situacao) => TEXTO_SITUACAO[situacao] ?? situacao;

// Uma linha do histórico → o que aconteceu, em poucas palavras.
// No agendamento, se a situação e o horário mudaram juntos, vale a situação.
export function descreverEvento({ tabela, acao, antes, depois }) {
    const insercao = acao === 'insercao';
    if (tabela === 'agendamentos') {
        if (insercao) return 'Agendamento criado';
        if (acao === 'alteracao' && antes && depois) {
            if (antes.situacao !== depois.situacao) {
                return `Situação: ${textoDaSituacao(antes.situacao)} → ${textoDaSituacao(depois.situacao)}`;
            }
            if (antes.inicio !== depois.inicio || antes.horas !== depois.horas) return 'Horário alterado';
        }
        return 'Alteração registrada';
    }
    if (RESERVAS[tabela]) {
        if (insercao) return RESERVAS[tabela];
        if (acao === 'alteracao') return 'Reserva atualizada';
    }
    if (INCLUIDOS[tabela] && insercao) return INCLUIDOS[tabela];
    return 'Alteração registrada';
}

// Instante → 'DD/MM/AAAA HH:MM' no relógio do fuso do estande.
export function dataHoraNoFuso(instante, fuso) {
    const p = partesNoFuso(new Date(instante), fuso);
    const [ano, mes, dia] = p.data.split('-');
    return `${dia}/${mes}/${ano} ${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}`;
}

// Campos que o formulário de cada cadastro mostra (Adicionar/Editar), na ordem da tela.
// rotulo: o texto do campo; escolha: a lista de onde vêm as opções (pelo nome); situacao: a lista
// das situações da arma. Ativo/ativa não entram: mudam pelo "Desativar"/"Reativar". A pista não
// tem campos: o número é o próximo livre.
// fixo (só ao criar) vem do servidor (CAMPOS_CADASTRO: o contrário de editavel), para os dois não
// se desencontrarem. soAoCriar é só da tela: a situação da arma pode mudar, mas pela lista.
const FORMULARIOS = {
    categoria: [{ nome: 'nome', rotulo: 'Nome' }],
    calibre: [{ nome: 'nome', rotulo: 'Nome' }],
    modelo: [
        { nome: 'categoria_id', rotulo: 'Categoria', escolha: 'categorias' },
        { nome: 'calibre_id', rotulo: 'Calibre', escolha: 'calibres' },
        { nome: 'marca', rotulo: 'Marca' },
        { nome: 'nome', rotulo: 'Nome' },
    ],
    tipo_municao: [
        { nome: 'calibre_id', rotulo: 'Calibre', escolha: 'calibres' },
        { nome: 'nome', rotulo: 'Nome' },
    ],
    unidade: [
        { nome: 'modelo_id', rotulo: 'Modelo', escolha: 'modelos' },
        { nome: 'numero_registro', rotulo: 'Nº de registro' },
        { nome: 'situacao', rotulo: 'Situação', situacao: true, soAoCriar: true },
    ],
    pista: [],
};

export const CAMPOS_FORMULARIO = Object.fromEntries(Object.entries(FORMULARIOS).map(([tipo, campos]) => [
    tipo,
    campos.map((campo) => ({ ...campo, fixo: !CAMPOS_CADASTRO[tipo][campo.nome].editavel })),
]));
