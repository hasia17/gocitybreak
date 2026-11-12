import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InfoTip } from './info-tip';

@Component({
  imports: [InfoTip],
  template: `<app-info-tip label="About days" text="Ticked days suit you." />`,
})
class Host {}

describe('InfoTip', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector('button')!;
    const tip = root.querySelector<HTMLElement>('[role="tooltip"]')!;
    const shown = async () => {
      await fixture.whenStable();
      return tip.classList.contains('open');
    };
    return { button, tip, shown };
  }

  it('describes its button with the text, even while closed', async () => {
    const { button, tip, shown } = await render();

    expect(button.getAttribute('aria-label')).toBe('About days');
    expect(document.getElementById(button.getAttribute('aria-describedby')!)).toBe(tip);
    expect(tip.textContent).toBe('Ticked days suit you.');
    expect(await shown()).toBe(false);
  });

  it('opens on hover and closes when the pointer leaves', async () => {
    const { button, shown } = await render();

    button.dispatchEvent(new Event('mouseenter'));
    expect(await shown()).toBe(true);
    button.dispatchEvent(new Event('mouseleave'));
    expect(await shown()).toBe(false);
  });

  it('opens on keyboard focus and closes on Escape or leaving it', async () => {
    const { button, shown } = await render();

    button.dispatchEvent(new FocusEvent('focus'));
    expect(await shown()).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await shown()).toBe(false);
    button.dispatchEvent(new FocusEvent('focus'));
    button.dispatchEvent(new FocusEvent('blur'));
    expect(await shown()).toBe(false);
  });

  it('opens on a tap, which focuses and clicks it, and stays open', async () => {
    const { button, shown } = await render();

    button.dispatchEvent(new FocusEvent('focus'));
    button.click();
    expect(await shown()).toBe(true);
  });
  it('keeps a focused explanation open when the pointer leaves', async () => {
    const { button, shown } = await render();
    button.dispatchEvent(new FocusEvent('focus'));
    button.dispatchEvent(new Event('mouseleave'));
    expect(await shown()).toBe(true);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await shown()).toBe(false);
  });

  it('keeps the explanation inside the viewport when opened near its bottom-right edge', async () => {
    const { button, tip, shown } = await render();
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 990,
      right: 1014,
      top: 750,
      bottom: 774,
      width: 24,
      height: 24,
      x: 990,
      y: 750,
      toJSON: () => ({}),
    });
    vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 288,
      top: 0,
      bottom: 100,
      width: 288,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    button.click();
    expect(await shown()).toBe(true);
    expect(parseFloat(tip.style.left)).toBeLessThanOrEqual(window.innerWidth - 288 - 8);
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat(tip.style.top)).toBeLessThanOrEqual(window.innerHeight - 100 - 8);
    expect(parseFloat(tip.style.top)).toBeGreaterThanOrEqual(8);
  });
});
