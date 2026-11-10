// Copies the UI apps into the app router's local resources for the MTA build (no bundling, no code changes).
// The UI5 runtime is loaded from the SAPUI5 CDN exactly as in development (index.html).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..', '..');
const target = join(root, 'app', 'router', 'resources');
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const app of ['home', 'case-worklist', 'investigation-studio']) {
  // Sample import files are development material; they are not shipped (the import action is disabled in production).
  cpSync(join(root, 'app', app, 'webapp'), join(target, app), { recursive: true, filter: src => !src.includes(`${app}/webapp/samples`) });
}
// Single entry point (launchpad sandbox with both apps) and the public signed-out page.
for (const page of ['launchpad.html', 'logout.html']) cpSync(join(root, 'app', page), join(target, page));
console.log(`staged UI apps into ${target}`);
