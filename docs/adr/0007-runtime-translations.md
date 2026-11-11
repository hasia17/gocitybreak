# Translate the interface at runtime from JSON files, in one build

The interface is offered in Polish and English, with more languages to come, and the user switches language from the header without losing what they typed. So the frontend loads its texts at runtime from one JSON file per language (with Transloco), from a single build: switching language needs no reload, adding a language means adding a file, and the deployment of ADR-0004 keeps serving one set of static files. On the first visit the language follows the browser (Polish for `pl`, English otherwise); after that, the user's choice is remembered in the browser. Names of airports, cities and countries are not part of these files: they come from Ryanair in each language, with the catalogue.

## Considered Options

- **Angular's built-in i18n**: no extra library and texts compiled in, but one build per language served under its own path (`/pl/`, `/en/`), so switching reloads the page and Caddy, Docker and the deploy workflow each have to handle every language.
