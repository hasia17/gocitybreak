-- Catalogue names share airport/city/country codes and are keyed by interface language.
-- +goose Up
ALTER TABLE airports
    ADD COLUMN names jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN city_names jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN country_names jsonb NOT NULL DEFAULT '{}';
UPDATE airports SET
    names = jsonb_build_object('en', name),
    city_names = CASE WHEN city_name IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('en', city_name) END,
    country_names = CASE WHEN country_name IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('en', country_name) END;

-- +goose Down
ALTER TABLE airports DROP COLUMN names, DROP COLUMN city_names, DROP COLUMN country_names;
