-- Airports, flights with their stored prices, and exchange rates (ADR-0002, ADR-0005, ADR-0006).

-- +goose Up
CREATE TABLE airports (
    code      char(3) PRIMARY KEY,
    name      text    NOT NULL,
    -- IANA time zone in which the airport's local times are expressed.
    time_zone text    NOT NULL,
    -- A supported airport: one whose routes we fetch into the price database.
    supported boolean NOT NULL DEFAULT false
);

-- A flight with its stored price. Times are local times at the respective airport.
CREATE TABLE flights (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    departure_airport char(3) NOT NULL REFERENCES airports (code),
    arrival_airport   char(3) NOT NULL REFERENCES airports (code),
    departure_date    date    NOT NULL,
    departure_time    time    NOT NULL,
    arrival_date      date    NOT NULL,
    arrival_time      time    NOT NULL,
    -- Original price in minor units (e.g. grosze, cents) and its currency;
    -- NULL when the flight could not be priced (ADR-0005 fallback), such flights are excluded from search.
    price_amount      bigint,
    price_currency    char(3),
    fetched_at        timestamptz NOT NULL,
    UNIQUE (departure_airport, arrival_airport, departure_date, departure_time),
    CHECK ((price_amount IS NULL) = (price_currency IS NULL))
);

CREATE INDEX flights_route_date ON flights (departure_airport, arrival_airport, departure_date);

-- Official NBP mid-market rate (table A): how many PLN one unit of the currency is worth on the given day.
CREATE TABLE exchange_rates (
    currency  char(3)        NOT NULL,
    rate_date date           NOT NULL,
    rate      numeric(12, 6) NOT NULL CHECK (rate > 0),
    PRIMARY KEY (currency, rate_date)
);

-- +goose Down
DROP TABLE exchange_rates;
DROP TABLE flights;
DROP TABLE airports;
