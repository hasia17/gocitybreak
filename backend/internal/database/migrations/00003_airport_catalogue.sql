-- The airport catalogue as Ryanair groups it: each airport's city and country (#5).
-- Our own additions to cities (e.g. BGY → Milan) are not stored here.

-- +goose Up
ALTER TABLE airports
    ADD COLUMN city_code    text,
    ADD COLUMN city_name    text,
    -- ISO 3166-1 alpha-2 country code in lower case, as Ryanair returns it (e.g. "pl").
    ADD COLUMN country_code text,
    ADD COLUMN country_name text;

-- +goose Down
ALTER TABLE airports
    DROP COLUMN city_code,
    DROP COLUMN city_name,
    DROP COLUMN country_code,
    DROP COLUMN country_name;
