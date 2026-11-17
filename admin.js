// Área da equipe (admin.html): a moldura (cabeçalho, abas e aviso) e uma seção por aba.
// Cada aba tem a sua função "abrirAba..." chamada quando ela é escolhida.
import { supabase, chamarFuncao } from './api.mjs';
import {
    NOMES_DIAS, abasVisiveis, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, numeroDoCampo,
    proximoNumeroDePista, rotuloSituacaoArma, mensagemCadastroSalvo, nomeDoModelo, ROTULO_PAPEL,
    consultaDosFiltros, descreverEvento, dataHoraNoFuso, CAMPOS_FORMULARIO,
} from './admin-regras.mjs';
import { formatarCpf, formatarTelefone } from './conta-regras.mjs';
import { descreverSessao, TEXTO_SITUACAO, somarDias } from './agendar-regras.mjs';
import { dataNoFuso } from './supabase/functions/_shared/cadastro.mjs';
import { PAPEIS } from './supabase/functions/_shared/papeis.mjs';
import { CHAVES_CONFIGURACAO, validarConfiguracao } from './supabase/functions/_shared/configuracoes.mjs';
import { SITUACOES_UNIDADE, validarCadastroCatalogo } from './supabase/functions/_shared/catalogo.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
const ENTRAR = 'conta.html?voltar=admin.html';
// Só este 403 quer dizer "sem acesso à conta". Outro 403 ("sem permissão") fica na tela, como erro.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let papeis = [];          // papéis de quem está logado (GET minha-conta)
let meuId = null;         // id de quem está logado (só para mostrar "você"; o servidor é quem protege)
let abaAtual = null;

// ---------- Ajudantes de tela ----------

function mostrarTela(id) {
    for (const tela of document.querySelectorAll('.tela')) tela.classList.toggle('ativa', tela.id === id);
    window.scrollTo(0, 0);
}

// Aviso no alto da página (fica visível mesmo com a página rolada): vermelho para problema,
// verde (sucesso) para "deu certo".
function avisar(texto, { sucesso = false } = {}) {
    const aviso = document.getElementById('aviso');
    aviso.textContent = texto ?? '';
    aviso.classList.toggle('sucesso', Boolean(texto) && sucesso);
    aviso.hidden = !texto;
}

function mostrarErroGeral(lugar, mensagem) {
    const geral = lugar.querySelector('[data-erro-geral]');
    if (!geral) {
        if (mensagem) avisar(mensagem);
        return;
    }
    geral.textContent = mensagem ?? '';
    geral.hidden = !mensagem;
}

function limparErros(form) {
    for (const el of form.querySelectorAll('[data-erro-para]')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    mostrarErroGeral(form, null);
}

// Cada chave de `campos` vai para o lugar com data-erro-para igual; sem lugar, vira o erro geral.
// O campo marcado é o de mesmo nome ou os campos do grupo com data-grupo-erro igual (ex.: 'dias.0').
function mostrarErros(form, campos) {
    for (const [chave, mensagem] of Object.entries(campos)) {
        const lugar = form.querySelector(`[data-erro-para="${chave}"]`);
        if (!lugar) {
            mostrarErroGeral(form, mensagem);
            continue;
        }
        lugar.textContent = mensagem;
        const campo = form.elements.namedItem(chave);
        if (campo instanceof Element) campo.setAttribute('aria-invalid', 'true');
        const grupo = form.querySelector(`[data-grupo-erro="${chave}"]`);
        for (const el of grupo?.querySelectorAll('input:not([type="checkbox"])') ?? []) el.setAttribute('aria-invalid', 'true');
    }
    const primeiro = form.querySelector('[aria-invalid="true"]')
        ?? [...form.querySelectorAll('[data-erro-para], [data-erro-geral]')].find((el) => el.textContent);
    primeiro?.scrollIntoView?.({ block: 'center' });
    if (primeiro?.matches('input, textarea, select') && !primeiro.disabled) primeiro.focus({ preventScroll: true });
}

// Desabilita os botões (e as listas de escolha) do lugar enquanto a chamada está em andamento.
async function ocupado(lugar, acao) {
    const botoes = lugar.querySelectorAll('button, select');
    botoes.forEach((b) => { b.disabled = true; });
    try {
        await acao();
    } catch (erro) {
        console.error(erro);
        mostrarErroGeral(lugar, ERRO_PADRAO);
    } finally {
        botoes.forEach((b) => { b.disabled = false; });
    }
}

// 401 (sem login) ou conta desativada: sair e ir para a página de entrar, que volta para cá.
function precisaEntrar(r) {
    return r.status === 401 || (r.status === 403 && r.dados?.erro === CONTA_DESATIVADA);
}

async function irParaEntrar() {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
}

function copiarMolde(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// ---------- Moldura: abas ----------

// A função de abrir de cada aba.
const ABRIR_ABA = {
    configuracoes: abrirAbaConfiguracoes,
    catalogo: abrirAbaCadastros,
    pistas: abrirAbaCadastros,
    equipe: abrirAbaEquipe,
    agendamentos: abrirAbaAgendamentos,
};

function botoesDasAbas() {
    return [...document.querySelectorAll('#abas [data-aba]')].filter((botao) => !botao.hidden);
}

function montarAbas() {
    const visiveis = abasVisiveis(papeis);
    for (const botao of document.querySelectorAll('#abas [data-aba]')) botao.hidden = !visiveis.includes(botao.dataset.aba);
    return visiveis;
}

function escolherAba(id) {
    abaAtual = id;
    avisar(null);
    for (const botao of document.querySelectorAll('#abas [data-aba]')) {
        const escolhida = botao.dataset.aba === id;
        botao.setAttribute('aria-selected', String(escolhida));
        botao.tabIndex = escolhida ? 0 : -1;
        document.getElementById(`painel-${botao.dataset.aba}`).hidden = !escolhida;
    }
    ABRIR_ABA[id]?.();
}

document.getElementById('abas').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-aba]');
    if (botao && botao.dataset.aba !== abaAtual) escolherAba(botao.dataset.aba);
});

// Setas do teclado passam de uma aba para a outra.
document.getElementById('abas').addEventListener('keydown', (evento) => {
    if (evento.key !== 'ArrowRight' && evento.key !== 'ArrowLeft') return;
    const botoes = botoesDasAbas();
    const atual = botoes.findIndex((b) => b.dataset.aba === abaAtual);
    const proximo = botoes[(atual + (evento.key === 'ArrowRight' ? 1 : -1) + botoes.length) % botoes.length];
    escolherAba(proximo.dataset.aba);
    proximo.focus();
});

document.getElementById('botao-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
});

// ---------- Aba Configurações ----------
// Um formulário por chave (form-<chave>). Os valores vêm do GET configuracoes e cada "Salvar"
// manda só a sua chave no PUT configuracoes.

let configuracoes = null;  // { chave: valor } como estão salvos no servidor

const listaDias = document.getElementById('dias-semana');
const listaDatas = document.getElementById('datas-fechadas');
const listaFaixas = document.getElementById('faixas-instrutores');
const textoDe = (form, nome) => form.elements[nome].value.trim();

// Uma linha por dia da semana, de domingo (0) a sábado (6). Montadas uma vez só.
function montarDias() {
    NOMES_DIAS.forEach((nome, dia) => {
        const linha = copiarMolde('molde-dia');
        linha.dataset.dia = String(dia);
        linha.dataset.grupoErro = `dias.${dia}`;
        linha.querySelector('[data-nome-dia]').textContent = nome;
        linha.querySelector('[data-erro-dia]').dataset.erroPara = `dias.${dia}`;
        linha.querySelector('[data-campo="fechado"]').addEventListener('change', () => atualizarDia(linha));
        listaDias.append(linha);
    });
}

// Dia fechado: os horários ficam desligados.
function atualizarDia(linha) {
    const fechado = linha.querySelector('[data-campo="fechado"]').checked;
    for (const campo of ['abre', 'fecha']) linha.querySelector(`[data-campo="${campo}"]`).disabled = fechado;
}

function adicionarData(valor = '') {
    const linha = copiarMolde('molde-data');
    const campo = linha.querySelector('[data-campo="data"]');
    campo.value = valor;
    linha.querySelector('[data-remover]').addEventListener('click', () => {
        linha.remove();
        atualizarSemDatas();
    });
    listaDatas.append(linha);
    atualizarSemDatas();
    return campo;
}

function atualizarSemDatas() {
    document.getElementById('sem-datas-fechadas').hidden = listaDatas.children.length > 0;
}

function adicionarFaixa({ ate = '', instrutores = '' } = {}) {
    const linha = copiarMolde('molde-faixa');
    linha.querySelector('[data-campo="ate"]').value = String(ate ?? '');
    linha.querySelector('[data-campo="instrutores"]').value = String(instrutores ?? '');
    linha.querySelector('[data-remover]').addEventListener('click', () => linha.remove());
    listaFaixas.append(linha);
    return linha;
}

document.getElementById('botao-adicionar-data').addEventListener('click', () => adicionarData().focus());
document.getElementById('botao-adicionar-faixa').addEventListener('click', () => {
    adicionarFaixa().querySelector('input').focus();
});

// Campos numéricos (type=number com name) do formulário: { nome: número ou null }.
function numerosDe(form) {
    const numeros = {};
    for (const campo of form.querySelectorAll('input[type="number"][name]')) numeros[campo.name] = numeroDoCampo(campo.value);
    return numeros;
}

function preencherNumeros(form, valor) {
    for (const campo of form.querySelectorAll('input[type="number"][name]')) campo.value = String(valor?.[campo.name] ?? '');
}

// Como cada chave vai para o formulário (preencher) e volta dele (ler). `atual` é o valor salvo:
// o que o formulário não mostra continua igual.
const FORMULARIOS = {
    estande: {
        preencher(form, valor) {
            for (const nome of ['nome', 'fuso', 'endereco', 'contato']) form.elements[nome].value = valor?.[nome] ?? '';
            form.elements.logo_url.value = valor?.logo_url ?? '';
        },
        ler(form, atual) {
            return {
                ...atual,
                nome: textoDe(form, 'nome'),
                fuso: textoDe(form, 'fuso'),
                endereco: textoDe(form, 'endereco'),
                contato: textoDe(form, 'contato'),
                logo_url: textoDe(form, 'logo_url') || null,
            };
        },
    },
    funcionamento: {
        preencher(_form, valor) {
            const { linhas, datas } = formularioDoFuncionamento(valor);
            linhas.forEach((dados, dia) => {
                const linha = listaDias.querySelector(`[data-dia="${dia}"]`);
                linha.querySelector('[data-campo="fechado"]').checked = dados.fechado;
                linha.querySelector('[data-campo="abre"]').value = dados.abre;
                linha.querySelector('[data-campo="fecha"]').value = dados.fecha;
                atualizarDia(linha);
            });
            listaDatas.replaceChildren();
            for (const data of datas) adicionarData(data);
            atualizarSemDatas();
        },
        ler(_form, atual) {
            const linhas = [...listaDias.querySelectorAll('[data-dia]')].map((linha) => ({
                fechado: linha.querySelector('[data-campo="fechado"]').checked,
                abre: linha.querySelector('[data-campo="abre"]').value,
                fecha: linha.querySelector('[data-campo="fecha"]').value,
            }));
            const datas = [...listaDatas.querySelectorAll('[data-campo="data"]')].map((campo) => campo.value);
            return { ...atual, ...funcionamentoDoFormulario(linhas, datas) };
        },
    },
    agenda: {
        preencher(form, valor) {
            preencherNumeros(form, valor);
            listaFaixas.replaceChildren();
            for (const faixa of valor?.faixas_instrutores ?? []) adicionarFaixa(faixa);
        },
        ler(form, atual) {
            const faixas_instrutores = [...listaFaixas.children].map((linha) => ({
                ate: numeroDoCampo(linha.querySelector('[data-campo="ate"]').value),
                instrutores: numeroDoCampo(linha.querySelector('[data-campo="instrutores"]').value),
            }));
            return { ...atual, ...numerosDe(form), faixas_instrutores };
        },
    },
    municao: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    cadastro: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    creditos: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    privacidade: textoVersionado(),
    termo: textoVersionado(),
};

// Política e termo: o texto muda na área grande; a versão só aparece. Texto diferente = versão seguinte.
function textoVersionado() {
    return {
        preencher(form, valor) {
            form.elements.texto.value = valor?.texto ?? '';
            form.querySelector('[data-versao]').textContent = String(valor?.versao ?? '');
        },
        ler(form, atual) {
            const texto = form.elements.texto.value;
            return { ...atual, texto, versao: proximaVersao(atual ?? { versao: 0, texto: '' }, texto) };
        },
    };
}

// Onde os clientes vão ver o texto novo de cada chave com versão.
const ONDE_ACEITAM = { termo: 'no próximo agendamento', privacidade: 'no próximo cadastro' };

function mensagemDeSucesso(chave, antes, depois) {
    if (ONDE_ACEITAM[chave] && depois.versao !== antes?.versao) {
        return `Versão ${depois.versao} publicada. Os clientes vão aceitar o texto novo ${ONDE_ACEITAM[chave]}.`;
    }
    return 'Configuração salva.';
}

function formularioDa(chave) {
    return document.getElementById(`form-${chave}`);
}

// As chaves que têm formulário nesta aba. A chave precos (hora de pista) fica na aba Preços.
const CHAVES_DA_ABA = CHAVES_CONFIGURACAO.filter((chave) => Object.hasOwn(FORMULARIOS, chave));

function preencherConfiguracao(chave) {
    FORMULARIOS[chave].preencher(formularioDa(chave), configuracoes[chave]);
}

function salvarConfiguracao(form) {
    const chave = form.dataset.chave;
    limparErros(form);
    avisar(null);
    const antes = configuracoes[chave];
    const valor = FORMULARIOS[chave].ler(form, antes);
    const campos = validarConfiguracao(chave, valor);
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    return ocupado(form, async () => {
        const r = await chamarFuncao('configuracoes', { metodo: 'PUT', corpo: { chave, valor } });
        if (r.status === 200) {
            configuracoes[chave] = r.dados.valor;
            preencherConfiguracao(chave);
            avisar(mensagemDeSucesso(chave, antes, r.dados.valor), { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
}

for (const chave of CHAVES_DA_ABA) {
    formularioDa(chave).addEventListener('submit', (evento) => {
        evento.preventDefault();
        salvarConfiguracao(evento.currentTarget);
    });
}

function mostrarEstadoConfiguracoes(estado, mensagem) {
    document.getElementById('configuracoes-carregando').hidden = estado !== 'carregando';
    document.getElementById('configuracoes-erro').hidden = estado !== 'erro';
    document.getElementById('configuracoes-formularios').hidden = estado !== 'pronto';
    document.getElementById('configuracoes-erro-mensagem').textContent = mensagem ?? '';
}

async function carregarConfiguracoes() {
    mostrarEstadoConfiguracoes('carregando');
    try {
        const r = await chamarFuncao('configuracoes');
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200 || !r.dados?.configuracoes) return mostrarEstadoConfiguracoes('erro', r.dados?.erro ?? ERRO_CARREGAR);
        configuracoes = r.dados.configuracoes;
        for (const chave of CHAVES_DA_ABA) {
            limparErros(formularioDa(chave));
            preencherConfiguracao(chave);
        }
        mostrarEstadoConfiguracoes('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoConfiguracoes('erro', ERRO_CARREGAR);
    }
}

document.getElementById('botao-recarregar-configuracoes').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarConfiguracoes);
});

// Carrega uma vez; voltar para a aba não apaga o que foi digitado e ainda não salvo.
function abrirAbaConfiguracoes() {
    if (!configuracoes) carregarConfiguracoes();
}

montarDias();

// ---------- Abas Catálogo e Pistas ----------
// As duas abas usam o mesmo GET catalogo: carregado uma vez (na primeira das duas que for aberta)
// e de novo depois de cada cadastro salvo. Nada é apagado: só criar, editar e desativar/reativar.
// Cada tipo tem a sua seção (secao-<tipo>), com a lista (linhas-<tipo>) e um formulário
// (form-<tipo>) montado na hora, para "Adicionar" ou "Editar".

let catalogo = null;            // { categorias, calibres, modelos, tipos_municao, unidades, pistas }
let catalogoEmCarga = null;     // a primeira carga em andamento (as duas abas não pedem duas vezes)

// campos: o que o formulário mostra (CAMPOS_FORMULARIO, em admin-regras.mjs: rótulos, listas de
// escolha e o fixo/soAoCriar, este tirado das regras do servidor).
const CADASTROS = {
    categoria: {
        lista: 'categorias', nomeItem: 'categoria', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.categoria,
        colunas: (item) => [['Nome', item.nome]],
    },
    calibre: {
        lista: 'calibres', nomeItem: 'calibre', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.calibre,
        colunas: (item) => [['Nome', item.nome]],
    },
    modelo: {
        lista: 'modelos', nomeItem: 'modelo', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.modelo,
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [
            ['Modelo', nomeDoModelo(item)],
            ['Categoria', nomeNaLista('categorias', item.categoria_id)],
            ['Calibre', nomeNaLista('calibres', item.calibre_id)],
        ],
    },
    tipo_municao: {
        lista: 'tipos_municao', nomeItem: 'munição', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.tipo_municao,
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [['Munição', item.nome], ['Calibre', nomeNaLista('calibres', item.calibre_id)]],
    },
    unidade: {
        lista: 'unidades', nomeItem: 'arma',
        campos: CAMPOS_FORMULARIO.unidade,
        avisoAoEditar: 'O modelo não pode ser mudado depois de criado. A situação muda na lista.',
        colunas: (item) => [['Nº de registro', item.numero_registro], ['Modelo', nomeNaLista('modelos', item.modelo_id)]],
    },
    pista: {
        lista: 'pistas', nomeItem: 'pista', campoAtivo: 'ativa', rotulos: ['Ativa', 'Inativa'],
        campos: CAMPOS_FORMULARIO.pista,
        colunas: (item) => [['Pista', `Pista ${item.numero}`]],
    },
};

function nomeDoItem(lista, item) {
    return lista === 'modelos' ? nomeDoModelo(item) : item.nome;
}

function itemDaLista(lista, id) {
    return (catalogo?.[lista] ?? []).find((item) => item.id === id);
}

function nomeNaLista(lista, id) {
    const item = itemDaLista(lista, id);
    return item ? nomeDoItem(lista, item) : '—';
}

function estaAtivo(tipo, item) {
    if (tipo === 'unidade') return item.situacao !== 'desativada';
    return item[CADASTROS[tipo].campoAtivo] === true;
}

// Os campos que o formulário mostra: ao criar, todos; ao editar, só os que podem mudar ali.
function camposDoFormulario(tipo, criando) {
    return CADASTROS[tipo].campos.filter((campo) => criando || (!campo.fixo && !campo.soAoCriar));
}

// ----- Listas -----

function celula(coluna, conteudo) {
    const td = document.createElement('td');
    td.dataset.coluna = coluna;
    td.append(conteudo);
    return td;
}

function rotuloSituacao(texto, ativo) {
    const rotulo = document.createElement('span');
    rotulo.className = `rotulo ${ativo ? 'ativo' : 'inativo'}`;
    rotulo.textContent = texto;
    return rotulo;
}

function botaoDaLinha(texto, acao, item, descricao, { perigo = false } = {}) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `botao secundario pequeno${perigo ? ' perigo' : ''}`;
    botao.textContent = texto;
    botao.dataset.acao = acao;
    botao.dataset.id = String(item.id);
    botao.setAttribute('aria-label', `${texto}: ${descricao}`);
    return botao;
}

// Opções das listas de escolha. Situação: as três. Outras: só os itens ativos, mais o que já está
// escolhido (se tiver sido desativado depois, para não sumir da edição).
function preencherOpcoes(select, campo, valor) {
    let opcoes;
    if (campo.situacao) {
        opcoes = SITUACOES_UNIDADE.map((situacao) => [situacao, rotuloSituacaoArma(situacao)]);
    } else {
        opcoes = [['', 'Escolha…']];
        for (const item of catalogo?.[campo.escolha] ?? []) {
            if (!item.ativo && item.id !== valor) continue;
            opcoes.push([String(item.id), `${nomeDoItem(campo.escolha, item)}${item.ativo ? '' : ' (desativado)'}`]);
        }
    }
    select.replaceChildren(...opcoes.map(([valorOpcao, texto]) => {
        const opcao = document.createElement('option');
        opcao.value = valorOpcao;
        opcao.textContent = texto;
        return opcao;
    }));
    select.value = valor === null || valor === undefined ? '' : String(valor);
    if (select.selectedIndex < 0) select.value = '';
}

function seletorSituacao(item) {
    const select = document.createElement('select');
    select.dataset.acao = 'situacao';
    select.dataset.id = String(item.id);
    select.setAttribute('aria-label', `Situação da arma ${item.numero_registro}`);
    preencherOpcoes(select, { situacao: true }, item.situacao);
    return select;
}

function linhaDoCadastro(tipo, item) {
    const definicao = CADASTROS[tipo];
    const ativo = estaAtivo(tipo, item);
    const colunas = definicao.colunas(item);
    const descricao = colunas[0][1];
    const linha = document.createElement('tr');
    linha.dataset.id = String(item.id);
    linha.classList.toggle('inativo', !ativo);
    for (const [coluna, texto] of colunas) linha.append(celula(coluna, texto));

    if (tipo === 'unidade') {
        linha.append(celula('Situação', seletorSituacao(item)));
    } else {
        const [textoAtivo, textoInativo] = definicao.rotulos ?? ['Ativo', 'Desativado'];
        linha.append(celula('Situação', rotuloSituacao(ativo ? textoAtivo : textoInativo, ativo)));
    }
    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    if (definicao.campos.length > 0) acoes.append(botaoDaLinha('Editar', 'editar', item, descricao));
    if (definicao.campoAtivo) {
        acoes.append(botaoDaLinha(ativo ? 'Desativar' : 'Reativar', 'alternar', item, descricao, { perigo: ativo }));
    }
    const celulaAcoes = celula('', acoes);
    celulaAcoes.className = 'celula-acoes';
    linha.append(celulaAcoes);
    return linha;
}

function mostrarCadastros() {
    for (const [tipo, definicao] of Object.entries(CADASTROS)) {
        const itens = catalogo[definicao.lista] ?? [];
        const corpo = document.getElementById(`linhas-${tipo}`);
        corpo.replaceChildren(...itens.map((item) => linhaDoCadastro(tipo, item)));
        corpo.closest('table').hidden = itens.length === 0;
        document.getElementById(`vazio-${tipo}`).hidden = itens.length > 0;

        // Formulário aberto: as listas de escolha ganham os itens novos, sem perder o escolhido.
        const form = document.getElementById(`form-${tipo}`);
        if (!form || form.hidden) continue;
        for (const campo of definicao.campos.filter((c) => c.escolha)) {
            const select = form.elements.namedItem(campo.nome);
            if (select instanceof HTMLSelectElement) preencherOpcoes(select, campo, numeroDoCampo(select.value));
        }
    }
}

// ----- Formulário de Adicionar / Editar -----

function montarCampo(campo, item) {
    const rotulo = document.createElement('label');
    rotulo.className = 'campo';
    rotulo.append(campo.rotulo);
    let entrada;
    if (campo.escolha || campo.situacao) {
        entrada = document.createElement('select');
        preencherOpcoes(entrada, campo, item ? item[campo.nome] : (campo.situacao ? 'disponivel' : null));
    } else {
        entrada = document.createElement('input');
        entrada.autocomplete = 'off';
        entrada.value = item?.[campo.nome] ?? '';
    }
    entrada.name = campo.nome;
    const erro = document.createElement('span');
    erro.className = 'erro';
    erro.dataset.erroPara = campo.nome;
    rotulo.append(entrada, erro);
    return rotulo;
}

function criarBotao(texto, tipo, classe) {
    const botao = document.createElement('button');
    botao.type = tipo;
    botao.className = classe;
    botao.textContent = texto;
    return botao;
}

function abrirFormulario(tipo, item = null) {
    const definicao = CADASTROS[tipo];
    const form = document.getElementById(`form-${tipo}`);
    const criando = !item;
    if (criando && !form.hidden && form.dataset.modo === 'criar') {
        form.querySelector('input, select')?.focus();
        return;
    }
    form.dataset.modo = criando ? 'criar' : 'editar';
    form.dataset.id = criando ? '' : String(item.id);

    const titulo = document.createElement('h3');
    titulo.className = 'formulario-titulo';
    titulo.textContent = criando ? `Adicionar ${definicao.nomeItem}` : `Editar ${definicao.nomeItem}`;
    const grade = document.createElement('div');
    grade.className = 'grade';
    for (const campo of camposDoFormulario(tipo, criando)) grade.append(montarCampo(campo, item));
    const partes = [titulo, grade];
    if (!criando && definicao.avisoAoEditar) {
        const aviso = document.createElement('p');
        aviso.className = 'subtitulo';
        aviso.textContent = definicao.avisoAoEditar;
        partes.push(aviso);
    }
    const geral = document.createElement('p');
    geral.className = 'erro';
    geral.dataset.erroGeral = '';
    geral.hidden = true;
    const botoes = document.createElement('div');
    botoes.className = 'botoes';
    const cancelar = criarBotao('Cancelar', 'button', 'botao secundario');
    cancelar.dataset.cancelar = '';
    botoes.append(criarBotao('Salvar', 'submit', 'botao'), cancelar);
    form.replaceChildren(...partes, geral, botoes);
    form.hidden = false;
    form.scrollIntoView?.({ block: 'nearest' });
    form.querySelector('input, select')?.focus({ preventScroll: true });
}

function fecharFormulario(form) {
    form.hidden = true;
    form.replaceChildren();
    delete form.dataset.modo;
    delete form.dataset.id;
}

function dadosDoFormulario(form, tipo, criando) {
    const dados = {};
    for (const campo of camposDoFormulario(tipo, criando)) {
        const valor = form.elements[campo.nome].value;
        dados[campo.nome] = campo.escolha ? numeroDoCampo(valor) : valor;
    }
    return dados;
}

// ----- Enviar (POST cria, PUT edita) -----

// Busca o catálogo e, dando certo, refaz as listas. Devolve {} (certo), { erro } ou { saiu }
// (sem login: já foi para a página de entrar).
async function buscarCatalogo() {
    const r = await chamarFuncao('catalogo');
    if (precisaEntrar(r)) {
        await irParaEntrar();
        return { saiu: true };
    }
    if (r.status !== 200 || !Array.isArray(r.dados?.categorias)) return { erro: r.dados?.erro ?? ERRO_CARREGAR };
    catalogo = r.dados;
    mostrarCadastros();
    return {};
}

// Confere no navegador (as mesmas regras do servidor) e envia. Erros vão para os campos do
// formulário ou, sem formulário (botões da lista e "Adicionar pista"), para o aviso.
// Devolve true quando salvou.
async function enviarCadastro(tipo, id, dados, form = null) {
    const criando = id === null;
    const mostrarProblema = (campos) => {
        if (form) mostrarErros(form, campos);
        else avisar(Object.values(campos)[0]);
    };
    const { campos, valores } = validarCadastroCatalogo(tipo, dados, { criando });
    if (Object.keys(campos).length) {
        mostrarProblema(campos);
        return false;
    }

    const corpo = criando ? { tipo, dados: valores } : { tipo, id, dados: valores };
    const r = await chamarFuncao('catalogo', { metodo: criando ? 'POST' : 'PUT', corpo });
    if (r.status === 200 || r.status === 201) {
        if (form) fecharFormulario(form);
        const recarga = await buscarCatalogo().catch((erro) => {
            console.error(erro);
            return { erro: ERRO_CARREGAR };
        });
        if (recarga.saiu) return true;
        if (recarga.erro) avisar('Salvo, mas não deu para atualizar a lista. Recarregue a página.');
        else avisar(mensagemCadastroSalvo(tipo, r.dados?.reservas_futuras), { sucesso: true });
        return true;
    }
    if (precisaEntrar(r)) {
        await irParaEntrar();
    } else if ((r.status === 400 || r.status === 409) && r.dados?.campos) {
        mostrarProblema(r.dados.campos);
    } else if (form) {
        mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
    } else {
        avisar(r.dados?.erro ?? ERRO_PADRAO);
    }
    return false;
}

function salvarFormulario(form) {
    const tipo = form.closest('[data-tipo]').dataset.tipo;
    const criando = form.dataset.modo === 'criar';
    limparErros(form);
    avisar(null);
    const id = criando ? null : Number(form.dataset.id);
    const dados = dadosDoFormulario(form, tipo, criando);
    return ocupado(form, () => enviarCadastro(tipo, id, dados, form));
}

// "Editar", "Desativar"/"Reativar" (ativo ou ativa ao contrário) e a situação da arma (lista na linha).
async function acaoDaLinha(tipo, alvo) {
    const definicao = CADASTROS[tipo];
    const id = Number(alvo.dataset.id);
    const item = itemDaLista(definicao.lista, id);
    if (!item) return;
    if (alvo.dataset.acao === 'editar') {
        abrirFormulario(tipo, item);
        return;
    }
    avisar(null);
    const dados = alvo.dataset.acao === 'situacao'
        ? { situacao: alvo.value }
        : { [definicao.campoAtivo]: !item[definicao.campoAtivo] };
    await ocupado(alvo.closest('tr'), async () => {
        let salvou = false;
        try {
            salvou = await enviarCadastro(tipo, id, dados);
        } finally {
            // Não salvou: a lista de situação volta ao valor de antes.
            if (!salvou && alvo.dataset.acao === 'situacao') alvo.value = item.situacao;
        }
    });
}

for (const secao of document.querySelectorAll('#painel-catalogo [data-tipo], #painel-pistas [data-tipo]')) {
    const tipo = secao.dataset.tipo;
    const corpo = document.getElementById(`linhas-${tipo}`);
    corpo.addEventListener('click', (evento) => {
        const alvo = evento.target.closest('button[data-acao]');
        if (alvo) acaoDaLinha(tipo, alvo);
    });
    corpo.addEventListener('change', (evento) => {
        if (evento.target.matches('select[data-acao="situacao"]')) acaoDaLinha(tipo, evento.target);
    });

    const form = document.getElementById(`form-${tipo}`);
    if (!form) continue;
    secao.querySelector('[data-adicionar]').addEventListener('click', () => abrirFormulario(tipo));
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        salvarFormulario(form);
    });
    form.addEventListener('click', (evento) => {
        if (evento.target.closest('[data-cancelar]')) fecharFormulario(form);
    });
}

document.getElementById('botao-adicionar-pista').addEventListener('click', () => {
    avisar(null);
    ocupado(document.getElementById('secao-pista'), () => (
        enviarCadastro('pista', null, { numero: proximoNumeroDePista(catalogo.pistas) })
    ));
});

function mostrarEstadoCadastros(estado, mensagem) {
    for (const [nome, conteudo] of [['catalogo', 'catalogo-secoes'], ['pistas', 'pistas-conteudo']]) {
        document.getElementById(`${nome}-carregando`).hidden = estado !== 'carregando';
        document.getElementById(`${nome}-erro`).hidden = estado !== 'erro';
        document.getElementById(conteudo).hidden = estado !== 'pronto';
        document.getElementById(`${nome}-erro-mensagem`).textContent = mensagem ?? '';
    }
}

async function carregarCatalogo() {
    mostrarEstadoCadastros('carregando');
    try {
        const resultado = await buscarCatalogo();
        if (resultado.saiu) return;
        if (resultado.erro) mostrarEstadoCadastros('erro', resultado.erro);
        else mostrarEstadoCadastros('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoCadastros('erro', ERRO_CARREGAR);
    }
}

for (const botao of document.querySelectorAll('[data-recarregar-cadastros]')) {
    botao.addEventListener('click', () => ocupado(botao.parentElement, carregarCatalogo));
}

// Carrega na primeira vez; depois, as listas já estão montadas (e o que foi digitado continua).
function abrirAbaCadastros() {
    if (!catalogo && !catalogoEmCarga) {
        catalogoEmCarga = carregarCatalogo().finally(() => { catalogoEmCarga = null; });
    }
}

// ---------- Aba Equipe ----------
// A lista de quem tem papel de equipe e a busca por outras pessoas (nome, e-mail ou CPF, a partir de
// 2 caracteres). Cada pessoa é um cartão (li.pessoa) com os papéis (caixas de marcar) e o botão de
// desativar ou reativar a conta. As proteções (ex.: não tirar o próprio superadmin) são do servidor:
// a recusa dele (409) aparece no aviso.

const listaEquipe = document.getElementById('lista-equipe');
const campoBuscaEquipe = document.getElementById('busca-equipe');
let buscaEquipe = '';       // a busca em uso ('' = só a equipe)
let cargaEquipe = 0;        // número da última carga: respostas atrasadas são ignoradas

function textoDaEquipe(classe, campo, texto) {
    const p = document.createElement('p');
    p.className = classe;
    p.dataset.campo = campo;
    p.textContent = texto;
    return p;
}

function cartaoDaPessoa(pessoa) {
    const cartao = document.createElement('li');
    cartao.className = 'pessoa';
    cartao.dataset.id = String(pessoa.id);
    cartao.dataset.nome = pessoa.nome_completo || pessoa.email || '';  // para a pergunta de confirmação
    cartao.classList.toggle('inativo', !pessoa.ativo);

    const topo = document.createElement('div');
    topo.className = 'pessoa-topo';
    const identidade = document.createElement('div');
    const nome = textoDaEquipe('pessoa-nome', 'nome', pessoa.nome_completo || 'Sem cadastro');
    if (pessoa.id === meuId) nome.append(' (você)');
    identidade.append(nome, textoDaEquipe('subtitulo', 'email', pessoa.email ?? ''));
    if (pessoa.cpf) identidade.append(textoDaEquipe('subtitulo', 'cpf', formatarCpf(pessoa.cpf)));
    const situacao = rotuloSituacao(pessoa.ativo ? 'Ativa' : 'Desativada', pessoa.ativo);
    situacao.dataset.campo = 'situacao';
    topo.append(identidade, situacao);

    const form = document.createElement('form');
    form.className = 'pessoa-papeis';
    form.noValidate = true;
    const grupo = document.createElement('fieldset');
    grupo.className = 'grupo';
    const legenda = document.createElement('legend');
    legenda.className = 'campo-titulo';
    legenda.textContent = 'Papéis';
    grupo.append(legenda);
    for (const papel of PAPEIS) {
        const rotulo = document.createElement('label');
        rotulo.className = 'caixa';
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.name = 'papeis';
        caixa.value = papel;
        caixa.checked = (pessoa.papeis ?? []).includes(papel);
        rotulo.append(caixa, ROTULO_PAPEL[papel] ?? papel);
        grupo.append(rotulo);
    }
    const erroPapeis = document.createElement('span');
    erroPapeis.className = 'erro';
    erroPapeis.dataset.erroPara = 'papeis';
    const geral = document.createElement('p');
    geral.className = 'erro';
    geral.dataset.erroGeral = '';
    geral.hidden = true;
    const salvar = criarBotao('Salvar papéis', 'submit', 'botao pequeno');
    salvar.dataset.acao = 'salvar-papeis';
    form.append(grupo, erroPapeis, geral, salvar);

    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    const alternar = criarBotao(pessoa.ativo ? 'Desativar conta' : 'Reativar conta', 'button',
        `botao secundario pequeno${pessoa.ativo ? ' perigo' : ''}`);
    alternar.dataset.acao = pessoa.ativo ? 'desativar' : 'reativar';
    acoes.append(alternar);

    cartao.append(topo, form, acoes);
    return cartao;
}

function mostrarEstadoEquipe(estado, mensagem, quantidade = 0) {
    document.getElementById('equipe-carregando').hidden = estado !== 'carregando';
    document.getElementById('equipe-erro').hidden = estado !== 'erro';
    document.getElementById('equipe-erro-mensagem').textContent = mensagem ?? '';
    document.getElementById('equipe-vazio').hidden = !(estado === 'pronto' && quantidade === 0);
    listaEquipe.hidden = !(estado === 'pronto' && quantidade > 0);
}

// Busca a lista (com a busca em uso) e refaz os cartões. Devolve true se mostrou a lista.
async function carregarEquipe() {
    const minha = ++cargaEquipe;
    mostrarEstadoEquipe('carregando');
    try {
        const consulta = buscaEquipe ? `busca=${encodeURIComponent(buscaEquipe)}` : undefined;
        const r = await chamarFuncao('equipe', { consulta });
        if (minha !== cargaEquipe) return false;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return false;
        }
        if (r.status !== 200 || !Array.isArray(r.dados?.pessoas)) {
            mostrarEstadoEquipe('erro', r.dados?.erro ?? ERRO_CARREGAR);
            return false;
        }
        listaEquipe.replaceChildren(...r.dados.pessoas.map(cartaoDaPessoa));
        mostrarEstadoEquipe('pronto', null, r.dados.pessoas.length);
        return true;
    } catch (erro) {
        console.error(erro);
        if (minha === cargaEquipe) mostrarEstadoEquipe('erro', ERRO_CARREGAR);
        return false;
    }
}

// PUT equipe. 200: recarrega a lista e avisa o sucesso; 400 com campos: erro no cartão;
// 401/conta desativada: sai; outro (409, 404...): aviso de erro e a lista é recarregada.
async function mudarPessoa(cartao, corpo, textoSucesso, form = null) {
    avisar(null);
    await ocupado(cartao, async () => {
        const r = await chamarFuncao('equipe', { metodo: 'PUT', corpo: { usuario_id: cartao.dataset.id, ...corpo } });
        if (r.status === 200) {
            const mostrou = await carregarEquipe();
            avisar(mostrou ? textoSucesso : `${textoSucesso} Mas não deu para atualizar a lista.`, { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos && form) {
            mostrarErros(form, r.dados.campos);
        } else {
            const mensagem = r.dados?.erro ?? ERRO_PADRAO;
            await carregarEquipe();
            avisar(mensagem);
        }
    });
}

listaEquipe.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.target;
    limparErros(form);
    const marcados = [...form.querySelectorAll('input[name="papeis"]:checked')].map((caixa) => caixa.value);
    mudarPessoa(form.closest('li.pessoa'), { papeis: marcados }, 'Papéis salvos.', form);
});

listaEquipe.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao="desativar"], button[data-acao="reativar"]');
    if (!botao) return;
    const cartao = botao.closest('li.pessoa');
    if (botao.dataset.acao === 'desativar') {
        if (!confirm(`Desativar a conta de ${cartao.dataset.nome}? A pessoa não vai mais conseguir entrar.`)) return;
        mudarPessoa(cartao, { acao: 'desativar' }, 'Conta desativada.');
    } else {
        mudarPessoa(cartao, { acao: 'reativar' }, 'Conta reativada.');
    }
});

// Menos de 2 caracteres: não consulta pessoas; mostra a lista da equipe.
document.getElementById('form-busca-equipe').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const texto = campoBuscaEquipe.value.trim();
    buscaEquipe = texto.length >= 2 ? texto : '';
    avisar(null);
    ocupado(evento.currentTarget, carregarEquipe);
});

document.getElementById('botao-recarregar-equipe').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarEquipe);
});

// Carrega toda vez que a aba é aberta, para mostrar o estado de agora.
function abrirAbaEquipe() {
    carregarEquipe();
}

// ---------- Aba Agendamentos ----------
// A visão do administrativo. Duas vistas na mesma aba: a lista (filtros + tabela, que vira cartões no
// celular) e o detalhe de um agendamento (responsável, participantes e histórico). Abrir o detalhe
// chama o GET painel-agendamentos?id=, e o servidor registra esse acesso aos dados pessoais.
// Datas e horas aparecem sempre no relógio do fuso do estande (configuração "estande").

const DIAS_PADRAO_AGENDAMENTOS = 15;
const SEM_VALOR = '—';
const TEXTO_MODALIDADE = {
    estande: 'Arma e munição do estande',
    arma_propria: 'Arma própria com munição do estande',
    tudo_proprio: 'Arma e munição próprias',
};

const formFiltros = document.getElementById('form-filtros-agendamentos');
const linhasAgendamentos = document.getElementById('linhas-agendamentos');
const vistaDetalhe = document.getElementById('agendamentos-vista-detalhe');
let fusoEstande = null;         // fuso do estande (GET configuracoes, chave estande)
let cargaAgendamentos = 0;      // número da última carga da lista: respostas atrasadas são ignoradas
let cargaDetalhe = 0;           // o mesmo, para o detalhe
let agendamentoAberto = null;   // id do agendamento mostrado no detalhe (para voltar à linha dele)
let agendamentosAbertos = false;

function opcao(valor, texto) {
    const el = document.createElement('option');
    el.value = valor;
    el.textContent = texto;
    return el;
}

// Situação: "Todas" e as seis, montadas uma vez só.
function montarSituacoes() {
    formFiltros.elements.situacao.replaceChildren(opcao('', 'Todas'),
        ...Object.entries(TEXTO_SITUACAO).map(([valor, texto]) => opcao(valor, texto)));
}

// Instrutor: "Todos" e a lista que veio na resposta, sem perder o escolhido.
function preencherInstrutores(instrutores) {
    const select = formFiltros.elements.instrutor_id;
    const escolhido = select.value;
    select.replaceChildren(opcao('', 'Todos'), ...(instrutores ?? []).map((i) => opcao(i.id, i.nome)));
    select.value = escolhido;
    if (select.selectedIndex < 0) select.value = '';
}

// O fuso do estande: o da aba Configurações, se já foi carregado; senão, GET configuracoes
// (qualquer pessoa logada pode ler). Devolve o fuso, ou null (o erro já foi mostrado ou a pessoa
// foi mandada para entrar).
async function obterFuso() {
    if (fusoEstande) return fusoEstande;
    if (configuracoes?.estande?.fuso) {
        fusoEstande = configuracoes.estande.fuso;
        return fusoEstande;
    }
    const r = await chamarFuncao('configuracoes');
    if (precisaEntrar(r)) {
        await irParaEntrar();
        return null;
    }
    const fuso = r.dados?.configuracoes?.estande?.fuso;
    if (r.status !== 200 || !fuso) {
        mostrarErroGeral(formFiltros, r.dados?.erro ?? ERRO_CARREGAR);
        return null;
    }
    fusoEstande = fuso;
    return fuso;
}

// Datas em branco ganham o padrão: de hoje até hoje + 15 dias, no fuso do estande.
function preencherDatasPadrao(fuso) {
    const { de, ate } = formFiltros.elements;
    if (de.value || ate.value) return;
    de.value = dataNoFuso(new Date(), fuso);
    ate.value = somarDias(de.value, DIAS_PADRAO_AGENDAMENTOS);
}

function filtrosDoFormulario() {
    const campos = formFiltros.elements;
    return {
        de: campos.de.value,
        ate: campos.ate.value,
        situacao: campos.situacao.value,
        instrutor_id: campos.instrutor_id.value,
        busca: campos.busca.value,
    };
}

// estado: 'carregando', 'pronto' (com a quantidade de linhas) ou 'nada' (erro, mostrado no formulário).
function mostrarEstadoAgendamentos(estado, { quantidade = 0, limite = false } = {}) {
    const pronto = estado === 'pronto';
    document.getElementById('agendamentos-carregando').hidden = estado !== 'carregando';
    document.getElementById('agendamentos-vazio').hidden = !(pronto && quantidade === 0);
    document.getElementById('agendamentos-limite').hidden = !(pronto && limite);
    document.getElementById('tabela-agendamentos').hidden = !(pronto && quantidade > 0);
}

// Célula com uma ou mais linhas de texto (ex.: nome e telefone do responsável).
function celulaDeTextos(coluna, textos) {
    const caixa = document.createElement('div');
    caixa.className = 'celula-texto';
    for (const texto of textos) {
        const linha = document.createElement('span');
        linha.textContent = texto;
        caixa.append(linha);
    }
    return celula(coluna, caixa);
}

const listaOuTraco = (itens) => (itens.length ? itens : [SEM_VALOR]);
const textoDasPistas = (pistas) => (pistas ?? []).map((numero) => `Pista ${numero}`);
const textoDasArmas = (armas) => (armas ?? []).map((arma) => {
    const modelo = arma.modelo ?? 'Arma';
    return arma.numero_registro ? `${modelo} (nº ${arma.numero_registro})` : modelo;
});

function rotuloDaSituacao(situacao) {
    const rotulo = document.createElement('span');
    rotulo.className = 'rotulo';
    rotulo.dataset.situacao = situacao;
    rotulo.textContent = TEXTO_SITUACAO[situacao] ?? situacao;
    return rotulo;
}

// Uma linha por agendamento. A linha inteira abre o detalhe (clique, Enter ou espaço).
function linhaDoAgendamento(a) {
    const linha = document.createElement('tr');
    linha.className = 'clicavel';
    linha.dataset.id = a.id;
    linha.tabIndex = 0;
    const responsavel = [a.responsavel?.nome_completo || 'Sem nome'];
    if (a.responsavel?.telefone) responsavel.push(formatarTelefone(a.responsavel.telefone));
    linha.append(
        celula('Sessão', descreverSessao(a.inicio, a.horas, fusoEstande)),
        celula('Situação', rotuloDaSituacao(a.situacao)),
        celulaDeTextos('Responsável', responsavel),
        celula('Pessoas', String(a.participantes_qtd ?? 0)),
        celulaDeTextos('Instrutores', listaOuTraco(a.instrutores ?? [])),
        celulaDeTextos('Pistas', listaOuTraco(textoDasPistas(a.pistas))),
        celulaDeTextos('Armas', listaOuTraco(textoDasArmas(a.armas))),
    );
    return linha;
}

// Busca a lista com os filtros do formulário. 400 com campos: o erro vai para baixo de cada filtro;
// outro erro: no fim do formulário.
async function carregarAgendamentos() {
    const minha = ++cargaAgendamentos;
    limparErros(formFiltros);
    mostrarEstadoAgendamentos('carregando');
    try {
        const fuso = await obterFuso();
        if (minha !== cargaAgendamentos) return;
        if (!fuso) {
            mostrarEstadoAgendamentos('nada');
            return;
        }
        preencherDatasPadrao(fuso);
        const consulta = consultaDosFiltros(filtrosDoFormulario());
        const r = await chamarFuncao('painel-agendamentos', { consulta: consulta || undefined });
        if (minha !== cargaAgendamentos) return;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return;
        }
        if (r.status !== 200 || !Array.isArray(r.dados?.agendamentos)) {
            mostrarEstadoAgendamentos('nada');
            if (r.status === 400 && r.dados?.campos) mostrarErros(formFiltros, r.dados.campos);
            else mostrarErroGeral(formFiltros, r.dados?.erro ?? ERRO_CARREGAR);
            return;
        }
        preencherInstrutores(r.dados.instrutores);
        linhasAgendamentos.replaceChildren(...r.dados.agendamentos.map(linhaDoAgendamento));
        mostrarEstadoAgendamentos('pronto', {
            quantidade: r.dados.agendamentos.length,
            limite: r.dados.limite_atingido === true,
        });
    } catch (erro) {
        console.error(erro);
        if (minha !== cargaAgendamentos) return;
        mostrarEstadoAgendamentos('nada');
        mostrarErroGeral(formFiltros, ERRO_CARREGAR);
    }
}

formFiltros.addEventListener('submit', (evento) => {
    evento.preventDefault();
    avisar(null);
    ocupado(formFiltros, carregarAgendamentos);
});

// ----- Detalhe -----

function mostrarVistaAgendamentos(vista) {
    document.getElementById('agendamentos-vista-lista').hidden = vista !== 'lista';
    vistaDetalhe.hidden = vista !== 'detalhe';
}

function mostrarEstadoDetalhe(estado, mensagem) {
    document.getElementById('detalhe-carregando').hidden = estado !== 'carregando';
    document.getElementById('detalhe-erro').hidden = estado !== 'erro';
    document.getElementById('detalhe-erro-mensagem').textContent = mensagem ?? '';
    document.getElementById('detalhe-conteudo').hidden = estado !== 'pronto';
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA'.
function dataBrasileira(data) {
    const [ano, mes, dia] = String(data ?? '').split('-');
    return dia ? `${dia}/${mes}/${ano}` : SEM_VALOR;
}

function armaDoParticipante(p) {
    if (p.modalidade === 'estande') return `${p.modelo ?? 'Arma'}, do estande`;
    const arma = p.arma_propria;
    if (!arma) return 'Arma própria';
    let texto = arma.modelo ?? 'Arma';
    if (arma.calibre) texto += ` (${arma.calibre})`;
    if (arma.numero_registro) texto += `, nº ${arma.numero_registro}`;
    return `${texto}, arma própria`;
}

function municaoDoParticipante(p) {
    if (p.modalidade === 'tudo_proprio' || !p.tipo_municao) return 'Própria';
    return `${p.municao_qtd ?? 0} × ${p.tipo_municao}`;
}

// Lista de pares nome → valor (dl).
function dadosEmLista(pares) {
    const lista = document.createElement('dl');
    lista.className = 'dados';
    for (const [nome, valor] of pares) {
        const par = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = nome;
        const dd = document.createElement('dd');
        dd.textContent = valor;
        par.append(dt, dd);
        lista.append(par);
    }
    return lista;
}

function cartaoDoParticipante(p) {
    const cartao = document.createElement('li');
    cartao.className = 'participante';
    const nome = document.createElement('p');
    nome.className = 'pessoa-nome';
    nome.textContent = p.nome_completo;
    const pares = [
        ['CPF', p.cpf ? formatarCpf(p.cpf) : SEM_VALOR],
        ['Nascimento', dataBrasileira(p.data_nascimento)],
        ['Modalidade', TEXTO_MODALIDADE[p.modalidade] ?? p.modalidade],
        ['Arma', armaDoParticipante(p)],
        ['Munição', municaoDoParticipante(p)],
    ];
    if (p.termo_versao !== null && p.termo_versao !== undefined) pares.push(['Termo', `Aceito na versão ${p.termo_versao}`]);
    cartao.append(nome, dadosEmLista(pares));
    return cartao;
}

function preencherDetalhe({ agendamento: a, historico }) {
    document.getElementById('detalhe-sessao').textContent = descreverSessao(a.inicio, a.horas, fusoEstande);
    document.getElementById('detalhe-situacao').replaceChildren(rotuloDaSituacao(a.situacao));
    document.getElementById('detalhe-instrutores').textContent = listaOuTraco(a.instrutores ?? []).join(', ');
    document.getElementById('detalhe-pistas').textContent = listaOuTraco(textoDasPistas(a.pistas)).join(', ');
    document.getElementById('detalhe-armas').textContent = listaOuTraco(textoDasArmas(a.armas)).join(', ');

    const resp = a.responsavel ?? {};
    const valores = {
        nome: resp.nome_completo || SEM_VALOR,
        email: resp.email || SEM_VALOR,
        cpf: resp.cpf ? formatarCpf(resp.cpf) : SEM_VALOR,
        telefone: resp.telefone ? formatarTelefone(resp.telefone) : SEM_VALOR,
    };
    const responsavel = document.getElementById('detalhe-responsavel');
    for (const [campo, valor] of Object.entries(valores)) {
        responsavel.querySelector(`[data-campo="${campo}"]`).textContent = valor;
    }

    document.getElementById('detalhe-participantes').replaceChildren(...(a.participantes ?? []).map(cartaoDoParticipante));

    // Uma linha por evento, na ordem em que aconteceram (o servidor já manda em ordem).
    const eventos = historico ?? [];
    document.getElementById('detalhe-historico').replaceChildren(...eventos.map((evento) => {
        const item = document.createElement('li');
        item.textContent = `${dataHoraNoFuso(evento.em, fusoEstande)} · ${evento.autor || 'Sistema'} · ${descreverEvento(evento)}`;
        return item;
    }));
    document.getElementById('detalhe-historico-vazio').hidden = eventos.length > 0;
}

async function abrirDetalhe(id) {
    const minha = ++cargaDetalhe;
    agendamentoAberto = id;
    avisar(null);
    mostrarVistaAgendamentos('detalhe');
    mostrarEstadoDetalhe('carregando');
    window.scrollTo(0, 0);
    document.getElementById('botao-voltar-agendamentos').focus({ preventScroll: true });
    try {
        const r = await chamarFuncao('painel-agendamentos', { consulta: `id=${encodeURIComponent(id)}` });
        if (minha !== cargaDetalhe) return;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return;
        }
        if (r.status !== 200 || !r.dados?.agendamento) {
            mostrarEstadoDetalhe('erro', r.dados?.erro ?? ERRO_CARREGAR);
            return;
        }
        preencherDetalhe(r.dados);
        mostrarEstadoDetalhe('pronto');
    } catch (erro) {
        console.error(erro);
        if (minha === cargaDetalhe) mostrarEstadoDetalhe('erro', ERRO_CARREGAR);
    }
}

// Volta para a lista como ela estava, com o foco na linha que foi aberta.
function voltarParaLista() {
    cargaDetalhe++;
    avisar(null);
    mostrarVistaAgendamentos('lista');
    const linha = [...linhasAgendamentos.querySelectorAll('tr[data-id]')].find((tr) => tr.dataset.id === agendamentoAberto);
    agendamentoAberto = null;
    if (linha) {
        linha.scrollIntoView?.({ block: 'center' });
        linha.focus({ preventScroll: true });
    }
}

linhasAgendamentos.addEventListener('click', (evento) => {
    const linha = evento.target.closest('tr[data-id]');
    if (linha) abrirDetalhe(linha.dataset.id);
});

linhasAgendamentos.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    if (!evento.target.matches('tr[data-id]')) return;
    evento.preventDefault();
    abrirDetalhe(evento.target.dataset.id);
});

document.getElementById('botao-voltar-agendamentos').addEventListener('click', voltarParaLista);

// Na primeira vez, carrega com o período padrão. Depois, os filtros continuam como estavam e a
// lista é carregada de novo (estado de agora); se o detalhe estava aberto, ele continua aberto.
function abrirAbaAgendamentos() {
    if (agendamentosAbertos && !vistaDetalhe.hidden) return;
    agendamentosAbertos = true;
    ocupado(formFiltros, carregarAgendamentos);
}

montarSituacoes();

// ---------- Início ----------

function mostrarErroCarregar(mensagem) {
    document.getElementById('erro-carregar-mensagem').textContent = mensagem ?? ERRO_CARREGAR;
    mostrarTela('tela-erro');
}

async function carregar() {
    mostrarTela('tela-carregando');
    const r = await chamarFuncao('minha-conta');
    if (precisaEntrar(r)) return irParaEntrar();
    if (r.status !== 200) return mostrarErroCarregar(r.dados?.erro);
    papeis = r.dados.papeis ?? [];
    meuId = r.dados.id ?? null;
    document.getElementById('nome-equipe').textContent = r.dados.perfil?.nome_completo ?? r.dados.email ?? '';
    document.getElementById('topo-conta').hidden = false;

    const visiveis = montarAbas();
    if (visiveis.length === 0) return mostrarTela('tela-sem-acesso');
    mostrarTela('tela-admin');
    escolherAba(visiveis[0]);
}

function carregarComErro() {
    return carregar().catch((erro) => {
        console.error(erro);
        mostrarErroCarregar(null);
    });
}

document.getElementById('botao-tentar-de-novo').addEventListener('click', () => {
    ocupado(document.getElementById('tela-erro'), carregarComErro);
});

async function iniciar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    return carregarComErro();
}

iniciar().catch((erro) => {
    console.error(erro);
    mostrarErroCarregar(null);
});
