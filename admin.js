// Área da equipe (admin.html): a moldura (cabeçalho, abas e aviso) e uma seção por aba.
// Cada aba tem a sua função "abrirAba..." chamada quando ela é escolhida; as abas ainda sem
// função mostram "Em construção." (Tasks 8 e 9 do plano 4 trocam isso).
import { supabase, chamarFuncao } from './api.mjs';
import {
    NOMES_DIAS, abasVisiveis, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, numeroDoCampo,
    proximoNumeroDePista, rotuloSituacaoArma, mensagemCadastroSalvo, nomeDoModelo,
} from './admin-regras.mjs';
import { CHAVES_CONFIGURACAO, validarConfiguracao } from './supabase/functions/_shared/configuracoes.mjs';
import { SITUACOES_UNIDADE, validarCadastroCatalogo } from './supabase/functions/_shared/catalogo.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
const ENTRAR = 'conta.html?voltar=admin.html';
// Só este 403 quer dizer "sem acesso à conta". Outro 403 ("sem permissão") fica na tela, como erro.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let papeis = [];          // papéis de quem está logado (GET minha-conta)
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

// A função de abrir de cada aba. null = ainda em construção (o painel já mostra o aviso).
const ABRIR_ABA = {
    configuracoes: abrirAbaConfiguracoes,
    catalogo: abrirAbaCadastros,
    pistas: abrirAbaCadastros,
    equipe: null,
    agendamentos: null,
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

for (const chave of CHAVES_CONFIGURACAO) {
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
        for (const chave of CHAVES_CONFIGURACAO) {
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

// campos: o que o formulário mostra. escolha = lista de onde vêm as opções (pelo nome);
// fixo = só ao criar (o servidor não deixa mudar depois); soAoCriar = só ao criar, porque depois
// muda pela lista (a situação da arma). Ativo/ativa não entram: mudam pelo "Desativar"/"Reativar".
const CADASTROS = {
    categoria: {
        lista: 'categorias', nomeItem: 'categoria', campoAtivo: 'ativo',
        campos: [{ nome: 'nome', rotulo: 'Nome' }],
        colunas: (item) => [['Nome', item.nome]],
    },
    calibre: {
        lista: 'calibres', nomeItem: 'calibre', campoAtivo: 'ativo',
        campos: [{ nome: 'nome', rotulo: 'Nome' }],
        colunas: (item) => [['Nome', item.nome]],
    },
    modelo: {
        lista: 'modelos', nomeItem: 'modelo', campoAtivo: 'ativo',
        campos: [
            { nome: 'categoria_id', rotulo: 'Categoria', escolha: 'categorias' },
            { nome: 'calibre_id', rotulo: 'Calibre', escolha: 'calibres', fixo: true },
            { nome: 'marca', rotulo: 'Marca' },
            { nome: 'nome', rotulo: 'Nome' },
        ],
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [
            ['Modelo', nomeDoModelo(item)],
            ['Categoria', nomeNaLista('categorias', item.categoria_id)],
            ['Calibre', nomeNaLista('calibres', item.calibre_id)],
        ],
    },
    tipo_municao: {
        lista: 'tipos_municao', nomeItem: 'munição', campoAtivo: 'ativo',
        campos: [
            { nome: 'calibre_id', rotulo: 'Calibre', escolha: 'calibres', fixo: true },
            { nome: 'nome', rotulo: 'Nome' },
        ],
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [['Munição', item.nome], ['Calibre', nomeNaLista('calibres', item.calibre_id)]],
    },
    unidade: {
        lista: 'unidades', nomeItem: 'arma',
        campos: [
            { nome: 'modelo_id', rotulo: 'Modelo', escolha: 'modelos', fixo: true },
            { nome: 'numero_registro', rotulo: 'Nº de registro' },
            { nome: 'situacao', rotulo: 'Situação', situacao: true, soAoCriar: true },
        ],
        avisoAoEditar: 'O modelo não pode ser mudado depois de criado. A situação muda na lista.',
        colunas: (item) => [['Nº de registro', item.numero_registro], ['Modelo', nomeNaLista('modelos', item.modelo_id)]],
    },
    pista: {
        lista: 'pistas', nomeItem: 'pista', campoAtivo: 'ativa', rotulos: ['Ativa', 'Inativa'],
        campos: [],
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
