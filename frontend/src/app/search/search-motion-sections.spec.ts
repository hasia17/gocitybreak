import { fillPlace, removeAnywhere } from './place-testing';
import { renderSearch, useAnimatedSearch } from './search-testing';

/** Motion of the Leave and Filters panels, kept toggled with [hidden] (#84, spec #79). */
describe('Search section panel motion', () => {
  useAnimatedSearch();

  function sectionButton(root: HTMLElement, name: string): HTMLButtonElement {
    const found = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
    ).find((b) => b.textContent?.trim().startsWith(name));
    if (!found) throw new Error(`no section button ${name}`);
    return found;
  }

  function panel(root: HTMLElement, id: string): HTMLElement {
    return root.querySelector<HTMLElement>(`#${id}`)!;
  }

  it.each([
    ['Leave', 'leave-panel'],
    ['Filters', 'filters-panel'],
  ])('makes the %s panel inert at once while it closes', async (name, id) => {
    const { fixture, root } = await renderSearch();
    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(false);
    expect(panel(root, id).hasAttribute('inert')).toBe(false);

    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(true);
    expect(panel(root, id).hasAttribute('inert')).toBe(true);

    sectionButton(root, name).click();
    await fixture.whenStable();
    expect(panel(root, id).hidden).toBe(false);
    expect(panel(root, id).hasAttribute('inert')).toBe(false);
  });

  it('still opens a closed Leave section to show a blocking field inside it', async () => {
    const { fixture, root } = await renderSearch();
    removeAnywhere(root);
    fillPlace(root, 'From', 'KRK');
    fillPlace(root, 'To', 'BGY');
    const earliest = root.querySelector<HTMLInputElement>('input[formControlName="from"]')!;
    earliest.value = '2026-12-01';
    earliest.dispatchEvent(new Event('input'));
    const workStart = root.querySelector<HTMLInputElement>('input[formControlName="workStart"]')!;
    expect(panel(root, 'leave-panel').hidden).toBe(true);
    workStart.value = '';
    workStart.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    expect(panel(root, 'leave-panel').hidden).toBe(false);
    expect(panel(root, 'leave-panel').hasAttribute('inert')).toBe(false);
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Enter your work start time.',
    );
  });

  it('arms the fold transitions only once the user acts, not on page load', async () => {
    const { fixture, root } = await renderSearch();
    expect(root.classList.contains('motion-armed')).toBe(false);
    sectionButton(root, 'Filters').click();
    await fixture.whenStable();
    expect(root.classList.contains('motion-armed')).toBe(true);
  });
});
