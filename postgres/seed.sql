-- AdBrain — seed data
-- Seeds one workspace/brand/product row matching Creative OS's existing
-- PF / PF-COOKIE-BRK ids (see docs/03-DATA-MODEL.md §3.1) so rows can be
-- joined/synced across both databases without an id-mapping table.
-- Run after postgres/schema.sql, in adbrain_db.

begin;

insert into public.workspaces (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Pur'' Ferme Project', 'purferme')
on conflict (id) do nothing;

insert into public.brands (id, workspace_id, name)
values ('PF', '00000000-0000-0000-0000-000000000001', 'Pur'' Ferme Project')
on conflict (id) do nothing;

insert into public.products (id, workspace_id, brand_id, name)
values ('PF-COOKIE-BRK', '00000000-0000-0000-0000-000000000001', 'PF', 'Millet & Oats Breakfast Cookies')
on conflict (id) do nothing;

commit;

-- Verification helper.
select id, name from public.workspaces;
select id, workspace_id, name from public.brands;
select id, workspace_id, brand_id, name from public.products;
