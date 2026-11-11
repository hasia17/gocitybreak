import { httpResource } from '@angular/common/http';
import { Component } from '@angular/core';
import { Search } from './search/search';

/** Response of the backend's GET /api/status. */
interface ApiStatus {
  status: string;
  version: string;
  database: { status: string; schemaVersion?: number };
}

@Component({
  selector: 'app-root',
  imports: [Search],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly apiStatus = httpResource<ApiStatus>(() => '/api/status');
}
