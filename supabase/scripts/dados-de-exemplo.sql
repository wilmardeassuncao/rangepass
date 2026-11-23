-- Dados de exemplo para testar o agendamento à mão.
-- SÓ PARA O PROJETO DE DESENVOLVIMENTO. Nunca rode isto no banco de um estande de verdade.
-- Como usar: abra o painel do Supabase → SQL Editor, cole este texto,
-- troque INSTRUTOR-1@exemplo.com e INSTRUTOR-2@exemplo.com pelos e-mails das duas
-- contas de instrutor (criadas em conta.html e já confirmadas por e-mail) e clique em Run.
-- Pode rodar mais de uma vez: o que já existe não é duplicado.

-- Categorias
insert into public.categorias (nome) values
    ('Pistola'), ('Revólver'), ('Carabina'), ('Fuzil'), ('Espingarda')
on conflict do nothing;

-- Calibres
insert into public.calibres (nome) values
    ('9mm'), ('.380 ACP'), ('.40 S&W'), ('.38 SPL'), ('.357 Magnum'),
    ('.22 LR'), ('5,56x45mm'), ('7,62x51mm'), ('12')
on conflict do nothing;

-- Modelos (os ids de categoria e calibre são buscados pelo nome)
insert into public.modelos (categoria_id, calibre_id, marca, nome)
select c.id, k.id, v.marca, v.nome
from (values
    ('Pistola',    '9mm',         'Glock',      'G17'),
    ('Pistola',    '.380 ACP',    'Glock',      'G25'),
    ('Pistola',    '9mm',         'Taurus',     'TS9'),
    ('Pistola',    '9mm',         'CZ',         'Shadow 2'),
    ('Pistola',    '9mm',         'Sig Sauer',  'P320'),
    ('Pistola',    '.40 S&W',     'Imbel',      'MD7'),
    ('Revólver',   '.38 SPL',     'Taurus',     'RT 82S'),
    ('Revólver',   '.357 Magnum', 'Taurus',     'RT 627'),
    ('Carabina',   '.22 LR',      'CBC',        '7022'),
    ('Carabina',   '5,56x45mm',   'Taurus',     'T4'),
    ('Fuzil',      '5,56x45mm',   'Colt',       'AR-15'),
    ('Fuzil',      '5,56x45mm',   'Imbel',      'IA2'),
    ('Fuzil',      '7,62x51mm',   'Imbel',      'FAL'),
    ('Espingarda', '12',          'CBC',        'Pump Military 3.0')
) as v (categoria, calibre, marca, nome)
join public.categorias c on c.nome = v.categoria
join public.calibres k on k.nome = v.calibre
on conflict do nothing;

-- Tipos de munição (um por calibre)
insert into public.tipos_municao (calibre_id, nome)
select k.id, v.nome
from (values
    ('9mm',         'ETOG'),
    ('.380 ACP',    'ETOG'),
    ('.40 S&W',     'ETOG'),
    ('.38 SPL',     'CHOG'),
    ('.357 Magnum', 'EXPO'),
    ('.22 LR',      'CHOG'),
    ('5,56x45mm',   'ETOG'),
    ('7,62x51mm',   'ETOG'),
    ('12',          'Chumbo 3T')
) as v (calibre, nome)
join public.calibres k on k.nome = v.calibre
on conflict do nothing;

-- Unidades: duas armas físicas por modelo, com registro EXEMPLO-<marca>-<nome>-1 e -2
insert into public.unidades_arma (modelo_id, numero_registro, situacao)
select m.id, 'EXEMPLO-' || m.marca || '-' || m.nome || '-' || n.n, 'disponivel'
from public.modelos m
cross join (values (1), (2)) as n (n)
where (m.marca, m.nome) in (
    ('Glock', 'G17'), ('Glock', 'G25'), ('Taurus', 'TS9'), ('CZ', 'Shadow 2'),
    ('Sig Sauer', 'P320'), ('Imbel', 'MD7'), ('Taurus', 'RT 82S'), ('Taurus', 'RT 627'),
    ('CBC', '7022'), ('Taurus', 'T4'), ('Colt', 'AR-15'), ('Imbel', 'IA2'),
    ('Imbel', 'FAL'), ('CBC', 'Pump Military 3.0')
)
on conflict do nothing;

-- Pistas 1 a 4
insert into public.pistas (numero) values (1), (2), (3), (4)
on conflict do nothing;

-- Instrutores: troque os dois e-mails abaixo pelos das contas de instrutor.
insert into public.papeis_usuario (usuario_id, papel)
select id, 'instrutor' from auth.users
where email in ('INSTRUTOR-1@exemplo.com', 'INSTRUTOR-2@exemplo.com')
on conflict do nothing;

-- Preços de exemplo. São valores de exemplo, baseados numa pesquisa de mercado de 2025
-- (Brasília e a média das faixas de preço no Brasil). Cada estande deve cadastrar os seus
-- na aba Preços da área da equipe.
-- Só preenche o que ainda está vazio: um preço que você já cadastrou na aba Preços nunca
-- é trocado. Rodar de novo não muda nada (o "is null" deixa de fora tudo o que já tem
-- preço, e assim nada novo vai para o histórico).

-- Hora de pista: R$ 100,00 (10000 centavos). As outras chaves de "precos" ficam como estão.
update public.configuracoes
set valor = jsonb_set(valor, '{hora_pista_centavos}', '10000'::jsonb, true),
    atualizado_em = now()
where chave = 'precos'
  and valor ->> 'hora_pista_centavos' is null;

-- Aluguel por hora de cada modelo, pela categoria (em centavos).
update public.modelos m
set preco_hora_centavos = coalesce(m.preco_hora_centavos, v.centavos)
from (values
    ('Pistola',    5000),
    ('Revólver',   5000),
    ('Carabina',   4000),
    ('Fuzil',      9000),
    ('Espingarda', 6000)
) as v (categoria, centavos)
join public.categorias c on c.nome = v.categoria
where m.categoria_id = c.id
  and m.preco_hora_centavos is null;

-- Preço por unidade de cada munição, pelo calibre (em centavos).
update public.tipos_municao t
set preco_unidade_centavos = coalesce(t.preco_unidade_centavos, v.centavos)
from (values
    ('.22 LR',       250),
    ('.380 ACP',     500),
    ('9mm',          600),
    ('.40 S&W',      650),
    ('.38 SPL',      500),
    ('.357 Magnum',  700),
    ('5,56x45mm',   1400),
    ('7,62x51mm',   1800),
    ('12',          1000)
) as v (calibre, centavos)
join public.calibres k on k.nome = v.calibre
where t.calibre_id = k.id
  and t.preco_unidade_centavos is null;

-- Confere. Esperado: categorias 5, calibres 9, modelos 14, tipos_municao 9,
-- unidades 28, pistas 4, instrutores 2, modelos_com_preco 14, tipos_municao_com_preco 9
-- e hora_pista_centavos 10000 (ou o valor que você já tinha cadastrado na aba Preços).
select 'categorias' as item, count(*) as quantidade
from public.categorias where nome in ('Pistola', 'Revólver', 'Carabina', 'Fuzil', 'Espingarda')
union all
select 'calibres', count(*) from public.calibres
where nome in ('9mm', '.380 ACP', '.40 S&W', '.38 SPL', '.357 Magnum', '.22 LR', '5,56x45mm', '7,62x51mm', '12')
union all
select 'modelos', count(*) from public.modelos m
where exists (select 1 from public.unidades_arma u
              where u.modelo_id = m.id and u.numero_registro like 'EXEMPLO-%')
union all
select 'tipos_municao', count(*) from public.tipos_municao t
where exists (select 1 from public.calibres k
              where k.id = t.calibre_id
                and k.nome in ('9mm', '.380 ACP', '.40 S&W', '.38 SPL', '.357 Magnum',
                               '.22 LR', '5,56x45mm', '7,62x51mm', '12'))
  and t.nome in ('ETOG', 'CHOG', 'EXPO', 'Chumbo 3T')
union all
select 'unidades', count(*) from public.unidades_arma where numero_registro like 'EXEMPLO-%'
union all
select 'pistas', count(*) from public.pistas where numero between 1 and 4
union all
select 'instrutores', count(*) from public.papeis_usuario where papel = 'instrutor'
union all
select 'modelos_com_preco', count(*) from public.modelos m
where m.preco_hora_centavos is not null
  and exists (select 1 from public.unidades_arma u
              where u.modelo_id = m.id and u.numero_registro like 'EXEMPLO-%')
union all
select 'tipos_municao_com_preco', count(*) from public.tipos_municao t
where t.preco_unidade_centavos is not null
  and exists (select 1 from public.calibres k
              where k.id = t.calibre_id
                and k.nome in ('9mm', '.380 ACP', '.40 S&W', '.38 SPL', '.357 Magnum',
                               '.22 LR', '5,56x45mm', '7,62x51mm', '12'))
  and t.nome in ('ETOG', 'CHOG', 'EXPO', 'Chumbo 3T')
union all
select 'hora_pista_centavos', (valor ->> 'hora_pista_centavos')::bigint
from public.configuracoes where chave = 'precos';
