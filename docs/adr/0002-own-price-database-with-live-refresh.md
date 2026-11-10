# Search runs on our own price database; the selected offer's price is refreshed live

Ryanair has no official public API; we use unofficial endpoints that can change or block us under a high request volume. A single search (several home airports × anywhere × travel window × stay length) means hundreds of combinations, so querying Ryanair live on every search would be slow and risky. Instead, a background worker regularly fetches prices into our own database and search runs exclusively on it, while the price of a specific offer is refreshed live only when the user selects it. The first version may skip the live refresh, but it must show how old the stored price is.

## Considered Options

- **Query Ryanair live on every search**: always-current prices, but slow searches and a high risk of being blocked.
- **Own database only, no live refresh**: simple and fast, but the user may hit a stale price.
