import { renderSearch, useAnimatedSearch } from './search-testing';

/**
 * Fields that come and go with the kind of offer and the date mode (Latest, Nights), and the
 * leave fields behind the "no leave limit" switch, grow and fold in and out (spec #88).
 * jsdom has no Element.getAnimations, so Angular's animate.enter / animate.leave do not run here:
 * the growing, the row re-sharing its space, the switch's knob and reduced motion are checked by
 * hand in the browser. These specs pin what the DOM does around them: a field that stops applying
 * is gone once it has left, so Tab cannot reach it, and focus stays on the control the user used.
 */
describe('Search changing fields motion', () => {
  useAnimatedSearch();

  /** A control of the field row or the Leave section (the filters reuse some control names). */
  function control(root: HTMLElement, name: string): HTMLInputElement | null {
    return root.querySelector<HTMLInputElement>(
      `.fields input[formControlName="${name}"], #leave-panel input[formControlName="${name}"]`,
    );
  }

  function radio(root: HTMLElement, value: string): HTMLInputElement {
    return root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
  }

  /** Focuses a control and clicks it, as a keyboard or pointer user would. */
  async function use(fixture: { whenStable(): Promise<unknown> }, input: HTMLInputElement) {
    input.focus();
    input.click();
    await fixture.whenStable();
  }

  it('removes Nights once it has left for a one-way search, and brings it back', async () => {
    const { fixture, root } = await renderSearch();
    expect(control(root, 'min')).not.toBeNull();

    await use(fixture, radio(root, 'oneWay'));
    expect(control(root, 'min')).toBeNull();
    expect(control(root, 'max')).toBeNull();
    expect(document.activeElement).toBe(radio(root, 'oneWay'));

    await use(fixture, radio(root, 'roundTrip'));
    expect(control(root, 'min')).not.toBeNull();
    expect(document.activeElement).toBe(radio(root, 'roundTrip'));
  });

  it('removes Nights once it has left for fixed dates', async () => {
    const { fixture, root } = await renderSearch();

    await use(fixture, radio(root, 'fixed'));
    expect(control(root, 'min')).toBeNull();
    expect(control(root, 'to')).not.toBeNull();
    expect(document.activeElement).toBe(radio(root, 'fixed'));
  });

  it('removes Latest once it has left for one-way fixed dates, and brings it back', async () => {
    const { fixture, root } = await renderSearch();
    await use(fixture, radio(root, 'oneWay'));
    expect(control(root, 'to')).not.toBeNull();

    await use(fixture, radio(root, 'fixed'));
    expect(control(root, 'to')).toBeNull();
    expect(document.activeElement).toBe(radio(root, 'fixed'));

    await use(fixture, radio(root, 'flexible'));
    expect(control(root, 'to')).not.toBeNull();
    expect(document.activeElement).toBe(radio(root, 'flexible'));
  });

  it('folds the leave fields away and back with the switch, keeping focus on it', async () => {
    const { fixture, root } = await renderSearch();
    const leaveButton = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'),
    ).find((b) => b.textContent?.trim().startsWith('Leave'))!;
    leaveButton.click();
    await fixture.whenStable();
    const leaveSwitch = root.querySelector<HTMLInputElement>('input[role="switch"]')!;
    const leaveFields = ['workStart', 'workEnd', 'maxLeaveDays'];
    expect(leaveFields.map((name) => control(root, name))).not.toContain(null);

    await use(fixture, leaveSwitch);
    expect(leaveFields.map((name) => control(root, name))).toEqual([null, null, null]);
    expect(document.activeElement).toBe(leaveSwitch);

    await use(fixture, leaveSwitch);
    expect(leaveFields.map((name) => control(root, name))).not.toContain(null);
    expect(document.activeElement).toBe(leaveSwitch);
  });
});
