-- ============================================================================
-- ConstructCo — Row Level Security (RLS) policies
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor > New query).
-- This is the REAL security control for this app. The anon key in app.js is
-- public by design; nothing about it needs to be hidden. Access is enforced
-- HERE, on the server, where the client cannot bypass it.
--
-- Run once. Safe to re-run: policies are dropped-if-exists before create.
--
-- Access model (mirrors PERMISSIONS + loadAllowedSites in app.js):
--   admin      full access to everything
--   accountant read everything; add/edit cashbook only
--   supervisor scoped to assigned sites; workers CRUD, attendance add/edit,
--              material_entries add/edit (no deletes)
--   engineer   scoped to assigned sites; attendance add, material_entries add
--   (site scope: sites.supervisorid = uid, or uid = ANY(sites.engineerids))
-- ============================================================================

-- ── 0. LOCK ROLE ASSIGNMENT (closes the self-elevation hole) ────────────────
-- Role must NOT be settable by the user. This trigger forces every INSERT/
-- UPDATE from a normal client to keep a safe role. Only the service_role key
-- (server/admin) may set an arbitrary role. To promote someone to admin,
-- do it from the SQL editor or a trusted backend, e.g.:
--     update public.profiles set role = 'admin' where email = 'boss@co.com';

create or replace function public.enforce_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (server-side) bypasses the lock entirely.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- New self-service signups always start non-privileged.
    new.role := 'supervisor';
  elsif tg_op = 'UPDATE' then
    -- Normal users can never change their own role.
    new.role := old.role;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_profile_role on public.profiles;
create trigger trg_enforce_profile_role
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_role();

-- ── 1. HELPER FUNCTIONS ─────────────────────────────────────────────────────
-- SECURITY DEFINER so they read profiles/sites without tripping RLS recursion.

-- Current user's authoritative role (from profiles, NOT user_metadata).
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- True if the current user may see/act on rows belonging to a given site.
create or replace function public.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_app_role() in ('admin', 'accountant')
    or exists (
      select 1
      from public.sites s
      where s.id = p_site_id
        and (
          s.supervisorid = auth.uid()
          or auth.uid() = any(coalesce(s.engineerids, '{}'::uuid[]))
        )
    );
$$;

-- ── 2. ENABLE RLS ON EVERY TABLE ────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.sites            enable row level security;
alter table public.workers          enable row level security;
alter table public.materials_master enable row level security;
alter table public.attendance       enable row level security;
alter table public.material_entries enable row level security;
alter table public.cashbook         enable row level security;

-- ── 3. PROFILES ─────────────────────────────────────────────────────────────
-- Read: any authenticated user (app populates supervisor/engineer dropdowns).
-- Write: own row only (role is force-locked by the trigger above).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated using (public.current_app_role() = 'admin');

-- ── 4. SITES ────────────────────────────────────────────────────────────────
-- Read: scoped by can_access_site. Write: admin only.
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites
  for select to authenticated using (public.can_access_site(id));

drop policy if exists sites_write_admin on public.sites;
create policy sites_write_admin on public.sites
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ── 5. WORKERS ──────────────────────────────────────────────────────────────
-- Read: any accessible site. Add/Edit/Delete: admin or supervisor on the site.
drop policy if exists workers_select on public.workers;
create policy workers_select on public.workers
  for select to authenticated using (public.can_access_site(site_id));

drop policy if exists workers_insert on public.workers;
create policy workers_insert on public.workers
  for insert to authenticated
  with check (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  );

drop policy if exists workers_update on public.workers;
create policy workers_update on public.workers
  for update to authenticated
  using (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  )
  with check (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  );

drop policy if exists workers_delete on public.workers;
create policy workers_delete on public.workers
  for delete to authenticated
  using (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  );

-- ── 6. MATERIALS_MASTER (catalog) ───────────────────────────────────────────
-- Read: any authenticated. Write: admin only.
drop policy if exists matmaster_select on public.materials_master;
create policy matmaster_select on public.materials_master
  for select to authenticated using (true);

drop policy if exists matmaster_write_admin on public.materials_master;
create policy matmaster_write_admin on public.materials_master
  for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

-- ── 7. ATTENDANCE ───────────────────────────────────────────────────────────
-- Read: accessible site. Add: admin/supervisor/engineer. Edit: admin/supervisor.
-- Delete: admin only.
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated using (public.can_access_site(site_id));

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    public.current_app_role() in ('admin', 'supervisor', 'engineer')
    and public.can_access_site(site_id)
  );

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  )
  with check (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  );

drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated
  using (public.current_app_role() = 'admin' and public.can_access_site(site_id));

-- ── 8. MATERIAL_ENTRIES ─────────────────────────────────────────────────────
-- Same shape as attendance.
drop policy if exists matentries_select on public.material_entries;
create policy matentries_select on public.material_entries
  for select to authenticated using (public.can_access_site(site_id));

drop policy if exists matentries_insert on public.material_entries;
create policy matentries_insert on public.material_entries
  for insert to authenticated
  with check (
    public.current_app_role() in ('admin', 'supervisor', 'engineer')
    and public.can_access_site(site_id)
  );

drop policy if exists matentries_update on public.material_entries;
create policy matentries_update on public.material_entries
  for update to authenticated
  using (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  )
  with check (
    public.current_app_role() in ('admin', 'supervisor')
    and public.can_access_site(site_id)
  );

drop policy if exists matentries_delete on public.material_entries;
create policy matentries_delete on public.material_entries
  for delete to authenticated
  using (public.current_app_role() = 'admin' and public.can_access_site(site_id));

-- ── 9. CASHBOOK ─────────────────────────────────────────────────────────────
-- Read: accessible site (admin/accountant = all). Add/Edit: admin/accountant.
-- Delete: admin only.
drop policy if exists cashbook_select on public.cashbook;
create policy cashbook_select on public.cashbook
  for select to authenticated using (public.can_access_site(site_id));

drop policy if exists cashbook_insert on public.cashbook;
create policy cashbook_insert on public.cashbook
  for insert to authenticated
  with check (
    public.current_app_role() in ('admin', 'accountant')
    and public.can_access_site(site_id)
  );

drop policy if exists cashbook_update on public.cashbook;
create policy cashbook_update on public.cashbook
  for update to authenticated
  using (
    public.current_app_role() in ('admin', 'accountant')
    and public.can_access_site(site_id)
  )
  with check (
    public.current_app_role() in ('admin', 'accountant')
    and public.can_access_site(site_id)
  );

drop policy if exists cashbook_delete on public.cashbook;
create policy cashbook_delete on public.cashbook
  for delete to authenticated
  using (public.current_app_role() = 'admin' and public.can_access_site(site_id));

-- ============================================================================
-- POST-INSTALL NOTES
-- ----------------------------------------------------------------------------
-- 1. Promote your admin(s) AFTER running this (the trigger blocks self-promote):
--       update public.profiles set role = 'admin' where email = 'YOU@co.com';
--
-- 2. app.js reads currentRole from user_metadata.role, which is now only
--    cosmetic (UI show/hide). The SERVER now enforces the real role via
--    profiles.role. For consistency, consider updating showApp() to read the
--    role from the profiles table instead of user_metadata.
--
-- 3. Verify: log in as a supervisor and confirm you cannot read/modify sites
--    you aren't assigned to, and cannot touch cashbook. Try to self-promote
--    (update profiles set role='admin') — it must silently keep the old role.
-- ============================================================================
