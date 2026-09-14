/**
 * Black → POSITRON → SENSOR UNIVERSE → the field is born. No progress bars.
 * Resolves when the particles should begin to appear.
 */
export function playIntro(root: HTMLElement, skip = false): Promise<void> {
  if (skip) return Promise.resolve();
  const el = document.createElement('div');
  el.className = 'intro';
  el.innerHTML = `<div class="l1">Positron</div><div class="l2">Sensor Universe</div>`;
  root.appendChild(el);

  const at = (ms: number, fn: () => void) => setTimeout(fn, ms);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      resolve();
      at(2400, () => el.remove());
    };
    el.addEventListener('click', finish);
    at(500, () => el.classList.add('s1'));
    at(1900, () => el.classList.add('s2'));
    at(4200, finish);
  });
}
