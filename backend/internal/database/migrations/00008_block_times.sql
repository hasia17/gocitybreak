-- The scheduled block time (gate to gate) an airline flies a route at a departure time of day, learnt from the
-- airline's flight status of near flights (ADR-0008), and when the worker last read each route's flight status.

-- +goose Up
CREATE TABLE route_block_times (
    airline           text        NOT NULL,
    departure_airport char(3)     NOT NULL,
    arrival_airport   char(3)     NOT NULL,
    -- The scheduled departure's local time of day.
    departure_time    time        NOT NULL,
    block_minutes     integer     NOT NULL CHECK (block_minutes > 0),
    observed_at       timestamptz NOT NULL,
    PRIMARY KEY (airline, departure_airport, arrival_airport, departure_time)
);

CREATE TABLE route_schedule_refreshes (
    airline           text        NOT NULL,
    departure_airport char(3)     NOT NULL,
    arrival_airport   char(3)     NOT NULL,
    refreshed_at      timestamptz NOT NULL,
    PRIMARY KEY (airline, departure_airport, arrival_airport)
);

-- +goose Down
DROP TABLE route_schedule_refreshes;
DROP TABLE route_block_times;
