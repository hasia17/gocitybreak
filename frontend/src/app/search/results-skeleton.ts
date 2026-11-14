import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A few grey result rows that show where offers will appear while a search runs. */
@Component({
  selector: 'app-results-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './results-skeleton.css',
  host: { 'aria-hidden': 'true', 'data-testid': 'skeleton' },
  template: `
    @for (row of rows; track row) {
      <div class="row">
        <span class="bar wide"></span>
        <span class="bar"></span>
        <span class="bar price"></span>
      </div>
    }
  `,
})
export class ResultsSkeleton {
  protected readonly rows = [1, 2, 3, 4];
}
