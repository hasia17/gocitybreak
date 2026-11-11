-- When the worker last stored the prices of a route in a month (Ryanair's API answers month by month),
-- so near months can be refreshed more often than far ones.

-- +goose Up
CREATE TABLE route_month_refreshes (
    departure_airport char(3)     NOT NULL,
    arrival_airport   char(3)     NOT NULL,
    -- The first day of the month.
    month             date        NOT NULL,
    refreshed_at      timestamptz NOT NULL,
    PRIMARY KEY (departure_airport, arrival_airport, month)
);

-- +goose Down
DROP TABLE route_month_refreshes;
