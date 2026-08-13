-- COO control plane for school tenants.
-- Tenant operational data remains in each school's private schema.

create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  department_name text,
  domain_code text not null,
  schema_name text not null,
  status text not null default 'provisioning'
    check (status in ('pending', 'provisioning', 'active', 'suspended', 'cancelled', 'failed')),
  plan text not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schools_domain_code_format check (domain_code ~ '^[a-z]{3,}$'),
  constraint schools_domain_code_unique unique (domain_code),
  constraint schools_schema_name_unique unique (schema_name)
);

-- Backfill control-plane columns when the legacy public.schools table already exists.
alter table public.schools add column if not exists school_name text;
alter table public.schools add column if not exists department_name text;
alter table public.schools add column if not exists schema_name text;
alter table public.schools add column if not exists status text default 'provisioning';
alter table public.schools add column if not exists plan text default 'standard';
alter table public.schools add column if not exists updated_at timestamptz default now();

update public.schools
set school_name = coalesce(school_name, name),
    department_name = coalesce(department_name, department),
    status = coalesce(status, 'provisioning'),
    plan = coalesce(plan, 'standard'),
    updated_at = coalesce(updated_at, created_at, now())
where school_name is null or department_name is null or status is null or plan is null or updated_at is null;

create table if not exists public.school_contacts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  contact_name text not null,
  email text not null,
  phone text,
  role text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists school_contacts_one_primary
  on public.school_contacts (school_id)
  where is_primary;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  plan text not null,
  billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'yearly', 'one_time')),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  currency text not null default 'KRW',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  renewed_at timestamptz,
  status text not null default 'active'
    check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  payment_provider text,
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  domain_code text not null,
  hostname text not null,
  vercel_domain_id text,
  dns_status text not null default 'pending'
    check (dns_status in ('pending', 'verifying', 'verified', 'failed')),
  ssl_status text not null default 'pending'
    check (ssl_status in ('pending', 'active', 'failed')),
  verified_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domains_domain_code_format check (domain_code ~ '^[a-z]{3,}$'),
  constraint domains_domain_code_unique unique (domain_code),
  constraint domains_hostname_unique unique (hostname)
);

create table if not exists public.school_provisioning (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null unique references public.schools(id) on delete cascade,
  schema_name text not null,
  provision_status text not null default 'pending'
    check (provision_status in ('pending', 'creating_schema', 'creating_tables', 'seeding_data', 'ready', 'failed', 'retrying')),
  provisioned_at timestamptz,
  last_error text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint provisioning_schema_name_unique unique (schema_name)
);

create index if not exists schools_status_idx on public.schools(status);
create index if not exists school_contacts_school_idx on public.school_contacts(school_id);
create index if not exists subscriptions_school_status_idx on public.subscriptions(school_id, status);
create index if not exists domains_school_idx on public.domains(school_id);
create index if not exists provisioning_status_idx on public.school_provisioning(provision_status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists schools_set_updated_at on public.schools;
create trigger schools_set_updated_at before update on public.schools
for each row execute function public.set_updated_at();

drop trigger if exists school_contacts_set_updated_at on public.school_contacts;
create trigger school_contacts_set_updated_at before update on public.school_contacts
for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists domains_set_updated_at on public.domains;
create trigger domains_set_updated_at before update on public.domains
for each row execute function public.set_updated_at();

drop trigger if exists provisioning_set_updated_at on public.school_provisioning;
create trigger provisioning_set_updated_at before update on public.school_provisioning
for each row execute function public.set_updated_at();

alter table public.schools enable row level security;
alter table public.school_contacts enable row level security;
alter table public.subscriptions enable row level security;
alter table public.domains enable row level security;
alter table public.school_provisioning enable row level security;

-- No anon access. Add explicit COO/admin policies after the admin identity model is chosen.
revoke all on public.schools, public.school_contacts, public.subscriptions,
  public.domains, public.school_provisioning from anon;

comment on table public.schools is 'COO tenant registry; operational data lives in schema_name.';
comment on table public.school_contacts is 'Primary and secondary contacts for each school.';
comment on table public.subscriptions is 'Commercial subscription and billing metadata; never store card data.';
comment on table public.domains is 'Custom subdomain, DNS, Vercel, and SSL provisioning state.';
comment on table public.school_provisioning is 'Idempotent school schema/table creation workflow state.';
