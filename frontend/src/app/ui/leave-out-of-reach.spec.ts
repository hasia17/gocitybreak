import { leaveOutOfReach } from './leave-out-of-reach';

/**
 * Angular only runs animate.leave in a browser (jsdom has no getAnimations), so this pins the
 * leave on a jsdom element whose running animation the test controls.
 */
describe('leaveOutOfReach', () => {
  function leaving() {
    const element = document.createElement('span');
    element.innerHTML = '<button type="button">×</button>';
    document.body.appendChild(element);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    element.getAnimations = () => [{ finished } as unknown as Animation];
    const animationComplete = vi.fn();
    return { element, finish, animationComplete };
  }

  afterEach(() => document.body.replaceChildren());

  it('takes the leaving element out of Tab and pointer reach at once, with the leave class', () => {
    const { element, animationComplete } = leaving();

    leaveOutOfReach('chip-leave')({ target: element, animationComplete });

    expect(element.inert).toBe(true);
    expect(element.classList.contains('chip-leave')).toBe(true);
    expect(animationComplete).not.toHaveBeenCalled();
  });

  it('completes the leave once its animation has finished', async () => {
    const { element, finish, animationComplete } = leaving();
    leaveOutOfReach('chip-leave')({ target: element, animationComplete });

    finish();
    await Promise.resolve();
    await Promise.resolve();

    expect(animationComplete).toHaveBeenCalledOnce();
  });

  it('completes the leave at once when nothing animates', async () => {
    const { element, animationComplete } = leaving();
    element.getAnimations = () => [];

    leaveOutOfReach('chip-leave')({ target: element, animationComplete });
    await Promise.resolve();
    await Promise.resolve();

    expect(animationComplete).toHaveBeenCalledOnce();
  });
});
