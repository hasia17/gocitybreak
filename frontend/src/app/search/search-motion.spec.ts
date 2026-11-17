import { useSearchClock } from './search-testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTestI18n } from '../i18n/testing';
import { fillPlace, flushCatalogue, removeAnywhere } from './place-testing';
import { Search } from './search';

useSearchClock();

/** Motion through the visible form, with Angular animations switched on (#80, spec #79). */
describe('Search validation message motion', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Search],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTestI18n()],
      animationsEnabled: true,
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(Search);
    flushCatalogue();
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('shows an alert after an invalid submit and removes it once the field is fixed', async () => {
    const { fixture, root } = await render();
    removeAnywhere(root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Choose at least one home airport.');

    fillPlace(root, 'From', 'KRK');
    await fixture.whenStable();
    await fixture.whenStable();
    expect(root.textContent).not.toContain('Choose at least one home airport.');
  });
});
