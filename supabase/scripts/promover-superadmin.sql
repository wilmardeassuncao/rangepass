-- Transforma uma conta já criada em superadmin.
-- Como usar: abra o painel do Supabase → SQL Editor, cole este texto,
-- troque SEU-EMAIL@exemplo.com pelo e-mail da conta e clique em Run.
-- Se a conta já for superadmin, nada muda.
insert into public.papeis_usuario (usuario_id, papel)
select id, 'superadmin' from auth.users where email = 'SEU-EMAIL@exemplo.com'
on conflict do nothing;

-- Confere: deve aparecer uma linha com o e-mail e o papel superadmin.
select u.email, p.papel
from public.papeis_usuario p join auth.users u on u.id = p.usuario_id
where u.email = 'SEU-EMAIL@exemplo.com';
