package pricestore

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/hasia17/gocitybreak/backend/internal/airline"
)

// BlockKey names a scheduled block time: the airline's route and the local time of day ("15:04") of its departure.
type BlockKey struct {
	Airline  airline.Airline
	From, To string
	Time     string
}

// ReplaceBlockTimes stores the block times airline a's flight status gave for the route from → to, each by the
// local time of day ("15:04") of the departure, and records observedAt as the route's last flight status read. It
// then gives every stored flight of the route whose departure time has a block time its scheduled arrival (the
// departure plus the block time, in the arrival airport's time zone), no longer estimated. Block times of other
// departure times are kept, so a seasonal flight's is remembered while it doesn't fly.
func (s *Store) ReplaceBlockTimes(ctx context.Context, a airline.Airline, from, to string, blocks map[string]time.Duration, observedAt time.Time) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		b := &pgx.Batch{}
		for at, block := range blocks {
			b.Queue(`INSERT INTO route_block_times
    (airline, departure_airport, arrival_airport, departure_time, block_minutes, observed_at)
VALUES ($1, $2, $3, $4::text::time, $5, $6)
ON CONFLICT (airline, departure_airport, arrival_airport, departure_time) DO UPDATE SET
    block_minutes = EXCLUDED.block_minutes,
    observed_at = EXCLUDED.observed_at`, string(a), from, to, at, int(block/time.Minute), observedAt)
		}
		b.Queue(`INSERT INTO route_schedule_refreshes (airline, departure_airport, arrival_airport, refreshed_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (airline, departure_airport, arrival_airport) DO UPDATE SET
    refreshed_at = EXCLUDED.refreshed_at`, string(a), from, to, observedAt)
		// The departure's wall clock is read in the departure airport's zone to get the instant, which the block
		// time moves on, and the result is read in the arrival airport's zone again.
		b.Queue(`WITH moved AS (
    SELECT f.departure_date, f.departure_time, l.arrival
    FROM flights f
    JOIN route_block_times bt ON bt.airline = f.airline AND bt.departure_airport = f.departure_airport
        AND bt.arrival_airport = f.arrival_airport AND bt.departure_time = f.departure_time
    JOIN airports dep ON dep.code = f.departure_airport
    JOIN airports arr ON arr.code = f.arrival_airport
    CROSS JOIN LATERAL (SELECT (((f.departure_date + f.departure_time) AT TIME ZONE dep.time_zone)
                                + make_interval(mins => bt.block_minutes)) AT TIME ZONE arr.time_zone AS arrival) l
    WHERE f.airline = $1 AND f.departure_airport = $2 AND f.arrival_airport = $3
)
UPDATE flights f
SET arrival_date = m.arrival::date, arrival_time = m.arrival::time, estimated_arrival = false
FROM moved m
WHERE f.airline = $1 AND f.departure_airport = $2 AND f.arrival_airport = $3
  AND f.departure_date = m.departure_date AND f.departure_time = m.departure_time
  AND (f.estimated_arrival OR f.arrival_date IS DISTINCT FROM m.arrival::date
       OR f.arrival_time IS DISTINCT FROM m.arrival::time)`, string(a), from, to)
		if err := tx.SendBatch(ctx, b).Close(); err != nil {
			return fmt.Errorf("store block times %s→%s: %w", from, to, err)
		}
		return nil
	})
}

// BlockTimes reads every scheduled block time of airline a.
func (s *Store) BlockTimes(ctx context.Context, a airline.Airline) (map[BlockKey]time.Duration, error) {
	rows, err := s.pool.Query(ctx, `SELECT departure_airport, arrival_airport, to_char(departure_time, 'HH24:MI'), block_minutes
FROM route_block_times WHERE airline = $1`, string(a))
	if err != nil {
		return nil, fmt.Errorf("read block times: %w", err)
	}
	blocks := map[BlockKey]time.Duration{}
	k := BlockKey{Airline: a}
	var minutes int
	if _, err := pgx.ForEachRow(rows, []any{&k.From, &k.To, &k.Time, &minutes}, func() error {
		blocks[k] = time.Duration(minutes) * time.Minute
		return nil
	}); err != nil {
		return nil, fmt.Errorf("read block times: %w", err)
	}
	return blocks, nil
}

// ScheduleRefreshes reads when airline a's flight status was last read, by route "FROM-TO".
func (s *Store) ScheduleRefreshes(ctx context.Context, a airline.Airline) (map[string]time.Time, error) {
	rows, err := s.pool.Query(ctx, `SELECT departure_airport || '-' || arrival_airport, refreshed_at
FROM route_schedule_refreshes WHERE airline = $1`, string(a))
	if err != nil {
		return nil, fmt.Errorf("read schedule refreshes: %w", err)
	}
	refreshes := map[string]time.Time{}
	var route string
	var at time.Time
	if _, err := pgx.ForEachRow(rows, []any{&route, &at}, func() error {
		refreshes[route] = at
		return nil
	}); err != nil {
		return nil, fmt.Errorf("read schedule refreshes: %w", err)
	}
	return refreshes, nil
}
