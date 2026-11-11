# Store prices in their original currency and convert to PLN at search time with the NBP rate

Ryanair prices a flight in its departure airport's currency (BGY→KRK in EUR, KRK→BGY in PLN), and that is what the traveller actually pays. Its `currency=PLN` option converts for us, but at its own rate, which varied between 4.23 and 4.38 PLN/EUR across flights on the same day. So the worker stores each flight's original price (amount and currency) as Ryanair returns it, and search converts it to PLN using the National Bank of Poland's mid-market rate, fetched once a day into our database: table A for the major currencies, and table B (published weekly) for the few Ryanair currencies table A lacks, such as the Moroccan dirham (MAD) on flights from Morocco. The offer price is shown in PLN, marked as approximate ("≈") when any flight is in another currency, and each such flight also shows its original amount.

## Considered Options

- **Fetch everything with `currency=PLN`**: no rate source to maintain, but the stored amount is neither what the traveller pays nor a consistent conversion, and changing our mind later means re-fetching all prices.
