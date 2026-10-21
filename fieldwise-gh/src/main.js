import './styles.css';
import { startApp } from './ui/app.js';

const root = document.getElementById('app');
try {
  startApp(root);
} catch (e) {
  console.error(e);
  root.textContent = 'FieldWise could not start. Try reloading the page, or clearing this site\'s data if the problem continues.';
}
