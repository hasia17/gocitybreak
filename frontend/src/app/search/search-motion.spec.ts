import { fillPlace, removeAnywhere } from './place-testing';
import { renderSearch, useAnimatedSearch } from './search-testing';

/** Motion through the visible form, with Angular animations switched on (#80, spec #79). */
describe('Search validation message motion', () => {
  useAnimatedSearch();

  it('shows an alert after an invalid submit and removes it once the field is fixed', async () => {
    const { fixture, root } = await renderSearch();
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
