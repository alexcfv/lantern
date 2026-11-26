import { createApp } from './app.js';
import { loadSettings } from './config.js';
const settings = loadSettings();
createApp().listen(settings.port, '0.0.0.0', () => {
    console.log(`agents server listening on ${settings.port}`);
});
