# Wyszukujemy we własnej bazie cen, a cenę wybranej oferty odświeżamy na żywo

Ryanair nie ma oficjalnego publicznego API; korzystamy z nieoficjalnych endpointów, które mogą się zmienić lub nas zablokować przy dużej liczbie zapytań. Jedno wyszukiwanie (kilka lotnisk domowych × dokądkolwiek × okno podróży × długość pobytu) to setki kombinacji, więc odpytywanie Ryanaira na żywo przy każdym wyszukiwaniu byłoby wolne i ryzykowne. Dlatego w tle regularnie pobieramy ceny do własnej bazy i wyszukiwanie działa wyłącznie na niej, a cenę konkretnej oferty odświeżamy na żywo dopiero, gdy użytkownik ją wybierze. Pierwsza wersja może pominąć odświeżanie na żywo, ale musi pokazywać, jak stara jest zapisana cena.

## Considered Options

- **Odpytywanie na żywo przy każdym wyszukiwaniu**: zawsze aktualne ceny, ale wolne wyszukiwanie i wysokie ryzyko blokady.
- **Tylko własna baza bez odświeżania**: proste i szybkie, ale użytkownik może trafić na nieaktualną cenę.
