-- Domain restriction and bootstrap admin
update public.app_settings
set allowed_domain = 'shopup.org',
    bootstrap_admin_email = 'tasnim.piyash@shopup.org'
where id = 1;
