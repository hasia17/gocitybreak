-- Every flight belongs to an airline, and refreshes are recorded per airline (GLOSSARY: Airline).
-- Everything stored so far is Ryanair's.

-- +goose Up
ALTER TABLE flights ADD COLUMN airline text NOT NULL DEFAULT 'ryanair';
ALTER TABLE flights ALTER COLUMN airline DROP DEFAULT;
-- +goose StatementBegin
DO $$
DECLARE name text;
BEGIN
    -- The old unique constraint was named by Postgres; it is the only unique constraint of flights.
    SELECT conname INTO name FROM pg_constraint WHERE conrelid = 'flights'::regclass AND contype = 'u';
    EXECUTE format('ALTER TABLE flights DROP CONSTRAINT %I', name);
END $$;
-- +goose StatementEnd
ALTER TABLE flights ADD CONSTRAINT flights_airline_route_departure_key
    UNIQUE (airline, departure_airport, arrival_airport, departure_date, departure_time);

ALTER TABLE route_month_refreshes ADD COLUMN airline text NOT NULL DEFAULT 'ryanair';
ALTER TABLE route_month_refreshes ALTER COLUMN airline DROP DEFAULT;
ALTER TABLE route_month_refreshes DROP CONSTRAINT route_month_refreshes_pkey;
ALTER TABLE route_month_refreshes ADD PRIMARY KEY (airline, departure_airport, arrival_airport, month);

-- +goose Down
ALTER TABLE route_month_refreshes DROP CONSTRAINT route_month_refreshes_pkey;
DELETE FROM route_month_refreshes WHERE airline <> 'ryanair';
ALTER TABLE route_month_refreshes DROP COLUMN airline;
ALTER TABLE route_month_refreshes ADD PRIMARY KEY (departure_airport, arrival_airport, month);

ALTER TABLE flights DROP CONSTRAINT flights_airline_route_departure_key;
DELETE FROM flights WHERE airline <> 'ryanair';
ALTER TABLE flights DROP COLUMN airline;
ALTER TABLE flights ADD UNIQUE (departure_airport, arrival_airport, departure_date, departure_time);
