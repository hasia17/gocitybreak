import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Texts } from '../i18n/texts';
import { DestinationGroup } from './destination-groups';

/** The results board of destination groups: one row per destination airport. */
@Component({
  selector: 'app-destination-group-list',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './destination-group-list.css',
  templateUrl: './destination-group-list.html',
})
export class DestinationGroupList {
  /** Groups in the order to show them. */
  readonly groups = input.required<DestinationGroup[]>();
  /** Changes when the board should start again from the first page, all closed: a new search or sort. */
  readonly pageKey = input<unknown>();
  /** Texts of the interface language; undefined until they have loaded. */
  readonly texts = input<Texts | undefined>();
}
