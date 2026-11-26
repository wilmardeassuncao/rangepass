// Regras da página da equipe (admin.html) que não mexem na tela: dá para testar no Node.
import { temAlgumPapel } from './supabase/functions/_shared/papeis.mjs';
import { partesNoFuso } from './supabase/functions/_shared/agendamento.mjs';
import { TEXTO_SITUACAO, doisDigitos } from './agendar-regras.mjs';
import { CAMPOS_CADASTRO } from './supabase/functions/_shared/catalogo.mjs';
import { centavosDoTexto, formatarReais } from './supabase/functions/_shared/precos.mjs';

export const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// As abas da página, na ordem em que aparecem, e quem pode ver cada uma.
// O superadmin passa em qualquer exigência (temAlgumPapel).
export const ABAS = [
    { id: 'configuracoes', papeis: ['superadmin'] },
    { id: 'catalogo', papeis: ['superadmin'] },
    { id: 'pistas', papeis: ['superadmin'] },
    { id: 'precos', papeis: ['superadmin'] },
    { id: 'promocoes', papeis: ['superadmin'] },
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

// ---------- Preços ----------

const VALOR_INVALIDO = 'Use um valor em reais, por exemplo 120,00.';

// Campo de preço (em reais) → { valor: centavos } ou { erro }. Vazio = sem preço (null); quem não
// aceita null (a hora de pista) recusa com a mensagem do servidor.
export function precoDoCampo(texto) {
    const limpo = String(texto ?? '').trim();
    if (limpo === '') return { valor: null };
    const centavos = centavosDoTexto(limpo);
    return centavos === null ? { erro: VALOR_INVALIDO } : { valor: centavos };
}

// O inverso: centavos → texto do campo ('' quando não tem preço).
export function textoDoPreco(centavos) {
    return Number.isInteger(centavos) ? formatarReais(centavos) : '';
}

export const AVISO_SEM_PRECO = {
    modelo: 'Sem preço, esta arma não aparece para os clientes.',
    tipo_municao: 'Sem preço, esta munição não aparece para os clientes.',
    hora_pista: 'Sem preço da hora de pista, ninguém consegue agendar.',
};

// Formulário da regra por dia e horário → dados do POST/PUT precos. Os dias chegam como os valores
// das caixas marcadas ('0' a '6'). Prioridade vazia vale 0; percentual vazio vai null (o servidor recusa).
export function regraDoFormulario(campos) {
    return {
        nome: campos.nome,
        dias: campos.dias.map(Number).sort((a, b) => a - b),
        hora_inicio: campos.hora_inicio,
        hora_fim: campos.hora_fim,
        percentual: numeroDoCampo(campos.percentual),
        prioridade: numeroDoCampo(campos.prioridade) ?? 0,
        ativo: campos.ativo,
    };
}

// O inverso: regra salva (ou null, para uma nova) → valores dos campos da tela.
export function formularioDaRegra(regra) {
    if (!regra) return { nome: '', dias: [], hora_inicio: '', hora_fim: '', percentual: '', prioridade: '0', ativo: true };
    return {
        nome: regra.nome,
        dias: [...regra.dias],
        hora_inicio: regra.hora_inicio,
        hora_fim: regra.hora_fim,
        percentual: String(regra.percentual),
        prioridade: String(regra.prioridade),
        ativo: regra.ativo,
    };
}

export function diasDaRegra(dias) {
    if (dias.length === NOMES_DIAS.length) return 'Todos os dias';
    return [...dias].sort((a, b) => a - b).map((dia) => NOMES_DIAS[dia].slice(0, 3)).join(', ');
}

export function textoDoPercentual(percentual) {
    return `${percentual > 0 ? '+' : ''}${percentual}%`;
}

// ---------- Promoções ----------

// Campanha pela data de hoje ('AAAA-MM-DD', no fuso do estande): o início e o fim contam.
export function situacaoDaCampanha(campanha, hoje) {
    if (hoje < campanha.inicio) return 'Agendada';
    if (hoje > campanha.fim) return 'Encerrada';
    return 'Vigente';
}

function textoDaData(data) {
    const [ano, mes, dia] = data.split('-');
    return `${dia}/${mes}/${ano}`;
}

export function textoDoPeriodo(inicio, fim) {
    return inicio === fim ? textoDaData(inicio) : `${textoDaData(inicio)} a ${textoDaData(fim)}`;
}

// Formulário da campanha → dados do POST/PUT precos (percentual vazio vai null: o servidor recusa).
export function campanhaDoFormulario(campos) {
    return {
        nome: campos.nome,
        percentual: numeroDoCampo(campos.percentual),
        inicio: campos.inicio,
        fim: campos.fim,
        ativo: campos.ativo,
    };
}

export function formularioDaCampanha(campanha) {
    if (!campanha) return { nome: '', percentual: '', inicio: '', fim: '', ativo: true };
    return {
        nome: campanha.nome,
        percentual: String(campanha.percentual),
        inicio: campanha.inicio,
        fim: campanha.fim,
        ativo: campanha.ativo,
    };
}

// A classe tem um percentual para cada parte do preço (pista, aluguel de armas e munição), na ordem da tela.
const PARTES_DA_CLASSE = [['percentual_pista', 'Pista'], ['percentual_aluguel', 'Aluguel'], ['percentual_municao', 'Munição']];

// Formulário da classe → dados do POST/PUT precos (percentual vazio vai null: o servidor recusa).
export function classeDoFormulario(campos) {
    const dados = { nome: campos.nome };
    for (const [campo] of PARTES_DA_CLASSE) dados[campo] = numeroDoCampo(campos[campo]);
    dados.ativo = campos.ativo;
    return dados;
}

// O inverso. Numa classe nova, as três partes começam em 0 (sem desconto naquela parte).
export function formularioDaClasse(classe) {
    const campos = { nome: classe ? classe.nome : '' };
    for (const [campo] of PARTES_DA_CLASSE) campos[campo] = classe ? String(classe[campo]) : '0';
    campos.ativo = classe ? classe.ativo : true;
    return campos;
}

// Coluna "Desconto" da lista de classes: 'Pista 20% · Aluguel 10% · Munição 15%' (as partes em 0 ficam de fora).
export function textoDoDescontoDaClasse(classe) {
    return PARTES_DA_CLASSE.filter(([campo]) => classe[campo] > 0)
        .map(([campo, nome]) => `${nome} ${classe[campo]}%`).join(' · ');
}

// Formulário do pacote → { dados, erros }. O preço vem em reais; "Nenhum" (vazio) vira null; sem
// munição escolhida, a quantidade vai null. erros: só o do preço digitado errado (o resto é do validarPacote).
export function pacoteDoFormulario(campos) {
    const preco = precoDoCampo(campos.preco_centavos);
    const tipoMunicao = numeroDoCampo(campos.tipo_municao_id);
    return {
        dados: {
            nome: campos.nome,
            inicio: campos.inicio,
            fim: campos.fim,
            preco_centavos: preco.erro ? null : preco.valor,
            horas: numeroDoCampo(campos.horas),
            modelo_id: numeroDoCampo(campos.modelo_id),
            tipo_municao_id: tipoMunicao,
            municao_qtd: tipoMunicao === null ? null : numeroDoCampo(campos.municao_qtd),
            ativo: campos.ativo,
        },
        erros: preco.erro ? { preco_centavos: preco.erro } : {},
    };
}

const textoOuVazio = (valor) => (valor === null || valor === undefined ? '' : String(valor));

export function formularioDoPacote(pacote) {
    if (!pacote) {
        return {
            nome: '', inicio: '', fim: '', preco_centavos: '', horas: '1',
            modelo_id: '', tipo_municao_id: '', municao_qtd: '', ativo: true,
        };
    }
    return {
        nome: pacote.nome,
        inicio: pacote.inicio,
        fim: pacote.fim,
        preco_centavos: textoDoPreco(pacote.preco_centavos),
        horas: String(pacote.horas),
        modelo_id: textoOuVazio(pacote.modelo_id),
        tipo_municao_id: textoOuVazio(pacote.tipo_municao_id),
        municao_qtd: textoOuVazio(pacote.municao_qtd),
        ativo: pacote.ativo,
    };
}

// O que o pacote inclui. nomes: { modelo, municao } (null quando o pacote não tem).
export function textoDoPacote(pacote, nomes) {
    const partes = [`${pacote.horas} hora${pacote.horas > 1 ? 's' : ''} de pista`];
    if (nomes.modelo) partes.push(`aluguel de ${nomes.modelo}`);
    if (nomes.municao) partes.push(`${pacote.municao_qtd} muniç${pacote.municao_qtd > 1 ? 'ões' : 'ão'} ${nomes.municao}`);
    return partes.join(' + ');
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
