create table public.site_settings (
  id smallint primary key default 1 check (id = 1),
  footer_terms_visible boolean not null default false,
  footer_terms_pdf_url text not null default '',
  footer_privacy_visible boolean not null default false,
  footer_privacy_pdf_url text not null default '',
  footer_cookie_visible boolean not null default false,
  footer_cookie_pdf_url text not null default '',
  constraint site_settings_terms_url_check check (
    footer_terms_pdf_url = '' or footer_terms_pdf_url ~* '^https://'
  ),
  constraint site_settings_visible_terms_check check (
    not footer_terms_visible or footer_terms_pdf_url <> ''
  ),
  constraint site_settings_privacy_url_check check (
    footer_privacy_pdf_url = '' or footer_privacy_pdf_url ~* '^https://'
  ),
  constraint site_settings_visible_privacy_check check (
    not footer_privacy_visible or footer_privacy_pdf_url <> ''
  ),
  constraint site_settings_cookie_url_check check (
    footer_cookie_pdf_url = '' or footer_cookie_pdf_url ~* '^https://'
  ),
  constraint site_settings_visible_cookie_check check (
    not footer_cookie_visible or footer_cookie_pdf_url <> ''
  )
);

insert into public.site_settings (
  id,
  footer_terms_visible,
  footer_terms_pdf_url,
  footer_privacy_visible,
  footer_privacy_pdf_url,
  footer_cookie_visible,
  footer_cookie_pdf_url
)
values (1, false, '', false, '', false, '')
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

create policy "Site settings are public"
on public.site_settings for select
using (true);

create policy "Admins can update site settings"
on public.site_settings for update
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.site_settings from anon, authenticated;
grant select on table public.site_settings to anon, authenticated;
grant update on table public.site_settings to authenticated;
