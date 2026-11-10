# gocitybreak

Wyszukiwarka tanich lotów na krótkie wyjazdy (city breaki), na start oparta wyłącznie na lotach Ryanaira.

Pojęcia są po polsku; kod jest po angielsku i używa nazw podanych przy każdym pojęciu jako _W kodzie_.

## Język

**Lot**:
Pojedynczy przelot z jednego lotniska na drugie w konkretnym dniu i o konkretnej godzinie, z ceną.
_W kodzie_: `Flight`
_Unikaj_: połączenie, przelot

**Odcinek**:
Droga z lotniska początkowego do docelowego w jedną stronę, złożona z jednego lub więcej lotów (odcinek tam, odcinek powrotny).
_W kodzie_: `Leg` (`outbound`, `inbound`)
_Unikaj_: etap, kierunek, segment, journey

**Lot bezpośredni**:
Odcinek złożony z dokładnie jednego lotu.
_W kodzie_: `Leg.isDirect`
_Unikaj_: non-stop

**Samodzielna przesiadka**:
Odcinek sklejony z kilku osobnych lotów kupowanych jako osobne bilety; ryzyko spóźnienia na kolejny lot leży po stronie podróżnego.
_W kodzie_: `SelfTransfer`
_Unikaj_: połączenie z przesiadką, connection

**Oferta**:
Pojedynczy wynik wyszukiwania z łączną ceną: albo tam i z powrotem (odcinek tam + odcinek powrotny), albo w jedną stronę (jeden odcinek).
_W kodzie_: `Offer`
_Unikaj_: połączenie, wynik, wycieczka, deal, result, trip

**Oferta tam i z powrotem**:
Oferta złożona z odcinka tam i odcinka powrotnego; podstawowy rodzaj oferty.
_W kodzie_: `RoundTripOffer`
_Unikaj_: return (myli się z odcinkiem powrotnym)

**Oferta w jedną stronę**:
Oferta złożona z jednego odcinka.
_W kodzie_: `OneWayOffer`

**Obsługiwane lotnisko**:
Lotnisko, z którego trasy pobieramy do naszej bazy cen; na razie wyłącznie polskie lotniska Ryanaira.
_W kodzie_: `SupportedAirport`

**Lotniska domowe**:
Wybrany przez użytkownika spośród obsługiwanych lotnisk zbiór lotnisk, z których może wylecieć i na które może wrócić; lot powrotny może lądować na innym lotnisku domowym niż to, z którego był wylot.
_W kodzie_: `homeAirports`
_Unikaj_: lotniska wylotu, origin

**Cel**:
Określenie, dokąd użytkownik chce lecieć: wybrane lotniska, miasta lub kraje (dowolnie wiele) albo „dokądkolwiek”, pomniejszone o wykluczenia.
_W kodzie_: `Destination`
_Unikaj_: destynacja, kierunek

**Dokądkolwiek**:
Cel obejmujący wszystkie lotniska osiągalne z lotnisk domowych.
_W kodzie_: `Anywhere`
_Unikaj_: everywhere

**Miasto**:
Grupa lotnisk, które Ryanair przypisuje do danej nazwy miasta, także tych leżących daleko od niego (np. Mediolan obejmuje Bergamo); oferta zawsze pokazuje konkretne lotnisko.
_W kodzie_: `City`
_Unikaj_: lokalizacja, destynacja

**Wykluczenie**:
Miejsce, które użytkownik usuwa z celu, żeby nie dostawać do niego ofert.
_W kodzie_: `Exclusion`
_Unikaj_: blacklista, filtr

## Terminy

**Okno podróży**:
Zakres dat, w którym musi się zmieścić cała oferta: lot tam najwcześniej pierwszego dnia, lot powrotny najpóźniej ostatniego (w ofercie w jedną stronę: jedyny lot w tym zakresie).
_W kodzie_: `TravelWindow`
_Unikaj_: okno wylotu, zakres dat, termin

**Długość pobytu**:
Zakres liczby nocy między lotem tam a lotem powrotnym w ofercie tam i z powrotem.
_W kodzie_: `StayLength` (w nocach)
_Unikaj_: liczba dni, czas trwania, duration

**Przedział godzin**:
Opcjonalny zakres godzin, w którym musi wypaść wylot lub przylot danego odcinka, żeby oferta została pokazana.
_W kodzie_: `TimeRange`
_Unikaj_: dobre godziny, wygoda

## Urlop

**Dzień roboczy**:
Dzień od poniedziałku do piątku, który nie jest polskim świętem ustawowo wolnym od pracy.
_W kodzie_: `WorkingDay`
_Unikaj_: dzień pracujący, business day

**Koniec pracy**:
Ustawiana przez użytkownika godzina, po której wylot nie zabiera mu dnia roboczego.
_W kodzie_: `workEnd`

**Początek pracy**:
Ustawiana przez użytkownika godzina, przed którą powrót nie zabiera mu dnia roboczego.
_W kodzie_: `workStart`

**Dni urlopu**:
Liczba dni roboczych od dnia wylotu do dnia powrotu włącznie, z pominięciem dnia wylotu, gdy lot tam startuje po końcu pracy, i dnia powrotu, gdy lot powrotny ląduje przed początkiem pracy.
_W kodzie_: `leaveDays`
_Unikaj_: dni wolne, urlop, vacationDays, daysOff

## Cena

**Cena oferty**:
Suma cen lotów oferty dla jednego dorosłego pasażera w najtańszej taryfie, czyli z samym małym bagażem pod siedzenie (bez walizki kabinowej).
_W kodzie_: `Offer.price`
_Unikaj_: cena łączna, cena za wszystkich, total

**Zapisana cena**:
Cena lotu pobrana wcześniej w tle i przechowywana w naszej bazie, wraz z momentem pobrania; na niej działa wyszukiwanie.
_W kodzie_: `StoredPrice`
_Unikaj_: cena z cache, stara cena, cachedPrice

**Aktualna cena**:
Cena lotu pobrana z Ryanaira na żywo w chwili, gdy użytkownik wybiera ofertę.
_W kodzie_: `LivePrice`
_Unikaj_: cena rzeczywista, currentPrice

**Cena za noc**:
Łączna cena oferty tam i z powrotem podzielona przez liczbę nocy pobytu.
_W kodzie_: `pricePerNight`
_Unikaj_: cena za dzień
