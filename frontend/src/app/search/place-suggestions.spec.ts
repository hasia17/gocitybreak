import { restorePlaces, suggestPlaces } from './place-suggestions';
import { Catalogue } from './search-api';
import en from '../../../public/i18n/en.json';
import pl from '../../../public/i18n/pl.json';

const anywhere = { name: en.places.anywhere, names: [en.places.anywhere, pl.places.anywhere] };

const catalogue: Catalogue = {
  supportedAirports: [
    { code: 'KRK', name: 'Kraków' },
    { code: 'KTW', name: 'Katowice' },
  ],
  airports: [
    {
      code: 'KRK',
      name: 'Kraków',
      names: { en: 'Krakow', pl: 'Kraków' },
      cities: ['KRAKOW'],
      country: 'pl',
    },
    { code: 'KTW', name: 'Katowice', cities: ['KATOWICE'], country: 'pl' },
    {
      code: 'BGY',
      name: 'Milan Bergamo',
      names: { pl: 'Mediolan-Bergamo' },
      cities: ['MILAN'],
      country: 'it',
    },
    { code: 'MXP', name: 'Milan Malpensa', cities: ['MILAN'], country: 'it' },
    { code: 'STN', name: 'London Stansted', cities: ['LONDON'], country: 'gb' },
  ],
  cities: [
    { code: 'KRAKOW', name: 'Kraków', airports: ['KRK'], country: 'pl' },
    {
      code: 'MILAN',
      name: 'Milan',
      names: { pl: 'Mediolan' },
      airports: ['BGY', 'MXP'],
      country: 'it',
    },
    { code: 'LONDON', name: 'London', airports: ['STN'], country: 'gb' },
  ],
  countries: [
    { code: 'pl', name: 'Poland', names: { pl: 'Polska' } },
    { code: 'it', name: 'Italy', names: { pl: 'Włochy' } },
    { code: 'gb', name: 'United Kingdom' },
  ],
};

describe('place suggestions', () => {
  it.each(['krakow', 'KRAKÓW', 'kra'])(
    'matches word prefixes without case or diacritics: %s',
    (text) => {
      expect(
        suggestPlaces(text, catalogue, 'destination', [], [], 'en').map((p) => p.value),
      ).toEqual(['city:KRAKOW', 'KRK']);
    },
  );
});

describe('catalogue suggestion rules', () => {
  const values = (
    text: string,
    field: 'homeAirports' | 'destination' | 'exclusions' = 'destination',
    selected: string[] = [],
    excluded: string[] = [],
  ) =>
    suggestPlaces(text, catalogue, field, selected, excluded, 'en', anywhere).map((p) => p.value);
  it('matches consecutive words, any name language, and code prefixes', () => {
    expect(values('london st')).toEqual(['STN']);
    expect(values('medi')).toEqual(['city:MILAN', 'BGY']);
    expect(values('wlo')).toEqual(['country:it']);
    expect(values('st')).toEqual(['STN']);
    expect(values('don')).toEqual([]);
  });
  it('prioritizes an exact airport code, then cities, countries and alphabetical airports', () => {
    const c: Catalogue = {
      ...catalogue,
      cities: [...catalogue.cities, { code: 'BGYCITY', name: 'BGY City', airports: ['BGY'] }],
      countries: [...catalogue.countries, { code: 'xx', name: 'BGY Country' }],
    };
    expect(suggestPlaces('BGY', c, 'destination').map((p) => p.value)).toEqual([
      'BGY',
      'city:BGYCITY',
      'country:xx',
    ]);
    expect(values('mil')).toEqual(['city:MILAN', 'BGY', 'MXP']);
  });
  it('hides selected and fully excluded coverage while retaining partly available cities', () => {
    expect(values('mil', 'destination', [], ['country:it'])).toEqual([]);
    expect(values('mil', 'destination', [], ['BGY'])).toEqual(['city:MILAN', 'MXP']);
    expect(values('mil', 'destination', ['city:MILAN'])).toEqual([]);
    expect(values('mil', 'exclusions', ['BGY'])).toEqual(['city:MILAN', 'MXP']);
  });
  it('offers Anywhere only for To and Poland plus only supported airports for From', () => {
    expect(values('any')).toEqual(['anywhere']);
    expect(values('any', 'exclusions')).toEqual([]);
    expect(values('', 'homeAirports')).toEqual(['country:pl', 'KTW', 'KRK']);
    expect(values('pol', 'homeAirports')).toEqual(['country:pl']);
    expect(values('', 'destination', ['anywhere'])).toEqual([]);
  });
  it.each(['en', 'pl'])('matches either dictionary name for Anywhere in %s', (language) => {
    const label = {
      ...anywhere,
      name: language === 'pl' ? pl.places.anywhere : en.places.anywhere,
    };
    for (const text of ['Anywhere', 'Gdziekolwiek']) {
      const matches = suggestPlaces(text, catalogue, 'destination', [], [], language, label);
      expect(matches.map((p) => ({ value: p.value, name: p.name }))).toEqual([
        { value: 'anywhere', name: label.name },
      ]);
    }
    expect(restorePlaces('Gdziekolwiek', catalogue, 'destination', label)).toBe('anywhere');
  });
  it.each([
    ['Polish', 'tel aw'],
    ['English', 'tel aviv'],
  ])('finds an airport only Wizz Air flies to by its %s name', (_language, text) => {
    // A Wizz Air airport no city of ours knows is a city of its own, named like itself in both languages.
    const names = { en: 'Tel Aviv', pl: 'Tel Awiw' };
    const c: Catalogue = {
      ...catalogue,
      airports: [
        ...catalogue.airports,
        { code: 'TLV', name: 'Tel Aviv', names, cities: ['TLV'], country: 'il' },
      ],
      cities: [
        ...catalogue.cities,
        { code: 'TLV', name: 'Tel Aviv', names, airports: ['TLV'], country: 'il' },
      ],
      countries: [...catalogue.countries, { code: 'il', name: 'Israel', names: { pl: 'Izrael' } }],
    };
    expect(suggestPlaces(text, c, 'destination', [], [], 'en').map((p) => p.value)).toEqual([
      'city:TLV',
      'TLV',
    ]);
  });
  it('returns every match without truncation', () => {
    const c: Catalogue = {
      ...catalogue,
      airports: Array.from({ length: 30 }, (_, i) => ({
        code: 'A' + i,
        name: 'Airport ' + i,
        cities: [],
      })),
    };
    expect(suggestPlaces('Airport', c, 'destination')).toHaveLength(30);
  });
  it('restores canonical identifiers and old exact translated names but drops unknown values', () => {
    expect(restorePlaces('Mediolan, BGY, Atlantis', catalogue, 'destination')).toBe(
      'city:MILAN, BGY',
    );
    expect(restorePlaces('Polska', catalogue, 'homeAirports')).toBe('KRK, KTW');
    expect(restorePlaces('BGY, KRK', catalogue, 'homeAirports')).toBe('KRK');
    expect(restorePlaces('country:it, city:MILAN', catalogue, 'destination')).toBe(
      'country:it, city:MILAN',
    );
    expect(restorePlaces({ airports: ['KRK'] }, catalogue, 'homeAirports')).toBe('');
  });
});
