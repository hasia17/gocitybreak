-- Hand-made sample data for local development, until the price worker (#5) fills the database.
-- Dates are relative to today, so the data stays searchable. Safe to re-run: it only adds missing sample rows
-- and never changes or deletes existing ones, including prices stored by the worker.
--
--   docker compose exec -T postgres psql -U gocitybreak -d gocitybreak < backend/seed/dev.sql

BEGIN;

INSERT INTO airports (code, name, time_zone, supported) VALUES
    ('KRK', 'Kraków', 'Europe/Warsaw', true),
    ('KTW', 'Katowice', 'Europe/Warsaw', true),
    ('WRO', 'Wrocław', 'Europe/Warsaw', true),
    ('BGY', 'Milan Bergamo', 'Europe/Rome', false),
    ('CIA', 'Rome Ciampino', 'Europe/Rome', false),
    ('STN', 'London Stansted', 'Europe/London', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO exchange_rates (currency, rate_date, rate) VALUES
    ('EUR', CURRENT_DATE - 1, 4.2512),
    ('GBP', CURRENT_DATE - 1, 4.9873)
ON CONFLICT (currency, rate_date) DO NOTHING;

-- Every route flies every day for the next 60 days; prices vary with the day.
INSERT INTO flights (departure_airport, arrival_airport,
    departure_date, departure_time, arrival_date, arrival_time,
    price_amount, price_currency, fetched_at)
SELECT r.dep, r.arr, d::date, r.dep_time, d::date, r.arr_time,
    r.base + (extract(doy FROM d)::int * 37 % 9) * r.step, r.currency,
    now() - (extract(doy FROM d)::int % 12) * interval '1 hour'
FROM generate_series(CURRENT_DATE + 1, CURRENT_DATE + 60, interval '1 day') AS d
CROSS JOIN (VALUES
    ('KRK', 'BGY', time '06:15', time '08:10', 4900, 1500, 'PLN'),
    ('KRK', 'BGY', time '18:40', time '20:35', 7900, 2000, 'PLN'),
    ('BGY', 'KRK', time '09:00', time '10:50', 1499, 500, 'EUR'),
    ('KTW', 'CIA', time '07:30', time '09:45', 5900, 2500, 'PLN'),
    ('CIA', 'KTW', time '10:25', time '12:35', 1999, 700, 'EUR'),
    ('WRO', 'STN', time '12:05', time '13:30', 9900, 3000, 'PLN'),
    ('STN', 'WRO', time '14:10', time '17:25', 2499, 900, 'GBP')
) AS r(dep, arr, dep_time, arr_time, base, step, currency)
ON CONFLICT (departure_airport, arrival_airport, departure_date, departure_time) DO NOTHING;

COMMIT;
