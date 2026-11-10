-- Baseline migration: establishes schema versioning. Domain tables arrive with the first search (#4).

-- +goose Up
SELECT 1;

-- +goose Down
SELECT 1;
