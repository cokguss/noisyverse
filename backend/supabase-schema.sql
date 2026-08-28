-- Noisy Verse — skema Supabase (model KV-blob)
-- Jalankan di Supabase SQL Editor sekali saat setup.
--
-- Semua data aplikasi (users, orders, packages, dst.) disimpan sebagai satu baris
-- per entitas di tabel kv_store. Kolom `data` bertipe jsonb menampung isi blob
-- (array atau objek) yang dulu berada di backend/data/*.json.

create table if not exists public.kv_store (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Akses hanya lewat service-role key dari server (Vercel). Aktifkan RLS agar
-- anon/public key TIDAK bisa membaca/menulis; service-role melewati RLS.
alter table public.kv_store enable row level security;

-- Seed awal (opsional — server juga melakukan seed idempoten saat boot).
-- Paket default:
insert into public.kv_store (key, data) values
  ('packages', '[
    {"id":"gratis","name":"Gratis","tagline":"Coba dulu rasanya","priceOld":null,"price":"Rp0","durationDays":0,"reverseQuota":1,"prdQuota":1,"benefits":["1x reverse website / repo","1x generate PRD AI (salin teks)","Lihat design system hasil scraping"],"featured":false,"active":true,"purchasable":false},
    {"id":"premium","name":"Premium","tagline":"Paling laris untuk kreator serius","priceOld":"Rp50rb","price":"Rp40rb","durationDays":30,"reverseQuota":50,"prdQuota":10,"benefits":["50x reverse website / repo","10x generate PRD AI","Unduh PRD.md langsung","Design system disertakan","Prioritas antrian scraping"],"featured":true,"active":true,"purchasable":true},
    {"id":"unlimited","name":"Unlimited","tagline":"Untuk yang hidup dari editing","priceOld":"Rp100rb","price":"Rp80rb","durationDays":30,"reverseQuota":null,"prdQuota":30,"benefits":["Reverse tanpa batas","30x generate PRD AI","Unduh PRD.md langsung","Semua fitur premium","Support prioritas 24/7","Update fitur gratis selamanya"],"featured":false,"active":true,"purchasable":true}
  ]'::jsonb)
on conflict (key) do nothing;

-- CATATAN: key 'visitors' di kv_store hanya dipakai sebagai FALLBACK bila tabel
-- statistik realtime di bagian bawah file ini belum dibuat. Sumber utama
-- statistik pengunjung kini tabel public.site_stats + public.visitor_hits.
insert into public.kv_store (key, data) values
  ('config', '{"maintenance": false}'::jsonb),
  ('users', '[]'::jsonb),
  ('orders', '[]'::jsonb),
  ('announcements', '[]'::jsonb),
  ('projects', '[]'::jsonb),
  ('coupons', '[]'::jsonb),
  ('visitors', '{"total": 0, "visitors": {}}'::jsonb),
  ('sessions', '{}'::jsonb),
  ('bot_state', '{"pending": {}, "codeToChat": {}, "chats": {}}'::jsonb),
  ('payments', '[
    {"id":"qris","type":"qris","name":"QRIS","accountName":"Noisy Verse","accountNumber":"","imageUrl":"","active":true},
    {"id":"bca","type":"bank","name":"BCA","accountName":"Noisy Verse","accountNumber":"1234567890","active":true},
    {"id":"dana","type":"ewallet","name":"DANA","accountName":"Noisy Verse","accountNumber":"0812-3456-7890","active":true}
  ]'::jsonb)
on conflict (key) do nothing;

-- ================================================================
-- STATISTIK PENGUNJUNG REALTIME
-- ================================================================
-- Tabel terpisah dari kv_store supaya bisa di-broadcast lewat Supabase Realtime
-- dan dibaca langsung browser dengan publishable key (read-only, tanpa PII).

-- Ringkasan counter — SATU baris (id = 1). Browser berlangganan perubahan baris
-- ini via postgres_changes, jadi angka berubah seketika tanpa polling.
create table if not exists public.site_stats (
  id              smallint primary key default 1,
  total_visits    bigint  not null default 0,
  unique_visitors bigint  not null default 0,
  live_now        integer not null default 0,
  reverses        bigint  not null default 0,
  prd             bigint  not null default 0,
  members         bigint  not null default 0,
  updated_at      timestamptz not null default now(),
  constraint site_stats_singleton check (id = 1)
);

insert into public.site_stats (id) values (1) on conflict (id) do nothing;

-- Jejak pengunjung unik. Menyimpan HASH SHA256(ip + salt), bukan IP asli.
create table if not exists public.visitor_hits (
  hash       text primary key,
  hits       integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create index if not exists visitor_hits_last_seen_idx
  on public.visitor_hits (last_seen desc);

-- ---------- Hak akses ----------
-- site_stats: boleh dibaca siapa pun (angka agregat, tidak sensitif).
alter table public.site_stats enable row level security;
drop policy if exists "site_stats_public_read" on public.site_stats;
create policy "site_stats_public_read"
  on public.site_stats for select
  to anon, authenticated
  using (true);
grant select on public.site_stats to anon, authenticated;

-- visitor_hits: RLS aktif TANPA policy => anon/authenticated ditolak total.
-- Hanya secret/service_role key di server yang bisa mengakses.
alter table public.visitor_hits enable row level security;
revoke all on public.visitor_hits from public, anon, authenticated;

-- ---------- Aktifkan Realtime untuk site_stats ----------
-- Idempoten: hanya menambah tabel bila belum ada di publication.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'site_stats'
  ) then
    alter publication supabase_realtime add table public.site_stats;
  end if;
end $$;

-- Kirim baris utuh saat UPDATE agar payload realtime berisi semua kolom.
alter table public.site_stats replica identity full;

-- ---------- Fungsi atomik: catat kunjungan ----------
-- Dipanggil server lewat RPC. Semua penghitungan terjadi di dalam Postgres
-- sehingga atomik — aman dari race condition antar invocation serverless
-- (berbeda dari model baca-ubah-tulis blob di kv_store).
-- Counter aplikasi (reverses/prd/members) ikut disinkronkan di sini supaya
-- satu kunjungan = satu write saja.
create or replace function public.track_visit(
  p_hash     text,
  p_reverses bigint default null,
  p_prd      bigint default null,
  p_members  bigint default null
)
returns public.site_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_stats;
begin
  insert into public.visitor_hits as vh (hash, hits, first_seen, last_seen)
  values (p_hash, 1, now(), now())
  on conflict (hash) do update
    set hits = vh.hits + 1,
        last_seen = now();

  -- Buang jejak lebih tua dari 30 hari.
  delete from public.visitor_hits where last_seen < now() - interval '30 days';

  update public.site_stats
     set total_visits    = total_visits + 1,
         unique_visitors = (select count(*) from public.visitor_hits),
         live_now        = (
           select count(*) from public.visitor_hits
           where last_seen > now() - interval '5 minutes'
         ),
         reverses        = coalesce(p_reverses, reverses),
         prd             = coalesce(p_prd, prd),
         members         = coalesce(p_members, members),
         updated_at      = now()
   where id = 1
  returning * into v_row;

  return v_row;
end $$;

-- ---------- Fungsi: refresh angka turunan ----------
-- Dipakai saat counter aplikasi berubah (selesai reverse / PRD / user baru).
-- Menulis ke site_stats => memicu event realtime ke semua browser yang terbuka.
create or replace function public.refresh_stats(
  p_reverses bigint default null,
  p_prd      bigint default null,
  p_members  bigint default null
)
returns public.site_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_stats;
begin
  update public.site_stats
     set live_now        = (
           select count(*) from public.visitor_hits
           where last_seen > now() - interval '5 minutes'
         ),
         unique_visitors = (select count(*) from public.visitor_hits),
         reverses        = coalesce(p_reverses, reverses),
         prd             = coalesce(p_prd, prd),
         members         = coalesce(p_members, members),
         updated_at      = now()
   where id = 1
  returning * into v_row;

  return v_row;
end $$;

-- ---------- Fungsi: heartbeat (jaga status "online") ----------
-- Menyegarkan last_seen TANPA menambah total_visits, lalu memperbarui live_now.
-- Dipanggil browser tiap ~60 detik lewat /api/track/heartbeat sehingga angka
-- "sedang online" naik-turun sesuai kenyataan.
create or replace function public.touch_visit(p_hash text)
returns public.site_stats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_stats;
begin
  insert into public.visitor_hits as vh (hash, hits, first_seen, last_seen)
  values (p_hash, 1, now(), now())
  on conflict (hash) do update set last_seen = now();

  update public.site_stats
     set live_now        = (
           select count(*) from public.visitor_hits
           where last_seen > now() - interval '5 minutes'
         ),
         unique_visitors = (select count(*) from public.visitor_hits),
         updated_at      = now()
   where id = 1
  returning * into v_row;

  return v_row;
end $$;

-- ---------- Hak akses fungsi ----------
-- PENTING: Postgres memberi EXECUTE ke PUBLIC secara default. Karena ketiga
-- fungsi ini SECURITY DEFINER (bisa menulis counter & menghapus baris),
-- cabut dari PUBLIC dulu lalu berikan HANYA ke service_role. Tanpa ini,
-- siapa pun yang punya publishable key bisa memanggil RPC dan menggelembungkan
-- statistik.
revoke all on function public.track_visit(text, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.touch_visit(text) from public, anon, authenticated;
revoke all on function public.refresh_stats(bigint, bigint, bigint) from public, anon, authenticated;

grant execute on function public.track_visit(text, bigint, bigint, bigint) to service_role;
grant execute on function public.touch_visit(text) to service_role;
grant execute on function public.refresh_stats(bigint, bigint, bigint) to service_role;

-- Bila pernah menjalankan versi awal skema ini, hapus varian lama track_visit
-- bertanda tangan satu argumen supaya tidak ada fungsi menganggur.
drop function if exists public.track_visit(text);



