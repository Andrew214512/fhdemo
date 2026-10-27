-- Runs Worm's timers every hour: 48-hour request expiry, 24-hour ship
-- reminders, missed 3-day ship windows, lost packages, and 2-day auto-confirm.
-- Needs the pg_cron extension (Supabase: Database → Extensions → pg_cron).

create extension if not exists pg_cron;

select cron.schedule('worm-tick', '7 * * * *', $$select public.worm_tick()$$);
