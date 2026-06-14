import { Component } from '@angular/core';

@Component({
  selector: 'app-inbox',
  standalone: true,
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-semibold">Inbox</h1>
      <p class="mt-2 text-slate-400">Module coming in its own commit.</p>
    </div>
  `,
})
export class InboxComponent {}
