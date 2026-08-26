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
