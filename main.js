import { html } from './components/html.js';
import { Root } from './components/Root.js';

const root = document.getElementById('root');
window.ReactDOM.createRoot(root).render(html`<${Root} />`);
