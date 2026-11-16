-- A flight records whether we estimated its arrival because the airline publishes none (GLOSSARY: Estimated arrival).

-- +goose Up
ALTER TABLE flights ADD COLUMN estimated_arrival boolean NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE flights DROP COLUMN estimated_arrival;
