import { AnimationCallbackEvent } from '@angular/core';

/**
 * An `(animate.leave)` handler that plays the leave class and keeps the leaving element out of
 * Tab, focus and the pointer until it is gone (spec #88). Inert at once drops focus from a button
 * inside it, as removing the element did before it animated. The leave completes when the
 * element's own animations finish, or at once when nothing animates (reduced motion included).
 */
export function leaveOutOfReach(className: string): (event: AnimationCallbackEvent) => void {
  return ({ target, animationComplete }) => {
    const element = target as HTMLElement;
    element.inert = true;
    element.classList.add(className);
    const done = () => animationComplete();
    Promise.all(element.getAnimations().map((animation) => animation.finished)).then(done, done);
  };
}
